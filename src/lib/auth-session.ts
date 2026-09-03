import type { Session } from "next-auth";

/**
 * A JWT-backed NextAuth session can outlive the database account that created
 * it. The auth callback marks those sessions invalid; every authenticated
 * entry point must honor that marker instead of checking object presence only.
 *
 * Treat a missing marker as valid for compatibility with sessions issued by
 * releases predating account deactivation. Their claims are refreshed from the
 * database by the JWT callback before this predicate is evaluated.
 */
export function isActiveSession(
  session: Session | null | undefined
): session is Session {
  return Boolean(
    session?.user?.id && session.user.authorizationValid !== false
  );
}
