import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useWallet } from "@solana/wallet-adapter-react";
import {
  ArrowRight,
  BookOpen,
  Bot,
  ChevronUp,
  Check,
  Clock,
  HelpCircle,
  Lightbulb,
  Mail,
  MessageSquare,
  MessagesSquare,
  Reply,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  X,
  User,
  Wallet,
} from "lucide-react";
import { Header } from "@/components/header";
import { Footer } from "@/components/footer";
import { LoginModal } from "@/components/login-modal";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { signWalletWrite } from "@/lib/wallet-write-auth";
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
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function truncateWallet(address: string) {
  if (address.startsWith("replit:")) return "Email member";
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

function getPostErrorMessage(error: Error | null, fallback = "We could not publish that post. Please wait a moment and try again."): string {
  if (!error?.message) return fallback;
  const body = error.message.match(/^\d+:\s*(\{[\s\S]*\})$/)?.[1];
  if (!body) return fallback;
  try {
    const parsed = JSON.parse(body) as { error?: unknown };
    return typeof parsed.error === "string" ? parsed.error : fallback;
  } catch {
    return fallback;
  }
}

type RejectedPost = {
  walletAddress: string;
  displayName: string;
  message: string;
  category: ForumCategory;
};

type CommunityAppeal = {
  id: string;
  requesterWallet: string;
  displayName: string;
  blockedMessage: string | null;
  category: string;
  appealReason: string;
  createdAt: string;
};

type MemberAppeal = {
  id: string;
  category: ForumCategory;
  status: "pending" | "approved" | "declined";
  moderatorNote: string | null;
  createdAt: string;
  resolvedAt: string | null;
};

const HOW_TO_GUIDES = [
  {
    title: "Check a token before trading",
    description: "Paste a Solana token address to review risk, holders, liquidity, creator activity, and wallet signals.",
    href: "/scan",
    action: "Open Token Scanner",
    icon: ShieldCheck,
  },
  {
    title: "Practice an automated strategy",
    description: "Set up Swing Bot in Paper mode first, choose simple controls, and watch how entries and exits work.",
    href: "/swing-bot",
    action: "Learn Swing Bot",
    icon: Bot,
  },
  {
    title: "Explore new launches safely",
    description: "Review newly detected tokens, then use the scanner before deciding whether any launch deserves attention.",
    href: "/new-launches",
    action: "View New Launches",
    icon: Sparkles,
  },
  {
    title: "Understand wallets and creators",
    description: "Look up a wallet or inspect creator history to better understand who may be behind token activity.",
    href: "/wallets",
    action: "Search a Wallet",
    icon: Search,
  },
];

const QUICK_ANSWERS = [
  {
    question: "Where should I start?",
    answer: "Start with Learn Crypto, then scan a token. If you try a bot, use Paper mode before considering Live mode.",
    href: "/learn",
    link: "Go to Learn Crypto",
  },
  {
    question: "Does a green scan mean a token is safe?",
    answer: "No. A scan is decision support, not a guarantee. Conditions and wallet behavior can change after a scan.",
    href: "/scan",
    link: "Read a token report",
  },
  {
    question: "What is Paper mode?",
    answer: "Paper mode simulates trades without spending real funds. It is the safest way to learn how a strategy behaves.",
    href: "/swing-bot",
    link: "Practice with Paper mode",
  },
];

const CATEGORY_DETAILS = {
  question: {
    label: "Question",
    description: "Ask how a PAIF.fun feature works",
    icon: HelpCircle,
    className: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
  },
  idea: {
    label: "Idea",
    description: "Suggest an improvement or feature",
    icon: Lightbulb,
    className: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  },
  discussion: {
    label: "Discussion",
    description: "Start a useful community conversation",
    icon: MessagesSquare,
    className: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  },
} as const;

type ForumCategory = keyof typeof CATEGORY_DETAILS;
type ForumFilter = "all" | ForumCategory;
type ForumSort = "top" | "new";

function categoryFor(comment: Comment): ForumCategory {
  return comment.category in CATEGORY_DETAILS
    ? comment.category as ForumCategory
    : "question";
}

function CommentRow({
  comment,
  replies,
  onUpvote,
  isSignedIn,
  replying,
  replyInput,
  replyPending,
  replyMutationError,
  onReplyInputChange,
  onStartReply,
  onCancelReply,
  onSubmitReply,
  onSignIn,
}: {
  comment: Comment;
  replies: Comment[];
  onUpvote: (id: string) => void;
  isSignedIn: boolean;
  replying: boolean;
  replyInput: string;
  replyPending: boolean;
  replyMutationError: string | null;
  onReplyInputChange: (value: string) => void;
  onStartReply: () => void;
  onCancelReply: () => void;
  onSubmitReply: () => void;
  onSignIn: () => void;
}) {
  const isEmailUser = comment.walletAddress.startsWith("replit:");
  const category = CATEGORY_DETAILS[categoryFor(comment)];
  const CategoryIcon = category.icon;

  return (
    <div className="space-y-2" data-testid={`forum-thread-${comment.id}`}>
      <article
        className="flex items-start gap-3 rounded-2xl border border-border bg-card p-4 transition-colors hover:border-emerald-300 dark:hover:border-emerald-700"
        data-testid={`forum-comment-${comment.id}`}
      >
        <button
          onClick={() => onUpvote(comment.id)}
          className="group flex min-w-8 flex-col items-center text-muted-foreground transition-colors hover:text-emerald-600"
          data-testid={`button-forum-upvote-${comment.id}`}
          title="Upvote this post"
        >
          <ChevronUp className="h-5 w-5" />
          <span className="text-xs font-bold" data-testid={`text-forum-upvotes-${comment.id}`}>
            {comment.upvotes}
          </span>
        </button>

        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-emerald-500/15">
          {isEmailUser
            ? <User className="h-4 w-4 text-emerald-600" />
            : <Wallet className="h-4 w-4 text-emerald-600" />}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-bold text-foreground">{comment.displayName}</span>
            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${category.className}`}>
              <CategoryIcon className="h-3 w-3" />
              {category.label}
            </span>
            <span className="ml-auto flex-shrink-0 text-xs text-muted-foreground">
              {timeAgo(new Date(comment.createdAt))}
            </span>
          </div>
          <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground">
            {censorText(comment.message)}
          </p>
          <p className="mt-2 font-mono text-[10px] text-muted-foreground">
            {truncateWallet(comment.walletAddress)}
          </p>
          <div className="mt-3 flex items-center gap-3">
            <button
              type="button"
              onClick={isSignedIn ? onStartReply : onSignIn}
              className="inline-flex min-h-8 items-center gap-1.5 rounded-md px-2 text-xs font-bold text-emerald-700 transition-colors hover:bg-emerald-500/10 dark:text-emerald-300"
              aria-label={isSignedIn ? `Reply to ${comment.displayName}` : "Sign in to reply"}
              data-testid={`button-forum-reply-${comment.id}`}
            >
              <Reply className="h-3.5 w-3.5" />
              Reply
            </button>
            {replies.length > 0 && (
              <span className="text-xs text-muted-foreground">
                {replies.length} {replies.length === 1 ? "reply" : "replies"}
              </span>
            )}
          </div>

          {replying && (
            <div className="mt-3 space-y-2 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3">
              <Textarea
                autoFocus
                aria-label={`Reply to ${comment.displayName}`}
                placeholder="Write a helpful reply..."
                value={replyInput}
                onChange={(event) => onReplyInputChange(event.target.value)}
                maxLength={500}
                rows={3}
                data-testid={`input-forum-reply-${comment.id}`}
              />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground">{replyInput.length}/500</span>
                <div className="flex gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={onCancelReply}>
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    onClick={onSubmitReply}
                    disabled={!replyInput.trim() || replyPending}
                    className="font-bold"
                    data-testid={`button-forum-submit-reply-${comment.id}`}
                  >
                    {replyPending ? "Replying..." : "Reply"}
                  </Button>
                </div>
              </div>
              {replyMutationError && (
                <p className="text-xs font-semibold text-red-500" data-testid={`text-forum-reply-error-${comment.id}`}>
                  {replyMutationError}
                </p>
              )}
            </div>
          )}
        </div>
      </article>

      {replies.length > 0 && (
        <div className="ml-6 space-y-2 border-l-2 border-emerald-500/20 pl-3 sm:ml-12" aria-label={`Replies to ${comment.displayName}`}>
          {replies.map((reply) => (
            <article
              key={reply.id}
              className="flex items-start gap-3 rounded-xl border border-border/80 bg-muted/20 p-3"
              data-testid={`forum-reply-${reply.id}`}
            >
              <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-emerald-500/10">
                {reply.walletAddress.startsWith("replit:")
                  ? <User className="h-3.5 w-3.5 text-emerald-600" />
                  : <Wallet className="h-3.5 w-3.5 text-emerald-600" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-bold text-foreground">{reply.displayName}</span>
                  <span className="text-[10px] text-muted-foreground">{timeAgo(new Date(reply.createdAt))}</span>
                </div>
                <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground">
                  {censorText(reply.message)}
                </p>
                <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                  {truncateWallet(reply.walletAddress)}
                </p>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ForumPage() {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<ForumSort>("new");
  const [filter, setFilter] = useState<ForumFilter>("all");
  const [postCategory, setPostCategory] = useState<ForumCategory>("question");
  const [postInput, setPostInput] = useState("");
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyInput, setReplyInput] = useState("");
  const [customName, setCustomName] = useState("");
  const [loginOpen, setLoginOpen] = useState(false);
  const [rejectedPost, setRejectedPost] = useState<RejectedPost | null>(null);
  const [appealReason, setAppealReason] = useState("");
  const [moderatorNotes, setModeratorNotes] = useState<Record<string, string>>({});
  const [resolutionMessage, setResolutionMessage] = useState("");

  const { publicKey, connected, signMessage } = useWallet();
  const { user: authUser, isAuthenticated: isEmailAuth } = useAuth();
  const isSignedIn = Boolean((connected && publicKey) || isEmailAuth);
  const profileName = authUser?.username
    ? `@${authUser.username}`
    : authUser?.firstName || (publicKey ? truncateWallet(publicKey.toBase58()) : "");
  const appealOwner = connected && publicKey
    ? publicKey.toBase58()
    : authUser
      ? `replit:${authUser.id}`
      : "";

  const { data: comments = [], isLoading } = useQuery<Comment[]>({
    queryKey: ["/api/comments"],
    refetchInterval: 8000,
  });

  const upvoteMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await apiRequest("POST", `/api/comments/${id}/upvote`, {});
      return response.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/comments"] }),
  });

  const postMutation = useMutation({
    mutationFn: async (data: {
      walletAddress: string;
      displayName: string;
      message: string;
      category: ForumCategory;
    }) => {
      let body: typeof data & { nonce?: number; signature?: string } = data;
      if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(data.walletAddress)) {
        const auth = await signWalletWrite(signMessage ?? undefined, "paif-comment", [
          data.walletAddress,
          data.displayName,
          data.message,
          data.category,
          "",
        ]);
        body = { ...data, ...auth };
      }
      const response = await apiRequest("POST", "/api/comments", body);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/comments"] });
      setPostInput("");
    },
    onError: (error, variables) => {
      if (getPostErrorMessage(error).startsWith("This post was not published because")) {
        setRejectedPost(variables);
        setAppealReason("");
      }
    },
  });

  const appealMutation = useMutation({
    mutationFn: async (data: RejectedPost & { appealReason: string }) => {
      let body: typeof data & { nonce?: number; signature?: string } = data;
      if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(data.walletAddress)) {
        const auth = await signWalletWrite(signMessage ?? undefined, "paif-community-appeal", [
          data.walletAddress,
          data.displayName,
          data.message,
          data.category,
          data.appealReason,
        ]);
        body = { ...data, ...auth };
      }
      const response = await apiRequest("POST", "/api/community-appeals", body);
      return response.json() as Promise<{ message: string; appeal: MemberAppeal }>;
    },
    onSuccess: (result) => {
      setRejectedPost(null);
      setAppealReason("");
      postMutation.reset();
      setResolutionMessage(result.message);
      queryClient.setQueryData<MemberAppeal[]>(
        ["/api/community-appeals/mine", appealOwner],
        (current = []) => [result.appeal, ...current.filter((appeal) => appeal.id !== result.appeal.id)],
      );
    },
  });

  const replyMutation = useMutation({
    mutationFn: async (data: {
      walletAddress: string;
      displayName: string;
      message: string;
      parentCommentId: string;
    }) => {
      let body: typeof data & { category: ForumCategory; nonce?: number; signature?: string } = {
        ...data,
        category: "question",
      };
      if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(data.walletAddress)) {
        const auth = await signWalletWrite(signMessage ?? undefined, "paif-comment", [
          data.walletAddress,
          data.displayName,
          data.message,
          "question",
          "",
          data.parentCommentId,
        ]);
        body = { ...body, ...auth };
      }
      const response = await apiRequest("POST", "/api/comments", body);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/comments"] });
      setReplyInput("");
      setReplyingTo(null);
    },
  });

  const { data: moderationAppeals } = useQuery<CommunityAppeal[]>({
    queryKey: ["/api/community-appeals"],
    queryFn: async () => {
      const response = await fetch("/api/community-appeals", { credentials: "include" });
      if (!response.ok) throw new Error(`${response.status}: ${response.statusText}`);
      return response.json();
    },
    enabled: isEmailAuth,
    retry: false,
    staleTime: 30_000,
  });

  const memberAppealsQuery = useQuery<MemberAppeal[]>({
    queryKey: ["/api/community-appeals/mine", appealOwner],
    queryFn: async () => {
      let body: { walletAddress: string; nonce?: number; signature?: string } = {
        walletAddress: appealOwner,
      };
      if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(appealOwner)) {
        const auth = await signWalletWrite(
          signMessage ?? undefined,
          "paif-community-appeals-read",
          [appealOwner],
        );
        body = { ...body, ...auth };
      }
      const response = await apiRequest("POST", "/api/community-appeals/mine", body);
      return response.json() as Promise<MemberAppeal[]>;
    },
    enabled: Boolean(appealOwner && isEmailAuth && !connected),
    retry: false,
    staleTime: 30_000,
  });

  const resolveAppealMutation = useMutation({
    mutationFn: async (data: { id: string; status: "approved" | "declined"; moderatorNote: string }) => {
      const response = await apiRequest("POST", `/api/community-appeals/${data.id}/resolve`, {
        status: data.status,
        moderatorNote: data.moderatorNote || undefined,
      });
      return response.json() as Promise<{ message: string }>;
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/community-appeals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/comments"] });
      setResolutionMessage(result.message);
    },
  });

  const visibleComments = useMemo(() => {
    const query = search.trim().toLowerCase();
    const repliesByParent = new Map<string, Comment[]>();
    for (const comment of comments) {
      if (comment.parentCommentId) {
        const replies = repliesByParent.get(comment.parentCommentId) ?? [];
        replies.push(comment);
        repliesByParent.set(comment.parentCommentId, replies);
      }
    }
    return comments
      .filter((comment) => !comment.parentCommentId)
      .filter((comment) => filter === "all" || categoryFor(comment) === filter)
      .filter((comment) => (
        !query
        || comment.message.toLowerCase().includes(query)
        || comment.displayName.toLowerCase().includes(query)
        || (repliesByParent.get(comment.id) ?? []).some((reply) => (
          reply.message.toLowerCase().includes(query)
          || reply.displayName.toLowerCase().includes(query)
        ))
      ))
      .sort((a, b) => (
        sort === "top"
          ? b.upvotes - a.upvotes
          : new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      ));
  }, [comments, filter, search, sort]);

  function handleReply(parent: Comment) {
    if (!replyInput.trim() || !isSignedIn) return;

    const displayName = customName.trim() || profileName || (
      authUser?.email?.split("@")[0] || "Member"
    );
    const walletAddress = connected && publicKey
      ? publicKey.toBase58()
      : authUser
        ? `replit:${authUser.id}`
        : "";
    if (!walletAddress) return;

    replyMutation.mutate({
      walletAddress,
      displayName,
      message: replyInput.trim(),
      parentCommentId: parent.id,
    });
  }

  function handlePost() {
    if (!postInput.trim() || !isSignedIn) return;

    if (connected && publicKey) {
      const walletAddress = publicKey.toBase58();
      postMutation.mutate({
        walletAddress,
        displayName: customName.trim() || profileName || truncateWallet(walletAddress),
        message: postInput.trim(),
        category: postCategory,
      });
      return;
    }

    if (authUser) {
      postMutation.mutate({
        walletAddress: `replit:${authUser.id}`,
        displayName: customName.trim() || profileName || authUser.email?.split("@")[0] || "Member",
        message: postInput.trim(),
        category: postCategory,
      });
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />

      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
        <section className="mb-10 max-w-3xl">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-bold text-emerald-700 dark:text-emerald-300">
            <BookOpen className="h-3.5 w-3.5" />
            Learn, ask, and help shape PAIF.fun
          </div>
          <h1 className="font-serif text-4xl font-black tracking-tight text-foreground sm:text-5xl" data-testid="text-forum-title">
            Community Help & Ideas
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-relaxed text-muted-foreground">
            Learn how to use PAIF.fun, ask the community a question, or suggest what we should improve next.
            The guides are always available, and new community posts appear automatically.
          </p>
        </section>

        <section className="mb-12" aria-labelledby="how-to-heading">
          <div className="mb-5 flex items-end justify-between gap-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-600">Start here</p>
              <h2 id="how-to-heading" className="mt-1 text-2xl font-black text-foreground">How to use PAIF.fun</h2>
            </div>
            <Link href="/learn" className="hidden items-center gap-1 text-sm font-bold text-emerald-700 hover:underline dark:text-emerald-300 sm:inline-flex">
              View all learning tools <ArrowRight className="h-4 w-4" />
            </Link>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {HOW_TO_GUIDES.map((guide) => {
              const Icon = guide.icon;
              return (
                <Link key={guide.href} href={guide.href}>
                  <Card className="h-full cursor-pointer transition-all hover:-translate-y-0.5 hover:border-emerald-400 hover:shadow-md">
                    <CardContent className="p-5">
                      <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10">
                        <Icon className="h-5 w-5 text-emerald-600" />
                      </div>
                      <h3 className="font-bold text-foreground">{guide.title}</h3>
                      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{guide.description}</p>
                      <span className="mt-4 inline-flex items-center gap-1 text-xs font-bold text-emerald-700 dark:text-emerald-300">
                        {guide.action} <ArrowRight className="h-3.5 w-3.5" />
                      </span>
                    </CardContent>
                  </Card>
                </Link>
              );
            })}
          </div>
        </section>

        <section className="mb-12 grid gap-3 md:grid-cols-3" aria-label="Quick answers">
          {QUICK_ANSWERS.map((item) => (
            <Card key={item.question} className="bg-muted/30">
              <CardContent className="p-5">
                <h3 className="text-sm font-black text-foreground">{item.question}</h3>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{item.answer}</p>
                <Link href={item.href} className="mt-3 inline-flex items-center gap-1 text-xs font-bold text-emerald-700 hover:underline dark:text-emerald-300">
                  {item.link} <ArrowRight className="h-3 w-3" />
                </Link>
              </CardContent>
            </Card>
          ))}
        </section>

        <section aria-labelledby="community-heading" className="mx-auto max-w-3xl">
          <div className="mb-5">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-600">Community forum</p>
            <h2 id="community-heading" className="mt-1 text-2xl font-black text-foreground">Questions, ideas & discussions</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Posts are published automatically after sign-in and basic safety checks. Never share seed phrases or private keys.
            </p>
          </div>

          <Card className="mb-5 border-emerald-500/30">
            <CardContent className="p-4 sm:p-5">
              {isSignedIn ? (
                <div className="space-y-3">
                  <div className="grid gap-2 sm:grid-cols-3">
                    {(Object.keys(CATEGORY_DETAILS) as ForumCategory[]).map((category) => {
                      const detail = CATEGORY_DETAILS[category];
                      const Icon = detail.icon;
                      return (
                        <button
                          key={category}
                          type="button"
                          onClick={() => setPostCategory(category)}
                          className={`rounded-xl border p-3 text-left transition-colors ${
                            postCategory === category
                              ? "border-emerald-500 bg-emerald-500/10"
                              : "border-border hover:border-emerald-300"
                          }`}
                        >
                          <span className="flex items-center gap-2 text-xs font-black">
                            <Icon className="h-4 w-4 text-emerald-600" />
                            {detail.label}
                          </span>
                          <span className="mt-1 block text-[10px] leading-snug text-muted-foreground">{detail.description}</span>
                        </button>
                      );
                    })}
                  </div>

                  {!profileName && (
                    <Input
                      placeholder="Display name (optional)"
                      value={customName}
                      onChange={(event) => setCustomName(event.target.value)}
                      maxLength={30}
                      data-testid="input-forum-name"
                    />
                  )}

                  <Textarea
                    placeholder={
                      postCategory === "question"
                        ? "What would you like help with?"
                        : postCategory === "idea"
                          ? "What should PAIF.fun improve or add?"
                          : "Start a useful community discussion..."
                    }
                    value={postInput}
                    onChange={(event) => setPostInput(event.target.value)}
                    maxLength={500}
                    rows={4}
                    data-testid="input-forum-post"
                  />

                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs text-muted-foreground">
                      Posting as {profileName || customName || "Member"} · {postInput.length}/500
                    </span>
                    <Button
                      onClick={handlePost}
                      disabled={!postInput.trim() || postMutation.isPending}
                      className="gap-2 font-bold"
                      data-testid="button-forum-post"
                    >
                      <Send className="h-4 w-4" />
                      {postMutation.isPending ? "Posting..." : "Post to community"}
                    </Button>
                  </div>

                  {postMutation.isError && (
                    <p className="text-xs font-semibold text-red-500" data-testid="text-forum-post-error">
                      {getPostErrorMessage(postMutation.error)}
                    </p>
                  )}

                  {rejectedPost && (
                    <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3" data-testid="forum-appeal-form">
                      <p className="text-sm font-bold text-foreground">Think this was a mistake?</p>
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                        Ask a moderator to review it. Your post stays unpublished while it is reviewed, and the review request does not reveal which safety check stopped it.
                      </p>
                      <Textarea
                        className="mt-3 bg-background"
                        placeholder="Briefly explain why this post should be reviewed..."
                        value={appealReason}
                        onChange={(event) => setAppealReason(event.target.value)}
                        maxLength={1000}
                        rows={3}
                        data-testid="input-forum-appeal-reason"
                      />
                      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                        <span className="text-[11px] text-muted-foreground">{appealReason.length}/1000</span>
                        <Button
                          variant="outline"
                          onClick={() => appealMutation.mutate({ ...rejectedPost, appealReason: appealReason.trim() })}
                          disabled={!appealReason.trim() || appealMutation.isPending}
                          className="gap-2 font-bold"
                          data-testid="button-forum-submit-appeal"
                        >
                          <ShieldCheck className="h-4 w-4" />
                          {appealMutation.isPending ? "Sending..." : "Request moderator review"}
                        </Button>
                      </div>
                      {appealMutation.isError && (
                        <p className="mt-2 text-xs font-semibold text-red-500" data-testid="text-forum-appeal-error">
                          {getPostErrorMessage(appealMutation.error, "We could not send the review request. Please try again.")}
                        </p>
                      )}
                    </div>
                  )}

                  {resolutionMessage && (
                    <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-300" data-testid="text-forum-resolution-message">
                      {resolutionMessage}
                    </p>
                  )}
                </div>
              ) : (
                <div className="py-2 text-center">
                  <MessageSquare className="mx-auto h-8 w-8 text-emerald-600" />
                  <h3 className="mt-3 font-black text-foreground">Join the conversation</h3>
                  <p className="mt-1 text-sm text-muted-foreground">Sign in with email or a wallet to ask a question or share an idea.</p>
                  <div className="mx-auto mt-4 flex max-w-md flex-col gap-2 sm:flex-row">
                    <Button className="flex-1 gap-2 font-bold" onClick={() => setLoginOpen(true)} data-testid="button-forum-signin-email">
                      <Mail className="h-4 w-4" /> Sign in
                    </Button>
                    <Button variant="outline" className="flex-1 gap-2 font-bold" onClick={() => setLoginOpen(true)} data-testid="button-forum-signin-wallet">
                      <Wallet className="h-4 w-4" /> Connect wallet
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {isSignedIn && (
            <Card className="mb-5" data-testid="forum-member-appeals">
              <CardContent className="p-4 sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <ShieldCheck className="h-4 w-4 text-emerald-600" />
                      <h3 className="font-black text-foreground">Your review requests</h3>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Check whether a moderator approved or declined a post you asked us to review.
                    </p>
                  </div>
                  {connected && publicKey && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => memberAppealsQuery.refetch()}
                      disabled={memberAppealsQuery.isFetching}
                      className="font-bold"
                      data-testid="button-forum-check-appeals"
                    >
                      {memberAppealsQuery.isFetching
                        ? "Checking..."
                        : memberAppealsQuery.data
                          ? "Refresh status"
                          : "Check status"}
                    </Button>
                  )}
                </div>

                {memberAppealsQuery.isLoading && (
                  <p className="mt-4 text-sm text-muted-foreground">Loading your review requests...</p>
                )}

                {memberAppealsQuery.isError && (
                  <p className="mt-4 text-xs font-semibold text-red-500" data-testid="text-forum-member-appeals-error">
                    {getPostErrorMessage(memberAppealsQuery.error, "We could not load your review requests. Please try again.")}
                  </p>
                )}

                {memberAppealsQuery.data?.length === 0 && (
                  <p className="mt-4 rounded-lg bg-muted/40 p-3 text-sm text-muted-foreground">
                    You have not submitted any review requests with this account.
                  </p>
                )}

                {memberAppealsQuery.data && memberAppealsQuery.data.length > 0 && (
                  <div className="mt-4 space-y-3">
                    {memberAppealsQuery.data.map((appeal) => {
                      const detail = CATEGORY_DETAILS[appeal.category] ?? CATEGORY_DETAILS.discussion;
                      const isApproved = appeal.status === "approved";
                      const isDeclined = appeal.status === "declined";
                      return (
                        <div
                          key={appeal.id}
                          className="rounded-xl border border-border p-3"
                          data-testid={`forum-member-appeal-${appeal.id}`}
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-bold text-foreground">{detail.label}</span>
                              <span className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wide ${
                                isApproved
                                  ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                                  : isDeclined
                                    ? "bg-red-500/10 text-red-600 dark:text-red-300"
                                    : "bg-amber-500/10 text-amber-700 dark:text-amber-300"
                              }`}>
                                {appeal.status}
                              </span>
                            </div>
                            <span className="text-[11px] text-muted-foreground">
                              {appeal.resolvedAt
                                ? `Updated ${timeAgo(new Date(appeal.resolvedAt))}`
                                : `Sent ${timeAgo(new Date(appeal.createdAt))}`}
                            </span>
                          </div>
                          <p className="mt-2 text-sm text-muted-foreground">
                            {isApproved
                              ? "Approved — your post was published to the community."
                              : isDeclined
                                ? "Declined — the unpublished text was discarded."
                                : "Waiting for moderator review. Your post is still unpublished."}
                          </p>
                          {appeal.moderatorNote && (
                            <div className="mt-3 rounded-lg bg-muted/40 p-3">
                              <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Moderator note</p>
                              <p className="mt-1 whitespace-pre-wrap break-words text-sm text-foreground">{appeal.moderatorNote}</p>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          <div className="mb-4 flex flex-col gap-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search community posts..."
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="pl-9"
                data-testid="input-forum-search"
              />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap gap-1.5">
                {(["all", "question", "idea", "discussion"] as ForumFilter[]).map((value) => (
                  <Button
                    key={value}
                    variant={filter === value ? "default" : "outline"}
                    size="sm"
                    onClick={() => setFilter(value)}
                    className="text-xs font-bold"
                  >
                    {value === "all" ? "All posts" : CATEGORY_DETAILS[value].label}
                  </Button>
                ))}
              </div>
              <div className="flex gap-1.5">
                <Button variant={sort === "new" ? "default" : "outline"} size="sm" onClick={() => setSort("new")} className="gap-1 text-xs font-bold">
                  <Clock className="h-3.5 w-3.5" /> New
                </Button>
                <Button variant={sort === "top" ? "default" : "outline"} size="sm" onClick={() => setSort("top")} className="gap-1 text-xs font-bold">
                  <ChevronUp className="h-3.5 w-3.5" /> Top
                </Button>
              </div>
            </div>
          </div>

          <div className="space-y-3" data-testid="forum-feed">
            {isLoading && (
              <div className="py-10 text-center text-sm text-muted-foreground" data-testid="text-forum-loading">
                Loading community posts...
              </div>
            )}

            {!isLoading && visibleComments.length === 0 && (
              <div className="rounded-2xl border border-dashed border-border bg-muted/20 px-6 py-12 text-center text-muted-foreground" data-testid="text-forum-empty">
                <MessageSquare className="mx-auto mb-3 h-9 w-9 opacity-40" />
                {search.trim() || filter !== "all" ? (
                  <>
                    <p className="font-bold text-foreground">No matching community posts</p>
                    <p className="mt-1 text-xs">Try another search or category.</p>
                  </>
                ) : (
                  <>
                    <p className="font-bold text-foreground">The community board is ready</p>
                    <p className="mt-1 text-xs">There are no genuine posts yet. Sign in to ask the first question or share the first idea.</p>
                  </>
                )}
              </div>
            )}

            {visibleComments.map((comment) => (
              <CommentRow
                key={comment.id}
                comment={comment}
                replies={comments.filter((reply) => reply.parentCommentId === comment.id).sort(
                  (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
                )}
                onUpvote={(id) => upvoteMutation.mutate(id)}
                isSignedIn={isSignedIn}
                replying={replyingTo === comment.id}
                replyInput={replyingTo === comment.id ? replyInput : ""}
                replyPending={replyMutation.isPending && replyingTo === comment.id}
                replyMutationError={replyingTo === comment.id && replyMutation.isError
                  ? getPostErrorMessage(replyMutation.error)
                  : null}
                onReplyInputChange={setReplyInput}
                onStartReply={() => {
                  replyMutation.reset();
                  setReplyingTo(comment.id);
                  setReplyInput("");
                }}
                onCancelReply={() => {
                  setReplyingTo(null);
                  setReplyInput("");
                }}
                onSubmitReply={() => handleReply(comment)}
                onSignIn={() => setLoginOpen(true)}
              />
            ))}
          </div>
        </section>

        {moderationAppeals && (
          <section className="mx-auto mb-12 max-w-3xl" aria-labelledby="moderation-heading" data-testid="forum-moderation-panel">
            <div className="mb-4 flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-emerald-600" />
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-600">Moderator tools</p>
                <h2 id="moderation-heading" className="mt-1 text-2xl font-black text-foreground">Community review requests</h2>
              </div>
            </div>
            {moderationAppeals.length === 0 ? (
              <Card>
                <CardContent className="py-6 text-sm text-muted-foreground">No pending review requests.</CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {moderationAppeals.map((appeal) => (
                  <Card key={appeal.id} data-testid={`forum-appeal-${appeal.id}`}>
                    <CardContent className="space-y-3 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="font-bold text-foreground">{appeal.displayName}</p>
                          <p className="font-mono text-[10px] text-muted-foreground">{truncateWallet(appeal.requesterWallet)}</p>
                        </div>
                        <span className="text-xs text-muted-foreground">{timeAgo(new Date(appeal.createdAt))}</span>
                      </div>
                      <div className="rounded-lg bg-muted/40 p-3">
                        <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Blocked post</p>
                        <p className="mt-1 whitespace-pre-wrap break-words text-sm text-foreground">{appeal.blockedMessage || "[content unavailable]"}</p>
                      </div>
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Member's explanation</p>
                        <p className="mt-1 whitespace-pre-wrap break-words text-sm text-foreground">{appeal.appealReason}</p>
                      </div>
                      <Textarea
                        placeholder="Optional note for the member..."
                        value={moderatorNotes[appeal.id] || ""}
                        onChange={(event) => setModeratorNotes((current) => ({ ...current, [appeal.id]: event.target.value }))}
                        maxLength={1000}
                        rows={2}
                        data-testid={`input-forum-appeal-note-${appeal.id}`}
                      />
                      <div className="flex flex-wrap justify-end gap-2">
                        <Button
                          variant="outline"
                          onClick={() => resolveAppealMutation.mutate({
                            id: appeal.id,
                            status: "declined",
                            moderatorNote: moderatorNotes[appeal.id] || "",
                          })}
                          disabled={resolveAppealMutation.isPending}
                          className="gap-2 font-bold"
                          data-testid={`button-forum-decline-appeal-${appeal.id}`}
                        >
                          <X className="h-4 w-4" /> Decline
                        </Button>
                        <Button
                          onClick={() => resolveAppealMutation.mutate({
                            id: appeal.id,
                            status: "approved",
                            moderatorNote: moderatorNotes[appeal.id] || "",
                          })}
                          disabled={resolveAppealMutation.isPending || !appeal.blockedMessage}
                          className="gap-2 font-bold"
                          data-testid={`button-forum-approve-appeal-${appeal.id}`}
                        >
                          <Check className="h-4 w-4" /> Approve & publish
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </section>
        )}
      </main>

      <Footer />
      <LoginModal open={loginOpen} onOpenChange={setLoginOpen} />
    </div>
  );
}