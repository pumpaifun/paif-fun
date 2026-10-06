import { Header } from "@/components/header";
import { Footer } from "@/components/footer";
import { Shield, Ban, DollarSign, Users, FileText, Mail } from "lucide-react";

const EFFECTIVE_DATE = "March 22, 2026";
const CONTACT_EMAIL = "paif@paif.fun";

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <section className="mb-10">
      <div className="flex items-center gap-2.5 mb-3">
        <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center text-emerald-500 shrink-0">
          {icon}
        </div>
        <h2 className="text-base font-bold text-foreground">{title}</h2>
      </div>
      <div className="text-sm text-muted-foreground leading-relaxed space-y-3 pl-10">
        {children}
      </div>
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-10">

        <div className="mb-10">
          <div className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-emerald-600 bg-emerald-500/10 px-2.5 py-1 rounded-full mb-3">
            <Shield className="w-3 h-3" /> Legal
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground mb-2">Privacy Policy & Terms of Use</h1>
          <p className="text-sm text-muted-foreground">Effective: {EFFECTIVE_DATE}</p>
          <p className="text-sm text-muted-foreground mt-1">
            By accessing or using <strong>PAIF.fun</strong> ("Platform", "we", "us", "our"), you agree to these terms. Please read them carefully.
          </p>
        </div>

        <Section icon={<Shield className="w-4 h-4" />} title="Privacy & Data Collection">
          <p>
            We collect only the minimum data required to operate the platform. This includes your Solana wallet public address when you connect your wallet, your Google account information (display name and email) if you sign in with Google, and anonymised usage analytics (page views, feature interactions).
          </p>
          <p>
            We do <strong>not</strong> sell, rent, or share your personal data with third-party advertisers. Wallet addresses are public on the Solana blockchain — we display on-chain data that is already publicly available. We never request or store your private keys or seed phrases.
          </p>
          <p>
            We use cookies and browser local storage solely to remember your session and preferences (e.g., dark mode, wallet connection). We do not use tracking cookies for advertising purposes.
          </p>
        </Section>

        <Section icon={<Ban className="w-4 h-4" />} title="No Scraping — Prohibited Automated Access">
          <p>
            <strong className="text-foreground">Automated scraping, crawling, or harvesting of any content, data, or information from PAIF.fun is strictly prohibited.</strong> This includes but is not limited to:
          </p>
          <ul className="list-disc list-inside space-y-1.5 text-sm">
            <li>Web scraping bots, spiders, or crawlers of any kind</li>
            <li>Automated scripts that query our API endpoints at non-human rates</li>
            <li>Mirroring or bulk-downloading platform data, token feeds, or community content</li>
            <li>Using our data to train machine learning models without prior written consent</li>
            <li>Any tool that bypasses or circumvents rate limiting, authentication, or access controls</li>
          </ul>
          <p>
            Violation of this policy may result in immediate and permanent IP banning, legal action under the Computer Fraud and Abuse Act (CFAA) and equivalent jurisdictions, and civil liability for damages. If you need access to PAIF.fun data for research or integration purposes, contact us at <strong className="text-foreground">{CONTACT_EMAIL}</strong> to discuss a data access agreement.
          </p>
        </Section>

        <Section icon={<DollarSign className="w-4 h-4" />} title="Platform Fees">
          <p>
            PAIF.fun charges a tiered platform fee on all trades and swaps executed through the platform. The fee decreases the longer your subscription commitment:
          </p>
          <ul className="list-disc list-inside space-y-1.5 text-sm">
            <li><strong className="text-foreground">Day Pass</strong> — 2.8% per trade</li>
            <li><strong className="text-foreground">Week Pass</strong> — 2.6% per trade</li>
            <li><strong className="text-foreground">Monthly</strong> — 2.4% per trade</li>
            <li><strong className="text-foreground">Annual</strong> — 2.2% per trade (lowest rate)</li>
          </ul>
          <p>
            Fees are applied at the time of transaction and are used to fund platform operations, development, and the $PAIF ecosystem. <strong className="text-foreground">Annual Members receive the lowest fee rate</strong> as a reward for their long-term commitment.
          </p>
          <p>
            All fees are transparently disclosed before any transaction is confirmed. No hidden charges. Fee structures may be updated with 14 days' notice posted on the platform.
          </p>
        </Section>

        <Section icon={<Users className="w-4 h-4" />} title="Community & User Conduct">
          <p>
            PAIF.fun hosts a community chat. You are responsible for all content you post. You agree not to:
          </p>
          <ul className="list-disc list-inside space-y-1.5 text-sm">
            <li>Post false or misleading financial information with intent to manipulate token prices</li>
            <li>Harass, threaten, or dox other users</li>
            <li>Spam, flood, or post unsolicited promotions</li>
            <li>Impersonate developers, team members, or other users</li>
          </ul>
          <p>
            We reserve the right to remove content and ban accounts that violate these rules without prior notice.
          </p>
        </Section>

        <Section icon={<FileText className="w-4 h-4" />} title="Disclaimers & Risk Warning">
          <p>
            <strong className="text-foreground">PAIF.fun is not a financial advisor.</strong> All content on this platform — including token data, public wallet activity, and market observations — is for informational purposes only and does not constitute financial advice.
          </p>
          <p>
            Cryptocurrency trading involves substantial risk of loss. Token prices shown are fetched from third-party data providers (DexScreener, Jupiter) and may be delayed or inaccurate. Always do your own research (DYOR) before making any investment decisions.
          </p>
          <p>
            The platform is provided "as is" without warranty of any kind. We are not liable for losses arising from trading decisions made using information on this platform, smart contract vulnerabilities, or third-party service outages.
          </p>
        </Section>

        <Section icon={<Mail className="w-4 h-4" />} title="Contact">
          <p>
            For privacy requests, data deletion inquiries, scraping license requests, or legal notices, contact us at:
          </p>
          <p>
            <a href={`mailto:${CONTACT_EMAIL}`} className="text-emerald-500 hover:text-emerald-400 font-semibold underline underline-offset-2" data-testid="link-contact-email">
              {CONTACT_EMAIL}
            </a>
          </p>
          <p className="text-[11px] text-muted-foreground/70 mt-4">
            These terms are governed by the laws of the United States. We reserve the right to update this policy at any time. Continued use of the platform after changes constitutes acceptance of the updated terms.
          </p>
        </Section>

      </main>
      <Footer />
    </div>
  );
}
