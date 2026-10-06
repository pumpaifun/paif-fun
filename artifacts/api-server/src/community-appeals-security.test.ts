import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import bs58 from "bs58";
import { ed25519 } from "@noble/curves/ed25519";
import { eq, inArray } from "drizzle-orm";
import { db } from "./db";
import { storage } from "./storage";
import {
  authorizeCommunityAppealSignature,
  communityAppealSignatureMessage,
  verifyCommunityAppealSignature,
} from "./community-appeal-security";
import { requireModeratorUser } from "./security";
import { formatApiResponseLog, isSensitiveApiPath } from "./request-logging";
import { comments, communityAppeals } from "@workspace/db";

const privateKey = new Uint8Array(32).fill(7);
const walletAddress = bs58.encode(ed25519.getPublicKey(privateKey));
const nonce = Date.now();
const signedFields = {
  walletAddress,
  displayName: "Appeal Member",
  message: "Could someone explain this launch?",
  category: "question",
  appealReason: "This is a genuine educational question.",
};
const signature = bs58.encode(ed25519.sign(
  communityAppealSignatureMessage(signedFields, nonce),
  privateKey,
));

assert.equal(
  await verifyCommunityAppealSignature(
    walletAddress,
    signature,
    communityAppealSignatureMessage(signedFields, nonce),
  ),
  true,
  "the canonical appeal payload accepts its matching signature",
);

for (const [field, replacement] of [
  ["walletAddress", bs58.encode(ed25519.getPublicKey(new Uint8Array(32).fill(8)))],
  ["displayName", "Another Member"],
  ["message", "Changed blocked post"],
  ["category", "idea"],
  ["appealReason", "Changed appeal reason"],
] as const) {
  const changed = { ...signedFields, [field]: replacement };
  assert.equal(
    await verifyCommunityAppealSignature(
      walletAddress,
      signature,
      communityAppealSignatureMessage(changed, nonce),
    ),
    false,
    `changing ${field} invalidates the wallet authorization`,
  );
}

const consumedSignatures = new Set<string>();
const consumeSignature = async (usedSignature: string) => {
  if (consumedSignatures.has(usedSignature)) return false;
  consumedSignatures.add(usedSignature);
  return true;
};
assert.deepEqual(
  await authorizeCommunityAppealSignature({
    fields: signedFields,
    nonce,
    signature,
    consumeSignature,
    now: nonce,
  }),
  { ok: true },
);
assert.deepEqual(
  await authorizeCommunityAppealSignature({
    fields: signedFields,
    nonce,
    signature,
    consumeSignature,
    now: nonce,
  }),
  { ok: false, error: "Authorization already used" },
  "a valid appeal signature cannot be replayed",
);

const previousModeratorEmails = process.env.MODERATOR_EMAILS;
process.env.MODERATOR_EMAILS = "moderator@example.com";
try {
  const denials: Array<{ status: number; body: { error: string } }> = [];
  assert.equal(
    requireModeratorUser(
      { email: "member@example.com" },
      (status, body) => denials.push({ status, body }),
    ),
    false,
  );
  assert.deepEqual(denials, [{
    status: 403,
    body: { error: "Moderator access required" },
  }]);
  assert.equal(
    requireModeratorUser(
      { email: "MODERATOR@example.com" },
      () => assert.fail("an allowlisted moderator must not be denied"),
    ),
    true,
  );
} finally {
  if (previousModeratorEmails === undefined) delete process.env.MODERATOR_EMAILS;
  else process.env.MODERATOR_EMAILS = previousModeratorEmails;
}

