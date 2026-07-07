/**
 * Formatting helpers
 * ==================
 *
 * All chain amounts in navio-sdk are `bigint` base units (1 NAV = 1e8
 * units, same convention for tokens). We format for display only at the
 * last moment and never round-trip a formatted string back into math.
 */

export const COIN = 100_000_000n;

/** Format base units as a decimal amount (trims trailing zeros). */
export function formatUnits(units: bigint, decimals = 8): string {
  const negative = units < 0n;
  const abs = negative ? -units : units;
  const whole = abs / COIN;
  const frac = (abs % COIN).toString().padStart(8, '0').slice(0, decimals).replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole.toLocaleString('en-US')}${frac ? '.' + frac : ''}`;
}

/** Parse a user-entered decimal amount into base units. Throws on junk. */
export function parseUnits(text: string): bigint {
  const trimmed = text.trim();
  if (!/^\d+(\.\d{1,8})?$/.test(trimmed)) {
    throw new Error('Enter a positive amount with at most 8 decimal places');
  }
  const [whole, frac = ''] = trimmed.split('.');
  return BigInt(whole) * COIN + BigInt(frac.padEnd(8, '0'));
}

/** Integer base-unit input (token sizes, prices). */
export function parseIntegerUnits(text: string): bigint {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) throw new Error('Enter a whole number of base units');
  return BigInt(trimmed);
}

/** Shorten a hash/address for display: `abcd1234…ef56`. */
export function shorten(value: string, head = 10, tail = 6): string {
  if (value.length <= head + tail + 1) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

/** Unix seconds → local time string. */
export function formatTime(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleString();
}

/** Now + minutes, in unix seconds — used for quote/intent expiries. */
export function minutesFromNow(minutes: number): number {
  return Math.floor(Date.now() / 1000) + minutes * 60;
}
