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

  try {
    const body = await request.json();
    const { entityType, entityId, isTest = true } = body;

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
        { error: "ENA credentials not configured. Please configure your Webin credentials in Platform Settings > General > ENA Configuration." },
        { status: 400 }
      );
    }

    // Use test server if user requests it OR if configured in settings
    const isTestServer = isTest || settings?.enaTestMode !== false;

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

      // Edge case: Check for existing pending/submitted submission
      const existingSubmission = await db.submission.findFirst({
        where: {
          entityType: "study",
          entityId: entityId,
          status: { in: ["PENDING", "SUBMITTED"] },
        },
      });

      if (existingSubmission) {
        return NextResponse.json(
          { error: "A submission for this study is already in progress" },
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
      let studyLevelMetadata: Record<string, string> = {};
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

      // Prepare sample data
      // Merge studyMetadata, order customFields, sample customFields, and checklistData for sample attributes
      const sampleDataList = study.samples.map(s => {
        // Start with study-level metadata (applies to all samples)
        let attributes: Record<string, string> = { ...studyLevelMetadata };

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

      // Step 2: Generate XML
      const studyXml = generateStudyXml(studyData);
      const sampleXml = generateSampleXml(sampleDataList);
      const submissionXml = generateSubmissionXml("ADD");

      steps.push({
        step: 2,
        name: "Generate XML",
        status: "completed",
        timestamp: new Date().toISOString(),
        details: {
          studyXml,
          sampleXml,
          submissionXml,
          totalSize: `${(studyXml.length + sampleXml.length + submissionXml.length)} bytes`,
        },
      });

      let studyAccession: string;
      let sampleAccessions: Record<string, string> = {};
      let enaResponse: string;

      const credentials = {
        username: settings!.enaUsername!,
        password: settings!.enaPassword!,
        testMode: isTestServer,
      };

      // Submit study
      const studyResult = await submitStudyToENA(credentials, studyData);

      // Step 3: Send to ENA (final status based on result)
      steps.push({
        step: 3,
        name: "Send to ENA",
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
        // Create failed submission record
        await db.submission.create({
          data: {
            submissionType: "STUDY",
            status: "ERROR",
            entityType: "study",
            entityId: entityId,
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
      enaResponse = studyResult.receiptXml || "";

      // Log the ENA response for debugging
      console.log("ENA Study Submission Result:", {
        success: studyResult.success,
        accessions: studyResult.accessions,
        studyAccession,
        receiptXmlLength: enaResponse.length,
        receiptXmlPreview: enaResponse.substring(0, 500),
      });

      // Submit samples
      const samplesResult = await submitSamplesToENA(credentials, sampleDataList);
      let samplesError: string | undefined;

      if (!samplesResult.success) {
        samplesError = samplesResult.error;
        // Study succeeded but samples failed - record partial success
        steps.push({
          step: 4,
          name: "Parse Response",
          status: "error",
          timestamp: new Date().toISOString(),
          details: {
            studySuccess: true,
            studyAccession,
            samplesSuccess: false,
            samplesError: samplesResult.error,
          },
        });
      } else {
        sampleAccessions = samplesResult.accessions?.samples || {};

        steps.push({
          step: 4,
          name: "Parse Response",
          status: "completed",
          timestamp: new Date().toISOString(),
          details: {
            success: true,
            studyAccession,
            sampleAccessions,
            receiptXml: enaResponse,
          },
        });
      }

      // Determine overall status
      const hasStudyAccession = Boolean(studyAccession);
      const hasSampleAccessions = Object.keys(sampleAccessions).length > 0;
      const allSamplesSucceeded = hasSampleAccessions && Object.keys(sampleAccessions).length === study.samples.length;
      const markSubmitted = !isTestServer && hasStudyAccession && allSamplesSucceeded;

      let submissionStatus: string;
      let submissionMessage: string;

      if (hasStudyAccession && allSamplesSucceeded) {
        submissionStatus = "ACCEPTED";
        submissionMessage = isTestServer
          ? "Successfully registered study and samples with ENA Test Server"
          : "Successfully registered study and samples with ENA Production Server";
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
          samplesTotal: study.samples.length,
          markedAsSubmitted: markSubmitted,
        },
      });

      // Combine all XML for storage
      const fullXmlContent = `<!-- STUDY XML -->\n${studyXml}\n\n<!-- SAMPLE XML -->\n${sampleXml}\n\n<!-- SUBMISSION XML -->\n${submissionXml}`;

      // Create submission record
      const submission = await db.submission.create({
        data: {
          submissionType: "STUDY",
          status: submissionStatus,
          entityType: "study",
          entityId: entityId,
          xmlContent: fullXmlContent,
          response: JSON.stringify({
            server: serverUrl,
            isTest: isTestServer,
            message: submissionMessage,
            timestamp: new Date().toISOString(),
            steps,
            receipt: {
              success: hasStudyAccession && allSamplesSucceeded,
              studyReceiptXml: enaResponse,
              samplesReceiptXml: samplesResult.receiptXml || null,
              studyAccession: studyAccession || null,
              sampleCount: study.samples.length,
              samplesRegistered: Object.keys(sampleAccessions).length,
            },
            samplesError: samplesError || null,
            debug: {
              studyResultAccessions: studyResult.accessions,
              samplesResultAccessions: samplesResult.accessions,
            },
          }),
          accessionNumbers: JSON.stringify({
            study: studyAccession || null,
            ...sampleAccessions,
          }),
        },
      });

      // Update study with accession number
      // Only mark as fully submitted for production submissions
      // Test submissions get accession but aren't marked as "submitted" since they expire
      await db.study.update({
        where: { id: entityId },
        data: {
          submitted: markSubmitted,
          submittedAt: markSubmitted ? new Date() : null,
          testRegisteredAt: isTestServer ? new Date() : null,
          studyAccessionId: studyAccession,
        },
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
        message: isTestServer
          ? "Successfully registered with ENA Test Server (expires in 24 hours)"
          : "Successfully registered with ENA Production Server",
      });
    }

    return NextResponse.json(
      { error: "Unsupported entity type" },
      { status: 400 }
    );
  } catch (error) {
    console.error("Error creating submission:", error);
    return NextResponse.json(
      { error: "Failed to create submission" },
      { status: 500 }
    );
  }
}
