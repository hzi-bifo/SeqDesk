export const ACTIVE_ADMINISTRATOR_WHERE = {
  systemRole: "ADMIN",
  isActive: true,
} as const;

export class FinalActiveAdministratorError extends Error {
  constructor() {
    super("The final active administrator cannot be removed");
    this.name = "FinalActiveAdministratorError";
  }
}

type ActiveAdministratorCounter = {
  user: {
    count(args: {
      where: typeof ACTIVE_ADMINISTRATOR_WHERE;
    }): Promise<number>;
  };
};

export async function assertCanRemoveActiveAdministrator(
  transaction: ActiveAdministratorCounter,
  account: { systemRole: string; isActive: boolean }
): Promise<void> {
  if (account.systemRole !== "ADMIN" || !account.isActive) return;

  const activeAdministratorCount = await transaction.user.count({
    where: ACTIVE_ADMINISTRATOR_WHERE,
  });
  if (activeAdministratorCount <= 1) {
    throw new FinalActiveAdministratorError();
  }
}

export function isSerializableTransactionConflict(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: unknown }).code === "P2034"
  );
}
