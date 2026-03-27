import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  submitStudyToENA,
  submitSamplesToENA,
  generateStudyXml,
  generateSampleXml,
  generateSubmissionXml,
} from "@/lib/ena";

function isExpiredTestRegistration(registeredAt: Date | string | null | undefined): boolean {
  if (!registeredAt) return false;
  return Date.now() - new Date(registeredAt).getTime() >= 24 * 60 * 60 * 1000;
}

class SubmissionInProgressError extends Error {
  constructor(message = "A submission for this study is already in progress") {
    super(message);
    this.name = "SubmissionInProgressError";
  }
}

// GET /api/admin/submissions - List all submissions
export async function GET() {
  const session = await getServerSession(authOptions);

  if (!session || session.user.role !== "FACILITY_ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const submissions = await db.submission.findMany({
      orderBy: { createdAt: "desc" },
    });

    // Enrich submissions with entity details
    const enrichedSubmissions = await Promise.all(
      submissions.map(async (submission) => {
        let entityDetails = null;

        if (submission.entityType === "study") {
          const study = await db.study.findUnique({
            where: { id: submission.entityId },
            select: {
              id: true,
              title: true,
              alias: true,
              studyAccessionId: true,
              user: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  email: true,
                },
              },
            },
          });
          entityDetails = study;
        } else if (submission.entityType === "sample") {
          const sample = await db.sample.findUnique({
            where: { id: submission.entityId },
            select: {
              id: true,
              sampleId: true,
              sampleTitle: true,
              sampleAccessionNumber: true,
              study: {
                select: {
                  id: true,
                  title: true,
                },
              },
            },
          });
          entityDetails = sample;
        }

        return {
          ...submission,
          entityDetails,
          accessionNumbers: submission.accessionNumbers
            ? JSON.parse(submission.accessionNumbers)
            : null,
        };
      })
    );

    return NextResponse.json(enrichedSubmissions);
  } catch (error) {
    console.error("Error fetching submissions:", error);
    return NextResponse.json(
      { error: "Failed to fetch submissions" },
      { status: 500 }
    );
  }
}

