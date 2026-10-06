import { useMemo } from "react";
import { Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { MessageSquare, ChevronUp, Flame, Wallet, User, ArrowRight } from "lucide-react";
import type { Comment } from "@shared/schema";

const censorWords = [
  "fuck", "fucking", "fucked", "shit", "shitty", "shitting",
  "damn", "damned", "ass", "asshole", "bitch", "bitches",
  "crap", "crappy", "hell", "wtf", "stfu", "bullshit",
];

function censorText(text: string): string {
  let result = text;
  for (const word of censorWords) {
    const regex = new RegExp(`\\b${word}\\b`, "gi");
    result = result.replace(regex, (match) => {
      if (match.length <= 2) return match;
      return match[0] + "*".repeat(match.length - 2) + match[match.length - 1];
    });
  }
  return result;
}

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

export function ForumPreview() {
  const { data: comments = [], isLoading } = useQuery<Comment[]>({
    queryKey: ["/api/comments"],
    refetchInterval: 15000,
  });

  const upvoteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/comments/${id}/upvote`, {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/comments"] });
    },
  });

  const topPosts = useMemo(
    () => [...comments].sort((a, b) => b.upvotes - a.upvotes).slice(0, 4),
    [comments],
  );

  const totalUpvotes = useMemo(
    () => comments.reduce((s, c) => s + c.upvotes, 0),
    [comments],
  );

  return (
    <Card data-testid="card-forum-preview">
      <CardContent className="p-4">
        <div className="flex items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2 min-w-0">
            <MessageSquare className="w-5 h-5 text-emerald-500 flex-shrink-0" />
            <h3 className="text-base font-black text-foreground truncate" data-testid="text-forum-preview-title">
              Community Forum
            </h3>
          </div>
          <div className="flex items-center gap-3 flex-shrink-0 text-[11px] font-bold text-muted-foreground">
            <span className="flex items-center gap-1" data-testid="text-forum-preview-posts">
              <MessageSquare className="w-3 h-3 text-emerald-500" /> {comments.length}
            </span>
            <span className="flex items-center gap-1" data-testid="text-forum-preview-upvotes">
              <Flame className="w-3 h-3 text-orange-500" /> {totalUpvotes}
            </span>
          </div>
        </div>

        <p className="text-xs text-muted-foreground mb-3">
          Share alpha, ask questions, and vote up the best calls.
        </p>

        {isLoading ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-12 rounded-lg bg-muted animate-pulse" data-testid={`skeleton-forum-${i}`} />
            ))}
          </div>
        ) : topPosts.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center" data-testid="text-forum-preview-empty">
            No posts yet — be the first to share alpha.
          </p>
        ) : (
          <div className="space-y-2">
            {topPosts.map((c) => {
              const isEmailUser = c.walletAddress.startsWith("replit:");
              return (
                <div
                  key={c.id}
                  className="flex items-start gap-2.5 rounded-lg p-2.5 bg-muted/40 border border-border hover:border-emerald-300 dark:hover:border-emerald-700 transition-colors"
                  data-testid={`forum-preview-comment-${c.id}`}
                >
                  <button
                    onClick={() => upvoteMutation.mutate(c.id)}
                    className="group flex flex-col items-center flex-shrink-0 pt-0.5 hover:text-emerald-500 transition-colors text-muted-foreground"
                    data-testid={`button-forum-preview-upvote-${c.id}`}
                    title="Upvote this post"
                  >
                    <ChevronUp className="w-4 h-4 group-hover:text-emerald-500" />
                    <span className="text-[11px] font-bold leading-none">{c.upvotes}</span>
                  </button>

                  <div className="flex-shrink-0 w-7 h-7 rounded-full bg-emerald-500/15 flex items-center justify-center mt-0.5">
                    {isEmailUser
                      ? <User className="w-3.5 h-3.5 text-emerald-600" />
                      : <Wallet className="w-3.5 h-3.5 text-emerald-600" />}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="font-bold text-xs text-foreground truncate">{c.displayName}</span>
                      <span className="text-[10px] text-muted-foreground ml-auto flex-shrink-0">
                        {timeAgo(new Date(c.createdAt))}
                      </span>
                    </div>
                    <p className="text-xs text-foreground leading-snug mt-0.5 break-words line-clamp-2">
                      {censorText(c.message)}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <Link
          href="/forum"
          className="mt-3 flex items-center justify-center gap-1.5 w-full rounded-lg bg-foreground text-background py-2 text-xs font-bold hover:opacity-90 transition-opacity"
          data-testid="link-forum-view-all"
        >
          Open the forum
          <ArrowRight className="w-3.5 h-3.5" />
        </Link>
      </CardContent>
    </Card>
  );
}
