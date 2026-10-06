import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { User, Check, Loader2, AlertCircle } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import type { User as UserType } from "@shared/schema";

interface ProfileSetupModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ProfileSetupModal({ open, onOpenChange }: ProfileSetupModalProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [usernameStatus, setUsernameStatus] = useState<"idle" | "checking" | "available" | "taken" | "invalid">("idle");
  const [checkTimer, setCheckTimer] = useState<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (user) {
      setUsername(user.username || "");
      setDisplayName(user.firstName || "");
    }
  }, [user]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PATCH", "/api/auth/profile", {
        username: username.trim() || undefined,
        firstName: displayName.trim() || undefined,
      });
      return res.json();
    },
    onSuccess: (updated: UserType) => {
      queryClient.setQueryData(["/api/auth/user"], updated);
      onOpenChange(false);
    },
  });

  function handleUsernameChange(val: string) {
    const clean = val.replace(/[^a-zA-Z0-9_]/g, "").slice(0, 32);
    setUsername(clean);

    if (checkTimer) clearTimeout(checkTimer);

    if (!clean || clean.length < 3) {
      setUsernameStatus(clean.length > 0 ? "invalid" : "idle");
      return;
    }

    setUsernameStatus("checking");
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/auth/check-username/${clean}`, { credentials: "include" });
        if (res.ok) {
          const data = await res.json();
          setUsernameStatus(data.available ? "available" : "taken");
        }
      } catch {
        setUsernameStatus("idle");
      }
    }, 500);
    setCheckTimer(t);
  }

  const canSave =
    (username === "" || (username.length >= 3 && usernameStatus !== "taken" && usernameStatus !== "invalid")) &&
    !saveMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm" data-testid="dialog-profile-setup">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-full bg-emerald-500/10 flex items-center justify-center">
              <User className="w-4 h-4 text-emerald-600" />
            </div>
            <DialogTitle className="text-base font-bold" data-testid="text-profile-title">
              Set Up Your Profile
            </DialogTitle>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Choose a username and display name so others can recognize you in the community.
          </p>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold" htmlFor="input-display-name">Display Name</Label>
            <Input
              id="input-display-name"
              placeholder="e.g. CryptoKing"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              maxLength={50}
              data-testid="input-display-name"
            />
            <p className="text-[11px] text-muted-foreground">Shown next to your activity in the community feed.</p>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-semibold" htmlFor="input-username">Username</Label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">@</span>
              <Input
                id="input-username"
                placeholder="yourhandle"
                value={username}
                onChange={(e) => handleUsernameChange(e.target.value)}
                className="pl-7"
                data-testid="input-username"
              />
              <div className="absolute right-3 top-1/2 -translate-y-1/2">
                {usernameStatus === "checking" && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />}
                {usernameStatus === "available" && <Check className="w-3.5 h-3.5 text-emerald-500" />}
                {usernameStatus === "taken" && <AlertCircle className="w-3.5 h-3.5 text-red-500" />}
                {usernameStatus === "invalid" && <AlertCircle className="w-3.5 h-3.5 text-amber-500" />}
              </div>
            </div>
            {usernameStatus === "taken" && (
              <p className="text-[11px] text-red-500">That username is taken. Try another.</p>
            )}
            {usernameStatus === "invalid" && (
              <p className="text-[11px] text-amber-500">At least 3 characters (letters, numbers, underscores).</p>
            )}
            {usernameStatus === "available" && (
              <p className="text-[11px] text-emerald-500">@{username} is available!</p>
            )}
            {usernameStatus === "idle" && (
              <p className="text-[11px] text-muted-foreground">Letters, numbers, and underscores only.</p>
            )}
          </div>

          {saveMutation.isError && (
            <p className="text-[11px] text-red-500" data-testid="text-profile-error">
              {(saveMutation.error as any)?.message || "Failed to save profile. Try again."}
            </p>
          )}

          <div className="flex gap-2 pt-1">
            <Button
              variant="outline"
              className="flex-1 text-xs"
              onClick={() => onOpenChange(false)}
              disabled={saveMutation.isPending}
              data-testid="button-profile-skip"
            >
              Skip for now
            </Button>
            <Button
              className="flex-1 text-xs font-bold"
              onClick={() => saveMutation.mutate()}
              disabled={!canSave || saveMutation.isPending}
              data-testid="button-profile-save"
            >
              {saveMutation.isPending ? (
                <><Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />Saving...</>
              ) : (
                <><Check className="w-3.5 h-3.5 mr-1" />Save Profile</>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
