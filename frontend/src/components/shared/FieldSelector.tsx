import { CONSENT_FIELD_LABELS, type ConsentField } from "@/types";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

const ALL_FIELDS = Object.keys(CONSENT_FIELD_LABELS) as ConsentField[];

interface FieldSelectorProps {
  selected: ConsentField[];
  /** Fields offered for selection; defaults to every consent field. */
  options?: ConsentField[];
  requestedFields?: ConsentField[];
  onChange: (fields: ConsentField[]) => void;
}

/**
 * Checkbox list of consent fields. Verifiers choose what to request; MSMEs
 * approve from `options`, which is limited to what was actually requested.
 */
export function FieldSelector({ selected, options = ALL_FIELDS, requestedFields = [], onChange }: FieldSelectorProps) {
  function toggle(field: ConsentField) {
    if (selected.includes(field)) onChange(selected.filter((f) => f !== field));
    else onChange([...selected, field]);
  }

  return (
    <div className="space-y-1">
      {options.map((field) => (
        <label
          key={field}
          className={cn(
            "flex cursor-pointer items-center justify-between rounded-md border border-transparent px-3 py-2 hover:bg-surface",
            selected.includes(field) && "border-primary-100 bg-primary-50/60"
          )}
        >
          <span className="flex items-center gap-2.5 text-sm text-slate-700">
            <Checkbox checked={selected.includes(field)} onCheckedChange={() => toggle(field)} />
            {CONSENT_FIELD_LABELS[field]}
          </span>
          {requestedFields.includes(field) && (
            <span className="text-xs font-medium text-primary-600">Requested</span>
          )}
        </label>
      ))}
    </div>
  );
}
