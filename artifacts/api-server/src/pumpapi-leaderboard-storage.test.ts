import assert from "node:assert/strict";
import { inArray } from "drizzle-orm";
import { db } from "./db";
import {
  listPumpApiCreatorLeaderboard,
  savePumpApiLaunch,
  upsertPumpApiMarketSnapshot,
} from "./pumpapi-leaderboard-storage";
import { pumpApiCreatorLaunches, pumpApiMarketSnapshots } from "@workspace/db";

const creatorWallet = "StorageRegressionCreator1111111111111111111";
const mints = [
  "StorageRegressionMintFalseTrue11111111111111",
  "StorageRegressionMintTrueFalse11111111111111",
];
const now = new Date();

async function snapshot(mint: string, graduatedObserved: boolean, marketCap: number) {
  await upsertPumpApiMarketSnapshot({
    mint,
    volume24hUsd: 100,
    currentMarketCapUsd: marketCap,
    peakMarketCapUsd: marketCap,
    peakObservedAt: now,
    outcomeObservedAt: now,
    graduatedObserved,
    observedAt: now,
    lastAttemptAt: now,
    failure: null,
    pairCount: 1,
  });
}

async function cleanup() {
  await db.delete(pumpApiMarketSnapshots).where(inArray(pumpApiMarketSnapshots.mint, mints));
  await db.delete(pumpApiCreatorLaunches).where(inArray(pumpApiCreatorLaunches.mint, mints));
}

await cleanup();
try {
  for (const [index, mint] of mints.entries()) {
    await savePumpApiLaunch({
      eventKey: `storage-regression-${mint}`,
      signature: `storage-regression-signature-${index}`,
      mint,
      creatorWallet,
      pool: "pump",
      name: `Regression ${index}`,
      symbol: `REG${index}`,
      launchedAt: new Date(now.getTime() + index),
      source: "replay",
    });
  }

  await snapshot(mints[0], false, 1_000);
  await snapshot(mints[0], true, 2_000);
  await snapshot(mints[1], true, 3_000);
  await snapshot(mints[1], false, 1_500);

  const [creator] = await listPumpApiCreatorLeaderboard(
    "launches",
    1,
    "desc",
    [creatorWallet],
  );
  assert.ok(creator);
  assert.equal(creator.outcomeCoveredTokens, 2);
  assert.equal(creator.graduatedLaunchCount, 2, "graduation remains true in both observation orders");
  assert.equal(creator.graduatedLaunchRate, 1);
  assert.equal(creator.bestObservedToken?.mint, mints[1]);
  assert.equal(creator.bestObservedToken?.peakMarketCapUsd, 3_000, "later lower values cannot reduce the retained peak");
} finally {
  await cleanup();
}

console.log("pumpapi leaderboard storage regression tests passed");