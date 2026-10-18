# F5 Report Generation Boundary

Report generation prepares its inputs before the final `GeneratedReport` transaction.

Passport generation and, for readiness report types, readiness evaluation may each commit their own Passport/readiness/audit records before the report snapshot and `REPORT_GENERATED` audit are persisted. A later report-builder, validation, report insert, or report-audit failure can therefore leave valid preparatory records even though no report was created. Report revocation and its audit are also outside the F5 generation transaction.

This is intentional for F5. The phase makes report persistence and its generation audit atomic, but does not attempt to make Passport preparation, readiness evaluation, report composition, and report persistence one global transaction. Passport/readiness preparation may therefore persist before report insertion. Existing Passport snapshot pinning remains the source of historical evidence for consent and guest disclosures.

Report evidence metadata is sourced from the exact Passport snapshot used for the report. Schema-2 snapshots provide embedded evidence records; they do not preserve original filenames, so `fileName` may be `null` even for a newly generated report. Legacy snapshots without embedded evidence are rejected by the current report-data loader for all report types; the loader never reads current `Document` rows to fill missing historical data.

For readiness report types, the readiness headline, level, requirements and actions are evaluated from the same schema-2 Passport snapshot as the report evidence. No live-document trust recomputation is performed in that report path. This guarantees generation-consistent readiness, but it does not make the preceding Passport preparation or the final report workflow globally atomic.

`persistReportAtomically` receives the authoritative pinned evidence ID set from `generateReport` and validates identity/evidence references again at the persistence boundary. The current report generator is the trusted caller of that internal entry point; it is not a public API.
