import { Icon, type IconName } from "@/components/Icons";

const KICKER_ICON: Record<string, IconName> = {
  "track record": "clock",
  rebuild: "link",
  "ai tips": "chart",
  library: "layers",
  "intelligence hub": "brain",
  custom: "layers",
  practice: "wallet",
  competition: "trophy",
  you: "bookmark",
};

export function PageHeader({
  kicker,
  title,
  subtitle,
  icon,
}: {
  kicker?: string;
  title: string;
  subtitle?: string;
  icon?: IconName;
}) {
  const ic = icon ?? KICKER_ICON[(kicker ?? "").toLowerCase()] ?? "spark";
  const words = title.trim().split(/\s+/);
  const last = words.length > 1 ? words.pop() : null;

  return (
    <header className="ph sc-rise">
      <span className="ph-watermark" aria-hidden>
        <Icon name={ic} size={180} />
      </span>
      <span className="ph-ic">
        <Icon name={ic} size={22} />
      </span>
      <div className="ph-copy">
        {kicker && <p className="ph-kicker">{kicker}</p>}
        <h2 className="ph-title">
          {words.join(" ")} {last && <span className="ph-title-grad">{last}</span>}
        </h2>
        {subtitle && <p className="ph-sub">{subtitle}</p>}
      </div>
    </header>
  );
}
