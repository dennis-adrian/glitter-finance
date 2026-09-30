import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

/** The "Volver" button at the left of a screen's header. */
export function BackButton({ back }: { back: () => void }) {
  return (
    <Button variant="ghost" size="icon" onClick={back} aria-label="Volver">
      <ChevronLeft className="size-6" />
    </Button>
  );
}
