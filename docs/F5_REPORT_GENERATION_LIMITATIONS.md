# F5 Report Generation Boundary

Report generation prepares its inputs before the final `GeneratedReport` transaction.

Passport generation and, for readiness report types, readiness evaluation may each commit their own Passport/readiness/audit records before the report snapshot and `REPORT_GENERATED` audit are persisted. A later report-builder, validation, report insert, or report-audit failure can therefore leave valid preparatory records even though no report was created.

This is intentional for F5. The phase makes report persistence and its generation audit atomic, but does not attempt to make Passport preparation, readiness evaluation, report composition, and report persistence one global transaction. Existing Passport snapshot pinning remains the source of historical evidence for consent and guest disclosures.

Report evidence metadata is sourced from the exact Passport snapshot used for the report. Schema-2 snapshots provide embedded evidence records; legacy snapshots without those records return unavailable/null metadata rather than reading current `Document` rows.
