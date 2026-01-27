// Projects field type - for defining projects/studies within an order

export interface Project {
  id: string;
  name: string;
}

export type ProjectsFieldValue = Project[];

export function generateProjectId(): string {
  return `proj_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
}

export function parseProjectsValue(value: unknown): Project[] {
  if (!value) return [];
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed.filter(
          (p): p is Project =>
            typeof p === "object" && p !== null && typeof p.id === "string" && typeof p.name === "string"
        );
      }
    } catch {
      // If it's a plain string (old format), split by newlines
      const lines = value.split("\n").filter((l) => l.trim());
      return lines.map((name, index) => ({
        id: `proj_${index}`,
        name: name.trim(),
      }));
    }
  }
  if (Array.isArray(value)) {
    return value.filter(
      (p): p is Project =>
        typeof p === "object" && p !== null && typeof p.id === "string" && typeof p.name === "string"
    );
  }
  return [];
}

export function stringifyProjectsValue(projects: Project[]): string {
  return JSON.stringify(projects);
}
