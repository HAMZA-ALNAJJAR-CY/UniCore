import { tr } from "../i18n/locale";
export function PageHeader({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <header className="page-header">
      <p className="eyebrow">{tr("text_16")}</p>
      <h1>{title}</h1>
      <p>{description}</p>
    </header>
  );
}
