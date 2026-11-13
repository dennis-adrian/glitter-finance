/**
 * Saves a file through a temporary link. On iOS Safari this opens the
 * download prompt; in a PWA installed on an iOS home screen it does not
 * work, which is what saveFile (lib/save-file.ts) shares instead.
 */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
  } finally {
    // Some browsers read the blob after click() returns.
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }
}

/**
 * Saves JSON text as a file: the diagnostic, and the copy of unsynced work
 * kept before discarding it.
 */
export function downloadJsonFile(json: string, filename: string) {
  downloadBlob(new Blob([json], { type: "application/json" }), filename);
}
