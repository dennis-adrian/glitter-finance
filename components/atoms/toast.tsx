import { Check } from "lucide-react";
import clsx from "clsx";
import type { ToastMessage } from "@/lib/types";

type ToastProps = {
  toast: ToastMessage;
};

export function Toast({ toast }: ToastProps) {
  return (
    <div className={clsx("toast", toast.tone)}>
      <Check size={18} />
      {toast.text}
    </div>
  );
}
