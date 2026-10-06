CREATE TABLE IF NOT EXISTS "tokenized_stock_catalog" (
  "issuer" text NOT NULL,
  "mint" text NOT NULL,
  "issuer_asset_id" text NOT NULL,
  "name" text NOT NULL,
  "token_symbol" text NOT NULL,
  "underlying_ticker" text NOT NULL,
  "instrument_type" text,
  "logo_url" text,
  "trading_status" text NOT NULL,
  "availability_label" text NOT NULL,
  "price_usd" double precision,
  "liquidity_usd" double precision,
  "volume_24h_usd" double precision,
  "price_change_24h_pct" double precision,
  "market_data_observed_at" timestamp,
  "issuer_catalog_observed_at" timestamp NOT NULL,
  "last_attempt_at" timestamp NOT NULL,
  "market_data_source" text,
  "failure" text,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "uniq_tokenized_stock_issuer_mint"
  ON "tokenized_stock_catalog" ("issuer", "mint");
CREATE INDEX IF NOT EXISTS "idx_tokenized_stock_mint"
  ON "tokenized_stock_catalog" ("mint");
CREATE INDEX IF NOT EXISTS "idx_tokenized_stock_issuer_ticker"
  ON "tokenized_stock_catalog" ("issuer", "underlying_ticker");
CREATE INDEX IF NOT EXISTS "idx_tokenized_stock_liquidity"
  ON "tokenized_stock_catalog" ("liquidity_usd");
CREATE INDEX IF NOT EXISTS "idx_tokenized_stock_volume_24h"
  ON "tokenized_stock_catalog" ("volume_24h_usd");