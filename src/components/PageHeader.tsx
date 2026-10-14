export function PageHeader({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <header className="page-header">
      <p className="eyebrow">مساحتك الأكاديمية</p>
      <h1>{title}</h1>
      <p>{description}</p>
    </header>
  );
}
