import type { ReactNode } from "react";

type EmptyStateProps = {
  icon: ReactNode;
  title: string;
  body: string;
  action?: ReactNode;
};

export function EmptyState({ icon, title, body, action }: EmptyStateProps) {
  return (
    <div className="grid min-h-[360px] place-content-center justify-items-center px-6 text-center">
      <span className="text-muted-foreground">{icon}</span>
      <h2 className="mt-4 mb-2 text-2xl font-semibold text-foreground">
        {title}
      </h2>
      <p className="mb-5 leading-snug text-muted-foreground">{body}</p>
      {action}
    </div>
  );
}
