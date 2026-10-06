import { z } from 'zod';

export const mintSchema = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
const maybeNumber = z.preprocess(
  (value) => value === null || value === undefined || value === '' ? null : Number(value),
  z.number().finite().nullable(),
);
export const tokenSchema = z.object({
  mint: mintSchema,
  symbol: z.string(),
  name: z.string(),
  price: z.union([z.string(), z.number()]).transform(String),
  marketDataAt: z.string().nullable().default(null),
  change1h: maybeNumber,
  change5m: maybeNumber,
  mcap: maybeNumber,
  volume1h: maybeNumber,
  volume24h: maybeNumber,
  liquidity: maybeNumber,
  txns1h: maybeNumber,
  imageUrl: z.string().optional(),
  graduated: z.boolean().optional(),
});
export type Token = z.infer<typeof tokenSchema>;

const flagSchema = z.object({ severity: z.string(), label: z.string(), detail: z.string() });
const categorySchema = z.object({
  key: z.string(), label: z.string(), score: z.number().finite(),
  weight: z.number().finite(), detail: z.string(),
});
const riskSchema = z.object({
  score: z.number().min(0).max(100),
  band: z.enum(['low', 'medium', 'high']),
  confidence: z.enum(['low', 'medium', 'high']),
  grade: z.string(),
  flags: z.array(flagSchema),
  categories: z.array(categorySchema),
  sanctioned: z.boolean(),
  sanctionDetail: z.string().nullable(),
  sanctionsCoverage: z.string(),
  generatedAt: z.string(),
}).passthrough().transform((risk) => ({
  ...risk,
  level: risk.band,
  factors: risk.categories.map((category) => ({
    name: category.label, impact: category.score, detail: category.detail,
  })),
}));
export const scanSchema = z.object({
  tokenAddress: mintSchema,
  tokenName: z.string(),
  tokenSymbol: z.string(),
  tokenImage: z.string(),
  creatorAddress: z.string(),
  topHolderPercent: z.number().finite(),
  rating: z.enum(['green', 'yellow', 'red']).nullable(),
  ratingExplanation: z.string(),
  dataIncomplete: z.boolean(),
  topHolders: z.array(z.object({
    address: z.string(), percent: z.number().finite(),
    label: z.string().nullable().optional(), category: z.string().optional(),
  })),
  risk: riskSchema.nullable(),
  recentTransactions: z.array(z.object({
    signature: z.string(), type: z.string(), amount: z.number().finite(), timestamp: z.number().finite(),
  })),
  sentiment: z.unknown().optional(),
}).passthrough();
export type ScanResult = z.infer<typeof scanSchema>;

export interface Weather {
  available: boolean;
  solUsd?: number;
  solChg24?: number;
  btcChg24?: number;
  nasdaqChg1d?: number | null;
  mood?: string;
  fetchedAt?: number;
  facts?: string;
}
