import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { FileText, Landmark, Receipt, UploadCloud, CheckCircle2, ArrowRight, AlertCircle, Info } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SectionCard } from "@/components/shared/SectionCard";
import { EvidenceStatusBadge } from "@/components/shared/EvidenceStatusBadge";
import { useAppStore } from "@/store/appStore";
import { TURNOVER_BANDS, type CrossCheckResult, type DocumentType } from "@/types";
import { cn, formatDateTime } from "@/lib/utils";
import { backendFieldLabel, documentTypeLabel } from "@/lib/fieldLabels";
import { NOT_EXTERNALLY_VERIFIED, describeEvidenceStatus } from "@/lib/trustVocabulary";
import { getApiError } from "@/services/api";
import { useToast } from "@/components/ui/use-toast";

const schema = z.object({
  legalName: z.string().min(2, "Enter the legal business name"),
  gstin: z.string().regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/, "GSTIN must be a valid 15-character GSTIN"),
  udyamNumber: z.string().regex(/^UDYAM-[A-Z]{2}-\d{2}-\d{7}$/, "Format: UDYAM-XX-00-0000000"),
  pan: z.string().regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/, "PAN must be 10 characters, e.g. ABCDE1234F"),
  address: z.string().min(5, "Enter the registered address"),
  turnoverBand: z.string().min(1, "Select a turnover band"),
});
type FormValues = z.infer<typeof schema>;

const DOC_TILES: { type: DocumentType; label: string; icon: typeof FileText }[] = [
  { type: "gst_certificate", label: "GST Certificate", icon: Receipt },
  { type: "udyam_certificate", label: "Udyam Certificate", icon: FileText },
  { type: "bank_statement", label: "Bank Statement", icon: Landmark },
];

const SEVERITY_ORDER: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

