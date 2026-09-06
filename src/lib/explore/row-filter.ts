/**
 * Row filters in the R / dplyr style, evaluated here without R:
 *
 *   specimen_type == "Urine" & n_samples >= 10
 *   taxon %in% c("Escherichia coli", "Klebsiella pneumoniae")
 *   !is.na(q_value) & q_value < 0.05 | significant == TRUE
 *   grepl("coccus", taxon)
 *
 * Comparisons, `&`/`|`/`!` (also `&&`, `||`), parentheses, `%in%` with `c(...)`,
 * `is.na(col)`, `grepl(pattern, col)` and `startsWith(col, prefix)`. Column
 * names may be written bare or in backticks. Text is compared as text, numbers
 * as numbers; a missing value never satisfies a comparison.
 */
import type { ExploreRowData } from "./types";

type Cell = ExploreRowData[string];

type Token =
  | { kind: "number"; value: number }
  | { kind: "string"; value: string }
  | { kind: "name"; value: string }
  | { kind: "op"; value: string }
  | { kind: "punct"; value: "(" | ")" | "," };

type Node =
  | { kind: "literal"; value: Cell }
  | { kind: "column"; name: string }
  | { kind: "list"; items: Node[] }
  | { kind: "not"; operand: Node }
  | { kind: "binary"; op: string; left: Node; right: Node }
  | { kind: "call"; name: string; args: Node[] };

export interface CompiledFilter {
  expression: string;
  /** Column names the expression refers to. */
  columns: string[];
  test: (row: ExploreRowData) => boolean;
}

export class RowFilterError extends Error {}

const OPERATORS = ["==", "!=", "<=", ">=", "<", ">", "&&", "||", "&", "|", "!", "%in%"];
const FUNCTIONS = new Set(["c", "is.na", "grepl", "startsWith"]);

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    if (char === "(" || char === ")" || char === ",") {
      tokens.push({ kind: "punct", value: char });
      index += 1;
      continue;
    }
    if (char === '"' || char === "'") {
      const end = source.indexOf(char, index + 1);
      if (end < 0) throw new RowFilterError("A text value is missing its closing quote");
      tokens.push({ kind: "string", value: source.slice(index + 1, end) });
      index = end + 1;
      continue;
    }
    if (char === "`") {
      const end = source.indexOf("`", index + 1);
      if (end < 0) throw new RowFilterError("A column name is missing its closing backtick");
      tokens.push({ kind: "name", value: source.slice(index + 1, end) });
      index = end + 1;
      continue;
    }
    const number = source.slice(index).match(/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?(?![A-Za-z_.])/);
    if (number && !(number[0].startsWith("-") && tokens.length > 0 && ["number", "string", "name"].includes(tokens[tokens.length - 1].kind))) {
      tokens.push({ kind: "number", value: Number(number[0]) });
      index += number[0].length;
      continue;
    }
    const operator = OPERATORS.find((candidate) => source.startsWith(candidate, index));
    if (operator) {
      tokens.push({ kind: "op", value: operator });
      index += operator.length;
      continue;
    }
    const name = source.slice(index).match(/^[A-Za-z_][A-Za-z0-9_.]*/);
    if (name) {
      tokens.push({ kind: "name", value: name[0] });
      index += name[0].length;
      continue;
    }
    throw new RowFilterError(`Unexpected "${char}" at position ${index + 1}`);
  }
  return tokens;
}

class Parser {
  private position = 0;

  constructor(private readonly tokens: Token[]) {}

  parse(): Node {
    if (this.tokens.length === 0) throw new RowFilterError("The filter is empty");
    const node = this.parseOr();
    if (this.position < this.tokens.length) throw new RowFilterError(`Unexpected "${this.describe(this.tokens[this.position])}"`);
    return node;
  }

  private describe(token: Token): string {
    return token.kind === "string" ? `"${token.value}"` : String(token.value);
  }

  private peek(): Token | undefined {
    return this.tokens[this.position];
  }

