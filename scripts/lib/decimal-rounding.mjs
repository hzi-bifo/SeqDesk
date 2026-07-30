/**
 * Format a non-negative exact ratio using round-half-to-even.
 *
 * @param {number} numerator non-negative safe integer
 * @param {number} denominator positive safe integer
 * @param {number} decimalPlaces non-negative safe integer
 */
export function formatHalfEvenRatio(
  numerator,
  denominator,
  decimalPlaces,
) {
  if (
    !Number.isSafeInteger(numerator) ||
    numerator < 0 ||
    !Number.isSafeInteger(denominator) ||
    denominator <= 0 ||
    !Number.isSafeInteger(decimalPlaces) ||
    decimalPlaces < 0
  ) {
    throw new TypeError(
      "Half-even ratio inputs must be non-negative safe integers",
    );
  }
  const scale = 10n ** BigInt(decimalPlaces);
  const divisor = BigInt(denominator);
  const scaledNumerator = BigInt(numerator) * scale;
  let rounded = scaledNumerator / divisor;
  const remainder = scaledNumerator % divisor;
  const twiceRemainder = remainder * 2n;
  if (
    twiceRemainder > divisor ||
    (twiceRemainder === divisor && rounded % 2n !== 0n)
  ) {
    rounded += 1n;
  }

  if (decimalPlaces === 0) return String(rounded);
  const whole = rounded / scale;
  const fraction = String(rounded % scale).padStart(decimalPlaces, "0");
  return `${whole}.${fraction}`;
}

/**
 * Format the exact IEEE-754 binary64 value using round-half-to-even.
 * Python float formatting observes the same binary representation, so this
 * avoids both Number#toFixed's tie rule and arbitrary midpoint epsilons.
 *
 * @param {number} value finite non-negative number
 * @param {number} decimalPlaces non-negative safe integer
 */
export function formatHalfEvenBinary64(value, decimalPlaces) {
  if (
    !Number.isFinite(value) ||
    value < 0 ||
    !Number.isSafeInteger(decimalPlaces) ||
    decimalPlaces < 0
  ) {
    throw new TypeError(
      "Half-even binary64 value and precision must be non-negative",
    );
  }
  if (value === 0) return formatHalfEvenRatio(0, 1, decimalPlaces);

  const buffer = new ArrayBuffer(8);
  const view = new DataView(buffer);
  view.setFloat64(0, value, false);
  const bits = view.getBigUint64(0, false);
  const exponentBits = Number((bits >> 52n) & 0x7ffn);
  const fractionBits = bits & ((1n << 52n) - 1n);
  let numerator =
    exponentBits === 0 ? fractionBits : (1n << 52n) | fractionBits;
  const binaryExponent =
    (exponentBits === 0 ? 1 - 1023 : exponentBits - 1023) - 52;
  let denominator = 1n;
  if (binaryExponent >= 0) {
    numerator <<= BigInt(binaryExponent);
  } else {
    denominator <<= BigInt(-binaryExponent);
  }

  const scale = 10n ** BigInt(decimalPlaces);
  const scaledNumerator = numerator * scale;
  let rounded = scaledNumerator / denominator;
  const remainder = scaledNumerator % denominator;
  const twiceRemainder = remainder * 2n;
  if (
    twiceRemainder > denominator ||
    (twiceRemainder === denominator && rounded % 2n !== 0n)
  ) {
    rounded += 1n;
  }
  if (decimalPlaces === 0) return String(rounded);
  const whole = rounded / scale;
  const fraction = String(rounded % scale).padStart(decimalPlaces, "0");
  return `${whole}.${fraction}`;
}

/**
 * Reproduce github.com/shenwei356/util/math.Round from v0.5.2, the helper
 * used by SeqKit 2.8.0 `stats`. It first adds half of the requested decimal
 * unit in binary64, truncates the scaled value, and only then formats it.
 *
 * This is deliberately separate from both exact-ratio rounding and Go/Python
 * fixed-point formatting: for example, SeqKit turns the binary64 value 1.15
 * into 1.2 at one decimal place before fmt receives it.
 *
 * @param {number} value finite non-negative binary64 value
 * @param {number} decimalPlaces non-negative safe integer
 */
export function roundSeqkit28Binary64(value, decimalPlaces) {
  if (
    !Number.isFinite(value) ||
    value < 0 ||
    !Number.isSafeInteger(decimalPlaces) ||
    decimalPlaces < 0
  ) {
    throw new TypeError(
      "SeqKit 2.8 rounding value and precision must be non-negative",
    );
  }
  const scale = 10 ** decimalPlaces;
  if (!Number.isFinite(scale)) {
    throw new TypeError("SeqKit 2.8 rounding precision is too large");
  }
  return Math.trunc((value + 0.5 / scale) * scale) / scale;
}

/**
 * Format a value exactly as SeqKit 2.8.0 `stats -T`: apply its pinned
 * util/math.Round implementation, then Go's binary64 round-half-even fmt.
 *
 * @param {number} value finite non-negative binary64 value
 * @param {number} decimalPlaces non-negative safe integer
 */
export function formatSeqkit28RoundedBinary64(value, decimalPlaces) {
  return formatHalfEvenBinary64(
    roundSeqkit28Binary64(value, decimalPlaces),
    decimalPlaces,
  );
}
