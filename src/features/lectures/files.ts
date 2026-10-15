export const MAX_FILE_BYTES = 100 * 1024 * 1024;
const formats: Record<string, readonly string[]> = {
  mp3: ["audio/mpeg", "audio/mp3"],
  wav: ["audio/wav", "audio/x-wav", "audio/wave"],
  m4a: ["audio/mp4", "audio/x-m4a"],
  aac: ["audio/aac", "audio/aacp"],
  ogg: ["audio/ogg", "application/ogg"],
  flac: ["audio/flac", "audio/x-flac"],
  opus: ["audio/opus", "audio/ogg"],
  mp4: ["video/mp4"],
  webm: ["video/webm", "audio/webm"],
  mov: ["video/quicktime"],
  jpg: ["image/jpeg"],
  jpeg: ["image/jpeg"],
  png: ["image/png"],
  webp: ["image/webp"],
  pdf: ["application/pdf"],
  doc: ["application/msword"],
  docx: [
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ],
  ppt: ["application/vnd.ms-powerpoint"],
  pptx: [
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ],
  xls: ["application/vnd.ms-excel"],
  xlsx: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  txt: ["text/plain"],
  csv: ["text/csv", "text/plain"],
  odt: ["application/vnd.oasis.opendocument.text"],
  odp: ["application/vnd.oasis.opendocument.presentation"],
  ods: ["application/vnd.oasis.opendocument.spreadsheet"],
};
export const FILE_ACCEPT = Object.keys(formats)
  .map((extension) => "." + extension)
  .join(",");
export type FileProblem = "unsupported" | "mime" | "size" | "empty";
/** Conservative extension/MIME checks, not a malware scanner or content-authenticity guarantee. */
export function fileProblem(name: string, blob: Blob): FileProblem | undefined {
  const extension = name.toLowerCase().split(".").pop() ?? "";
  if (
    !formats[extension] ||
    !name.includes(".") ||
    (Array.from(name).some(character=>character.charCodeAt(0)<32) || /[/\\]/.test(name))
  )
    return "unsupported";
  if (!blob.size) return "empty";
  if (blob.size > MAX_FILE_BYTES) return "size";
  const mime = blob.type.toLowerCase().split(";")[0].trim();
  if (
    mime &&
    mime !== "application/octet-stream" &&
    !formats[extension].includes(mime)
  )
    return "mime";
}
