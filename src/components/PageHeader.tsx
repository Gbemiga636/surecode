export function PageHeader({
  kicker,
  title,
  subtitle,
}: {
  kicker?: string;
  title: string;
  subtitle?: string;
}) {
  return (
    <header className="sc-rise mb-6">
      {kicker && <p className="sc-page-kicker">{kicker}</p>}
      <h2 className="mt-2 font-display text-2xl font-extrabold tracking-tight text-[var(--ink)] sm:text-3xl">
        {title}
      </h2>
      {subtitle && (
        <p className="mt-2 max-w-xl text-[0.95rem] leading-relaxed text-[var(--muted)]">
          {subtitle}
        </p>
      )}
    </header>
  );
}
