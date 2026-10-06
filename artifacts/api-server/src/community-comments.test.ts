import assert from "node:assert/strict";
import express from "express";
import { createServer, type Server } from "node:http";
import { Keypair } from "@solana/web3.js";
import { ed25519 } from "@noble/curves/ed25519";
import bs58 from "bs58";
import { registerRoutes } from "./routes/routes";
import { storage } from "./storage";

const parentCommentId = "post-parent";
const otherParentCommentId = "post-other";
const wallet = Keypair.generate();
const walletAddress = wallet.publicKey.toBase58();

type CommentInput = {
  parentCommentId?: string;
  walletAddress: string;
  displayName: string;
  message: string;
  category: "question" | "idea" | "discussion";
  taggedMint?: string;
};

const createdComments: CommentInput[] = [];
const consumedSignatures = new Set<string>();
const parentComments = new Map([
  [parentCommentId, { id: parentCommentId, parentCommentId: null }],
  [otherParentCommentId, { id: otherParentCommentId, parentCommentId: null }],
]);

function signedCommentBody(input: {
  signer?: Keypair;
  walletAddress?: string;
  displayName: string;
  message: string;
  category?: "question" | "idea" | "discussion";
  taggedMint?: string;
  parentCommentId?: string;
  nonce: number;
}) {
  const walletForMessage = input.walletAddress ?? walletAddress;
  const category = input.category ?? "question";
  const message = [
    "paif-comment", "v1", walletForMessage, input.displayName, input.message,
    category, input.taggedMint ?? "",
    ...(input.parentCommentId ? [input.parentCommentId] : []),
    String(input.nonce),
  ].join("|");
  const signature = bs58.encode(ed25519.sign(
    new TextEncoder().encode(message),
    (input.signer ?? wallet).secretKey.slice(0, 32),
  ));
  return {
    walletAddress: walletForMessage,
    displayName: input.displayName,
    message: input.message,
    category,
    ...(input.taggedMint ? { taggedMint: input.taggedMint } : {}),
    ...(input.parentCommentId ? { parentCommentId: input.parentCommentId } : {}),
    nonce: input.nonce,
    signature,
  };
}

async function responseJson(response: Response): Promise<any> {
  return response.json();
}

let httpServer: Server | undefined;
const originalGetComment = storage.getComment;
const originalCreateComment = storage.createComment;
const originalConsumeSignature = storage.consumeWalletWriteSignature;

try {
  const app = express();
  app.use(express.json());
  httpServer = createServer(app);

  storage.getComment = async (id: string) => parentComments.get(id) as any;
  storage.createComment = async (data: CommentInput) => {
    createdComments.push(data);
    return { id: `reply-${createdComments.length}`, ...data } as any;
  };
  storage.consumeWalletWriteSignature = async (signature: string, purpose: string, address: string) => {
    const receiptKey = `${purpose}:${address}:${signature}`;
    if (consumedSignatures.has(receiptKey)) return false;
    consumedSignatures.add(receiptKey);
    return true;
  };

  await registerRoutes(httpServer, app);
  await new Promise<void>((resolve) => httpServer!.listen(0, "127.0.0.1", resolve));
  const address = httpServer.address();
  assert(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}/api/comments`;
  let requestNumber = 0;

  const postComment = async (body: unknown) => {
    requestNumber += 1;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        // Keep the IP bucket independent from the wallet bucket so this test
        // can isolate the per-wallet throttle below.
        "x-forwarded-for": `198.51.100.${requestNumber}`,
      },
      body: JSON.stringify(body),
    });
    return { response, body: await responseJson(response) };
  };

  const validReply = signedCommentBody({
    displayName: "  Alice\u200b  ",
    message: "  A helpful reply\u200b  ",
    parentCommentId,
    nonce: Date.now(),
  });
  const accepted = await postComment(validReply);
  assert.equal(accepted.response.status, 200);
  assert.equal(accepted.body.parentCommentId, parentCommentId);
  assert.equal(accepted.body.message, "A helpful reply");
  assert.equal(accepted.body.displayName, "Alice");
  assert.equal(createdComments.at(-1)?.parentCommentId, parentCommentId);

  const replay = await postComment(validReply);
  assert.equal(replay.response.status, 401);
  assert.match(replay.body.error, /already used/);
  assert.equal(createdComments.length, 1);

  const crossParent = signedCommentBody({
    displayName: "Alice",
    message: "This signature belongs to the first post.",
    parentCommentId,
    nonce: Date.now() + 1,
  });
  const moved = await postComment({ ...crossParent, parentCommentId: otherParentCommentId });
  assert.equal(moved.response.status, 401);
  assert.match(moved.body.error, /Invalid wallet signature/);
  assert.equal(createdComments.length, 1);

  const unauthenticatedSessionIdentity = await postComment({
    walletAddress: "replit:not-authenticated",
    displayName: "Alice",
    message: "A reply without a wallet signature.",
    parentCommentId,
    nonce: Date.now(),
  });
  assert.equal(unauthenticatedSessionIdentity.response.status, 401);
  assert.match(unauthenticatedSessionIdentity.body.error, /Wallet signature required/);

  const moderatedReply = signedCommentBody({
    displayName: "Alice",
    message: "Please send me your seed phrase so I can help.",
    parentCommentId,
    nonce: Date.now() + 2,
  });
  const rejected = await postComment(moderatedReply);
  assert.equal(rejected.response.status, 422);
  assert.match(rejected.body.error, /seed phrases/);
  assert.equal(createdComments.length, 1);

  const throttleWallet = Keypair.generate();
  const throttleAddress = throttleWallet.publicKey.toBase58();
  const throttleReplies = Array.from({ length: 11 }, (_, index) => {
    const body = signedCommentBody({
      signer: throttleWallet,
      walletAddress: throttleAddress,
      displayName: "Throttled member",
      message: `A useful reply number ${index + 1}.`,
      parentCommentId,
      nonce: Date.now() + 10 + index,
    });
    return body;
  });
  const throttleResponses = [];
  for (const body of throttleReplies) throttleResponses.push(await postComment(body));
  assert.equal(throttleResponses.at(-1)?.response.status, 429);
  assert.equal(
    throttleResponses.slice(0, -1).every(({ response }) => response.status === 200),
    true,
  );
} finally {
  // Restore the singleton so importing this test alongside another test does
  // not leak the in-memory storage double.
  storage.getComment = originalGetComment;
  storage.createComment = originalCreateComment;
  storage.consumeWalletWriteSignature = originalConsumeSignature;
  if (httpServer?.listening) {
    await new Promise<void>((resolve) => httpServer!.close(() => resolve()));
  }
}

console.log("community signed-reply route tests passed");