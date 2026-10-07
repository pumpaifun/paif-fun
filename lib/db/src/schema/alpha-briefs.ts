import { sql } from "drizzle-orm";
import { pgTable, varchar, text, timestamp, integer, boolean, jsonb, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

export const alphaOversightBriefs = pgTable("alpha_oversight_briefs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  ownerWallet: text("owner_wallet").notNull(),
  generatedAt: timestamp("generated_at", { withTimezone: true }).defaultNow().notNull(),
  advisoryOnly: boolean("advisory_only").notNull().default(true),
  engine: text("engine").notNull(),
  confidence: integer("confidence").notNull(),
  riskLevel: text("risk_level").notNull(),
  recommendation: text("recommendation").notNull(),
  evidence: jsonb("evidence").notNull(),
}, (t) => ({
  byOwner: index("idx_alpha_briefs_owner").on(t.ownerWallet, t.generatedAt),
}));

export const insertAlphaOversightBriefSchema = createInsertSchema(alphaOversightBriefs).omit({ id: true, generatedAt: true });
export type AlphaOversightBriefRecord = typeof alphaOversightBriefs.$inferSelect;
