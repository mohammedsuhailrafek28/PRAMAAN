import { AlertCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export function LoadingState({ label = "Loading" }: { label?: string }) {
  return <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />{label}...</div>;
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return <div role="alert" className="flex flex-col items-center justify-center gap-3 rounded-lg border border-destructive/25 bg-destructive/5 px-6 py-12 text-center"><AlertCircle className="h-5 w-5 text-destructive" /><p className="max-w-md text-sm text-destructive">{message}</p>{onRetry && <Button variant="outline" onClick={onRetry}>Try again</Button>}</div>;
}
