import type { ReportDocument } from "../report-composer.types.js";
import { asArray, asStringArray, formatDateTime, humanize, percentWidth } from "./report-formatters.js";
import { clampScore, escapeHtml, maskSensitive, safeJsonValue, stripPath, text } from "./report-sanitizer.js";
import { reportStyles } from "./report-styles.js";

export function renderReportHtml(document: ReportDocument) {
  const revoked = Boolean(document.revokedAt);
  const reportName = humanize(document.reportType);
  const businessName = safeJsonValue(document.business?.businessName);
  const sourceVerified = document.provenance?.sourceVerificationPerformed === true;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${text(reportName)} - ${text(businessName)}</title>
  <style>${reportStyles}</style>
</head>
<body>
  <main class="report">
    <header class="topline">
      <div>
        <div class="brand">PRAMAAN</div>
        <div class="kicker">Evidence-backed business report</div>
      </div>
      <div class="meta">
        <div>Report ID: ${text(document.reportId)}</div>
        <div>Version: ${text(document.reportVersion)}</div>
        <div>Generated: ${text(formatDateTime(document.generatedAt))}</div>
      </div>
    </header>

    ${revoked ? `<div class="watermark">REVOKED</div><div class="revoked">REVOKED - This report was revoked at ${text(formatDateTime(document.revokedAt))}. It remains visible to the owner for history, but should no longer be relied on as current.</div>` : ""}

    <h1>${text(reportName)}</h1>
    <p class="statement">Evidence-backed report generated from submitted information and internal consistency checks.</p>
    ${sourceVerified ? "" : `<p class="warning">No authoritative external source verification was performed.</p>`}

    ${renderHeaderSummary(document)}
    ${renderBusinessIdentity(document)}
    ${renderTrustMetrics(document)}
    ${renderIdentityFields(document)}
    ${renderReadiness(document)}
    ${renderEvidence(document)}
    ${renderContradictions(document)}
    ${renderActions(document)}
    ${renderTimeline(document)}
    ${renderLimitations(document)}
    ${renderProvenance(document)}

    <p class="footer-note">PRAMAAN - Evidence-backed report - not an approval or certificate. This HTML/PDF is a presentation of the stored immutable JSON report snapshot.</p>
  </main>
</body>
</html>`;
}

function renderHeaderSummary(document: ReportDocument) {
  return `<section class="section">
    <h2>Executive Summary</h2>
    <div class="grid">
      ${fieldBlock("Business", document.business?.businessName)}
      ${fieldBlock("Status", document.headline?.statusLabel)}
      ${fieldBlock("Score", document.headline?.score ?? "Not applicable")}
      ${fieldBlock("Readiness Level", document.headline?.level ?? "Not applicable")}
    </div>
    <p>${text(document.headline?.summary, "No executive summary was stored with this report.")}</p>
    ${document.headline?.blocked ? `<p class="warning">This readiness report is blocked by one or more stored blocking issues.</p>` : ""}
  </section>`;
}

function renderBusinessIdentity(document: ReportDocument) {
  const identifiers = document.business?.identifiers as Record<string, unknown> | undefined;
  return `<section class="section">
    <h2>Business Identity</h2>
    <div class="grid">
      ${fieldBlock("Business Name", document.business?.businessName)}
      ${fieldBlock("Owner", document.business?.ownerName)}
      ${fieldBlock("GSTIN", identifiers?.gstin)}
      ${fieldBlock("PAN", identifiers?.pan)}
      ${fieldBlock("Udyam Number", identifiers?.udyamNumber)}
      ${fieldBlock("Address", document.business?.address)}
    </div>
  </section>`;
}

function renderTrustMetrics(document: ReportDocument) {
  const metrics = asArray(document.trustMetrics);
  if (!metrics.length) return emptySection("Trust Metrics", "No trust metrics were stored in this report snapshot.");
  return `<section class="section">
    <h2>Trust Metrics</h2>
    <div class="metric-grid">
      ${metrics.map((metric) => {
        const score = clampScore(metric.score ?? metric.value);
        return `<div class="metric">
          <div class="metric-label">${text(metric.label ?? metric.metric)}</div>
          <div class="metric-score">${text(score ?? "N/A")}${score === null ? "" : "/100"}</div>
          <div class="bar" aria-label="${text(metric.label ?? metric.metric)} score ${score ?? "not available"}"><span style="width:${percentWidth(score)}"></span></div>
          <p>${text(metric.explanation ?? metric.reason ?? "Stored metric without additional explanation.")}</p>
        </div>`;
      }).join("")}
    </div>
  </section>`;
}

function renderIdentityFields(document: ReportDocument) {
  const fields = asArray(document.identityFields);
  if (!fields.length) return emptySection("Field Confidence", "No identity field confidence rows were stored.");
  return `<section class="section">
    <h2>Field Confidence</h2>
    <table>
      <thead><tr><th>Field</th><th>Value</th><th>Status</th><th>Confidence</th><th>Reason</th><th>Evidence</th><th>Checks</th></tr></thead>
      <tbody>
        ${fields.map((field) => `<tr>
          <td>${text(field.label ?? field.field)}</td>
          <td>${text(maskSensitive(field.field, field.value))}</td>
          <td>${badge(field.evidenceStatus)}</td>
          <td>${text(field.confidence ?? "N/A")}</td>
          <td>${text(field.reason)}</td>
          <td>${text(Array.isArray(field.evidenceIds) ? field.evidenceIds.length : 0)}</td>
          <td>${renderInlineList(asStringArray(field.checks))}</td>
        </tr>`).join("")}
      </tbody>
    </table>
  </section>`;
}

function renderReadiness(document: ReportDocument) {
  const requirements = asArray(document.requirements);
  if (!requirements.length) return "";
  const groups = ["SATISFIED", "PARTIALLY_SATISFIED", "MISSING", "BLOCKED", "MANUAL_REVIEW", "NOT_APPLICABLE"];
  return `<section class="section major">
    <h2>Purpose-Specific Readiness</h2>
    ${groups.map((group) => {
      const rows = requirements.filter((item) => String(item.status ?? "").toUpperCase() === group);
      if (!rows.length) return "";
      return `<h3>${text(humanize(group))}</h3>${renderRequirementTable(rows)}`;
    }).join("")}
  </section>`;
}

function renderRequirementTable(rows: Array<Record<string, any>>) {
  return `<table>
    <thead><tr><th>Requirement</th><th>Status</th><th>Score</th><th>Weight</th><th>Evidence</th><th>Reason</th><th>Next Action</th></tr></thead>
    <tbody>
      ${rows.map((row) => `<tr>
        <td>${text(row.label ?? row.requirementId)}</td>
        <td>${badge(row.status)}</td>
        <td>${text(row.score ?? "N/A")}</td>
        <td>${text(row.weight ?? "N/A")}</td>
        <td>${text(row.evidenceStatus ?? row.minimumEvidenceStatus ?? "N/A")}</td>
        <td>${text(row.reason ?? row.message)}</td>
        <td>${text(row.nextAction ?? row.action ?? "No action stored.")}</td>
      </tr>`).join("")}
    </tbody>
  </table>`;
}

function renderEvidence(document: ReportDocument) {
  const evidence = asArray(document.evidence);
  if (!evidence.length) return emptySection("Evidence Register", "No submitted evidence was stored in this report snapshot.");
  return `<section class="section major">
    <h2>Evidence Register</h2>
    <table>
      <thead><tr><th>Document Type</th><th>Filename</th><th>Submitted</th><th>Status</th><th>Confidence</th><th>Expiry</th><th>Method</th><th>Reason</th></tr></thead>
      <tbody>
        ${evidence.map((item) => `<tr>
          <td>${text(humanize(item.documentType))}</td>
          <td>${text(stripPath(item.fileName))}</td>
          <td>${text(formatDateTime(item.submittedAt))}</td>
          <td>${badge(item.evidenceStatus)}</td>
          <td>${text(item.confidence ?? "N/A")}</td>
          <td>${text(formatDateTime(item.expiresAt))}</td>
          <td>${text(item.crossCheckMethod)}</td>
          <td>${text(item.reason)} ${renderInlineList(asStringArray(item.limitations))}</td>
        </tr>`).join("")}
      </tbody>
    </table>
  </section>`;
}

function renderContradictions(document: ReportDocument) {
  const contradictions = asArray(document.contradictions);
  const blockers = asArray(document.requirements).filter((item) => String(item.status ?? "").toUpperCase() === "BLOCKED");
  if (!contradictions.length && !blockers.length) return emptySection("Contradictions and Blocking Issues", "No contradictions or blocking issues were stored in this report snapshot.");
  return `<section class="section">
    <h2>Contradictions and Blocking Issues</h2>
    ${contradictions.length ? `<h3>Contradictions</h3><table><thead><tr><th>Field</th><th>Severity</th><th>Reason</th><th>Claimed Value</th><th>Evidence Values</th><th>Resolution Guidance</th></tr></thead><tbody>${contradictions.map((item) => `<tr><td>${text(item.field)}</td><td>${badge(item.severity)}</td><td>${text(item.reason)}</td><td>${text(maskSensitive(item.field, item.claimedValue))}</td><td>${renderInlineList(asStringArray(item.evidenceValues))}</td><td>${text(item.resolutionNeeded)}</td></tr>`).join("")}</tbody></table>` : ""}
    ${blockers.length ? `<h3>Blocking Issues</h3>${renderRequirementTable(blockers)}` : ""}
  </section>`;
}

function renderActions(document: ReportDocument) {
  const actions = asArray(document.actions);
  const gaps = asArray(document.gaps);
  return `<section class="section">
    <h2>Gaps and Action Plan</h2>
    ${gaps.length ? `<h3>Gaps</h3>${renderInlineList(gaps.map((gap) => `${safeJsonValue(gap.field ?? gap.requirementId)}: ${safeJsonValue(gap.message ?? gap.reason)}`))}` : `<p>Current submitted evidence satisfies all requirements represented by this report profile. Final institutional requirements may still differ.</p>`}
    ${actions.length ? `<h3>Next Actions</h3><table><thead><tr><th>Priority</th><th>Title</th><th>Description</th><th>Reason</th><th>Expected Status Change</th></tr></thead><tbody>${actions.map((action) => `<tr><td>${text(action.priority)}</td><td>${text(action.title)}</td><td>${text(action.description)}</td><td>${text(action.reason)}</td><td>${text(action.expectedStatusChange)}</td></tr>`).join("")}</tbody></table>` : ""}
  </section>`;
}

function renderTimeline(document: ReportDocument) {
  const timeline = asArray(document.timeline);
  if (!timeline.length) return emptySection("Trust Timeline", "No timeline events were stored in this report snapshot.");
  return `<section class="section major">
    <h2>Trust Timeline</h2>
    ${timeline.map((event) => `<div class="timeline-item">
      <div class="label">${text(formatDateTime(event.createdAt ?? event.timestamp ?? event.date))}</div>
      <strong>${text(event.title ?? event.action)}</strong>
      <p>${text(event.description ?? event.message)}</p>
      <p class="muted">Actor type: ${text(event.actorRole ?? event.actorType ?? "Not provided")}</p>
    </div>`).join("")}
  </section>`;
}

function renderLimitations(document: ReportDocument) {
  const limitations = asStringArray(document.limitations);
  return `<section class="section">
    <h2>Limitations and Disclaimer</h2>
    ${renderInlineList([
      "Report generated from submitted information.",
      "Internal cross-checks are not authoritative external verification.",
      "Readiness does not guarantee approval, eligibility, lending, compliance, or acceptance.",
      "Actual requirements vary by institution.",
      "This report is a time-bound snapshot.",
      ...(document.revokedAt ? ["This report has been revoked and should no longer be relied on as current."] : []),
      ...limitations,
      safeJsonValue(document.disclaimer)
    ])}
  </section>`;
}

function renderProvenance(document: ReportDocument) {
  const p = document.provenance ?? {};
  return `<section class="section">
    <h2>Provenance</h2>
    <div class="grid">
      ${fieldBlock("Report ID", document.reportId)}
      ${fieldBlock("Report Version", document.reportVersion)}
      ${fieldBlock("Generated At", formatDateTime(document.generatedAt))}
      ${fieldBlock("Trust Profile ID", p.trustProfileId)}
      ${fieldBlock("Trust Profile Generated At", formatDateTime(p.trustProfileGeneratedAt))}
      ${fieldBlock("Readiness Evaluation ID", p.readinessEvaluationId)}
      ${fieldBlock("Readiness Profile ID", p.readinessProfileId)}
      ${fieldBlock("Readiness Profile Version", p.readinessProfileVersion)}
      ${fieldBlock("Source Verification Performed", p.sourceVerificationPerformed === true ? "true" : "false")}
    </div>
  </section>`;
}

function fieldBlock(label: string, value: unknown) {
  return `<div class="metric"><div class="label">${text(label)}</div><div>${text(value)}</div></div>`;
}

function badge(value: unknown) {
  return `<span class="badge">${text(humanize(value))}</span>`;
}

function renderInlineList(items: string[]) {
  if (!items.length) return `<span class="muted">None stored.</span>`;
  return `<ul>${items.map((item) => `<li>${text(item)}</li>`).join("")}</ul>`;
}

function emptySection(title: string, message: string) {
  return `<section class="section"><h2>${escapeHtml(title)}</h2><p class="muted">${escapeHtml(message)}</p></section>`;
}
