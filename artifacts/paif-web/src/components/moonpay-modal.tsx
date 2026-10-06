import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { CreditCard, Clock, ExternalLink, CheckCircle2 } from "lucide-react";

const MOONPAY_API_KEY = import.meta.env.VITE_MOONPAY_API_KEY as string | undefined;
const PENDING_APPROVAL = !MOONPAY_API_KEY;

interface MoonPayModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultCurrency?: string;
}

export function MoonPayModal({ open, onOpenChange }: MoonPayModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-sm w-full overflow-hidden"
        data-testid="dialog-moonpay"
      >
        <DialogHeader className="pb-2">
          <DialogTitle className="flex items-center gap-2 text-base font-bold" data-testid="text-moonpay-title">
            <CreditCard className="w-4 h-4 text-emerald-500" />
            Buy Crypto with Card
          </DialogTitle>
        </DialogHeader>

        {PENDING_APPROVAL ? (
          <div className="flex flex-col items-center text-center gap-4 py-6 px-2">
            <div className="w-16 h-16 rounded-full bg-yellow-500/10 border border-yellow-500/20 flex items-center justify-center">
              <Clock className="w-8 h-8 text-yellow-500" />
            </div>

            <div>
              <h3 className="font-bold text-foreground text-base mb-1.5" data-testid="text-moonpay-pending-title">
                MoonPay — Application Pending
              </h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                We've applied to MoonPay for partnership approval to offer fiat on-ramp inside PAIF. This feature is <span className="font-semibold text-foreground">not yet available</span> — we'll enable it once approved.
              </p>
            </div>

            <div className="w-full rounded-xl border border-border bg-muted/40 p-4 space-y-2.5 text-left">
              <p className="text-xs font-bold text-foreground uppercase tracking-wider mb-1">If approved, you'll be able to:</p>
              {[
                "Buy SOL, USDC and more with a credit or debit card",
                "Fund your wallet in seconds — no CEX account needed",
                "Bank transfer and Apple Pay / Google Pay support",
              ].map((item) => (
                <div key={item} className="flex items-start gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0 mt-0.5" />
                  <span className="text-xs text-muted-foreground">{item}</span>
                </div>
              ))}
            </div>

            <div className="flex flex-col gap-2 w-full">
              <a
                href="https://www.moonpay.com"
                target="_blank"
                rel="noopener noreferrer"
                data-testid="link-moonpay-site"
              >
                <Button variant="outline" className="w-full gap-2 text-sm font-semibold">
                  <ExternalLink className="w-3.5 h-3.5" />
                  Buy on MoonPay directly
                </Button>
              </a>
              <Button
                variant="ghost"
                className="w-full text-xs text-muted-foreground"
                onClick={() => onOpenChange(false)}
                data-testid="button-moonpay-close"
              >
                Close
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground py-4 text-center">
            MoonPay widget will appear here once configured.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

interface BuyWithCardButtonProps {
  className?: string;
  size?: "sm" | "default";
}

export function BuyWithCardButton({ className, size = "default" }: BuyWithCardButtonProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="outline"
        size={size}
        className={`gap-1.5 font-bold ${className ?? ""}`}
        onClick={() => setOpen(true)}
        data-testid="button-buy-with-card"
      >
        <CreditCard className="w-3.5 h-3.5 text-emerald-500" />
        Buy with Card
      </Button>
      <MoonPayModal open={open} onOpenChange={setOpen} />
    </>
  );
}
