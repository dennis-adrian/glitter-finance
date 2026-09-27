"use client";

import { useEffect, type RefObject } from "react";

function isEditable(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.tagName === "SELECT")
  );
}

/** Keyboard users: "/" focuses the screen's search field (Escape leaves it). */
export function useSearchShortcut(
  inputRef: RefObject<HTMLInputElement | null>
) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (
        event.key !== "/" ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        isEditable(event.target) ||
        document.querySelector("[role=dialog],[role=alertdialog]")
      ) {
        return;
      }
      event.preventDefault();
      inputRef.current?.focus();
      inputRef.current?.select();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [inputRef]);
}
