import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useWallet } from "@solana/wallet-adapter-react";
import {
  getAlphaBriefHistory, requestAlphaBrief, useGetAlphaOversightAuthority, getGetAlphaOversightAuthorityQueryKey,
  type AlphaOversightBrief,
} from "@workspace/api-client-react";
import bs58 from "bs58";
import { FileText, Loader2, LockKeyhole } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";

export function AlphaOversightBriefs() {
  const { publicKey, connected, signMessage } = useWallet();
  const { toast } = useToast();
  const wallet = connected ? publicKey?.toBase58() ?? null : null;
  const currentWallet = useRef(wallet);
  currentWallet.current = wallet;
  const authority = useGetAlphaOversightAuthority({
    query: { queryKey: getGetAlphaOversightAuthorityQueryKey(), staleTime: 30_000, retry: false },
  });
  const [history, setHistory] = useState<{ wallet: string; items: AlphaOversightBrief[] } | null>(null);
  const isOwner = !!wallet && wallet === authority.data?.ownerWallet;
  const items = isOwner && history?.wallet === wallet ? history.items : [];

  const operation = useMutation({
    retry: false,
    mutationFn: async (action: "request" | "history") => {
      const owner = wallet;
      if (!owner || owner !== authority.data?.ownerWallet || !signMessage) {
        throw new Error("Connect the PAIF owner treasury wallet with message signing.");
      }
      const nonce = Date.now();
      const message = ["paif-alpha-oversight", "v1", action, owner, String(nonce)].join("|");
      const signature = bs58.encode(await signMessage(new TextEncoder().encode(message)));
      if (currentWallet.current !== owner) throw new Error("Wallet changed. Sign with the owner wallet again.");
      const authorization = { nonce, signature };
      const result = action === "request"
        ? [await requestAlphaBrief(authorization)]
        : await getAlphaBriefHistory(authorization);
      return { owner, action, result };
    },
    onSuccess: ({ owner, action, result }) => {
      if (currentWallet.current !== owner) return;
      setHistory((prior) => ({
        wallet: owner,
        items: action === "history" ? result
          : [...result, ...(prior?.wallet === owner ? prior.items.filter((item) => item.id !== result[0].id) : [])].slice(0, 20),
      }));
      toast({ title: action === "history" ? "Saved briefs loaded" : "Advisory brief saved" });
    },
    onError: (error: Error) => toast({
      title: "Oversight request not completed", description: error.message, variant: "destructive",
    }),
  });

  return (
    <Card className="mt-8 p-6" data-testid="alpha-oversight-briefs">
      <h2 className="flex items-center gap-2 text-xl font-bold">
        <FileText className="h-5 w-5 text-emerald-500" /> Owner oversight briefs
      </h2>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">
        Advisory only. A signed request collects a bounded server snapshot of market-data health,
        settled Paper Swing results, verified payment receipts, and release evidence.
        No free-text instructions are accepted. This does not run a Claw Pump agent turn,
        trade, transfer, publish, or change skills or bot settings.
      </p>
      <p className="mt-2 text-xs text-muted-foreground">
        Engine: rules-based fallback, not a Claw Pump AI response. Saved privately for the owner.
        Payment failures and release-check results are marked unknown when not available.
      </p>
      {authority.isError ? (
        <p className="mt-4 text-sm text-destructive">Owner authorization information is unavailable.</p>
      ) : !isOwner ? (
        <p className="mt-4 flex items-center gap-2 rounded-xl border bg-muted/20 p-4 text-sm text-muted-foreground">
          <LockKeyhole className="h-4 w-4 shrink-0" />
          {authority.isLoading ? "Checking oversight authority…" : "Connect the PAIF owner treasury wallet to request or read saved briefs."}
        </p>
      ) : (
        <>
          <div className="mt-4 flex flex-wrap gap-3">
            <Button disabled={operation.isPending || !signMessage} onClick={() => operation.mutate("request")}>
              {operation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Sign and request brief
            </Button>
            <Button variant="outline" disabled={operation.isPending || !signMessage} onClick={() => operation.mutate("history")}>
              Sign and load saved history
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            One brief per minute. History shows the latest 20 saved briefs; sign to reload it after reopening this page.
          </p>
          {!items.length && <p className="mt-5 text-sm text-muted-foreground">No briefs loaded. Request a new brief or load your saved history.</p>}
          <div className="mt-5 space-y-5">
            {items.map((brief) => (
              <article key={brief.id} className="rounded-xl border p-4" data-testid="alpha-oversight-brief">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-semibold">Advisory only · {brief.riskLevel} risk</h3>
                  <span className="text-xs text-muted-foreground">{new Date(brief.generatedAt).toLocaleString()}</span>
                </div>
                <p className="mt-2 text-sm">Evidence confidence: {brief.confidence}% · Rules-based fallback</p>
                <p className="mt-3 text-sm leading-6">{brief.recommendation}</p>
                <details className="mt-4">
                  <summary className="cursor-pointer text-sm font-semibold">Evidence and limitations</summary>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    {brief.evidence.map((evidence) => (
                      <div key={evidence.area} className="rounded-lg border bg-muted/20 p-3">
                        <h4 className="text-sm font-semibold capitalize">{evidence.area} · {evidence.status}</h4>
                        <p className="mt-1 text-xs text-muted-foreground">{evidence.source}</p>
                        <p className="mt-1 text-xs text-muted-foreground">Observed: {new Date(evidence.observedAt).toLocaleString()}</p>
                        <ul className="mt-2 space-y-1 text-xs leading-5">
                          {evidence.facts.map((fact) => <li key={fact}>{fact}</li>)}
                        </ul>
                        <ul className="mt-2 space-y-1 text-xs leading-5 text-muted-foreground">
                          {evidence.limitations.map((limitation) => <li key={limitation}>Limit: {limitation}</li>)}
                        </ul>
                      </div>
                    ))}
                  </div>
                </details>
              </article>
            ))}
          </div>
        </>
      )}
    </Card>
  );
}
