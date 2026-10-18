import { randomBytes } from "node:crypto";

let counter = Math.floor(Math.random() * 36 ** 4);

/**
 * A cuid-shaped identifier (25 characters, "c" prefix) so a row's id can be known
 * before it is inserted. Prisma's own `@default(cuid())` is generated inside the
 * client and cannot be read in advance; Passport needs its id inside its snapshot.
 */
export function newCuid(): string {
  counter = (counter + 1) % 36 ** 4;
  const time = Date.now().toString(36).padStart(8, "0");
  const count = counter.toString(36).padStart(4, "0");
  const fingerprint = (process.pid % 36 ** 4).toString(36).padStart(4, "0");
  const random = [...randomBytes(8)].map((byte) => (byte % 36).toString(36)).join("");
  return `c${time}${count}${fingerprint}${random}`;
}
