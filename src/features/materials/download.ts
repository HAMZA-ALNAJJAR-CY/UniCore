/** Download only, never navigate to or embed an untrusted document. Caller disposes on unmount. */
export function downloadMaterial(file: { blob: Blob; fileName: string }, urls: Map<string, ReturnType<typeof setTimeout>>) {
  const url = URL.createObjectURL(new Blob([file.blob], { type: "application/octet-stream" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = Array.from(file.fileName).map(character => character.charCodeAt(0) < 32 ? "_" : character).join("").replace(/[\u007f/\\<>:"|?*\u202a-\u202e\u2066-\u2069]/g, "_").replace(/^[. ]+|[. ]+$/g, "") || "attachment";
  try {
    document.body.append(anchor);
    anchor.click();
    urls.set(url, setTimeout(() => { URL.revokeObjectURL(url); urls.delete(url); }, 60000));
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  } finally { anchor.remove(); }
}

export function disposeDownloads(urls: Map<string, ReturnType<typeof setTimeout>>) {
  for (const [url, timer] of urls) { clearTimeout(timer); URL.revokeObjectURL(url); }
  urls.clear();
}
