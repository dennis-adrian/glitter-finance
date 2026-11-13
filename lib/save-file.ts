import { downloadBlob } from "@/lib/download-json";

/** What the browser offers for saving a file. */
export type SaveFileSupport = {
  /** Running as a PWA added to an iOS home screen (navigator.standalone). */
  iosStandalone: boolean;
  /** navigator.share accepts this file (navigator.canShare({ files })). */
  canShareFile: boolean;
};

/**
 * How to hand a file to the user. A link download works in browsers and in
 * installed PWAs on Android and desktop, but not in a PWA on an iOS home
 * screen, where nothing happens or the file opens with no way back to the
 * app; there the share sheet saves it (to Files, or sends it by WhatsApp or
 * mail) instead.
 */
export function saveFileMethod(support: SaveFileSupport): "share" | "download" {
  return support.iosStandalone && support.canShareFile ? "share" : "download";
}

export type SaveFileOutcome =
  | "downloaded"
  | "shared"
  /** The user closed the share sheet. */
  | "cancelled"
  /**
   * The browser wants a fresh tap to share: building the file took longer
   * than the click's activation lasts. Call shareFile from a new click.
   */
  | "needs-tap";

function readSupport(file: File): SaveFileSupport {
  const nav = navigator as Navigator & { standalone?: boolean };
  let canShareFile = false;
  try {
    canShareFile =
      typeof nav.share === "function" &&
      typeof nav.canShare === "function" &&
      nav.canShare({ files: [file] });
  } catch {
    canShareFile = false;
  }
  return { iosStandalone: nav.standalone === true, canShareFile };
}

function errorName(error: unknown) {
  return error instanceof Error || error instanceof DOMException
    ? error.name
    : "";
}

/** Opens the share sheet with `file`. Throws when sharing fails. */
export async function shareFile(file: File): Promise<SaveFileOutcome> {
  try {
    await navigator.share({ files: [file], title: file.name });
    return "shared";
  } catch (error) {
    const name = errorName(error);
    if (name === "AbortError") return "cancelled";
    if (name === "NotAllowedError") return "needs-tap";
    throw error;
  }
}

/** Downloads `file`, or shares it where a download does not work. */
export async function saveFile(file: File): Promise<SaveFileOutcome> {
  if (saveFileMethod(readSupport(file)) === "share") {
    return shareFile(file);
  }
  downloadBlob(file, file.name);
  return "downloaded";
}
