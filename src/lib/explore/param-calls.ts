import type { CanvasParamsSchema } from "./canvas-layout";

/**
 * A plain script declares its parameters through `sx.param("name", default)` calls (R: `sx$param`).
 * The default literal is the value the version carries; the browser edits it in place.
 */
const CALL = /\bsx(?:\.|\$)param\(\s*(["'])([A-Za-z_][\w.-]*)\1\s*(?:,\s*(?:default\s*=\s*)?([^,)]+?)\s*)?\)/g;
/** A comment on the same line as the call names the parameter for people: `sx.param("n", 12)  # Numeric columns to plot`. */
function titleAfter(code: string, index: number): string | undefined {
  const end = code.indexOf("\n", index);
  const rest = code.slice(index, end === -1 ? undefined : end);
  const comment = /#\s*(.+?)\s*$/.exec(rest);
  return comment && comment[1].length <= 80 ? comment[1] : undefined;
}
type Literal = { value: unknown; type: "integer" | "number" | "string" | "boolean" | "null" };

function parseLiteral(raw: string): Literal | null {
  const text = raw.trim();
  if (/^(None|NULL|null)$/.test(text)) return { value: null, type: "null" };
  if (/^(True|TRUE|true)$/.test(text)) return { value: true, type: "boolean" };
  if (/^(False|FALSE|false)$/.test(text)) return { value: false, type: "boolean" };
  if (/^[+-]?\d+$/.test(text)) return { value: Number(text), type: "integer" };
  if (/^[+-]?(\d+\.\d*|\d*\.\d+|\d+)([eE][+-]?\d+)?$/.test(text)) return { value: Number(text), type: "number" };
  const quoted = /^(["'])(.*)\1$/.exec(text);
  if (quoted && !quoted[2].includes(quoted[1])) return { value: quoted[2], type: "string" };
  return null;
}

/** The parameters a script reads with a literal default, as a schema the canvas controls understand; null when it reads none. */
export function schemaFromCode(code: string): CanvasParamsSchema | null {
  const properties: Record<string, { type?: string | string[]; default?: unknown; title?: string; description?: string; computed?: boolean }> = {};
  for (const match of code.matchAll(CALL)) {
    const key = match[2];
    if (key in properties || match[3] === undefined) continue;
    const title = titleAfter(code, match.index! + match[0].length);
    const literal = parseLiteral(match[3]);
    // A computed default still shows on the card, greyed, so nobody wonders where the parameter went.
    if (!literal) { properties[key] = { computed: true, ...(title ? { title } : {}), description: "The default is computed in the code. Change it there." }; continue; }
    properties[key] = { type: literal.type === "null" ? ["string", "null"] : literal.type, default: literal.value, ...(title ? { title } : {}) };
  }
  return Object.keys(properties).length ? { type: "object", properties } as CanvasParamsSchema : null;
}
