import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";

type FormFieldProps = {
  label: string;
  hint?: string;
  children: ReactNode;
};

export function FormField({ label, hint, children }: FormFieldProps) {
  return (
    <div className="mt-3.5 grid gap-1.5">
      <Label className="flex items-center justify-between text-sm font-medium">
        {label}
        {hint ? (
          <span className="font-normal text-muted-foreground">{hint}</span>
        ) : null}
      </Label>
      {children}
    </div>
  );
}
