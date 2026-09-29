"use client";

import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Reloading is how a device moves to the tenant that became active on
 * another device (the "tenant-changed" sync state), and an installed app has
 * no reload button of its own. The reload uploads pending work before it
 * clears the local data (PowerSyncProvider).
 */
export function ReloadAppButton({ className }: { className?: string }) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className={cn("w-fit", className)}
      onClick={() => window.location.reload()}
    >
      <RefreshCw className="size-4" />
      Recargar la app
    </Button>
  );
}
