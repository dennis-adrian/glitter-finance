import assert from "node:assert/strict";
import test from "node:test";
import { measureKeyboard } from "@/lib/virtual-keyboard";

const base = {
  baselineHeight: 800,
  layoutHeight: 800,
  visualHeight: 800,
  visualOffsetTop: 0,
  scale: 1,
  textFieldFocused: true,
};

test("iOS: keyboard overlays the layout, so fixed UI lifts by its height", () => {
  assert.deepEqual(measureKeyboard({ ...base, visualHeight: 460 }), {
    open: true,
    visibleHeight: 460,
    inset: 340,
  });
});

test("Android resizes-content: layout shrinks, nothing needs lifting", () => {
  assert.deepEqual(
    measureKeyboard({ ...base, layoutHeight: 470, visualHeight: 470 }),
    { open: true, visibleHeight: 470, inset: 0 }
  );
});

test("toolbars, pinch-zoom, and unfocused fields are not a keyboard", () => {
  assert.equal(measureKeyboard({ ...base, visualHeight: 740 }).open, false);
  assert.equal(
    measureKeyboard({ ...base, visualHeight: 400, scale: 2 }).open,
    false
  );
  assert.equal(
    measureKeyboard({ ...base, visualHeight: 460, textFieldFocused: false })
      .open,
    false
  );
});
