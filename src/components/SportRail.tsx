import { Icon, type IconName } from "@/components/Icons";

const SPORTS: { key: string; label: string; icon: IconName }[] = [
  { key: "football", label: "Football", icon: "football" },
  { key: "basketball", label: "Basketball", icon: "basketball" },
  { key: "tennis", label: "Tennis", icon: "tennis" },
  { key: "hockey", label: "Ice hockey", icon: "hockey" },
  { key: "baseball", label: "Baseball", icon: "baseball" },
];

export function SportRail({
  counts,
  tone = "dark",
}: {
  counts?: Record<string, number>;
  tone?: "dark" | "light";
}) {
  return (
    <ul className={`sr sr-${tone}`} aria-label="Sports covered">
      {SPORTS.map((s, i) => (
        <li key={s.key} className="sr-item" style={{ animationDelay: `${i * 70}ms` }}>
          <span className="sr-ic">
            <Icon name={s.icon} size={22} className="sr-svg" />
          </span>
          <span className="sr-label">{s.label}</span>
          {counts && <span className="sr-count">{counts[s.key] ?? 0}</span>}
        </li>
      ))}
    </ul>
  );
}
