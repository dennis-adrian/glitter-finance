import { SearchX } from "lucide-react";
import { EmptyState } from "@/components/molecules/empty-state";
import { ScreenHeader } from "@/components/molecules/screen-header";
import { Screen } from "@/components/templates/screen";

type MissingRecordScreenProps = {
  title: string;
  body: string;
  back: () => void;
};

/** Shown when a deep link points at a sale or product this device lacks. */
export function MissingRecordScreen({
  title,
  body,
  back,
}: MissingRecordScreenProps) {
  return (
    <Screen
      width="narrow"
      header={<ScreenHeader title="Detalle" onBack={back} />}
    >
      <EmptyState icon={<SearchX size={46} />} title={title} body={body} />
    </Screen>
  );
}
