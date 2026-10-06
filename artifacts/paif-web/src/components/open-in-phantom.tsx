import { ExternalLink } from "lucide-react";
import { usePhantomBrowser, getPhantomDeepLink } from "@/lib/use-phantom-browser";

interface OpenInPhantomProps {
  className?: string;
  compact?: boolean;
}

export function OpenInPhantomBanner({ className = "", compact = false }: OpenInPhantomProps) {
  const { showOpenInPhantom, inPhantomBrowser } = usePhantomBrowser();

  if (!showOpenInPhantom || inPhantomBrowser) return null;

  const deepLink = getPhantomDeepLink();

  if (compact) {
    return (
      <a
        href={deepLink}
        className={`inline-flex items-center gap-1.5 text-xs font-semibold text-purple-600 dark:text-purple-400 hover:underline underline-offset-2 ${className}`}
        data-testid="link-open-in-phantom"
      >
        <span className="w-4 h-4 rounded bg-purple-600 flex items-center justify-center flex-shrink-0">
          <span className="text-white font-black" style={{ fontSize: "9px" }}>P</span>
        </span>
        Open in Phantom
        <ExternalLink className="w-3 h-3" />
      </a>
    );
  }

  return (
    <a
      href={deepLink}
      className={`flex items-center gap-3 rounded-xl border border-purple-500/30 bg-purple-500/8 px-4 py-3 hover:bg-purple-500/12 transition-colors ${className}`}
      data-testid="banner-open-in-phantom"
    >
      <div className="w-9 h-9 rounded-xl bg-purple-600 flex items-center justify-center flex-shrink-0 shadow-sm">
        <span className="text-white font-black text-base">P</span>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-foreground">Open in Phantom</p>
        <p className="text-xs text-muted-foreground leading-snug">For the best trading experience on mobile</p>
      </div>
      <ExternalLink className="w-4 h-4 text-muted-foreground flex-shrink-0" />
    </a>
  );
}
