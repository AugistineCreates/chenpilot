const SCALE = 7n;
const FACTOR = 10_000_000n;

export function parseAmount(amount: string): bigint {
  if (!/^\d+(\.\d{1,7})?$/.test(amount)) {
    throw new Error(`Invalid amount: ${amount}`);
  }

  const [whole, fraction = ""] = amount.split(".");
  return BigInt(whole) * FACTOR + BigInt(fraction.padEnd(Number(SCALE), "0"));
}

export function formatAmount(value: bigint): string {
  const sign = value < 0n ? "-" : "";
  const absolute = value < 0n ? -value : value;
  const whole = absolute / FACTOR;
  const fraction = (absolute % FACTOR).toString().padStart(Number(SCALE), "0");
  const trimmed = fraction.replace(/0+$/, "");
  return `${sign}${whole.toString()}${trimmed ? `.${trimmed}` : ""}`;
}

export function addAmount(a: string, b: string): string {
  return formatAmount(parseAmount(a) + parseAmount(b));
}

export function subtractAmount(a: string, b: string): string {
  return formatAmount(parseAmount(a) - parseAmount(b));
}

export function compareAmount(a: string, b: string): number {
  const left = parseAmount(a);
  const right = parseAmount(b);
  if (left === right) return 0;
  return left > right ? 1 : -1;
}

export function minAmount(a: string, b: string): string {
  return compareAmount(a, b) <= 0 ? a : b;
}
