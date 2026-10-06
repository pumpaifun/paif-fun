import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useWallet } from "@solana/wallet-adapter-react";
import bs58 from "bs58";
import { Header } from "@/components/header";
import { Footer } from "@/components/footer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  Send, Plus, Trash2, Sparkles, FileText, Wand2, Wallet, ShieldCheck,
  AlertTriangle, CheckCircle2, Loader2, Power, Megaphone, ExternalLink,
} from "lucide-react";

interface TgStatus {
  configured: boolean;
  botUsername: string | null;
  botError: string | null;
  treasury: string;
}
interface TgDestination {
  id: string;
  chatId: string;
  label: string;
  enabled: boolean;
  createdAt: string;
}
interface TgPost {
  id: string;
  kind: string;
  copyMode: string;
  content: string;
  tokenSymbol: string | null;
  targets: string[];
  sentCount: number;
  failCount: number;
  createdAt: string;
}
interface TrendingToken {
  mint: string;
  symbol: string;
  name: string;
  price: number;
  change1h: number;
  icon?: string;
}

type Kind = "platform" | "trending" | "custom";
type CopyMode = "ai" | "template";

export default function TelegramBotPage() {
  const { publicKey, connected, signMessage } = useWallet();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const wallet = connected ? publicKey?.toBase58() ?? null : null;

  const [kind, setKind] = useState<Kind>("platform");
  const [copyMode, setCopyMode] = useState<CopyMode>("template");
  const [content, setContent] = useState("");
  const [usedMode, setUsedMode] = useState<CopyMode | null>(null);
  const [selectedTokenMint, setSelectedTokenMint] = useState<string>("");
  const [customMint, setCustomMint] = useState("");
  const [customSymbol, setCustomSymbol] = useState("");
  const [selectedDests, setSelectedDests] = useState<Set<string>>(new Set());
  const [newChatId, setNewChatId] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [busy, setBusy] = useState<"idle" | "generating" | "sending" | "adding" | "mutating">("idle");

  useEffect(() => {
    document.title = "Admin · Telegram Shill Bot — PAIF.fun";
  }, []);

  const { data: status, isLoading: statusLoading } = useQuery<TgStatus>({
    queryKey: ["/api/telegram/admin/status"],
    queryFn: async () => {
      const r = await fetch("/api/telegram/admin/status", { credentials: "include" });
      if (!r.ok) throw new Error("status fetch failed");
      return r.json();
    },
    refetchInterval: 20_000,
  });

  const isTreasury = !!wallet && !!status?.treasury && wallet === status.treasury;

  const { data: destData, isLoading: destLoading } = useQuery<{ destinations: TgDestination[] }>({
    queryKey: ["/api/telegram/admin/destinations"],
    queryFn: async () => {
      const r = await fetch("/api/telegram/admin/destinations", { credentials: "include" });
      if (!r.ok) throw new Error("destinations fetch failed");
      return r.json();
    },
  });
  const destinations = destData?.destinations ?? [];

  const { data: postData } = useQuery<{ posts: TgPost[] }>({
    queryKey: ["/api/telegram/admin/posts"],
    queryFn: async () => {
      const r = await fetch("/api/telegram/admin/posts", { credentials: "include" });
      if (!r.ok) throw new Error("posts fetch failed");
      return r.json();
    },
  });
  const posts = postData?.posts ?? [];

  const { data: trending } = useQuery<TrendingToken[]>({
    queryKey: ["/api/trending-tokens"],
    enabled: isTreasury && kind === "trending",
  });

  const selectedTrending = useMemo(
    () => (trending ?? []).find((t) => t.mint === selectedTokenMint),
    [trending, selectedTokenMint],
  );

  // Build the token payload sent to the server for trending/custom shills.
  function buildToken() {
    if (kind === "trending") {
      if (!selectedTrending) return undefined;
      return {
        mint: selectedTrending.mint,
        symbol: selectedTrending.symbol,
        name: selectedTrending.name,
        price: selectedTrending.price,
        change1h: selectedTrending.change1h,
      };
    }
    if (kind === "custom") {
      const mint = customMint.trim();
      if (!mint) return undefined;
      return { mint, symbol: customSymbol.trim() || undefined };
    }
    return undefined;
  }

  // Treasury signs a canonical, nonce-bound message authorizing the action.
  async function sign(action: string): Promise<{ nonce: number; signature: string }> {
    if (!signMessage) throw new Error("Your wallet can't sign messages — reconnect and try again.");
    if (!status?.treasury) throw new Error("Treasury wallet unknown.");
    const nonce = Date.now();
    const message = ["paif-telegram", "v1", action, status.treasury, String(nonce)].join("|");
    const signature = bs58.encode(await signMessage(new TextEncoder().encode(message)));
    return { nonce, signature };
  }

  async function handleGenerate() {
    if (busy !== "idle") return;
    const token = buildToken();
    if ((kind === "trending" || kind === "custom") && !token) {
      toast({ title: "Pick a token first", variant: "destructive" });
      return;
    }
    setBusy("generating");
    try {
      // AI generation hits a paid API, so the server requires a treasury
      // signature for it. Template generation is free and needs no popup.
      const auth = copyMode === "ai" ? await sign("generate") : {};
      const r = await apiRequest("POST", "/api/telegram/admin/generate", { kind, copyMode, token, ...auth }).then((x) => x.json());
      setContent(r.content);
      setUsedMode(r.usedMode);
      if (copyMode === "ai" && r.usedMode === "template") {
        toast({ title: "AI unavailable — used a template instead" });
      }
    } catch (e: any) {
      toast({ title: "Couldn't generate copy", description: e?.message, variant: "destructive" });
    } finally {
      setBusy("idle");
    }
  }

  async function handleAddDestination() {
    if (busy !== "idle") return;
    const chatId = newChatId.trim();
    if (chatId.length < 2) {
      toast({ title: "Enter a chat id or @username", variant: "destructive" });
      return;
    }
    setBusy("adding");
    try {
      const auth = await sign("add-destination");
      await apiRequest("POST", "/api/telegram/admin/destinations", { chatId, label: newLabel.trim(), ...auth });
      setNewChatId("");
      setNewLabel("");
      queryClient.invalidateQueries({ queryKey: ["/api/telegram/admin/destinations"] });
      toast({ title: "Destination added" });
    } catch (e: any) {
      toast({ title: "Couldn't add destination", description: e?.message, variant: "destructive" });
    } finally {
      setBusy("idle");
    }
  }

  async function handleToggle(d: TgDestination) {
    if (busy !== "idle") return;
    setBusy("mutating");
    try {
      const auth = await sign("toggle-destination");
      await apiRequest("POST", "/api/telegram/admin/destinations/toggle", { id: d.id, enabled: !d.enabled, ...auth });
      queryClient.invalidateQueries({ queryKey: ["/api/telegram/admin/destinations"] });
    } catch (e: any) {
      toast({ title: "Couldn't update", description: e?.message, variant: "destructive" });
    } finally {
      setBusy("idle");
    }
  }

  async function handleRemove(d: TgDestination) {
    if (busy !== "idle") return;
    setBusy("mutating");
    try {
      const auth = await sign("remove-destination");
      await apiRequest("POST", "/api/telegram/admin/destinations/remove", { id: d.id, ...auth });
      setSelectedDests((prev) => {
        const next = new Set(prev);
        next.delete(d.id);
        return next;
      });
      queryClient.invalidateQueries({ queryKey: ["/api/telegram/admin/destinations"] });
      toast({ title: "Destination removed" });
    } catch (e: any) {
      toast({ title: "Couldn't remove", description: e?.message, variant: "destructive" });
    } finally {
      setBusy("idle");
    }
  }

  async function handleSend() {
    if (busy !== "idle") return;
    if (!content.trim()) {
      toast({ title: "Generate or write a message first", variant: "destructive" });
      return;
    }
    const ids = Array.from(selectedDests);
    if (ids.length === 0) {
      toast({ title: "Select at least one destination", variant: "destructive" });
      return;
    }
    setBusy("sending");
    try {
      const auth = await sign("send");
      const r = await apiRequest("POST", "/api/telegram/admin/send", {
        kind,
        copyMode: usedMode ?? copyMode,
        content,
        token: buildToken(),
        destinationIds: ids,
        ...auth,
      }).then((x) => x.json());
      queryClient.invalidateQueries({ queryKey: ["/api/telegram/admin/posts"] });
      if (r.failCount > 0) {
        const firstErr = (r.results ?? []).find((x: any) => !x.ok)?.error;
        toast({
          title: `Sent to ${r.sentCount}, ${r.failCount} failed`,
          description: firstErr ? `e.g. ${firstErr}` : "Some chats rejected the message — is the bot a member/admin?",
          variant: "destructive",
        });
      } else {
        toast({ title: `🚀 Shilled to ${r.sentCount} chat${r.sentCount !== 1 ? "s" : ""}` });
      }
    } catch (e: any) {
      toast({ title: "Send failed", description: e?.message, variant: "destructive" });
    } finally {
      setBusy("idle");
    }
  }

  const enabledDestCount = destinations.filter((d) => d.enabled).length;

  function toggleSelect(id: string) {
    setSelectedDests((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // ── Gate: wallet + treasury ────────────────────────────────────────────────
  if (statusLoading) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header />
        <main className="flex-1 max-w-3xl mx-auto w-full px-4 py-8">
          <Skeleton className="h-40 w-full" />
        </main>
        <Footer />
      </div>
    );
  }

  if (!connected || !isTreasury) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header />
        <main className="flex-1 max-w-3xl mx-auto w-full px-4 py-8">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ShieldCheck className="w-5 h-5" /> Telegram Shill Bot — Admin
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-start gap-2 text-sm text-muted-foreground" data-testid="text-gate-message">
                <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
                {!connected
                  ? "Connect the treasury wallet to manage the Telegram bot."
                  : "This wallet is not the treasury. Connect the treasury wallet to continue."}
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Wallet className="w-3.5 h-3.5" />
                {wallet ? `${wallet.slice(0, 6)}…${wallet.slice(-4)}` : "No wallet connected"}
              </div>
            </CardContent>
          </Card>
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 max-w-3xl mx-auto w-full px-4 py-8 space-y-5">
        <div>
          <h1 className="text-2xl font-black flex items-center gap-2" data-testid="text-page-title">
            <Megaphone className="w-6 h-6 text-sky-500" /> Telegram Shill Bot
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Compose hype and blast it to your Telegram groups & channels.
          </p>
        </div>

        {/* Bot status */}
        <Card data-testid="card-bot-status">
          <CardContent className="p-4">
            {!status?.configured ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm font-bold text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="w-4 h-4" /> Bot not connected yet
                </div>
                <ol className="text-xs text-muted-foreground list-decimal ml-4 space-y-1">
                  <li>Open Telegram, message <span className="font-mono">@BotFather</span>, send <span className="font-mono">/newbot</span>, follow the prompts.</li>
                  <li>Copy the bot token it gives you.</li>
                  <li>Add it as the <span className="font-mono">TELEGRAM_BOT_TOKEN</span> secret (I'll prompt you), then refresh.</li>
                  <li>Add your bot to each group/channel — as an <b>admin</b> for channels.</li>
                </ol>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-sm font-bold text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="w-4 h-4" />
                  {status.botUsername ? (
                    <a
                      href={`https://t.me/${status.botUsername}`}
                      target="_blank"
                      rel="noreferrer"
                      className="hover:underline inline-flex items-center gap-1"
                      data-testid="link-bot-username"
                    >
                      @{status.botUsername} <ExternalLink className="w-3 h-3" />
                    </a>
                  ) : (
                    "Bot token configured"
                  )}
                </div>
                {status.botError && (
                  <span className="text-xs text-destructive" data-testid="text-bot-error">{status.botError}</span>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Destinations */}
        <Card data-testid="card-destinations">
          <CardHeader>
            <CardTitle className="text-base flex items-center justify-between">
              <span>Destinations</span>
              <Badge variant="secondary" data-testid="badge-dest-count">{enabledDestCount} active</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-col sm:flex-row gap-2">
              <Input
                placeholder="@channelname or -1001234567890"
                value={newChatId}
                onChange={(e) => setNewChatId(e.target.value)}
                data-testid="input-chat-id"
              />
              <Input
                placeholder="Label (e.g. Main Group)"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                className="sm:max-w-[180px]"
                data-testid="input-chat-label"
              />
              <Button
                onClick={handleAddDestination}
                disabled={busy !== "idle"}
                className="bg-foreground text-background hover:bg-foreground/90 font-bold gap-1.5"
                data-testid="button-add-destination"
              >
                {busy === "adding" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                Add
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Tip: add the bot to the group, then forward a message from the group to <span className="font-mono">@userinfobot</span> to get its numeric chat id. Public channels can use <span className="font-mono">@username</span>.
            </p>

            {destLoading ? (
              <Skeleton className="h-16 w-full" />
            ) : destinations.length === 0 ? (
              <p className="text-sm text-muted-foreground py-2">No destinations yet — add one above.</p>
            ) : (
              <div className="space-y-1.5">
                {destinations.map((d) => (
                  <div
                    key={d.id}
                    className="flex items-center gap-2 rounded-lg border border-border p-2"
                    data-testid={`row-destination-${d.id}`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedDests.has(d.id)}
                      onChange={() => toggleSelect(d.id)}
                      disabled={!d.enabled}
                      className="w-4 h-4 accent-sky-500"
                      data-testid={`checkbox-destination-${d.id}`}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold truncate" data-testid={`text-dest-label-${d.id}`}>
                        {d.label || d.chatId}
                      </p>
                      {d.label && <p className="text-[11px] text-muted-foreground font-mono truncate">{d.chatId}</p>}
                    </div>
                    {!d.enabled && <Badge variant="outline" className="text-[10px]">off</Badge>}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => handleToggle(d)}
                      disabled={busy !== "idle"}
                      title={d.enabled ? "Disable" : "Enable"}
                      data-testid={`button-toggle-${d.id}`}
                    >
                      <Power className={`w-4 h-4 ${d.enabled ? "text-emerald-500" : "text-muted-foreground"}`} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive"
                      onClick={() => handleRemove(d)}
                      disabled={busy !== "idle"}
                      title="Remove"
                      data-testid={`button-remove-${d.id}`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Composer */}
        <Card data-testid="card-composer">
          <CardHeader>
            <CardTitle className="text-base">Compose a shill</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* What to hype */}
            <div>
              <p className="text-xs font-bold text-muted-foreground mb-1.5">What to hype</p>
              <div className="flex flex-wrap gap-2">
                {([
                  ["platform", "PAIF + $PAIF"],
                  ["trending", "Trending token"],
                  ["custom", "Specific token"],
                ] as [Kind, string][]).map(([k, label]) => (
                  <button
                    key={k}
                    onClick={() => setKind(k)}
                    className={[
                      "px-3 py-1.5 rounded-full border text-xs font-bold transition-colors",
                      kind === k
                        ? "bg-foreground text-background border-foreground"
                        : "bg-card text-foreground border-border hover:border-foreground/40",
                    ].join(" ")}
                    data-testid={`button-kind-${k}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {kind === "trending" && (
              <div>
                <p className="text-xs font-bold text-muted-foreground mb-1.5">Pick a trending token</p>
                <select
                  value={selectedTokenMint}
                  onChange={(e) => setSelectedTokenMint(e.target.value)}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                  data-testid="select-trending-token"
                >
                  <option value="">Select…</option>
                  {(trending ?? []).map((t) => (
                    <option key={t.mint} value={t.mint}>
                      ${t.symbol} — {t.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {kind === "custom" && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <Input
                  placeholder="Token mint address"
                  value={customMint}
                  onChange={(e) => setCustomMint(e.target.value)}
                  className="sm:col-span-2 font-mono text-xs"
                  data-testid="input-custom-mint"
                />
                <Input
                  placeholder="Ticker (optional)"
                  value={customSymbol}
                  onChange={(e) => setCustomSymbol(e.target.value)}
                  data-testid="input-custom-symbol"
                />
              </div>
            )}

            {/* Copy mode */}
            <div>
              <p className="text-xs font-bold text-muted-foreground mb-1.5">Copy style</p>
              <div className="flex gap-2">
                <button
                  onClick={() => setCopyMode("template")}
                  className={[
                    "flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-bold transition-colors",
                    copyMode === "template"
                      ? "bg-foreground text-background border-foreground"
                      : "bg-card text-foreground border-border hover:border-foreground/40",
                  ].join(" ")}
                  data-testid="button-mode-template"
                >
                  <FileText className="w-3.5 h-3.5" /> Template
                </button>
                <button
                  onClick={() => setCopyMode("ai")}
                  className={[
                    "flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-bold transition-colors",
                    copyMode === "ai"
                      ? "bg-foreground text-background border-foreground"
                      : "bg-card text-foreground border-border hover:border-foreground/40",
                  ].join(" ")}
                  data-testid="button-mode-ai"
                >
                  <Sparkles className="w-3.5 h-3.5" /> AI-written
                </button>
              </div>
            </div>

            <Button
              variant="outline"
              onClick={handleGenerate}
              disabled={busy !== "idle"}
              className="font-bold gap-1.5 w-full sm:w-auto"
              data-testid="button-generate"
            >
              {busy === "generating" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
              Generate copy
            </Button>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-xs font-bold text-muted-foreground">Message</p>
                <span className="text-[11px] text-muted-foreground" data-testid="text-char-count">
                  {content.length}/4096
                </span>
              </div>
              <Textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="Generate copy above, or write your own hype here. Basic HTML (<b>, <i>) is supported."
                rows={7}
                maxLength={4096}
                data-testid="textarea-content"
              />
              {usedMode && (
                <p className="text-[11px] text-muted-foreground mt-1">
                  {usedMode === "ai" ? "✨ AI-generated" : "📝 Template"} — edit freely before sending.
                </p>
              )}
            </div>

            <Button
              onClick={handleSend}
              disabled={busy !== "idle" || !status?.configured}
              className="w-full bg-foreground text-background hover:bg-foreground/90 font-bold gap-2 h-11"
              data-testid="button-send"
            >
              {busy === "sending" ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
              Send to {selectedDests.size} selected chat{selectedDests.size !== 1 ? "s" : ""}
            </Button>
            {!status?.configured && (
              <p className="text-[11px] text-amber-600 dark:text-amber-400 text-center">
                Add the bot token first (see status above) to enable sending.
              </p>
            )}
          </CardContent>
        </Card>

        {/* History */}
        {posts.length > 0 && (
          <Card data-testid="card-history">
            <CardHeader>
              <CardTitle className="text-base">Recent blasts</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {posts.map((p) => (
                <div key={p.id} className="rounded-lg border border-border p-2.5" data-testid={`row-post-${p.id}`}>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <div className="flex items-center gap-1.5 text-xs font-bold">
                      <Badge variant="secondary" className="text-[10px]">{p.kind}</Badge>
                      {p.tokenSymbol && <span className="text-muted-foreground">${p.tokenSymbol}</span>}
                    </div>
                    <span className="text-[11px] text-muted-foreground">
                      <span className="text-emerald-500">{p.sentCount} sent</span>
                      {p.failCount > 0 && <span className="text-destructive"> · {p.failCount} failed</span>}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground line-clamp-2 whitespace-pre-wrap">{p.content}</p>
                  <p className="text-[10px] text-muted-foreground/70 mt-1">
                    {new Date(p.createdAt).toLocaleString()} · {p.targets.join(", ")}
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </main>
      <Footer />
    </div>
  );
}
