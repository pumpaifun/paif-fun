import assert from "node:assert/strict";
import { moderateCommunityPost } from "./security";

const rejected = (displayName: string, message: string, rule: string) => {
  const result = moderateCommunityPost(displayName, message);
  assert.equal(result.allowed, false);
  if (!result.allowed) assert.match(result.reason, new RegExp(rule));
};

rejected("Member", "Please send me your seed phrase so I can help recover the wallet.", "seed phrases");
rejected("PAIF.fun Support", "Connect your wallet at https://example.com/help.", "impersonate");
rejected("Member", "Claim your free tokens at https://example.com/airdrop now.", "unsafe or misleading links");
rejected("Member", "Buy buy buy buy buy buy now!", "useful and not repetitive");
rejected("Member", "Guaranteed profit. DM me for signals on Telegram.", "useful and not repetitive");

assert.equal(
  moderateCommunityPost("Ava", "How can I keep my seed phrase safe?").allowed,
  true,
);
assert.equal(
  moderateCommunityPost("Ava", "How do I verify that my recovery phrase backup is correct?").allowed,
  true,
);
assert.equal(
  moderateCommunityPost("Ava", "I never share my private key with anyone.").allowed,
  true,
);
assert.equal(
  moderateCommunityPost("Ava", "Could someone explain how Paper mode works?").allowed,
  true,
);
assert.equal(
  moderateCommunityPost("Moderator", "It would be helpful to compare Paper mode and Live mode.").allowed,
  true,
);
assert.equal(
  moderateCommunityPost("Ava", "Could we discuss investment returns and signals in general?").allowed,
  true,
);
assert.equal(
  moderateCommunityPost("Ava", "I found the docs helpful: https://docs.solana.com/").allowed,
  true,
);

console.log("community moderation tests passed");