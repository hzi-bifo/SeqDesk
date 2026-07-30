/**
 * Runtime glob patterns are resolved relative to a pipeline run's output
 * directory. Keep this helper browser-safe because manifest schemas are also
 * imported by UI-facing modules.
 */
export function isSafePackageRuntimePattern(value: string): boolean {
  if (!value || value.includes("\0")) return false;

  const normalized = value.replace(/\\/g, "/");
  if (normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized)) {
    return false;
  }

  return !normalized.split("/").some((segment) => segment === "..");
}

export function isSafePackageRuntimeFilePath(value: string): boolean {
  if (!isSafePackageRuntimePattern(value)) return false;

  const normalized = value.replace(/\\/g, "/");
  const finalSegment = normalized.split("/").at(-1);
  return Boolean(finalSegment && finalSegment !== ".");
}

export function isSafePipelineFlagToken(value: string): boolean {
  return /^-{1,2}[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(value);
}

function escapeRegularExpressionCharacter(value: string): string {
  return /[\\^$+?.()|[\]{}]/.test(value) ? `\\${value}` : value;
}

function packageGlobToRegExpSource(pattern: string): string {
  let source = "";
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];

    if (character === "*") {
      if (pattern[index + 1] === "*") {
        source += ".*";
        index += 1;
      } else {
        source += "[^/]*";
      }
      continue;
    }
    if (character === "?") {
      source += "[^/]";
      continue;
    }
    if (character === "{") {
      const closeIndex = pattern.indexOf("}", index + 1);
      if (closeIndex > index + 1) {
        const alternatives = pattern.slice(index + 1, closeIndex).split(",");
        if (alternatives.length > 1 && alternatives.every(Boolean)) {
          source += `(?:${alternatives
            .map((alternative) => packageGlobToRegExpSource(alternative))
            .join("|")})`;
          index = closeIndex;
          continue;
        }
      }
    }

    source += escapeRegularExpressionCharacter(character);
  }
  return source;
}

/**
 * Compile the small glob dialect used by pipeline output and parser patterns.
 * Regex metacharacters in package-authored paths are treated as literals.
 */
export function compilePackageGlobPattern(pattern: string): RegExp {
  return new RegExp(`^${packageGlobToRegExpSource(pattern)}$`);
}
