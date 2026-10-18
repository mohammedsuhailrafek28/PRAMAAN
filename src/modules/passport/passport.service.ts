import { AuditAction, Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { ApiError } from "../../utils/apiError.js";
import { newCuid } from "../../utils/id.js";
import { writeAuditLog } from "../audit/audit.service.js";
import { calculateAndPersistBusinessTrustProfileWithInputs } from "../trustEngine/trust-engine.service.js";
import { composeGeneratedTrustProfile } from "../trustEngine/trust-profile-composer.js";
import { SNAPSHOT_SCHEMA_VERSION, buildEvidenceRecords, validateSnapshot } from "./passport-snapshot.js";

const MAX_ATTEMPTS = 6;

/** Write-contention outcomes that are safe to retry from scratch: nothing was committed. */
function isRetryable(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) return ["P2002", "P2034", "P1008"].includes(error.code);
  const message = error instanceof Error ? error.message : "";
  return /database is locked|SQLITE_BUSY|write conflict|deadlock/i.test(message);
}

const pause = (attempt: number) => new Promise((resolve) => setTimeout(resolve, 15 * attempt + Math.floor(Math.random() * 25)));

/**
 * Generates the next Trust Profile version.
 *
 * Everything happens in one transaction: the complete snapshot (with its own id,
 * version and embedded evidence records) is built and validated first, and only
 * then inserted in a single statement, together with its audit row. A failure at
 * any step rolls the whole thing back, so no Passport row is ever observable with
 * an empty or partial snapshotJson, and no audit row can describe a snapshot that
 * does not exist. The first statement is a write to the Business row, which takes
 * the SQLite write lock up front so concurrent generations queue instead of
 * deadlocking on a read-then-write upgrade; version collisions are retried.
 */
export async function generate(userId: string) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          const locked = await tx.business.updateMany({ where: { userId }, data: { updatedAt: new Date() } });
          if (locked.count === 0) throw new ApiError(404, "NOT_FOUND", "Business profile not found.");
          const business = await tx.business.findUniqueOrThrow({ where: { userId } });
          if (!business.legalName && !business.gstin && !business.pan && !business.udyamNumber) {
            throw new ApiError(422, "INSUFFICIENT_BUSINESS_DATA", "Submit business claims before generating a Business Trust Profile.");
          }

          const latest = await tx.passport.aggregate({ where: { businessId: business.id }, _max: { version: true } });
          const version = (latest._max.version ?? 0) + 1;
          const generatedAt = new Date();
          const { profile, documents } = await calculateAndPersistBusinessTrustProfileWithInputs(business.id, tx);

          const id = newCuid();
          const snapshot = composeGeneratedTrustProfile({
            profileId: id,
            generatedAt,
            version,
            profile,
            evidence: buildEvidenceRecords(documents, profile),
            snapshotSchema: SNAPSHOT_SCHEMA_VERSION
          });
          validateSnapshot(snapshot, { profileId: id, businessId: business.id, version });

          const passport = await tx.passport.create({
            data: { id, businessId: business.id, version, generatedAt, snapshotJson: snapshot as Prisma.InputJsonValue }
          });
          await writeAuditLog({
            client: tx,
            businessId: business.id,
            actorId: userId,
            action: AuditAction.TRUST_PROFILE_GENERATED,
            metadata: { profileId: passport.id, version, summary: profile.summary, sourceVerificationPerformed: false }
          });
          return passport;
        },
        { maxWait: 15000, timeout: 30000 }
      );
    } catch (error) {
      if (attempt >= MAX_ATTEMPTS || !isRetryable(error)) throw error;
      await pause(attempt);
    }
  }
}

export async function getMine(userId: string) {
  const business = await prisma.business.findUnique({ where: { userId } });
  if (!business) throw new ApiError(404, "NOT_FOUND", "Business profile not found.");

  const passport = await prisma.passport.findFirst({
    where: { businessId: business.id },
    orderBy: { version: "desc" }
  });
  if (!passport) throw new ApiError(404, "NOT_FOUND", "Business Trust Profile not generated yet.");

  return passport;
}
