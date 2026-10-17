import "dotenv/config";
import { prisma } from "../src/config/prisma.js";
import { applyOperatorTransition, listHistory, type AssuranceOperatorInput } from "../src/modules/requesterAssurance/assurance.service.js";

function args() {
  const values = new Map<string, string>();
  for (let index = 2; index < process.argv.length; index += 1) {
    const value = process.argv[index];
    if (!value.startsWith("--")) continue;
    const [key, inline] = value.slice(2).split("=", 2);
    values.set(key, inline ?? process.argv[index + 1] ?? "");
    if (inline === undefined) index += 1;
  }
  return values;
}

function required(values: Map<string, string>, key: string) {
  const value = values.get(key)?.trim();
  if (!value) throw new Error(`Missing --${key}.`);
  return value;
}

function list(value: string | undefined) {
  return value ? value.split(",").map((item) => item.trim()).filter(Boolean) : [];
}

function usage() {
  console.log(`Local requester assurance operator (no public admin API):

Review organization:
  npx tsx scripts/requester-assurance.ts review --user-id ID --operator-id OP --review-basis REF [--organization-name NAME]
Authorize requester:
  npx tsx scripts/requester-assurance.ts authorize --user-id ID --operator-id OP --authorization-basis REF --authorization-reference REF --expires-at ISO --scope-fields a,b --scope-evidence-types TYPE
Suspend requester:
  npx tsx scripts/requester-assurance.ts suspend --user-id ID --operator-id OP --suspension-reason REASON
Re-review requester:
  npx tsx scripts/requester-assurance.ts re-review --user-id ID --operator-id OP --review-basis REF [--organization-name NAME]
View history:
  npx tsx scripts/requester-assurance.ts history --user-id ID`);
}

const values = args();
const action = process.argv[2] as AssuranceOperatorInput["action"] | "history" | "help" | undefined;

async function main() {
try {
  if (!action || action === "help") {
    usage();
  } else if (action === "history") {
    const events = await listHistory(required(values, "user-id"));
    console.log(JSON.stringify(events.map((event) => ({ id: event.id, operatorId: event.operatorId, action: event.action, previousStatus: event.previousStatus, newStatus: event.newStatus, createdAt: event.createdAt })), null, 2));
  } else {
    if (!["review", "authorize", "suspend", "re-review"].includes(action)) throw new Error("Unsupported operator action.");
    const input: AssuranceOperatorInput = {
      action,
      userId: required(values, "user-id"),
      operatorId: required(values, "operator-id"),
      organizationName: values.get("organization-name"),
      reviewBasis: values.get("review-basis"),
      authorizationBasis: values.get("authorization-basis"),
      authorizationReference: values.get("authorization-reference"),
      authorizationExpiresAt: values.get("expires-at"),
      authorizationScope: { fields: list(values.get("scope-fields")), evidenceTypes: list(values.get("scope-evidence-types")) },
      suspensionReason: values.get("suspension-reason")
    };
    const result = await applyOperatorTransition(input);
    console.log(JSON.stringify({ userId: result.userId, status: result.status, reviewedAt: result.reviewedAt, authorizationExpiresAt: result.authorizationExpiresAt, suspendedAt: result.suspendedAt }, null, 2));
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "Operator transition failed.");
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
}

void main();
