import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ToastMessage } from "@/lib/types";

type ToastProps = {
  toast: ToastMessage;
};

export function Toast({ toast }: ToastProps) {
  return (
    <div
      className={cn(
        "absolute right-4 bottom-[82px] left-4 z-[5] flex min-h-[46px] items-center justify-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-medium text-white shadow-lg [animation:toast-in_180ms_ease-out]",
        toast.tone === "danger"
          ? "bg-destructive"
          : toast.tone === "info"
            ? "bg-[#31234c]"
            : "bg-[#17151d]"
      )}
    >
      <Check className="size-[18px]" />
      {toast.text}
    </div>
  );
}
