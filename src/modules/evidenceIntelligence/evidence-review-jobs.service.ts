// Bounded asynchronous evidence-review jobs.
//
// Reading scanned documents takes seconds to minutes, so the owner STARTS a job, gets an id immediately, and POLLS it.
//
//  * State lives in SQLite (table EvidenceReviewJob: status, progress, error code). No extracted content is stored there;
//    values live only in the short-lived in-memory extraction cache of evidence-intelligence.service.ts.
//  * One active (QUEUED/RUNNING) job per business, enforced by a partial unique index. Starting again with unchanged
//    documents returns the same job; starting after the documents changed supersedes (cancels) the old job.
//  * Unchanged document revisions are never re-read: every document already in the cache is reused, and if all are, the job
//    is SUCCEEDED immediately.
//  * Capacity: at most `maxRunning` jobs run at once (the worker client bounds processes too) and at most `maxActive`
//    jobs may be queued+running system-wide (HTTP 503 QUEUE_FULL beyond that).
//  * A job is only visible to the business that owns it (404 otherwise, indistinguishable from "does not exist").
//  * Restarts are explicit: on boot, RUNNING jobs become FAILED/SERVER_RESTARTED and QUEUED jobs are resumed; a RUNNING job
//    nobody is working on (or with a stale heartbeat) is failed on the next poll. The owner just starts a new job.
//  * Jobs never touch consent, Passport snapshots, trust scores, audit rows or notifications.

import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { ApiError } from "../../utils/apiError.js";
import { buildReview, cachedExtractions, extractOne, loadOwnerState, MAX_REVIEW_DOCUMENTS, PIPELINE_VERSION } from "./evidence-intelligence.service.js";
import { ExtractionAborted } from "./worker-client.js";

export type JobStatus = "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED";
const ACTIVE: JobStatus[] = ["QUEUED", "RUNNING"];

export const JOB_LIMITS = {
  maxActive: Number(process.env.EVIDENCE_REVIEW_QUEUE_MAX ?? 20),
  maxRunning: Number(process.env.EVIDENCE_REVIEW_CONCURRENCY ?? 2),
  staleHeartbeatMs: Number(process.env.EVIDENCE_REVIEW_STALE_MS ?? 6 * 60_000),
  retentionMs: 24 * 60 * 60 * 1000
};

const running = new Map<string, AbortController>();
let pumping = false;
let again = false;

type Row = NonNullable<Awaited<ReturnType<typeof prisma.evidenceReviewJob.findFirst>>>;
type OwnerState = Awaited<ReturnType<typeof loadOwnerState>>;

export const documentsFingerprint = (documents: Array<{ id: string; revision: number }>) =>
  createHash("sha256").update(`${PIPELINE_VERSION}|${documents.slice(0, MAX_REVIEW_DOCUMENTS).map((d) => `${d.id}:${d.revision}`).sort().join(",")}`).digest("hex");

function view(job: Row) {
  return {
    id: job.id,
    status: job.status as JobStatus,
    docsTotal: job.docsTotal,
    docsDone: job.docsDone,
    currentStep: job.currentStep,
    errorCode: job.errorCode,
    degraded: job.degraded,
    isolation: job.isolation as "CONTAINER" | "LOCAL_PROCESS" | null,
    createdAt: job.createdAt.toISOString(),
    startedAt: job.startedAt?.toISOString() ?? null,
    finishedAt: job.finishedAt?.toISOString() ?? null
  };
}

async function finishIfActive(id: string, status: JobStatus, data: Prisma.EvidenceReviewJobUpdateManyMutationInput = {}) {
  const { count } = await prisma.evidenceReviewJob.updateMany({ where: { id, status: { in: ACTIVE } }, data: { status, finishedAt: new Date(), currentStep: null, ...data } });
  return count === 1;
}

async function cancelInternal(id: string, errorCode: string) {
  await finishIfActive(id, "CANCELLED", { errorCode });
  running.get(id)?.abort();
}

async function prune(businessId: string) {
  await prisma.evidenceReviewJob.deleteMany({ where: { businessId, status: { notIn: ACTIVE }, createdAt: { lt: new Date(Date.now() - JOB_LIMITS.retentionMs) } } });
}

/** Starts (or joins) the owner's review job. */
export async function startReviewJob(userId: string) {
  const business = await loadOwnerState(userId);
  const documents = business.documents.slice(0, MAX_REVIEW_DOCUMENTS);
  const fingerprint = documentsFingerprint(documents);
  await prune(business.id);

  const active = await prisma.evidenceReviewJob.findFirst({ where: { businessId: business.id, status: { in: ACTIVE } } });
  if (active) {
    if (active.fingerprint === fingerprint) return { job: view(active), reused: "ACTIVE_JOB" as const };
    await cancelInternal(active.id, "SUPERSEDED");
  }

  if (cachedExtractions(business.id, documents)) {
    const done = await prisma.evidenceReviewJob.create({
      data: { businessId: business.id, userId, status: "SUCCEEDED", fingerprint, docsTotal: documents.length, docsDone: documents.length, startedAt: new Date(), finishedAt: new Date() }
    });
    return { job: view(done), reused: "CACHED_RESULTS" as const };
  }

  const activeCount = await prisma.evidenceReviewJob.count({ where: { status: { in: ACTIVE } } });
  if (activeCount >= JOB_LIMITS.maxActive) throw new ApiError(503, "QUEUE_FULL", "Document reading is busy right now. Please try again in a few minutes.");
  try {
    const created = await prisma.evidenceReviewJob.create({ data: { businessId: business.id, userId, status: "QUEUED", fingerprint, docsTotal: documents.length } });
    void pump();
    return { job: view(created), reused: null };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      // A concurrent request created the single active job first: join it.
      const winner = await prisma.evidenceReviewJob.findFirst({ where: { businessId: business.id, status: { in: ACTIVE } } });
      if (winner) return { job: view(winner), reused: "ACTIVE_JOB" as const };
    }
    throw error;
  }
}