// POST /api/admin/submissions - Create a new submission (trigger ENA registration)
export async function POST(request: Request) {
  const session = await getServerSession(authOptions);

  if (!session || session.user.role !== "FACILITY_ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let pendingSubmissionId: string | null = null;
  let pendingSubmissionIsTest: boolean | null = null;

  try {
    const body = await request.json();
    const entityType = body?.entityType;
    const entityId = body?.entityId;
    const requestedIsTest =
      typeof body?.isTest === "boolean" ? body.isTest : undefined;

    if (!entityType || !entityId) {
      return NextResponse.json(
        { error: "entityType and entityId are required" },
        { status: 400 }
      );
    }

    // Get ENA credentials from settings
    const settings = await db.siteSettings.findUnique({
      where: { id: "singleton" },
      select: {
        enaUsername: true,
        enaPassword: true,
        enaTestMode: true,
      },
    });

    const hasCredentials = Boolean(settings?.enaUsername && settings?.enaPassword);

    // Require credentials for any submission
    if (!hasCredentials) {
      return NextResponse.json(
        { error: "ENA credentials not configured. Please configure your Webin credentials in Admin > Data Upload > ENA Configuration." },
        { status: 400 }
      );
    }

    // Respect the caller's explicit target selection when provided.
    const isTestServer = requestedIsTest ?? (settings?.enaTestMode !== false);

    // Validate entity exists
    if (entityType === "study") {
      const study = await db.study.findUnique({
        where: { id: entityId },
        include: {
          samples: {
            include: {
              reads: true,
              order: {
                select: {
                  id: true,
                  customFields: true,
                },
              },
            },
          },
          user: true,
        },
      });

      if (!study) {
        return NextResponse.json({ error: "Study not found" }, { status: 404 });
      }

      // Edge case: Study already submitted to ENA
      if (study.submitted && study.studyAccessionId) {
        return NextResponse.json(
          { error: `Study already registered with ENA (${study.studyAccessionId})` },
          { status: 400 }
        );
      }

      // Edge case: Validate required data
      if (!study.title || study.title.trim() === "") {
        return NextResponse.json(
          { error: "Study title is required for ENA registration" },
          { status: 400 }
        );
      }

      if (!study.description || study.description.trim() === "") {
        return NextResponse.json(
          { error: "Study description is required for ENA registration" },
          { status: 400 }
        );
      }

      if (study.samples.length === 0) {
        return NextResponse.json(
          { error: "Study must have at least one sample for ENA registration" },
          { status: 400 }
        );
      }

      // Edge case: ENA requires a TAXON_ID for every sample
      const samplesWithoutTaxId = study.samples.filter(
        (s) => !s.taxId || s.taxId.trim() === ""
      );
      if (samplesWithoutTaxId.length > 0) {
        return NextResponse.json(
          { error: `${samplesWithoutTaxId.length} sample(s) missing taxonomy ID (TAXON_ID is required by ENA)` },
          { status: 400 }
        );
      }

      const hasProductionStudyRegistration = Boolean(
        study.studyAccessionId && !study.testRegisteredAt
      );
      const hasActiveTestStudyRegistration = Boolean(
        study.studyAccessionId &&
          study.testRegisteredAt &&
          !isExpiredTestRegistration(study.testRegisteredAt)
      );

      if (isTestServer && hasProductionStudyRegistration) {
        return NextResponse.json(
          {
            error:
              "Study already has a production ENA accession. Test re-registration is blocked to avoid overwriting the production accession state.",
          },
          { status: 400 }
        );
      }

      const serverUrl = isTestServer
        ? "https://wwwdev.ebi.ac.uk/ena/submit/drop-box/submit/"
        : "https://www.ebi.ac.uk/ena/submit/drop-box/submit/";

      // Track steps for transparency
      const steps: Array<{
        step: number;
        name: string;
        status: "completed" | "pending" | "error";
        timestamp: string;
        details: Record<string, unknown>;
      }> = [];

      // Step 1: Validation
      steps.push({
        step: 1,
        name: "Validation",
        status: "completed",
        timestamp: new Date().toISOString(),
        details: {
          studyTitle: study.title,
          studyDescription: study.description?.substring(0, 100) + (study.description && study.description.length > 100 ? "..." : ""),
          sampleCount: study.samples.length,
          samplesValidated: study.samples.map(s => ({
            id: s.sampleId,
            hasOrganism: Boolean(s.taxId || s.scientificName),
            taxId: s.taxId,
            scientificName: s.scientificName,
          })),
        },
      });

      // Prepare study data
      const studyData = {
        alias: study.alias || study.id,
        title: study.title,
        description: study.description || "",
      };

      // Parse study-level metadata (applies to all samples)
      const studyLevelMetadata: Record<string, string> = {};
      if (study.studyMetadata) {
        try {
          const studyMeta = JSON.parse(study.studyMetadata);
          for (const [key, value] of Object.entries(studyMeta)) {
            if (value && typeof value === "string" && value.trim()) {
              studyLevelMetadata[key] = value;
            }
          }
        } catch {
          // ignore parse errors
        }
      }

      console.log("Study-level metadata:", studyLevelMetadata);

      const buildSampleSubmissionData = (
        samples: typeof study.samples
      ) => samples.map((s) => {
        // Start with study-level metadata (applies to all samples)
        const attributes: Record<string, string> = { ...studyLevelMetadata };

        // Then add order-level customFields (shared by all samples in the order)
        if (s.order?.customFields) {
          try {
            const orderCustomData = JSON.parse(s.order.customFields);
            for (const [key, value] of Object.entries(orderCustomData)) {
              if (value && typeof value === "string" && value.trim()) {
                attributes[key] = value;
              }
            }
          } catch {
            // ignore parse errors
          }
        }

        // Then add sample-level customFields (per-sample fields from order form)
        if (s.customFields) {
          try {
            const customData = JSON.parse(s.customFields);
            for (const [key, value] of Object.entries(customData)) {
              if (value && typeof value === "string" && value.trim()) {
                attributes[key] = value;
              }
            }
          } catch {
            // ignore parse errors
          }
        }

        // Then add checklistData (MIxS metadata), overwriting any duplicates
        if (s.checklistData) {
          try {
            const checklistFields = JSON.parse(s.checklistData);
            for (const [key, value] of Object.entries(checklistFields)) {
              if (value && typeof value === "string" && value.trim()) {
                attributes[key] = value;
              }
            }
          } catch {
            // ignore parse errors
          }
        }

        // Debug: log what we found
        console.log(`Sample ${s.sampleId} attributes:`, {
          studyLevelMetadata,
          orderCustomFieldsRaw: s.order?.customFields,
          sampleCustomFieldsRaw: s.customFields,
          checklistDataRaw: s.checklistData,
          mergedAttributes: attributes,
        });

        return {
          alias: s.sampleId,
          title: s.sampleTitle || s.sampleId,
          taxId: s.taxId || "",
          scientificName: s.scientificName || undefined,
          checklistType: study.checklistType || undefined,
          attributes: Object.keys(attributes).length > 0 ? attributes : undefined,
        };
      });

      const reuseExistingStudy = isTestServer
        ? hasActiveTestStudyRegistration
        : hasProductionStudyRegistration;
      const existingSampleAccessions = reuseExistingStudy
        ? Object.fromEntries(
            study.samples
              .filter((sample) => Boolean(sample.sampleAccessionNumber))
              .map((sample) => [sample.sampleId, sample.sampleAccessionNumber as string])
          )
        : {};
      const samplesToSubmit = reuseExistingStudy
        ? study.samples.filter((sample) => !sample.sampleAccessionNumber)
        : study.samples;
      const sampleDataList = buildSampleSubmissionData(samplesToSubmit);
      if (isTestServer && reuseExistingStudy && sampleDataList.length === 0) {
        return NextResponse.json(
          { error: "Study and samples are already registered on the ENA Test Server" },
          { status: 400 }
        );
      }

      try {
        const pendingSubmission = await db.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`submission:study:${entityId}`}))`;

          const existingSubmission = await tx.submission.findFirst({
            where: {
              entityType: "study",
              entityId: entityId,
              status: { in: ["PENDING", "SUBMITTED"] },
            },
          });

          if (existingSubmission) {
            throw new SubmissionInProgressError();
          }

          return tx.submission.create({
            data: {
              submissionType: "STUDY",
              status: "PENDING",
              entityType: "study",
              entityId,
              response: JSON.stringify({
                server: serverUrl,
                isTest: isTestServer,
                message: "Submission queued",
                timestamp: new Date().toISOString(),
                steps,
              }),
            },
          });
        });

        pendingSubmissionId = pendingSubmission.id;
        pendingSubmissionIsTest = isTestServer;
      } catch (error) {
        if (error instanceof SubmissionInProgressError) {
          return NextResponse.json(
            { error: error.message },
            { status: 400 }
          );
        }
        throw error;
      }

      const previewSampleXml = generateSampleXml(
        buildSampleSubmissionData(study.samples)
      );

      // Step 2: Generate XML
      const studyXml = generateStudyXml(studyData);
      const submissionXml = generateSubmissionXml("ADD");
      const sampleXml =
        sampleDataList.length > 0 ? generateSampleXml(sampleDataList) : previewSampleXml;

      steps.push({
        step: 2,
        name: "Generate XML",
        status: "completed",
        timestamp: new Date().toISOString(),
        details: {
          studyXml,
          sampleXml: previewSampleXml,
          submissionXml,
          totalSize: `${(studyXml.length + previewSampleXml.length + submissionXml.length)} bytes`,
        },
      });

      let sampleAccessions: Record<string, string> = {};
      let studyAccession = reuseExistingStudy ? study.studyAccessionId || "" : "";
      let studyReceiptXml = "";
      let studyResultAccessions: Record<string, unknown> | undefined;
      let samplesReceiptXml: string | null = null;

      const credentials = {
        username: settings!.enaUsername!,
        password: settings!.enaPassword!,
        testMode: isTestServer,
      };

      if (reuseExistingStudy) {
        steps.push({
          step: 3,
          name: "Reuse Existing Study",
          status: "completed",
          timestamp: new Date().toISOString(),
          details: {
            studyAccession,
            server: isTestServer
              ? "ENA Test Server (wwwdev.ebi.ac.uk)"
              : "ENA Production Server (www.ebi.ac.uk)",
            note: "Skipped project re-registration and reused the existing study accession for this target.",
          },
        });
      } else {
        const studyResult = await submitStudyToENA(credentials, studyData);

        // Step 3: Send study to ENA (final status based on result)
        steps.push({
          step: 3,
          name: "Send Study to ENA",
          status: studyResult.success ? "completed" : "error",
          timestamp: new Date().toISOString(),
          details: {
            endpoint: serverUrl,
            method: "POST",
            contentType: "multipart/form-data",
            server: isTestServer ? "ENA Test Server (wwwdev.ebi.ac.uk)" : "ENA Production Server (www.ebi.ac.uk)",
            note: isTestServer
              ? "Test submissions are automatically deleted after 24 hours"
              : "Production submissions are permanent",
            ...(studyResult.success
              ? {}
              : { error: studyResult.error || "ENA study submission failed" }),
          },
        });

        if (!studyResult.success) {
          await db.submission.update({
            where: { id: pendingSubmissionId! },
            data: {
              status: "ERROR",
              xmlContent: `<!-- STUDY XML -->\n${studyXml}\n\n<!-- SUBMISSION XML -->\n${submissionXml}`,
              response: JSON.stringify({
                server: serverUrl,
                isTest: isTestServer,
                error: studyResult.error,
                receiptXml: studyResult.receiptXml,
                steps,
              }),
            },
          });

          return NextResponse.json(
            { error: studyResult.error || "ENA study submission failed" },
            { status: 500 }
          );
        }

        studyAccession = studyResult.accessions?.study || "";
        studyReceiptXml = studyResult.receiptXml || "";
        studyResultAccessions = studyResult.accessions;

        console.log("ENA Study Submission Result:", {
          success: studyResult.success,
          accessions: studyResult.accessions,
          studyAccession,
          receiptXmlLength: studyReceiptXml.length,
          receiptXmlPreview: studyReceiptXml.substring(0, 500),
        });
      }

      let samplesError: string | undefined;

      if (sampleDataList.length === 0) {
        steps.push({
          step: 4,
          name: "Send Samples to ENA",
          status: "completed",
          timestamp: new Date().toISOString(),
          details: {
            studyAccession,
            submittedSamples: 0,
            reusedSamples: Object.keys(existingSampleAccessions).length,
            note: "All samples already have accessions for the current ENA target.",
          },
        });
      } else {
        const samplesResult = await submitSamplesToENA(credentials, sampleDataList);
        samplesReceiptXml = samplesResult.receiptXml || null;

        if (!samplesResult.success) {
          samplesError = samplesResult.error;
          steps.push({
            step: 4,
            name: "Send Samples to ENA",
            status: "error",
            timestamp: new Date().toISOString(),
            details: {
              studyAccession,
              submittedSamples: sampleDataList.length,
              samplesError: samplesResult.error,
            },
          });
        } else {
          sampleAccessions = samplesResult.accessions?.samples || {};

          steps.push({
            step: 4,
            name: "Send Samples to ENA",
            status: "completed",
            timestamp: new Date().toISOString(),
            details: {
              studyAccession,
              submittedSamples: sampleDataList.length,
              sampleAccessions,
              receiptXml: samplesReceiptXml,
            },
          });
        }
      }

      // Determine overall status
      const hasStudyAccession = Boolean(studyAccession);
      const combinedSampleAccessions = {
        ...existingSampleAccessions,
        ...sampleAccessions,
      };
      const allSamplesSucceeded =
        Object.keys(combinedSampleAccessions).length === study.samples.length;
      const markSubmitted = !isTestServer && hasStudyAccession && allSamplesSucceeded;

      let submissionStatus: string;
      let submissionMessage: string;

      if (hasStudyAccession && allSamplesSucceeded) {
        submissionStatus = "ACCEPTED";
        if (reuseExistingStudy && sampleDataList.length === 0) {
          submissionMessage = isTestServer
            ? "Study and samples are already registered with the ENA Test Server"
            : "Study and samples are already registered with the ENA Production Server";
        } else if (reuseExistingStudy) {
          submissionMessage = isTestServer
            ? "Reused the existing ENA Test study and registered the remaining samples"
            : "Reused the existing ENA Production study and registered the remaining samples";
        } else {
          submissionMessage = isTestServer
            ? "Successfully registered study and samples with ENA Test Server"
            : "Successfully registered study and samples with ENA Production Server";
        }
      } else if (hasStudyAccession && !allSamplesSucceeded) {
        submissionStatus = "PARTIAL";
        submissionMessage = samplesError
          ? `Study registered but samples failed: ${samplesError}`
          : "Study registered but some samples failed to register";
      } else {
        submissionStatus = "ERROR";
        submissionMessage = "Failed to get study accession from ENA";
      }

      // Step 5: Update Database
      steps.push({
        step: 5,
        name: "Update Database",
        status: hasStudyAccession ? "completed" : "error",
        timestamp: new Date().toISOString(),
        details: {
          studyUpdated: hasStudyAccession,
          studyAccessionId: studyAccession || "(not received)",
          samplesUpdated: Object.keys(sampleAccessions).length,
          samplesReused: Object.keys(existingSampleAccessions).length,
          samplesTotal: study.samples.length,
          markedAsSubmitted: markSubmitted,
        },
      });

      // Combine all XML for storage
      const fullXmlContent = `<!-- STUDY XML -->\n${studyXml}\n\n<!-- SAMPLE XML -->\n${sampleXml}\n\n<!-- SUBMISSION XML -->\n${submissionXml}`;

      // Create submission record
      const submission = await db.submission.update({
        where: { id: pendingSubmissionId! },
        data: {
          status: submissionStatus,
          xmlContent: fullXmlContent,
          response: JSON.stringify({
            server: serverUrl,
            isTest: isTestServer,
            message: submissionMessage,
            timestamp: new Date().toISOString(),
            steps,
            receipt: {
              success: hasStudyAccession && allSamplesSucceeded,
              studyReceiptXml: studyReceiptXml || null,
              samplesReceiptXml,
              studyAccession: studyAccession || null,
              sampleCount: study.samples.length,
              samplesSubmitted: Object.keys(sampleAccessions).length,
              samplesRegistered: Object.keys(combinedSampleAccessions).length,
            },
            samplesError: samplesError || null,
            debug: {
              reuseExistingStudy,
              studyResultAccessions: studyResultAccessions,
              samplesResultAccessions: sampleAccessions,
            },
          }),
          accessionNumbers: JSON.stringify({
            study: studyAccession || null,
            ...combinedSampleAccessions,
          }),
        },
      });

      // Update study with accession number
      // Only mark as fully submitted for production submissions
      // Test submissions get accession but aren't marked as "submitted" since they expire
      const studyUpdateData: Record<string, unknown> = {
        submitted: markSubmitted,
        submittedAt: markSubmitted ? new Date() : null,
      };
      if (!reuseExistingStudy) {
        studyUpdateData.studyAccessionId = studyAccession;
        studyUpdateData.testRegisteredAt = isTestServer ? new Date() : null;
      } else if (!isTestServer) {
        studyUpdateData.testRegisteredAt = null;
      }
      await db.study.update({
        where: { id: entityId },
        data: studyUpdateData,
      });

      // Update samples with accession numbers
      for (const sample of study.samples) {
        if (sampleAccessions[sample.sampleId]) {
          await db.sample.update({
            where: { id: sample.id },
            data: {
              sampleAccessionNumber: sampleAccessions[sample.sampleId],
            },
          });
        }
      }

      return NextResponse.json({
        submission,
        message: submissionMessage,
      });
    }

    return NextResponse.json(
      { error: "Unsupported entity type" },
      { status: 400 }
    );
  } catch (error) {
    if (pendingSubmissionId) {
      try {
        await db.submission.update({
          where: { id: pendingSubmissionId },
          data: {
            status: "ERROR",
            response: JSON.stringify({
              isTest: pendingSubmissionIsTest,
              error: error instanceof Error ? error.message : "Failed to create submission",
              timestamp: new Date().toISOString(),
            }),
          },
        });
      } catch (updateError) {
        console.error("Failed to update pending submission after error:", updateError);
      }
    }
    console.error("Error creating submission:", error);
    return NextResponse.json(
      { error: "Failed to create submission" },
      { status: 500 }
    );
  }
}
