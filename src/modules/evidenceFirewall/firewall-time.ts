// Strict timestamp handling shared by the firewall. Only full ISO-8601 instants with an explicit zone are accepted:
// Date.parse alone also accepts "2026", "Oct 20 2026" and other locale-dependent strings, which must never count as
// a valid expiry, revocation or assessment time.

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/;

/** Milliseconds since the epoch for a valid ISO-8601 instant, otherwise null. */
export function isoInstant(value: unknown): number | null {
  if (typeof value !== "string" || !ISO_INSTANT.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

export const hasOwn = (object: object, key: string) => Object.prototype.hasOwnProperty.call(object, key);

/** true when `key` is an own property holding null or a valid ISO instant. Missing, undefined and malformed fail. */
export function isOwnNullOrInstant(object: object, key: string): boolean {
  if (!hasOwn(object, key)) return false;
  const value = (object as Record<string, unknown>)[key];
  return value === null || isoInstant(value) !== null;
}
