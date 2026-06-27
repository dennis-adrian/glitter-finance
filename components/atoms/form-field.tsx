import {
  cloneElement,
  isValidElement,
  useId,
  type ReactElement,
  type ReactNode,
} from "react";
import { Label } from "@/components/ui/label";

type FormFieldProps = {
  label: string;
  hint?: string;
  /** Matches the control id; generated automatically when omitted. */
  id?: string;
  children: ReactNode;
};

export function FormField({ label, hint, id: idProp, children }: FormFieldProps) {
  const generatedId = useId();
  const id = idProp ?? generatedId;

  return (
    <div className="mt-3.5 grid gap-1.5">
      <Label
        htmlFor={id}
        className="flex items-center justify-between text-sm font-medium"
      >
        {label}
        {hint ? (
          <span className="font-normal text-muted-foreground">{hint}</span>
        ) : null}
      </Label>
      {isValidElement(children)
        ? cloneElement(children as ReactElement<{ id?: string }>, {
            id: (children.props as { id?: string }).id ?? id,
          })
        : children}
    </div>
  );
}
