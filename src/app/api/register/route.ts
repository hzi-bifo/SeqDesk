import { NextRequest, NextResponse } from "next/server";
import { hash } from "bcryptjs";
import { db } from "@/lib/db";
import {
  DEFAULT_MODULE_STATES,
  DEFAULT_ACCOUNT_VALIDATION_SETTINGS,
  AccountValidationSettings,
} from "@/lib/modules/types";
import { getServerEnrollmentPolicy } from "@/lib/deployment-profile/enrollment.server";
import { getServerDeploymentProfile } from "@/lib/deployment-profile/server";
import {
  getInviteGrant,
  legacyRoleForSystemRole,
  type InviteGrant,
} from "@/lib/accounts/invite-role";
import { z } from "zod";
import { inviteCodeLookup } from "@/lib/accounts/invite-secret.server";

const RESEARCHER_ROLES = [
  "PI",
  "POSTDOC",
  "PHD_STUDENT",
  "MASTER_STUDENT",
  "TECHNICIAN",
  "OTHER",
] as const;

const registrationSchema = z
  .object({
    email: z.string().trim().toLowerCase().email().max(320),
    password: z
      .string()
      .min(8)
      .max(72)
      .refine((value) => Buffer.byteLength(value, "utf8") <= 72),
    firstName: z.string().trim().min(1).max(100),
    lastName: z.string().trim().min(1).max(100),
    researcherRole: z.enum(RESEARCHER_ROLES).optional(),
    departmentId: z.string().trim().min(1).max(128).optional(),
    institution: z.string().trim().max(300).optional(),
    inviteCode: z.string().trim().min(1).max(128).optional(),
    // Compatibility assertions only. Neither field can grant access.
    role: z.enum(["RESEARCHER", "FACILITY_ADMIN"]).optional(),
    facilityName: z.string().trim().max(300).optional(),
  })
  .strict();

class InviteClaimError extends Error {}

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
    const parsed = registrationSchema.safeParse(
      await request.json().catch(() => null)
    );
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid registration details" },
        { status: 400 }
      );
    }

    const {
      email,
      password,
      firstName,
      lastName,
      researcherRole,
      departmentId,
      institution,
      inviteCode,
      role: legacyRoleAssertion,
      facilityName,
    } = parsed.data;

    const profile = getServerDeploymentProfile();
    const enrollment = await getServerEnrollmentPolicy();

    if (
      profile.id !== "sequencing-center" &&
      (researcherRole || departmentId || institution || facilityName)
    ) {
      return NextResponse.json(
        { error: "Sequencing-center profile fields are unavailable in this deployment" },
        { status: 400 }
      );
    }

    const activeAdministratorCount = await db.user.count({
      where: { systemRole: "ADMIN", isActive: true },
    });
    if (activeAdministratorCount === 0) {
      return NextResponse.json(
        {
          error: "SeqDesk setup must create an administrator before registration opens",
          code: "SETUP_INCOMPLETE",
        },
        { status: 503 }
      );
    }

    let invite = null;
    let grant: InviteGrant = {
      systemRole: "MEMBER",
      facilityWorkflowRole: "REQUESTER",
    };

    if (inviteCode) {
      invite = await db.adminInvite.findFirst({
        where: inviteCodeLookup(inviteCode).where,
        include: {
          createdBy: {
            select: { systemRole: true, isActive: true },
          },
        },
      });

      if (!invite) {
        return NextResponse.json({ error: "Invalid invite code" }, { status: 400 });
      }
      if (invite.usedAt) {
        return NextResponse.json(
          { error: "This invite has already been used" },
          { status: 400 }
        );
      }
      if (invite.revokedAt) {
        return NextResponse.json(
          { error: "This invite has been revoked" },
          { status: 400 }
        );
      }
      if (new Date() > invite.expiresAt) {
        return NextResponse.json(
          { error: "This invite has expired" },
          { status: 400 }
        );
      }
      if (
        invite.createdBy.isActive !== true ||
        invite.createdBy.systemRole !== "ADMIN"
      ) {
        return NextResponse.json(
          { error: "This invite is no longer active" },
          { status: 400 }
        );
      }
      if (invite.email && invite.email.toLowerCase() !== email) {
        return NextResponse.json(
          { error: "This invite is for a different email address" },
          { status: 400 }
        );
      }

      grant = getInviteGrant(invite);
      if (profile.id !== "sequencing-center") {
        grant = { ...grant, facilityWorkflowRole: "REQUESTER" };
      }
    } else if (!enrollment.allowSelfRegistration) {
      return NextResponse.json(
        {
          error: "This SeqDesk installation is invite-only",
          code: "INVITE_REQUIRED",
        },
        { status: 403 }
      );
    }

    // Older forms sent a role. Treat it only as an assertion about the
    // server-derived system grant; it can never create elevated access.
    if (
      legacyRoleAssertion &&
      legacyRoleAssertion !== legacyRoleForSystemRole(grant.systemRole)
    ) {
      return NextResponse.json(
        { error: "The requested account access is not granted by this invitation" },
        { status: 403 }
      );
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
    const existingUser = await db.user.findFirst({
      where: {
        email: { equals: email, mode: "insensitive" },
      },
    });

    if (existingUser) {
      return NextResponse.json(
        { error: "User with this email already exists" },
        { status: 400 }
      );
    }

    // Verify department exists if provided
    if (profile.id === "sequencing-center" && departmentId) {
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
          systemRole: grant.systemRole,
          // Conservative mirror for older releases; workflow access is stored
          // independently in facilityWorkflowRole.
          role: legacyRoleForSystemRole(grant.systemRole),
          facilityWorkflowRole: grant.facilityWorkflowRole,
          researcherRole:
            profile.id === "sequencing-center" &&
            grant.facilityWorkflowRole === "REQUESTER"
              ? researcherRole
              : null,
          departmentId:
            profile.id === "sequencing-center" &&
            grant.facilityWorkflowRole === "REQUESTER"
              ? departmentId
              : null,
          institution:
            profile.id === "sequencing-center" &&
            grant.facilityWorkflowRole === "REQUESTER"
              ? institution
              : null,
          facilityName: null,
        },
      });

      if (invite) {
        const claimedAt = new Date();
        const claim = await tx.adminInvite.updateMany({
          where: {
            id: invite.id,
            usedAt: null,
            revokedAt: null,
            expiresAt: { gt: claimedAt },
            createdBy: {
              is: { systemRole: "ADMIN", isActive: true },
            },
          },
          data: {
            usedAt: claimedAt,
            usedById: newUser.id,
            code: null,
          },
        });
        if (claim.count !== 1) {
          throw new InviteClaimError();
        }
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
          systemRole: user.systemRole,
          facilityWorkflowRole: user.facilityWorkflowRole,
        }
      },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof InviteClaimError) {
      return NextResponse.json(
        { error: "This invite was already used or revoked" },
        { status: 409 }
      );
    }
    console.error("Registration error:", error);
    return NextResponse.json(
      { error: "Something went wrong" },
      { status: 500 }
    );
  }
}
