import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { FileText, Landmark, Receipt, UploadCloud, CheckCircle2, ArrowRight, AlertCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SectionCard } from "@/components/shared/SectionCard";
import { VerificationBadge } from "@/components/shared/VerificationBadge";
import { useAppStore } from "@/store/appStore";
import type { DocumentType, TurnoverBand } from "@/types";
import { cn } from "@/lib/utils";
import { getApiError } from "@/services/api";
import { useToast } from "@/components/ui/use-toast";

const TURNOVER_BANDS: TurnoverBand[] = [
  "Under ₹40 Lakh",
  "₹40 Lakh – ₹1.5 Cr",
  "₹1.5 Cr – ₹5 Cr",
  "₹5 Cr – ₹25 Cr",
  "Above ₹25 Cr",
];

const schema = z.object({
  legalName: z.string().min(2, "Enter the legal business name"),
  gstin: z.string().regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/, "GSTIN must be a valid 15-character GSTIN"),
  udyamNumber: z.string().regex(/^UDYAM-[A-Z]{2}-\d{2}-\d{7}$/, "Format: UDYAM-XX-00-0000000"),
  pan: z.string().regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/, "PAN must be 10 characters, e.g. ABCDE1234F"),
  address: z.string().min(5, "Enter the registered address"),
  turnoverBand: z.enum(TURNOVER_BANDS as [TurnoverBand, ...TurnoverBand[]]),
});
type FormValues = z.infer<typeof schema>;

const DOC_TILES: { type: DocumentType; label: string; icon: typeof FileText }[] = [
  { type: "gst_certificate", label: "GST Certificate", icon: Receipt },
  { type: "udyam_certificate", label: "Udyam Certificate", icon: FileText },
  { type: "bank_statement", label: "Bank Statement (sample)", icon: Landmark },
];

export function BusinessVerificationPage() {
  const navigate = useNavigate();
  const { business, loadBusiness, saveBusinessProfile, uploadBusinessDocument, crossCheckBusiness, error } = useAppStore();
  const { toast } = useToast();
  const [files, setFiles] = useState<Partial<Record<DocumentType, File>>>({});
  const [running, setRunning] = useState(false);
  const [ranOnce, setRanOnce] = useState(false);

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
      await crossCheckBusiness();
      setRanOnce(true);
      toast({ title: "Internal cross-check complete", description: "Your submitted claims and evidence metadata were assessed." });
    } catch (error) {
      toast({ title: "Verification could not be completed", description: getApiError(error), variant: "destructive" });
    } finally { setRunning(false); }
  }

  const isCrossChecked = business?.trustStatus === "CROSS_CHECKED";

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-slate-900">Business Verification</h2>
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
              <Label>Turnover Band</Label>
              <Controller
                control={control}
                name="turnoverBand"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select turnover band" />
                    </SelectTrigger>
                    <SelectContent>
                      {TURNOVER_BANDS.map((band) => (
                        <SelectItem key={band} value={band}>
                          {band}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="address">Registered Address</Label>
              <Input id="address" {...register("address")} />
              {errors.address && <p className="text-xs text-destructive">{errors.address.message}</p>}
            </div>
          </div>
        </SectionCard>

        <SectionCard title="Supporting documents" description="PDF, PNG, or JPEG files up to 5 MB. Contents are stored but not parsed.">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {DOC_TILES.map((tile) => {
              const selectedFile = files[tile.type];
              const existing = business?.documents.find((document) => document.type === tile.type);
              return (
                <label
                  key={tile.type}
                  className={cn(
                    "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-surface px-4 py-6 text-center transition-colors hover:border-primary-300 hover:bg-primary-50/40",
                    (selectedFile || existing) && "border-solid border-verified-border bg-verified-bg"
                  )}
                >
                  {selectedFile || existing ? (
                    <CheckCircle2 className="h-6 w-6 text-verified-foreground" />
                  ) : (
                    <UploadCloud className="h-6 w-6 text-muted-foreground" />
                  )}
                  <span className="text-sm font-medium text-slate-700">{tile.label}</span>
                  <span className="text-xs text-muted-foreground">
                    {selectedFile?.name || existing?.fileName || "Choose a PDF, PNG, or JPEG"}
                  </span>
                  <input className="sr-only" type="file" accept="application/pdf,image/png,image/jpeg,.pdf,.png,.jpg,.jpeg" onChange={(event) => selectFile(tile.type, event.target.files?.[0])} />
                </label>
              );
            })}
          </div>
        </SectionCard>

        <div className="flex items-center justify-between">
          <Button type="submit" size="lg" disabled={running}>
            {running ? "Cross-checking…" : "Run internal cross-check"}
          </Button>
          {isCrossChecked && (
            <Button type="button" variant="outline" onClick={() => navigate("/msme/trust-profile")}>
              Continue to Verification Profile <ArrowRight className="h-4 w-4" />
            </Button>
          )}
        </div>
      </form>

      {ranOnce && business && (
        <SectionCard title="Verification Results">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <VerificationBadge label="GSTIN" state={business.fieldVerification.gstin ? "cross_checked" : "unverified"} />
            <VerificationBadge label="Udyam" state={business.fieldVerification.udyamNumber ? "cross_checked" : "unverified"} />
            <VerificationBadge label="PAN" state={business.fieldVerification.pan ? "cross_checked" : "unverified"} />
            <VerificationBadge
              label="Bank Statement"
              state={business.documents.find((d) => d.type === "bank_statement")?.verified ? "cross_checked" : "unverified"}
            />
          </div>
          <div className="mt-4 rounded-md border border-border p-3 text-sm">
            Business Status:{" "}
            <span className={cn("font-semibold", isCrossChecked ? "text-verified-foreground" : "text-warning-foreground")}>
              {isCrossChecked ? "Internally cross-checked" : "Needs review — check the fields above and re-submit"}
            </span>
          </div>
        </SectionCard>
      )}
    </div>
  );
}
