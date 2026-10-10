"use client";

import { useEffect } from "react";
import { isTextField, measureKeyboard } from "@/lib/virtual-keyboard";

/**
 * Keeps the focused field visible above the on-screen keyboard.
 *
 * The app shell is a fixed-height layout with inner scroll regions, so the
 * browser's own "scroll the input into view" can't do its job: Android lays
 * the keyboard over the bottom of the shell (covering footers like
 * "Registrar venta"), and iOS pans the whole page, hiding the header.
 *
 * While the keyboard is open this sets, on <html>:
 * - `data-keyboard="open"` (hides the bottom nav),
 * - `--app-height`: the visible height; the shell sizes itself to it,
 * - `--keyboard-inset`: how far bottom-anchored overlays must lift,
 * and scrolls the focused field to the middle of its scroll region.
 */
export function useVirtualKeyboard() {
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const visual = viewport;
    const root = document.documentElement;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let baselineHeight = window.innerHeight;
    let wasOpen = false;
    let frame = 0;
    let revealTimer = 0;

    function reveal(element: Element | null) {
      window.clearTimeout(revealTimer);
      // Wait a frame for the shell to take its new height first.
      revealTimer = window.setTimeout(() => {
        if (!isTextField(element) || document.activeElement !== element) {
          return;
        }
        element.scrollIntoView({
          block: "center",
          behavior: reducedMotion.matches ? "auto" : "smooth",
        });
      }, 50);
    }

    function apply() {
      frame = 0;
      const focused = document.activeElement;
      const textFieldFocused = isTextField(focused);
      // Track the full height only while nothing is being typed into, so
      // orientation changes and browser toolbars update the baseline.
      if (!textFieldFocused) {
        baselineHeight = Math.max(window.innerHeight, visual.height);
      }

      const state = measureKeyboard({
        baselineHeight,
        layoutHeight: window.innerHeight,
        visualHeight: visual.height,
        visualOffsetTop: visual.offsetTop,
        scale: visual.scale,
        textFieldFocused,
      });

      if (state.open) {
        root.dataset.keyboard = "open";
        root.style.setProperty("--app-height", `${state.visibleHeight}px`);
        root.style.setProperty("--keyboard-inset", `${state.inset}px`);
        // iOS pans the page to reveal the field; undo it, since the shell
        // now fits the visible area and scrolls the field itself.
        if (window.scrollY !== 0) window.scrollTo(0, 0);
        if (!wasOpen) reveal(focused);
      } else if (wasOpen) {
        delete root.dataset.keyboard;
        root.style.removeProperty("--app-height");
        root.style.removeProperty("--keyboard-inset");
      }
      wasOpen = state.open;
    }

    function schedule() {
      if (!frame) frame = window.requestAnimationFrame(apply);
    }

    function handleFocusIn(event: FocusEvent) {
      schedule();
      // Moving between fields with the keyboard already open.
      if (wasOpen) reveal(event.target as Element);
    }

    visual.addEventListener("resize", schedule);
    visual.addEventListener("scroll", schedule);
    window.addEventListener("resize", schedule);
    document.addEventListener("focusin", handleFocusIn);
    document.addEventListener("focusout", schedule);

    return () => {
      visual.removeEventListener("resize", schedule);
      visual.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      document.removeEventListener("focusin", handleFocusIn);
      document.removeEventListener("focusout", schedule);
      window.cancelAnimationFrame(frame);
      window.clearTimeout(revealTimer);
      delete root.dataset.keyboard;
      root.style.removeProperty("--app-height");
      root.style.removeProperty("--keyboard-inset");
    };
  }, []);
}
