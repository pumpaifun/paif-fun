import { useState, useEffect } from "react";
import { ChevronUp, ChevronDown } from "lucide-react";

const SECTION_IDS = [
  "strategy-vaults",
  "sniper-bot",
  "bump-bot-promo",
];

export function SectionNav() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    function onScroll() {
      setVisible(window.scrollY > 200);
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  function getCurrentSectionIndex(): number {
    const headerHeight = 70;
    let closest = -1;
    let closestDist = Infinity;

    for (let i = 0; i < SECTION_IDS.length; i++) {
      const el = document.getElementById(SECTION_IDS[i]);
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      const dist = Math.abs(rect.top - headerHeight);
      if (dist < closestDist) {
        closestDist = dist;
        closest = i;
      }
    }
    return closest;
  }

  function scrollToSection(index: number) {
    if (index < 0) index = 0;
    if (index >= SECTION_IDS.length) index = SECTION_IDS.length - 1;
    const el = document.getElementById(SECTION_IDS[index]);
    if (!el) return;
    const headerHeight = 64;
    const y = el.getBoundingClientRect().top + window.scrollY - headerHeight - 8;
    window.scrollTo({ top: y, behavior: "smooth" });
  }

  function goUp() {
    const current = getCurrentSectionIndex();
    scrollToSection(current - 1);
  }

  function goDown() {
    const current = getCurrentSectionIndex();
    scrollToSection(current + 1);
  }

  if (!visible) return null;

  return (
    <div className="fixed bottom-4 right-3 z-[9997] flex flex-col gap-1.5" data-testid="section-nav">
      <button
        onClick={goUp}
        className="w-10 h-10 rounded-full bg-card border border-border shadow-lg flex items-center justify-center hover:bg-muted transition-colors"
        aria-label="Previous section"
        data-testid="button-section-up"
      >
        <ChevronUp className="w-5 h-5 text-foreground" />
      </button>
      <button
        onClick={goDown}
        className="w-10 h-10 rounded-full bg-card border border-border shadow-lg flex items-center justify-center hover:bg-muted transition-colors"
        aria-label="Next section"
        data-testid="button-section-down"
      >
        <ChevronDown className="w-5 h-5 text-foreground" />
      </button>
    </div>
  );
}
