import { NextResponse } from "next/server";
import type {
  BootstrapAccountKind,
  BootstrapAccountOutcome,
  BootstrapAccountReport,
  BootstrapAccountReports,
} from "@/lib/auto-seed";
import { checkDatabaseStatus } from "@/lib/db-status";
import { buildSetupStatusResponse } from "@/lib/setup-status";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type PublicBootstrapAccount = {
  kind: BootstrapAccountKind;
  outcome: BootstrapAccountOutcome;
};

/**
 * Reduce a seed report to what an anonymous caller may see.
 *
 * This route is unauthenticated -- it is what the setup and login pages poll
 * before anyone can sign in. The internal report also carries the account's
 * address, which on a configured install is the facility's real admin address,
 * and a reason string. Neither is needed to answer "what happened to the
 * bootstrap accounts", so neither is published. The fields are picked one by
 * one on purpose: a field added to the report later cannot leak by being
 * spread in here unnoticed.
 */
function toPublicBootstrapAccount(report: BootstrapAccountReport): PublicBootstrapAccount {
  return { kind: report.kind, outcome: report.outcome };
}

function toPublicBootstrapAccounts(
  reports: BootstrapAccountReports
): Record<BootstrapAccountKind, PublicBootstrapAccount> {
  return {
    admin: toPublicBootstrapAccount(reports.admin),
    researcher: toPublicBootstrapAccount(reports.researcher),
  };
}

export async function GET() {
  let status = await checkDatabaseStatus();
  let seedError: string | undefined;
  let seedInProgress = false;
  let bootstrapAccounts: BootstrapAccountReports | undefined;

  // Auto-seed whenever the schema is reachable. `configured` only means the
  // site settings row exists, so a database that was migrated but never seeded
  // reports itself configured while having no accounts to log in with. Let
  // autoSeedIfNeeded's own guard decide -- it no-ops (without further queries)
  // once this process has confirmed the database is bootstrapped.
  if (status.exists) {
    try {
      const { autoSeedIfNeeded } = await import("@/lib/auto-seed");
      const result = await autoSeedIfNeeded();
      bootstrapAccounts = result.accounts;
      if (result.seeded) {
        // Re-check status after seeding
        status = await checkDatabaseStatus();
      } else if (result.error) {
        seedError = result.error;
        seedInProgress = result.error === "Seeding already in progress";
      }
    } catch (error) {
      seedError =
        error instanceof Error ? error.message : "Automatic seeding failed";
    }
  }

  return NextResponse.json(
    {
      ...buildSetupStatusResponse(status, {
        ...(seedError ? { seedError } : {}),
        ...(seedInProgress ? { seedInProgress } : {}),
      }),
      // Only present when a seed pass ran. `existing` means the account was
      // already in this database and its stored password was left untouched;
      // `refused` means it was not created because it would have received the
      // built-in default password. Addresses stay out of this response.
      ...(bootstrapAccounts
        ? { bootstrapAccounts: toPublicBootstrapAccounts(bootstrapAccounts) }
        : {}),
    },
    {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    }
  );
}
