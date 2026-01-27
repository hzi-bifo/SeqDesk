import { NextRequest, NextResponse } from "next/server";
import { hash } from "bcryptjs";
import { db } from "@/lib/db";
import {
  DEFAULT_MODULE_STATES,
  DEFAULT_ACCOUNT_VALIDATION_SETTINGS,
  AccountValidationSettings,
} from "@/lib/modules/types";

// Check if account validation module is enabled and get settings
async function getAccountValidationConfig(): Promise<{
  moduleEnabled: boolean;
  settings: AccountValidationSettings;
}> {
  try {
    const siteSettings = await db.siteSettings.findUnique({
      where: { id: "singleton" },
    });

    // Check if module is enabled
    let moduleEnabled = DEFAULT_MODULE_STATES["account-validation"] ?? false;
    let globalDisabled = false;

    if (siteSettings?.modulesConfig) {
      try {
        const parsed = JSON.parse(siteSettings.modulesConfig);
        // Handle new format with globalDisabled
        if (typeof parsed.modules === "object") {
          moduleEnabled = parsed.modules["account-validation"] ?? moduleEnabled;
          globalDisabled = parsed.globalDisabled ?? false;
        } else {
          // Old format
          moduleEnabled = parsed["account-validation"] ?? moduleEnabled;
        }
      } catch {
        // ignore parse errors
      }
    }

    // If globally disabled, treat as module disabled
    if (globalDisabled) {
      moduleEnabled = false;
    }

    // Get settings
    let settings = DEFAULT_ACCOUNT_VALIDATION_SETTINGS;
    if (siteSettings?.extraSettings) {
      try {
        const extraSettings = JSON.parse(siteSettings.extraSettings);
        if (extraSettings.accountValidationSettings) {
          settings = {
            ...DEFAULT_ACCOUNT_VALIDATION_SETTINGS,
            ...JSON.parse(extraSettings.accountValidationSettings),
          };
        }
      } catch {
        // ignore parse errors
      }
    }

    return { moduleEnabled, settings };
  } catch {
    return {
      moduleEnabled: false,
      settings: DEFAULT_ACCOUNT_VALIDATION_SETTINGS,
    };
  }
}

// Validate email domain
function validateEmailDomain(
  email: string,
  settings: AccountValidationSettings
): { valid: boolean; warning?: string } {
  // If no domains configured, allow all
  if (!settings.allowedDomains || settings.allowedDomains.length === 0) {
    return { valid: true };
  }

  const emailDomain = email.split("@")[1]?.toLowerCase();
  if (!emailDomain) {
    return { valid: false };
  }

  const isAllowed = settings.allowedDomains.some(
    (domain) => emailDomain === domain.toLowerCase()
  );

  if (isAllowed) {
    return { valid: true };
  }

  if (settings.enforceValidation) {
    return { valid: false };
  }

  // Not enforced, just warn
  return {
    valid: true,
    warning: `Your email domain is not in the list of approved domains (${settings.allowedDomains.join(", ")}). You may proceed but some features may be restricted.`,
  };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      email,
      password,
      firstName,
      lastName,
      role,
      researcherRole,
      departmentId,
      institution,
      facilityName,
      inviteCode, // For admin registration
    } = body;

    // Validation
    if (!email || !password || !firstName || !lastName || !role) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    if (role !== "RESEARCHER" && role !== "FACILITY_ADMIN") {
      return NextResponse.json(
        { error: "Invalid role" },
        { status: 400 }
      );
    }

    // Admin registration requires a valid invite code
    let invite = null;
    if (role === "FACILITY_ADMIN") {
      if (!inviteCode) {
        return NextResponse.json(
          { error: "Admin registration requires an invite code" },
          { status: 400 }
        );
      }

      invite = await db.adminInvite.findUnique({
        where: { code: inviteCode.toUpperCase() },
      });

      if (!invite) {
        return NextResponse.json(
          { error: "Invalid invite code" },
          { status: 400 }
        );
      }

      if (invite.usedAt) {
        return NextResponse.json(
          { error: "This invite has already been used" },
          { status: 400 }
        );
      }

      if (new Date() > invite.expiresAt) {
        return NextResponse.json(
          { error: "This invite has expired" },
          { status: 400 }
        );
      }

      // If invite is restricted to specific email, check it
      if (invite.email && invite.email.toLowerCase() !== email.toLowerCase()) {
        return NextResponse.json(
          { error: "This invite is for a different email address" },
          { status: 400 }
        );
      }
    }

    // Check email domain validation
    const { moduleEnabled, settings } = await getAccountValidationConfig();
    if (moduleEnabled) {
      const domainCheck = validateEmailDomain(email, settings);
      if (!domainCheck.valid) {
        return NextResponse.json(
          {
            error: `Registration is restricted to email addresses from: ${settings.allowedDomains.join(", ")}`,
            code: "INVALID_EMAIL_DOMAIN",
          },
          { status: 400 }
        );
      }
    }

    // Check if user already exists
    const existingUser = await db.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      return NextResponse.json(
        { error: "User with this email already exists" },
        { status: 400 }
      );
    }

    // Verify department exists if provided
    if (departmentId) {
      const department = await db.department.findUnique({
        where: { id: departmentId },
      });
      if (!department || !department.isActive) {
        return NextResponse.json(
          { error: "Invalid department selected" },
          { status: 400 }
        );
      }
    }

    // Hash password
    const hashedPassword = await hash(password, 12);

    // Create user (and mark invite as used if applicable)
    const user = await db.$transaction(async (tx) => {
      const newUser = await tx.user.create({
        data: {
          email,
          password: hashedPassword,
          firstName,
          lastName,
          role,
          researcherRole: role === "RESEARCHER" ? researcherRole : null,
          departmentId: role === "RESEARCHER" ? departmentId : null,
          institution: role === "RESEARCHER" ? institution : null,
          facilityName: role === "FACILITY_ADMIN" ? facilityName : null,
        },
      });

      // Mark invite as used
      if (invite) {
        await tx.adminInvite.update({
          where: { id: invite.id },
          data: {
            usedAt: new Date(),
            usedById: newUser.id,
          },
        });
      }

      return newUser;
    });

    return NextResponse.json(
      {
        message: "User created successfully",
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
        }
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Registration error:", error);
    return NextResponse.json(
      { error: "Something went wrong" },
      { status: 500 }
    );
  }
}