function CrossCheckResults({ result }: { result: CrossCheckResult }) {
  const overall = describeEvidenceStatus(result.trustStatus);
  const gaps = [...result.gaps].sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9));
  return (
    <SectionCard title="Cross-check results" description={`Run ${formatDateTime(result.checkedAt)}. These are the results the engine just produced.`}>
      <div className="flex flex-wrap items-center gap-3 rounded-md border border-border p-3 text-sm">
        <span className="font-medium text-slate-800">Overall:</span>
        <EvidenceStatusBadge status={result.trustStatus} />
        <span className="text-muted-foreground">{overall.description}</span>
      </div>

      <div className="mt-4 overflow-hidden rounded-md border border-border">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Field-level cross-check results</caption>
          <thead className="bg-surface text-xs uppercase tracking-wide text-muted-foreground">
            <tr><th scope="col" className="px-3 py-2 font-medium">Claim</th><th scope="col" className="px-3 py-2 font-medium">Status</th><th scope="col" className="hidden px-3 py-2 font-medium md:table-cell">Why</th></tr>
          </thead>
          <tbody>
            {result.fields.map((field) => (
              <tr key={field.field} className="border-t border-border align-top">
                <td className="px-3 py-2.5 font-medium text-slate-800">{backendFieldLabel(field.field)}<p className="mt-1 text-xs font-normal text-muted-foreground md:hidden">{field.reason}</p></td>
                <td className="px-3 py-2.5"><EvidenceStatusBadge status={field.status} /></td>
                <td className="hidden px-3 py-2.5 text-muted-foreground md:table-cell">{field.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {result.contradictions.length > 0 && (
        <div className="mt-4 space-y-2">
          <h4 className="text-sm font-semibold text-slate-900">Conflicts</h4>
          {result.contradictions.map((item, index) => (
            <p key={index} className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              <span className="font-medium">{backendFieldLabel(item.field)}</span> ({item.severity.toLowerCase()}): {item.reason}
            </p>
          ))}
        </div>
      )}

      {gaps.length > 0 && (
        <div className="mt-4 space-y-2">
          <h4 className="text-sm font-semibold text-slate-900">Evidence gaps</h4>
          {gaps.map((gap, index) => (
            <p key={index} className="rounded-md border border-warning-border bg-warning-bg px-3 py-2 text-sm text-warning-foreground">
              <span className="font-medium">{backendFieldLabel(gap.field)}</span> ({gap.severity.toLowerCase()}): {gap.message}
            </p>
          ))}
        </div>
      )}

      <p className="mt-4 flex items-start gap-2 text-xs text-muted-foreground"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />{NOT_EXTERNALLY_VERIFIED}</p>
    </SectionCard>
  );
}

export function BusinessVerificationPage() {
  const navigate = useNavigate();
  const { business, crossCheckResult, loadBusiness, saveBusinessProfile, uploadBusinessDocument, crossCheckBusiness, error } = useAppStore();
  const { toast } = useToast();
  const [files, setFiles] = useState<Partial<Record<DocumentType, File>>>({});
  const [running, setRunning] = useState(false);

  useEffect(() => {
    loadBusiness();
  }, [loadBusiness]);

  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    values: business
      ? {
          legalName: business.legalName,
          gstin: business.gstin,
          udyamNumber: business.udyamNumber,
          pan: business.pan,
          address: business.address,
          turnoverBand: business.turnoverBand,
        }
      : undefined,
  });

  // Keep a stored value selectable even if it predates the current band list.
  const turnoverOptions: string[] = business?.turnoverBand && !(TURNOVER_BANDS as readonly string[]).includes(business.turnoverBand)
    ? [business.turnoverBand, ...TURNOVER_BANDS]
    : [...TURNOVER_BANDS];

  function selectFile(type: DocumentType, file?: File) {
    if (!file) return;
    setFiles((prev) => ({ ...prev, [type]: file }));
  }

  async function onSubmit(values: FormValues) {
    setRunning(true);
    try {
      await saveBusinessProfile(values);
      for (const tile of DOC_TILES) {
        const file = files[tile.type];
        if (file) await uploadBusinessDocument(tile.type, file);
      }
      setFiles({});
      const result = await crossCheckBusiness();
      toast({ title: "Internal cross-check complete", description: `Overall result: ${describeEvidenceStatus(result.trustStatus).label}.` });
    } catch (error) {
      toast({ title: "Cross-check could not be completed", description: getApiError(error), variant: "destructive" });
    } finally { setRunning(false); }
  }

  const currentDocuments = business?.documents.filter((document) => document.isCurrent !== false) ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Business Profile</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Submit your business claims and supporting evidence. Pramaan runs a deterministic internal cross-check; it does not query government or banking systems.
        </p>
      </div>

      {error && <div role="alert" className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"><AlertCircle className="h-4 w-4 shrink-0" />{error}</div>}

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        <SectionCard title="Business Information">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="legalName">Legal Business Name</Label>
              <Input id="legalName" {...register("legalName")} />
              {errors.legalName && <p className="text-xs text-destructive">{errors.legalName.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="gstin">GSTIN</Label>
              <Input id="gstin" className="font-mono uppercase" {...register("gstin")} />
              {errors.gstin && <p className="text-xs text-destructive">{errors.gstin.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="udyamNumber">Udyam Number</Label>
              <Input id="udyamNumber" className="font-mono uppercase" {...register("udyamNumber")} />
              {errors.udyamNumber && <p className="text-xs text-destructive">{errors.udyamNumber.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pan">PAN</Label>
              <Input id="pan" className="font-mono uppercase" {...register("pan")} />
              {errors.pan && <p className="text-xs text-destructive">{errors.pan.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="turnoverBand">Turnover Band</Label>
              <Controller
                control={control}
                name="turnoverBand"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="turnoverBand">
                      <SelectValue placeholder="Select turnover band" />
                    </SelectTrigger>
                    <SelectContent>
                      {turnoverOptions.map((band) => (
                        <SelectItem key={band} value={band}>
                          {band}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              {errors.turnoverBand && <p className="text-xs text-destructive">{errors.turnoverBand.message}</p>}
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="address">Registered Address</Label>
              <Input id="address" {...register("address")} />
              {errors.address && <p className="text-xs text-destructive">{errors.address.message}</p>}
            </div>
          </div>
        </SectionCard>

        <SectionCard title="Supporting documents" description="PDF, PNG, or JPEG files up to 5 MB. Contents are stored but not parsed. Choosing a file replaces the current version.">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {DOC_TILES.map((tile) => {
              const selectedFile = files[tile.type];
              const existing = currentDocuments.find((document) => document.type === tile.type);
              return (
                <label
                  key={tile.type}
                  className={cn(
                    "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-surface px-4 py-6 text-center transition-colors focus-within:ring-2 focus-within:ring-primary-300 hover:border-primary-300 hover:bg-primary-50/40",
                    selectedFile && "border-solid border-primary-300 bg-primary-50/40"
                  )}
                >
                  {selectedFile ? <CheckCircle2 className="h-6 w-6 text-primary-700" aria-hidden /> : <UploadCloud className="h-6 w-6 text-muted-foreground" aria-hidden />}
                  <span className="text-sm font-medium text-slate-700">{tile.label}</span>
                  <span className="text-xs text-muted-foreground">
                    {selectedFile ? `Selected: ${selectedFile.name}` : existing?.fileName ? `Current: ${existing.fileName}` : "Choose a PDF, PNG, or JPEG"}
                  </span>
                  {!selectedFile && <EvidenceStatusBadge status={existing?.evidenceStatus} />}
                  <input className="sr-only" type="file" accept="application/pdf,image/png,image/jpeg,.pdf,.png,.jpg,.jpeg" onChange={(event) => selectFile(tile.type, event.target.files?.[0])} />
                </label>
              );
            })}
          </div>
        </SectionCard>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Button type="submit" size="lg" disabled={running}>
            {running ? "Cross-checking…" : "Save and run internal cross-check"}
          </Button>
          {business?.lastCrossCheckedAt && (
            <Button type="button" variant="outline" onClick={() => navigate("/msme/trust-profile")}>
              Continue to Trust Profile <ArrowRight className="h-4 w-4" />
            </Button>
          )}
        </div>
      </form>

      {crossCheckResult ? (
        <CrossCheckResults result={crossCheckResult} />
      ) : business && (
        <SectionCard
          title="Latest cross-check"
          description={business.lastCrossCheckedAt ? `Last run ${formatDateTime(business.lastCrossCheckedAt)}. Run a cross-check to see field-level results.` : "No cross-check has been run yet."}
        >
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="font-medium text-slate-800">Business status:</span>
            <EvidenceStatusBadge status={business.trustStatus} />
          </div>
          {currentDocuments.length > 0 && (
            <ul className="mt-3 grid gap-2 sm:grid-cols-3">
              {currentDocuments.map((document) => (
                <li key={document.id} className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm">
                  <span className="text-slate-700">{documentTypeLabel(document.type)}</span>
                  <EvidenceStatusBadge status={document.evidenceStatus} />
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      )}
    </div>
  );
}
