export function PageState({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="page-container py-[var(--section-space)]">
      <p className="eyebrow text-brand">Katha · Real World Assets</p>
      <h1 className="mt-8 text-section">{title}</h1>
      <div className="mt-6 max-w-[42ch] text-muted">{children}</div>
    </section>
  );
}
