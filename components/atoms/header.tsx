import type { ReactNode } from "react";

type HeaderProps = {
  title: string;
  left?: ReactNode;
  right?: ReactNode;
};

export function Header({ title, left, right }: HeaderProps) {
  return (
    <header className="mb-3.5 grid h-11 grid-cols-[44px_1fr_44px] items-center">
      <div className="flex items-center">{left}</div>
      <h1 className="text-center font-heading text-xl font-extrabold text-primary">
        {title}
      </h1>
      <div className="flex items-center justify-end">{right}</div>
    </header>
  );
}
