import { SiX, SiTelegram } from "react-icons/si";
import { Circle, Globe } from "lucide-react";
import { Link } from "wouter";

const socialLinks = [
  { href: "https://x.com/PAIFaiFUN", icon: <SiX className="w-3.5 h-3.5" />, label: "Follow", testId: "link-social-x" },
  { href: "https://t.me/paifaifun", icon: <SiTelegram className="w-3.5 h-3.5" />, label: "Telegram", testId: "link-social-telegram" },
  { href: "https://pump.fun/coin/HngT3GgmdyEZPmJAu4H84SeoexDb9kccQcZGQxvDpump", icon: <Circle className="w-3 h-3 fill-emerald-500 text-emerald-500" />, label: "Pump.fun", testId: "link-social-pumpfun" },
  { href: "https://paif.fun/", icon: <Globe className="w-3.5 h-3.5" />, label: "PAIF.fun", testId: "link-social-website" },
];

export function Footer() {
  return (
    <footer className="max-w-6xl mx-auto px-4 sm:px-6 pb-8 mt-12">
      <div className="border-t border-gray-300 pt-6 flex flex-col items-center gap-3">
        <div className="flex items-center gap-2 flex-wrap justify-center">
          {socialLinks.map((link) => (
            <a
              key={link.testId}
              href={link.href}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-1.5 w-[100px] py-1.5 rounded-full border border-border text-xs font-semibold text-muted-foreground hover:bg-foreground hover:text-background hover:border-foreground transition-all cursor-pointer"
              data-testid={link.testId}
            >
              {link.icon} {link.label}
            </a>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground">PAIF.fun — Pump AI Fun</p>
        <div className="flex items-center gap-3 text-[11px] text-muted-foreground/70">
          <Link href="/about" className="hover:text-foreground transition-colors underline underline-offset-2" data-testid="link-footer-about">
            About
          </Link>
          <span>·</span>
          <Link href="/whitepaper" className="hover:text-foreground transition-colors underline underline-offset-2" data-testid="link-footer-whitepaper">
            Whitepaper
          </Link>
          <span>·</span>
          <Link href="/privacy" className="hover:text-foreground transition-colors underline underline-offset-2" data-testid="link-footer-privacy">
            Privacy Policy
          </Link>
          <span>·</span>
          <Link href="/privacy" className="hover:text-foreground transition-colors underline underline-offset-2" data-testid="link-footer-terms">
            Terms of Service
          </Link>
        </div>
      </div>
    </footer>
  );
}
