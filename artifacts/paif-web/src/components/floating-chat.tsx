import { useState, useRef, useEffect } from "react";
import { MessageCircle, X, Send, Mail, Wallet, Tag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useWallet } from "@solana/wallet-adapter-react";
import { useAuth } from "@/hooks/use-auth";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { LoginModal } from "@/components/login-modal";
import { Link } from "wouter";
import type { Comment } from "@shared/schema";
import { signWalletWrite } from "@/lib/wallet-write-auth";

function timeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function truncateWallet(addr: string) {
  if (addr.startsWith("replit:")) return "Email user";
  return addr.slice(0, 4) + "..." + addr.slice(-4);
}

function truncateMint(mint: string) {
  return mint.slice(0, 5) + "..." + mint.slice(-4);
}

const SOLANA_ADDR_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function FloatingChat() {
  const [open, setOpen] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [tagOpen, setTagOpen] = useState(false);
  const [taggedMint, setTaggedMint] = useState("");
  const [tagError, setTagError] = useState("");
  const { publicKey, connected, signMessage } = useWallet();
  const { user: authUser, isAuthenticated: isEmailAuth } = useAuth();
  const scrollRef = useRef<HTMLDivElement>(null);

  const isSignedIn = (connected && publicKey) || isEmailAuth;

  const profileName = authUser?.username
    ? "@" + authUser.username
    : authUser?.firstName || (publicKey ? truncateWallet(publicKey.toBase58()) : "");

  const { data: comments = [] } = useQuery<Comment[]>({
    queryKey: ["/api/comments"],
    refetchInterval: 10000,
  });

  const postMutation = useMutation({
    mutationFn: async (data: { walletAddress: string; displayName: string; message: string; taggedMint?: string }) => {
      let body: typeof data & { nonce?: number; signature?: string } = data;
      if (SOLANA_ADDR_RE.test(data.walletAddress)) {
        const auth = await signWalletWrite(signMessage ?? undefined, "paif-comment", [
          data.walletAddress, data.displayName, data.message, data.taggedMint ?? "",
        ]);
        body = { ...data, ...auth };
      }
      const res = await apiRequest("POST", "/api/comments", body);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/comments"] });
      setMessage("");
      setTaggedMint("");
      setTagOpen(false);
      setTagError("");
    },
  });

  useEffect(() => {
    if (open && scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
  }, [open, comments.length]);

  function handleTagChange(val: string) {
    setTaggedMint(val);
    if (val && !SOLANA_ADDR_RE.test(val.trim())) {
      setTagError("Doesn't look like a valid contract address");
    } else {
      setTagError("");
    }
  }

  function handlePost() {
    if (!message.trim() || !isSignedIn) return;
    if (taggedMint && !SOLANA_ADDR_RE.test(taggedMint.trim())) return;

    let walletAddr: string;
    let name: string;

    if (connected && publicKey) {
      walletAddr = publicKey.toBase58();
      name = profileName || truncateWallet(walletAddr);
    } else if (authUser) {
      walletAddr = `replit:${authUser.id}`;
      name = profileName || authUser.email?.split("@")[0] || "Member";
    } else {
      return;
    }

    postMutation.mutate({
      walletAddress: walletAddr,
      displayName: name,
      message: message.trim(),
      taggedMint: taggedMint.trim() || undefined,
    });
  }

  return (
    <>
      <div className="fixed top-16 right-3 z-[9998]" data-testid="floating-chat">
        <button
          onClick={() => setOpen(!open)}
          className="w-10 h-10 rounded-full bg-emerald-500 text-white flex items-center justify-center shadow-lg hover:bg-emerald-600 transition-colors"
          aria-label={open ? "Close chat" : "Open community chat"}
          data-testid="button-floating-chat"
        >
          {open ? <X className="w-5 h-5" /> : <MessageCircle className="w-5 h-5" />}
        </button>

        {open && (
          <div className="absolute top-12 right-0 w-72 sm:w-80 bg-card border border-border rounded-xl shadow-2xl overflow-hidden" data-testid="floating-chat-panel">
            <div className="px-3 py-2.5 border-b border-border bg-muted/50">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-sm font-bold text-foreground">Community Chat</span>
                <span className="text-[10px] text-muted-foreground ml-auto">{comments.length} msg{comments.length !== 1 ? "s" : ""}</span>
              </div>
            </div>

            <div ref={scrollRef} className="max-h-60 overflow-y-auto p-2 space-y-1.5">
              {comments.length === 0 ? (
                <div className="text-center py-6 text-xs text-muted-foreground">
                  No messages yet. Be the first!
                </div>
              ) : (
                comments.map((c) => (
                  <div key={c.id} className="rounded-lg bg-muted/30 px-2.5 py-1.5" data-testid={`chat-msg-${c.id}`}>
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-bold text-foreground">{c.displayName}</span>
                      <span className="text-[9px] text-muted-foreground">{timeAgo(new Date(c.createdAt))}</span>
                    </div>
                    <p className="text-xs text-foreground/80 leading-snug">{c.message}</p>
                    {c.taggedMint && (
                      <Link
                        href={`/scan?mint=${c.taggedMint}`}
                        className="inline-flex items-center gap-1 mt-1 px-1.5 py-0.5 rounded-md bg-emerald-500/10 border border-emerald-500/25 text-[10px] font-mono text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20 transition-colors"
                        data-testid={`chat-tag-${c.id}`}
                      >
                        <Tag className="w-2.5 h-2.5" />
                        {truncateMint(c.taggedMint)}
                      </Link>
                    )}
                  </div>
                ))
              )}
            </div>

            <div className="border-t border-border p-2">
              {isSignedIn ? (
                <div className="space-y-1.5">
                  <div className="flex gap-1.5">
                    <Input
                      type="text"
                      placeholder={profileName ? `Post as ${profileName}...` : "Type a message..."}
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handlePost()}
                      className="text-xs h-8 flex-1"
                      maxLength={500}
                      data-testid="input-chat-message"
                    />
                    <button
                      type="button"
                      onClick={() => { setTagOpen(!tagOpen); if (tagOpen) { setTaggedMint(""); setTagError(""); } }}
                      className={`h-8 w-8 flex items-center justify-center rounded-md border transition-colors ${
                        tagOpen || taggedMint
                          ? "border-emerald-500 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                          : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/30"
                      }`}
                      title={tagOpen ? "Remove token tag" : "Tag a meme/token"}
                      data-testid="button-chat-tag-toggle"
                    >
                      <Tag className="w-3.5 h-3.5" />
                    </button>
                    <Button
                      size="sm"
                      className="h-8 px-2"
                      onClick={handlePost}
                      disabled={!message.trim() || postMutation.isPending || (!!taggedMint && !!tagError)}
                      data-testid="button-chat-send"
                    >
                      <Send className="w-3.5 h-3.5" />
                    </Button>
                  </div>

                  {tagOpen && (
                    <div className="space-y-1">
                      <Input
                        type="text"
                        placeholder="Paste contract address..."
                        value={taggedMint}
                        onChange={(e) => handleTagChange(e.target.value)}
                        className={`text-xs h-7 font-mono ${tagError ? "border-red-400 focus-visible:ring-red-400" : ""}`}
                        maxLength={44}
                        data-testid="input-chat-tag-mint"
                      />
                      {tagError && <p className="text-[10px] text-red-500">{tagError}</p>}
                      {taggedMint && !tagError && (
                        <p className="text-[10px] text-emerald-600 dark:text-emerald-400">
                          ✓ Token tagged — will show as a link in your message
                        </p>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-1.5 py-1">
                  <p className="text-[11px] text-muted-foreground text-center">Sign in to join the chat</p>
                  <div className="flex gap-1.5">
                    <Button
                      size="sm"
                      className="flex-1 h-8 text-xs font-semibold gap-1.5"
                      onClick={() => setLoginOpen(true)}
                      data-testid="button-floating-signin-email"
                    >
                      <Mail className="w-3.5 h-3.5" />
                      Sign In
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1 h-8 text-xs font-semibold gap-1.5"
                      onClick={() => setLoginOpen(true)}
                      data-testid="button-floating-signin-wallet"
                    >
                      <Wallet className="w-3.5 h-3.5" />
                      Wallet
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <LoginModal open={loginOpen} onOpenChange={setLoginOpen} />
    </>
  );
}