const routesSource = readFileSync(new URL("./routes/routes.ts", import.meta.url), "utf8");
assert.match(
  routesSource,
  /app\.get\("\/api\/community-appeals", isAuthenticated,[\s\S]*?if \(!requireModerator\(req, res\)\) return;/,
  "listing appeals requires both session authentication and moderator authorization",
);
assert.match(
  routesSource,
  /app\.post\("\/api\/community-appeals\/:id\/resolve", isAuthenticated,[\s\S]*?if \(!requireModerator\(req, res\)\) return;/,
  "resolving appeals requires both session authentication and moderator authorization",
);

const secretAppealText = "blocked text must never reach logs";
for (const path of [
  "/api/community-appeals",
  "/api/community-appeals/mine",
  "/api/community-appeals/appeal-id/resolve",
]) {
  assert.equal(isSensitiveApiPath(path), true);
  const line = formatApiResponseLog({
    method: "POST",
    path,
    statusCode: 200,
    durationMs: 4,
    responseBody: { blockedMessage: secretAppealText, moderatorNote: "private note" },
  });
  assert.equal(line, `POST ${path} 200 in 4ms`);
  assert.equal(line.includes(secretAppealText), false);
  assert.equal(line.includes("private note"), false);
}

const marker = `appeal-regression-${Date.now()}`;
const appealIds: string[] = [];
const commentIds: string[] = [];
try {
  const declined = await storage.createCommunityAppeal({
    requesterWallet: walletAddress,
    displayName: "Declined Member",
    blockedMessage: `${marker}-declined`,
    category: "question",
    appealReason: "Please review the declined case.",
  });
  appealIds.push(declined.id);
  assert.equal(
    (await db.select().from(comments).where(eq(comments.message, `${marker}-declined`))).length,
    0,
    "submitting an appeal never publishes its blocked text",
  );

  const declinedResult = await storage.resolveCommunityAppeal({
    id: declined.id,
    status: "declined",
    moderatorNote: "This does not meet the community rules.",
    resolvedBy: "moderator-test",
  });
  assert.ok(declinedResult);
  assert.equal(declinedResult.publishedComment, undefined);
  assert.equal(declinedResult.appeal.status, "declined");
  assert.equal(declinedResult.appeal.blockedMessage, null);
  assert.equal(
    (await db.select().from(comments).where(eq(comments.message, `${marker}-declined`))).length,
    0,
    "declining discards the blocked text without publishing it",
  );

  const approved = await storage.createCommunityAppeal({
    requesterWallet: walletAddress,
    displayName: "Approved Member",
    blockedMessage: `${marker}-approved`,
    category: "idea",
    appealReason: "Please review the approved case.",
  });
  appealIds.push(approved.id);
  assert.equal(
    (await db.select().from(comments).where(eq(comments.message, `${marker}-approved`))).length,
    0,
  );

  const approvedResult = await storage.resolveCommunityAppeal({
    id: approved.id,
    status: "approved",
    moderatorNote: "Approved after review.",
    resolvedBy: "moderator-test",
  });
  assert.ok(approvedResult?.publishedComment);
  commentIds.push(approvedResult.publishedComment.id);
  assert.equal(approvedResult.appeal.status, "approved");
  assert.equal(approvedResult.appeal.blockedMessage, null);
  assert.equal(approvedResult.publishedComment.message, `${marker}-approved`);
  assert.equal(approvedResult.publishedComment.walletAddress, walletAddress);

  assert.equal(
    await storage.resolveCommunityAppeal({
      id: approved.id,
      status: "approved",
      resolvedBy: "moderator-test",
    }),
    undefined,
    "a resolved appeal cannot publish a second time",
  );
  assert.equal(
    (await db.select().from(comments).where(eq(comments.message, `${marker}-approved`))).length,
    1,
    "approval publishes exactly once through the resolution transaction",
  );

  const persisted = await db
    .select({
      id: communityAppeals.id,
      status: communityAppeals.status,
      blockedMessage: communityAppeals.blockedMessage,
    })
    .from(communityAppeals)
    .where(inArray(communityAppeals.id, appealIds));
  assert.equal(persisted.length, 2);
  assert.ok(persisted.every((appeal) => appeal.blockedMessage === null));
  assert.deepEqual(
    new Set(persisted.map((appeal) => appeal.status)),
    new Set(["approved", "declined"]),
  );
} finally {
  if (commentIds.length > 0) {
    await db.delete(comments).where(inArray(comments.id, commentIds));
  }
  if (appealIds.length > 0) {
    await db.delete(communityAppeals).where(inArray(communityAppeals.id, appealIds));
  }
}

console.log("community appeal security regression tests passed");