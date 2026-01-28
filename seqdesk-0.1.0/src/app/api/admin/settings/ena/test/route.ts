import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";

// POST /api/admin/settings/ena/test - Test ENA connection
// Accepts credentials in request body (for testing before save) or uses saved credentials
export async function POST(request: Request) {
  const session = await getServerSession(authOptions);

  if (!session || session.user.role !== "FACILITY_ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Try to get credentials from request body first (for testing before save)
    let enaUsername: string | undefined;
    let enaPassword: string | undefined;
    let enaTestMode = true;
    let useSavedPassword = false;

    try {
      const body = await request.json();
      if (body.enaUsername) {
        enaUsername = body.enaUsername;
        enaTestMode = body.enaTestMode ?? true;

        if (body.enaPassword) {
          // User provided a new password
          enaPassword = body.enaPassword;
        } else if (body.useSavedPassword) {
          // User wants to use the saved password with potentially new username
          useSavedPassword = true;
        }
      }
    } catch {
      // No body or invalid JSON - fall back to saved credentials
    }

    // If we need the saved password, or no credentials were provided at all
    if (useSavedPassword || !enaUsername) {
      const settings = await db.siteSettings.findUnique({
        where: { id: "singleton" },
        select: {
          enaUsername: true,
          enaPassword: true,
          enaTestMode: true,
        },
      });

      if (useSavedPassword) {
        // Use the saved password with the username from request
        if (!settings?.enaPassword) {
          return NextResponse.json({
            success: false,
            error: "No saved password found. Please enter your password.",
          });
        }
        enaPassword = settings.enaPassword;
      } else {
        // Use fully saved credentials
        if (!settings?.enaUsername || !settings?.enaPassword) {
          return NextResponse.json({
            success: false,
            error: "ENA credentials not provided",
          });
        }
        enaUsername = settings.enaUsername;
        enaPassword = settings.enaPassword;
        enaTestMode = settings.enaTestMode;
      }
    }

    // Final validation
    if (!enaUsername || !enaPassword) {
      return NextResponse.json({
        success: false,
        error: "Username and password are required",
      });
    }

    // Trim whitespace from credentials
    enaUsername = enaUsername.trim();
    enaPassword = enaPassword.trim();

    // Determine endpoint based on test mode
    const baseUrl = enaTestMode
      ? "https://wwwdev.ebi.ac.uk"
      : "https://www.ebi.ac.uk";

    // Validate username format
    if (!enaUsername.match(/^Webin-\d+$/)) {
      return NextResponse.json({
        success: false,
        error: `Invalid username format. Expected "Webin-XXXXX" (e.g., Webin-12345), got "${enaUsername}"`,
        server: baseUrl,
      });
    }

    // Test by making an actual submission request with VALIDATE action
    // This will verify credentials without actually registering anything
    const authString = Buffer.from(
      `${enaUsername}:${enaPassword}`
    ).toString("base64");

    const submitUrl = `${baseUrl}/ena/submit/drop-box/submit/`;

    // Create a minimal validation-only submission
    const submissionXml = `<?xml version="1.0" encoding="UTF-8"?>
<SUBMISSION>
  <ACTIONS>
    <ACTION>
      <VALIDATE/>
    </ACTION>
  </ACTIONS>
</SUBMISSION>`;

    // Create minimal project XML for validation
    const projectXml = `<?xml version="1.0" encoding="UTF-8"?>
<PROJECT_SET>
  <PROJECT alias="test-connection-${Date.now()}">
    <TITLE>Connection Test</TITLE>
    <DESCRIPTION>Testing ENA credentials</DESCRIPTION>
    <SUBMISSION_PROJECT>
      <SEQUENCING_PROJECT/>
    </SUBMISSION_PROJECT>
  </PROJECT>
</PROJECT_SET>`;

    // Create form data
    const formData = new FormData();
    formData.append("SUBMISSION", new Blob([submissionXml], { type: "application/xml" }), "submission.xml");
    formData.append("PROJECT", new Blob([projectXml], { type: "application/xml" }), "project.xml");

    const response = await fetch(submitUrl, {
      method: "POST",
      headers: {
        Authorization: `Basic ${authString}`,
      },
      body: formData,
    });

    const responseText = await response.text();

    // 401 means invalid credentials
    if (response.status === 401) {
      return NextResponse.json({
        success: false,
        error: "Invalid credentials - authentication failed",
        server: baseUrl,
      });
    }

    // Check the response for success or auth errors
    if (responseText.includes('success="true"') || responseText.includes('success="false"')) {
      // We got a proper ENA response - credentials are valid!
      // (VALIDATE action will return success="false" if data is invalid, but auth worked)
      return NextResponse.json({
        success: true,
        message: `Credentials verified with ENA ${enaTestMode ? "Test" : "Production"} server`,
        server: baseUrl,
        username: enaUsername,
      });
    }

    // Check for authentication error in response
    if (responseText.toLowerCase().includes("unauthorized") ||
        responseText.toLowerCase().includes("authentication")) {
      return NextResponse.json({
        success: false,
        error: "Authentication failed - check your password",
        server: baseUrl,
      });
    }

    // Other error
    return NextResponse.json({
      success: false,
      error: `ENA server returned: ${response.status}`,
      server: baseUrl,
    });
  } catch (error) {
    console.error("Error testing ENA connection:", error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : "Connection failed",
    });
  }
}
