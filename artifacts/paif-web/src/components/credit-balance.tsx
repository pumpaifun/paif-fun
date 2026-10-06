import { useQuery } from "@tanstack/react-query";
import { useWallet } from "@solana/wallet-adapter-react";
import { Link } from "wouter";
import { Coins, Infinity as InfinityIcon } from "lucide-react";

interface CreditBalanceResponse {
  balance: number;
  unlimitedSubwallets: boolean;
  unlimitedUntil: string | null;
}

function formatRemainingShort(ms: number): string {
  if (ms <= 0) return "0m";
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return h >= 1 ? `${h}h${m ? ` ${m}m` : ""}` : `${m}m`;
}

/**
 * Compact pill showing how many bump credits the connected wallet has left,
 * with a quick link to /upgrade. Hidden when no wallet is connected — the
 * upgrade flow needs a signing wallet so there's nothing useful to show.
 */
export function CreditBalance() {
  const { publicKey, connected } = useWallet();
  const wallet = connected ? publicKey?.toBase58() ?? null : null;

  const { data, isLoading } = useQuery<CreditBalanceResponse>({
    queryKey: ["/api/credits", wallet],
    enabled: !!wallet,
    refetchInterval: 30_000,
    staleTime: 10_000,
  });

  if (!wallet) return null;

  const untilMs = data?.unlimitedUntil ? new Date(data.unlimitedUntil).getTime() : 0;
  const unlimitedActive = untilMs > Date.now();
  const colorCls = unlimitedActive
    ? "border-amber-500/40 bg-amber-500/10 text-amber-400"
    : "border-emerald-500/30 bg-emerald-500/10 text-emerald-400";

  return (
    <Link
      href="/upgrade"
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold hover-elevate active-elevate-2 ${colorCls}`}
      data-testid="link-credit-balance"
    >
      {unlimitedActive || data?.unlimitedSubwallets ? (
        <InfinityIcon className="h-3.5 w-3.5" />
      ) : (
        <Coins className="h-3.5 w-3.5" />
      )}
      <span data-testid="text-credit-balance">
        {isLoading
          ? "…"
          : unlimitedActive
            ? `Unlimited · ${formatRemainingShort(untilMs - Date.now())}`
            : `${data?.balance ?? 0} credits`}
      </span>
    </Link>
  );
}
