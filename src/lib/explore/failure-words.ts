/**
 * A failed step in words: the first line of the error turned into a sentence
 * a person can act on ("Step 4 needs a column named sample, which the table
 * does not have."). Rules only, no model; unknown errors keep their own line.
 */

const MAX_WORDS = 280;

function lastErrorLine(tail: string): string | null {
  const lines = tail.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
    .filter((line) => !/^(Traceback|File "|\s*at |Calls:|Execution halted|In addition:)/.test(line));
  const errorLine = [...lines].reverse().find((line) => /(Error|Exception|error|Killed|MemoryError|cannot|not found|No such file)/.test(line));
  return errorLine ?? lines.at(-1) ?? null;
}

const clip = (text: string) => (text.length > MAX_WORDS ? `${text.slice(0, MAX_WORDS - 1)}…` : text);

export function failureWords(stepLabel: string, errorTail: string | null | undefined, exitCode?: number | null): string {
  const step = `Step ${stepLabel}`;
  const tail = errorTail ?? "";
  const column =
    /KeyError: ['"]([^'"]+)['"]/.exec(tail) ??
    /[Cc]olumn[s]? ['"`]?([A-Za-z0-9_.-]+)['"`]? (?:not found|does not exist|doesn't exist|is not in)/.exec(tail) ??
    /object '([A-Za-z0-9_.]+)' not found/.exec(tail) ??
    /Column `([^`]+)` (?:not found|doesn't exist)/.exec(tail);
  if (/undefined columns selected/.test(tail)) return clip(`${step} asks for a column the table does not have.`);
  if (column) return clip(`${step} needs a column named ${column[1]}, which the table does not have.`);
  const role = /Required role "([^"]+)" is not mapped/.exec(tail);
  if (role) return clip(`${step} needs the ${role[1]} role on its input table.`);
  if (/MemoryError|cannot allocate vector|Out of memory|oom-kill|OOM/i.test(tail) || exitCode === 137) return clip(`${step} ran out of memory.`);
  if (/DUE TO TIME LIMIT|timed out|TimeoutError/i.test(tail) || exitCode === 124) return clip(`${step} ran longer than the time limit allows.`);
  const file = /(?:FileNotFoundError|No such file or directory|cannot open file)[^'"]*['"]([^'"]+)['"]/.exec(tail);
  if (file) return clip(`${step} could not find the file ${file[1].split("/").pop()}.`);
  if (/No such file or directory|FileNotFoundError|cannot open file/.test(tail)) return clip(`${step} could not find a file it needs.`);
  if (/ModuleNotFoundError: No module named ['"]([^'"]+)['"]/.test(tail)) {
    const name = /No module named ['"]([^'"]+)['"]/.exec(tail)![1];
    return clip(`${step} uses the ${name} package, which its environment does not have.`);
  }
  if (/there is no package called ['‘"]([^'’"]+)/.test(tail)) {
    const name = /there is no package called ['‘"]([^'’"]+)/.exec(tail)![1];
    return clip(`${step} uses the R package ${name}, which its environment does not have.`);
  }
  const line = lastErrorLine(tail);
  if (line) return clip(`${step} stopped with an error: ${line.replace(/^Error( in [^:]+)?:\s*/, "")}`);
  if (typeof exitCode === "number" && exitCode !== 0) return clip(`${step} stopped with exit code ${exitCode}.`);
  return clip(`${step} failed.`);
}
