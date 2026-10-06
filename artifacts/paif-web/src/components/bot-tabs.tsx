import { Link, useLocation } from "wouter";
import { Zap, Bot } from "lucide-react";

const tabs = [
  { label: "Autonomous DCA Bot", href: "/vaults", icon: Bot },
];

export function BotTabs() {
  const [location] = useLocation();
  const rawPath = location.split("?")[0].split("#")[0];
  const path = rawPath.length > 1 ? rawPath.replace(/\/+$/, "") : rawPath;
  return (
    <div className="mb-6" data-testid="tabs-bots">
      <div className="inline-flex rounded-xl border border-border bg-muted/30 p-1 gap-1">
        {tabs.map((t) => {
          const active = path === t.href || path.startsWith(t.href + "/");
          const Icon = t.icon;
          return (
            <Link
              key={t.href}
              href={t.href}
              data-testid={`tab-${t.label.toLowerCase()}`}
              aria-current={active ? "page" : undefined}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
                active
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="w-4 h-4" />
              {t.label}
            </Link>
          );
        })}
      </div>
      <p className="text-[11px] text-muted-foreground mt-1.5">
        Runs on our servers 24/7 — set it, close your browser, walk away.
      </p>
    </div>
  );
}