  private take(): Token {
    const token = this.tokens[this.position];
    if (!token) throw new RowFilterError("The filter ends too early");
    this.position += 1;
    return token;
  }

  private isOp(value: string): boolean {
    const token = this.peek();
    return Boolean(token && token.kind === "op" && token.value === value);
  }

  private parseOr(): Node {
    let left = this.parseAnd();
    while (this.isOp("|") || this.isOp("||")) {
      this.take();
      left = { kind: "binary", op: "|", left, right: this.parseAnd() };
    }
    return left;
  }

  private parseAnd(): Node {
    let left = this.parseNot();
    while (this.isOp("&") || this.isOp("&&")) {
      this.take();
      left = { kind: "binary", op: "&", left, right: this.parseNot() };
    }
    return left;
  }

  private parseNot(): Node {
    if (this.isOp("!")) {
      this.take();
      return { kind: "not", operand: this.parseNot() };
    }
    return this.parseComparison();
  }

  private parseComparison(): Node {
    const left = this.parsePrimary();
    const token = this.peek();
    if (token && token.kind === "op" && ["==", "!=", "<", "<=", ">", ">=", "%in%"].includes(token.value)) {
      this.take();
      const right = token.value === "%in%" ? this.parseList() : this.parsePrimary();
      return { kind: "binary", op: token.value, left, right };
    }
    return left;
  }

  private parseList(): Node {
    const token = this.peek();
    if (token && token.kind === "name" && token.value === "c") return this.parsePrimary();
    throw new RowFilterError("%in% needs a list such as c(\"a\", \"b\")");
  }

  private parsePrimary(): Node {
    const token = this.take();
    if (token.kind === "punct" && token.value === "(") {
      const inner = this.parseOr();
      const close = this.take();
      if (close.kind !== "punct" || close.value !== ")") throw new RowFilterError("A closing parenthesis is missing");
      return inner;
    }
    if (token.kind === "number") return { kind: "literal", value: token.value };
    if (token.kind === "string") return { kind: "literal", value: token.value };
    if (token.kind === "name") {
      if (token.value === "TRUE" || token.value === "T") return { kind: "literal", value: true };
      if (token.value === "FALSE" || token.value === "F") return { kind: "literal", value: false };
      if (token.value === "NA" || token.value === "NULL") return { kind: "literal", value: null };
      const next = this.peek();
      if (next && next.kind === "punct" && next.value === "(") {
        if (!FUNCTIONS.has(token.value)) throw new RowFilterError(`Unknown function ${token.value}(); available: c, is.na, grepl, startsWith`);
        this.take();
        const args: Node[] = [];
        while (!(this.peek()?.kind === "punct" && (this.peek() as { value: string }).value === ")")) {
          args.push(this.parseOr());
          const separator = this.peek();
          if (separator && separator.kind === "punct" && separator.value === ",") this.take();
          else break;
        }
        const close = this.take();
        if (close.kind !== "punct" || close.value !== ")") throw new RowFilterError(`${token.value}( is missing its closing parenthesis`);
        if (token.value === "c") return { kind: "list", items: args };
        return { kind: "call", name: token.value, args };
      }
      return { kind: "column", name: token.value };
    }
    throw new RowFilterError(`Unexpected "${this.describe(token)}"`);
  }
}

function isMissing(value: Cell): boolean {
  return value === null || value === undefined || value === "";
}

function compare(left: Cell, right: Cell, op: string): boolean {
  if (isMissing(left) || isMissing(right)) return op === "!=" && !(isMissing(left) && isMissing(right));
  if (typeof left === "number" || typeof right === "number") {
    const a = Number(left);
    const b = Number(right);
    if (Number.isNaN(a) || Number.isNaN(b)) return op === "!=";
    switch (op) {
      case "==": return a === b;
      case "!=": return a !== b;
      case "<": return a < b;
      case "<=": return a <= b;
      case ">": return a > b;
      case ">=": return a >= b;
    }
  }
  if (typeof left === "boolean" || typeof right === "boolean") {
    const a = String(left).toLowerCase();
    const b = String(right).toLowerCase();
    return op === "==" ? a === b : op === "!=" ? a !== b : false;
  }
  const a = String(left);
  const b = String(right);
  switch (op) {
    case "==": return a === b;
    case "!=": return a !== b;
    case "<": return a < b;
    case "<=": return a <= b;
    case ">": return a > b;
    case ">=": return a >= b;
  }
  return false;
}

