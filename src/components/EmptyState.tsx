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
      <span className="badge">مخطط</span>
      <h2>{title}</h2>
      <p>{description}</p>
      <p className="empty-note">هذه المساحة مخططة لمرحلة لاحقة.</p>
    </section>
  );
}
