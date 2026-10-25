import { useEffect, useState } from "react";
import { createAcademicStore } from "../data";
import { fileProblem, mediaPreview } from "../features/lectures/files";
import { lectureText as t } from "../i18n/lectures";

/** Opt-in, local media only. Documents always use the binary download path. */
export function LectureMedia({ id, lectureId, store, disabled }: {
  id: string; lectureId: string; store: ReturnType<typeof createAcademicStore>; disabled: boolean;
}) {
  const [opened, setOpened] = useState(false);
  const [media, setMedia] = useState<{ url: string; kind: "image" | "audio" | "video"; name: string }>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!opened) return;
    let active = true;
    let url: string | undefined;
    void store.lectureFiles.get(id).then(file => {
      const format = file && mediaPreview(file.fileName, file.mimeType);
      if (!active) return;
      if (!file || file.lectureId !== lectureId || fileProblem(file.fileName, file.blob) || !format) {
        setFailed(true);
        return;
      }
      url = URL.createObjectURL(new Blob([file.blob], { type: format.mime }));
      setMedia({ url, kind: format.kind, name: file.fileName });
    }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; if (url) URL.revokeObjectURL(url); };
  }, [opened, id, lectureId, store]);
  return <div className="lecture-media">
    <button disabled={disabled} onClick={() => { setOpened(!opened); setMedia(undefined); setFailed(false); }}>{opened ? t.closePreview : t.preview}</button>
    {opened && !failed && !media && <p role="status">{t.loading}</p>}
    {opened && failed && <p role="alert">{t.previewError}</p>}
    {opened && !failed && media && (media.kind === "image"
      ? <img src={media.url} alt={media.name} onError={() => setFailed(true)} />
      : media.kind === "audio"
        ? <audio controls preload="metadata" src={media.url} aria-label={media.name} onError={() => setFailed(true)} />
        : <video controls preload="metadata" src={media.url} aria-label={media.name} onError={() => setFailed(true)} />)}
  </div>;
}
