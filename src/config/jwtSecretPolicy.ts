export const MIN_PRODUCTION_JWT_SECRET_LENGTH = 32;

const KNOWN_WEAK_SECRETS = new Set([
  "dev-secret-change-me",
  "change-this-local-docker-secret",
  "replace-with-a-long-random-secret"
]);

function isRepetitive(secret: string) {
  if (/^(.)\1+$/.test(secret)) return true;
  for (let chunkLength = 1; chunkLength <= Math.floor(secret.length / 2); chunkLength += 1) {
    if (secret.length % chunkLength !== 0) continue;
    const chunk = secret.slice(0, chunkLength);
    if (chunk.repeat(secret.length / chunkLength) === secret) return true;
  }
  return false;
}

export function productionJwtSecretError(secret: string | undefined) {
  if (!secret) return "JWT_SECRET must be explicitly configured in production.";
  if (KNOWN_WEAK_SECRETS.has(secret)) return "JWT_SECRET uses a known development or demo value.";
  if (secret.length < MIN_PRODUCTION_JWT_SECRET_LENGTH) {
    return `JWT_SECRET must be at least ${MIN_PRODUCTION_JWT_SECRET_LENGTH} characters in production.`;
  }
  if (isRepetitive(secret)) return "JWT_SECRET must not be a repetitive value.";
  if (new Set(secret).size < 12) return "JWT_SECRET must contain meaningful character variety.";
  return undefined;
}