function evaluate(node: Node, row: ExploreRowData): Cell | Cell[] {
  switch (node.kind) {
    case "literal":
      return node.value;
    case "column":
      return row[node.name] ?? null;
    case "list":
      return node.items.map((item) => evaluate(item, row) as Cell);
    case "not":
      return !truthy(evaluate(node.operand, row));
    case "call": {
      const args = node.args.map((argument) => evaluate(argument, row));
      if (node.name === "is.na") return isMissing(args[0] as Cell);
      if (node.name === "grepl") {
        const [pattern, subject] = args;
        if (isMissing(subject as Cell)) return false;
        try {
          return new RegExp(String(pattern), "i").test(String(subject));
        } catch {
          throw new RowFilterError(`grepl: "${String(pattern)}" is not a valid pattern`);
        }
      }
      if (node.name === "startsWith") {
        const [subject, prefix] = args;
        return !isMissing(subject as Cell) && String(subject).startsWith(String(prefix));
      }
      return false;
    }
    case "binary": {
      if (node.op === "&") return truthy(evaluate(node.left, row)) && truthy(evaluate(node.right, row));
      if (node.op === "|") return truthy(evaluate(node.left, row)) || truthy(evaluate(node.right, row));
      const left = evaluate(node.left, row) as Cell;
      if (node.op === "%in%") {
        const items = evaluate(node.right, row);
        const list = Array.isArray(items) ? items : [items];
        return !isMissing(left) && list.some((item) => compare(left, item as Cell, "=="));
      }
      return compare(left, evaluate(node.right, row) as Cell, node.op);
    }
  }
}

function truthy(value: Cell | Cell[]): boolean {
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") return value.toLowerCase() === "true";
  return false;
}

function collectColumns(node: Node, into: Set<string>): void {
  switch (node.kind) {
    case "column":
      into.add(node.name);
      break;
    case "list":
      node.items.forEach((item) => collectColumns(item, into));
      break;
    case "not":
      collectColumns(node.operand, into);
      break;
    case "call":
      node.args.forEach((argument) => collectColumns(argument, into));
      break;
    case "binary":
      collectColumns(node.left, into);
      collectColumns(node.right, into);
      break;
    default:
      break;
  }
}

/** Parse a filter once; the result tests rows. Throws RowFilterError with a message for the editor. */
export function compileRowFilter(expression: string): CompiledFilter {
  const node = new Parser(tokenize(expression)).parse();
  const columns = new Set<string>();
  collectColumns(node, columns);
  return { expression, columns: [...columns], test: (row) => truthy(evaluate(node, row)) };
}

/** Rows that pass the filter; an empty or blank expression keeps every row. */
export function applyRowFilter(rows: ExploreRowData[], expression: string | null | undefined): ExploreRowData[] {
  if (!expression || !expression.trim()) return rows;
  const compiled = compileRowFilter(expression);
  return rows.filter((row) => compiled.test(row));
}

/** The problem with an expression, or null when it parses. */
export function rowFilterProblem(expression: string, knownColumns?: string[]): string | null {
  if (!expression.trim()) return null;
  try {
    const compiled = compileRowFilter(expression);
    if (knownColumns) {
      const known = new Set(knownColumns);
      const unknown = compiled.columns.filter((column) => !known.has(column));
      if (unknown.length > 0) return `No column called ${unknown.map((column) => `"${column}"`).join(", ")}`;
    }
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : "Not a valid filter";
  }
}
