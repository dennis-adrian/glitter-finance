import { SearchX } from "lucide-react";
import { EmptyState } from "@/components/molecules/empty-state";
import { ScreenHeader } from "@/components/molecules/screen-header";
import { Screen } from "@/components/templates/screen";

type MissingRecordScreenProps = {
  /** The header's title. */
  heading?: string;
  title: string;
  body: string;
  back: () => void;
};

/**
 * Shown when a deep link points at a sale, product or seller this device
 * lacks.
 */
export function MissingRecordScreen({
  heading = "Detalle",
  title,
  body,
  back,
}: MissingRecordScreenProps) {
  return (
    <Screen
      width="narrow"
      header={<ScreenHeader title={heading} onBack={back} />}
    >
      <EmptyState icon={<SearchX size={46} />} title={title} body={body} />
    </Screen>
  );
}
