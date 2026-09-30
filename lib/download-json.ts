/**
 * Saves JSON text as a file through a temporary link: the diagnostic, and the
 * copy of unsynced work kept before discarding it.
 */
export function downloadJsonFile(json: string, filename: string) {
  const url = URL.createObjectURL(
    new Blob([json], { type: "application/json" })
  );
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
