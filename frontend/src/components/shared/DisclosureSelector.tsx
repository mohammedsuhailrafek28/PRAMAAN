import { FileText, Type } from "lucide-react";

import { Checkbox } from "@/components/ui/checkbox";
import {
  EVIDENCE_DISCLOSURES,
  FIELD_DISCLOSURES,
  type DisclosureItem,
  type DisclosureScope,
  type EvidenceKey,
  type FieldKey,
} from "@/lib/disclosure";
import { cn } from "@/lib/utils";

interface DisclosureSelectorProps {
  value: DisclosureScope;
  onChange: (scope: DisclosureScope) => void;
  /** Items that may be selected. Defaults to the full catalogue. For approvals, pass the requested scope. */
  options?: DisclosureScope;
  /** Marks items as "Requested" (approval context). */
  requested?: DisclosureScope;
  /** Evidence types that cannot be chosen, with the reason shown beside them. */
  disabledEvidence?: Partial<Record<EvidenceKey, string>>;
  idPrefix: string;
}

function Group<K extends string>({
  title, hint, icon: Icon, items, selected, onToggle, requested, disabled, idPrefix,
}: {
  title: string; hint: string; icon: typeof FileText; items: readonly DisclosureItem<K>[]; selected: K[];
  onToggle: (key: K) => void; requested?: K[]; disabled?: Partial<Record<K, string>>; idPrefix: string;
}) {
  if (items.length === 0) return null;
  return (
    <fieldset className="space-y-1">
      <legend className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-600">
        <Icon className="h-3.5 w-3.5" aria-hidden />
        {title}
      </legend>
      <p className="mb-1.5 text-xs text-muted-foreground">{hint}</p>
      {items.map((item) => {
        const id = `${idPrefix}-${item.key}`;
        const reason = disabled?.[item.key];
        const checked = selected.includes(item.key);
        return (
          <label
            key={item.key}
            htmlFor={id}
            className={cn(
              "flex items-start justify-between gap-3 rounded-md border border-transparent px-3 py-2",
              reason ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:bg-surface",
              checked && "border-primary-100 bg-primary-50/60"
            )}
          >
            <span className="flex items-start gap-2.5">
              <Checkbox id={id} className="mt-0.5" checked={checked} disabled={Boolean(reason)} onCheckedChange={() => onToggle(item.key)} />
              <span>
                <span className="block text-sm text-slate-800">{item.label}</span>
                <span className="block text-xs text-muted-foreground">{reason ?? item.description}</span>
              </span>
            </span>
            {requested?.includes(item.key) && <span className="shrink-0 text-xs font-medium text-primary-600">Requested</span>}
          </label>
        );
      })}
    </fieldset>
  );
}

/**
 * The single picker for disclosure scope, used to request (verifier), approve
 * (MSME) and create guest links. Fields and evidence are always separate:
 * sharing GSTIN never implies sharing the GST certificate.
 */
export function DisclosureSelector({ value, onChange, options, requested, disabledEvidence, idPrefix }: DisclosureSelectorProps) {
  const fieldItems = options ? FIELD_DISCLOSURES.filter((item) => options.fields.includes(item.key)) : FIELD_DISCLOSURES;
  const evidenceItems = options ? EVIDENCE_DISCLOSURES.filter((item) => options.evidence.includes(item.key)) : EVIDENCE_DISCLOSURES;
  const toggleField = (key: FieldKey) => onChange({ ...value, fields: value.fields.includes(key) ? value.fields.filter((k) => k !== key) : [...value.fields, key] });
  const toggleEvidence = (key: EvidenceKey) => onChange({ ...value, evidence: value.evidence.includes(key) ? value.evidence.filter((k) => k !== key) : [...value.evidence, key] });

  return (
    <div className="space-y-4">
      <Group
        title="Business information" hint="Values from the Trust Profile." icon={Type} items={fieldItems}
        selected={value.fields} onToggle={toggleField} requested={requested?.fields} idPrefix={`${idPrefix}-field`}
      />
      <Group
        title="Supporting evidence" hint="Check status, source and dates as of the shared Trust Profile version. The file itself is never shared."
        icon={FileText} items={evidenceItems} selected={value.evidence} onToggle={toggleEvidence}
        requested={requested?.evidence} disabled={disabledEvidence} idPrefix={`${idPrefix}-evidence`}
      />
    </div>
  );
}
