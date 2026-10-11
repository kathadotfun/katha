// Server-rendered records state UTC explicitly; the server cannot know the
// reader's zone. Client-only views (wallet sessions, private requests) use local time.
const options = {
  day: "numeric",
  month: "short",
  year: "numeric",
} as const satisfies Intl.DateTimeFormatOptions;
const time = { hour: "numeric", minute: "2-digit", hour12: true } as const;

const utcDateTimeFormat = new Intl.DateTimeFormat("en-GB", {
  ...options,
  ...time,
  timeZone: "UTC",
});
const utcDateFormat = new Intl.DateTimeFormat("en-GB", { ...options, timeZone: "UTC" });

export function utcDateTime(iso: string): string {
  return `${utcDateTimeFormat.format(new Date(iso))} UTC`;
}
export function utcDate(iso: string): string {
  return utcDateFormat.format(new Date(iso));
}
export function localDateTime(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", { ...options, ...time }).format(
    new Date(iso),
  );
}
export function localTime(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", time).format(new Date(iso));
}

// Six-decimal test-token base units, shown exactly (no rounding), without padding.
export function tokenAmount(units: string): string {
  if (!/^(0|[1-9][0-9]*)$/.test(units)) throw new Error("Invalid token amount");
  const value = BigInt(units);
  const fraction = (value % 1000000n).toString().padStart(6, "0").replace(/0+$/, "");
  return fraction ? `${value / 1000000n}.${fraction}` : `${value / 1000000n}`;
}

// Chain timestamps are Unix seconds encoded as decimal strings.
export function unixSecondsIso(seconds: string): string {
  return new Date(Number(BigInt(seconds)) * 1000).toISOString();
}

// Short form for compact chips only; full addresses appear wherever they're relied on.
export function shortAddress(value: string): string {
  return value.length > 12 ? `${value.slice(0, 4)}…${value.slice(-4)}` : value;
}
export function localDate(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", options).format(new Date(iso));
}
