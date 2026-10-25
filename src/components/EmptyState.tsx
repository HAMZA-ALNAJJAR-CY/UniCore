import { tr } from "../i18n/locale";
import type { LucideIcon } from "lucide-react";

export function EmptyState({
  icon: Icon,
  title,
  description,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
}) {
  return (
    <section className="empty-state">
      <span className="icon-tile">
        <Icon size={28} aria-hidden="true" />
      </span>
      <span className="badge">{tr("text_17")}</span>
      <h2>{title}</h2>
      <p>{description}</p>
      <p className="empty-note">{tr("text_18")}</p>
    </section>
  );
}
