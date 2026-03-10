export const DEMO_EXPERIENCES = ["researcher", "facility"] as const;

export type DemoExperience = (typeof DEMO_EXPERIENCES)[number];

export function normalizeDemoExperience(
  value?: string | null
): DemoExperience {
  return value === "facility" ? "facility" : "researcher";
}