async function pump() {
  // A request that arrives while the loop is between its last look at the queue and clearing `pumping` must not be lost:
  // it sets `again`, and the loop looks once more.
  if (pumping) { again = true; return; }
  pumping = true;
  try {
    do {
      again = false;
      while (running.size < JOB_LIMITS.maxRunning) {
        const next = await prisma.evidenceReviewJob.findFirst({ where: { status: "QUEUED" }, orderBy: { createdAt: "asc" } });
        if (!next) break;
        const claimed = await prisma.evidenceReviewJob.updateMany({ where: { id: next.id, status: "QUEUED" }, data: { status: "RUNNING", startedAt: new Date(), heartbeatAt: new Date() } });
        if (claimed.count !== 1) continue;
        const controller = new AbortController();
        running.set(next.id, controller);
        void runJob(next, controller);
      }
    } while (again);
  } finally {
    pumping = false;
  }
}

async function runJob(job: Row, controller: AbortController) {
  try {
    const business = await prisma.business.findUnique({ where: { id: job.businessId }, include: { documents: { where: { isCurrent: true }, orderBy: [{ docType: "asc" }, { revision: "desc" }] } } });
    const documents = (business?.documents ?? []).slice(0, MAX_REVIEW_DOCUMENTS);
    if (!business || documentsFingerprint(documents) !== job.fingerprint) {
      await finishIfActive(job.id, "CANCELLED", { errorCode: "DOCUMENTS_CHANGED" });
      return;
    }
    let degraded = false;
    let isolation: string | null = null;
    for (let index = 0; index < documents.length; index += 1) {
      if (controller.signal.aborted) return;
      const step = await prisma.evidenceReviewJob.updateMany({ where: { id: job.id, status: "RUNNING" }, data: { currentStep: `READING:${documents[index].docType}`, docsDone: index, heartbeatAt: new Date() } });
      if (step.count !== 1) return; // cancelled or superseded while we were working
      const { extraction } = await extractOne(business.id, documents[index], controller.signal);
      if (extraction.engine === "LEGACY" || extraction.reason === "WORKER_UNAVAILABLE") degraded = true;
      if (extraction.isolation) isolation = extraction.isolation;
    }
    await finishIfActive(job.id, "SUCCEEDED", { docsDone: documents.length, degraded, isolation });
  } catch (error) {
    if (error instanceof ExtractionAborted || controller.signal.aborted) return;
    await finishIfActive(job.id, "FAILED", { errorCode: error instanceof ApiError ? error.code : "EXTRACTION_FAILED" });
  } finally {
    running.delete(job.id);
    void pump();
  }
}

/** Call once at startup: explicit failure for interrupted jobs, resume for queued ones. */
export async function recoverInterruptedJobs() {
  await prisma.evidenceReviewJob.updateMany({ where: { status: "RUNNING" }, data: { status: "FAILED", errorCode: "SERVER_RESTARTED", finishedAt: new Date(), currentStep: null } });
  void pump();
}

async function failIfOrphaned(job: Row): Promise<Row> {
  if (job.status !== "RUNNING") return job;
  const silent = Date.now() - (job.heartbeatAt ?? job.startedAt ?? job.createdAt).getTime() > JOB_LIMITS.staleHeartbeatMs;
  if (running.has(job.id) && !silent) return job;
  await finishIfActive(job.id, "FAILED", { errorCode: running.has(job.id) ? "JOB_TIMEOUT" : "JOB_INTERRUPTED" });
  running.get(job.id)?.abort();
  return (await prisma.evidenceReviewJob.findUnique({ where: { id: job.id } })) ?? job;
}

async function ownJob(business: OwnerState, jobId: string): Promise<Row> {
  const job = await prisma.evidenceReviewJob.findFirst({ where: { id: jobId, businessId: business.id } });
  if (!job) throw new ApiError(404, "NOT_FOUND", "Review job not found.");
  return job;
}

/** Status of one of the owner's jobs; includes the review once the job has SUCCEEDED and its results are still valid. */
export async function getReviewJob(userId: string, jobId: string, now = new Date()) {
  const business = await loadOwnerState(userId);
  const job = await failIfOrphaned(await ownJob(business, jobId));
  const base = { job: view(job) };
  if (job.status !== "SUCCEEDED") return base;
  const documents = business.documents.slice(0, MAX_REVIEW_DOCUMENTS);
  // A document was replaced after this job read the files: the result must not be shown as current.
  if (documentsFingerprint(documents) !== job.fingerprint) return { ...base, resultState: "STALE" as const };
  const extractions = cachedExtractions(business.id, documents);
  if (!extractions) return { ...base, resultState: "EXPIRED" as const };
  return { ...base, resultState: "READY" as const, review: buildReview(business, extractions, now) };
}

export async function cancelReviewJob(userId: string, jobId: string) {
  const business = await loadOwnerState(userId);
  const job = await ownJob(business, jobId);
  if (ACTIVE.includes(job.status as JobStatus)) await cancelInternal(job.id, "CANCELLED_BY_OWNER");
  return { job: view((await prisma.evidenceReviewJob.findUnique({ where: { id: job.id } })) ?? job) };
}

/** Test hook: aborts in-flight work without touching the database (simulates the process dying). */
export function _abandonRunningJobsForTests() {
  for (const controller of running.values()) controller.abort();
  running.clear();
}
