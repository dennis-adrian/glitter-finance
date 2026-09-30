/** Anything shorter is a browser toolbar changing size, not a keyboard. */
export const KEYBOARD_MIN_HEIGHT = 120;

const NON_TEXT_INPUT_TYPES = new Set([
  "button",
  "checkbox",
  "color",
  "date",
  "datetime-local",
  "file",
  "hidden",
  "image",
  "month",
  "radio",
  "range",
  "reset",
  "submit",
  "time",
  "week",
]);

/** Fields that open the on-screen keyboard when focused. */
export function isTextField(element: unknown): element is HTMLElement {
  if (typeof HTMLElement === "undefined" || !(element instanceof HTMLElement)) {
    return false;
  }
  if (element.isContentEditable || element.tagName === "TEXTAREA") return true;
  if (element.tagName !== "INPUT") return false;
  const input = element as HTMLInputElement;
  return !input.readOnly && !NON_TEXT_INPUT_TYPES.has(input.type);
}

export type KeyboardMeasurement = {
  /** Window height while no field is focused (keyboard closed). */
  baselineHeight: number;
  /** Current window.innerHeight (layout viewport). */
  layoutHeight: number;
  visualHeight: number;
  visualOffsetTop: number;
  scale: number;
  textFieldFocused: boolean;
};

export type KeyboardState = {
  open: boolean;
  /** Visible height to size the app shell to. */
  visibleHeight: number;
  /**
   * How much of the layout viewport the keyboard covers, for bottom-anchored
   * fixed UI. iOS overlays the keyboard (inset = keyboard height); Android
   * with `interactive-widget=resizes-content` shrinks the layout instead
   * (inset ≈ 0).
   */
  inset: number;
};

export function measureKeyboard(input: KeyboardMeasurement): KeyboardState {
  const closed = { open: false, visibleHeight: input.layoutHeight, inset: 0 };
  // Pinch-zoom also shrinks the visual viewport; don't mistake it for a
  // keyboard.
  if (!input.textFieldFocused || input.scale > 1.01) return closed;
  if (input.baselineHeight - input.visualHeight < KEYBOARD_MIN_HEIGHT) {
    return closed;
  }
  return {
    open: true,
    visibleHeight: Math.round(input.visualHeight),
    inset: Math.max(
      0,
      Math.round(
        input.layoutHeight - input.visualHeight - input.visualOffsetTop
      )
    ),
  };
}
