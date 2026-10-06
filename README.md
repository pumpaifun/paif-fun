# PAIF.fun

A token research and trading-tools platform for the Solana ecosystem, with BNB token research and a separate Android companion.

Live product: [paif.fun](https://www.paif.fun)

## What is in this repository

- **Web app** — token research, wallet and market activity, risk disclosures, education, community, and trading tools.
- **API server** — market and research endpoints, data services, and backend bot services used by the web product.
- **Android app** — an Expo companion with live research, risk disclosures, an on-device paper-trading ledger, and a source-level Solana Mobile Wallet Adapter authorization/signing demo.
- **Shared workspace packages** — database schema, types, scripts, and utilities used across the products.

The Android companion is a separate app, not a replacement for the website. Its current scope does **not** include real token buys or sells, Swing Bot control, or autonomous-strategy execution. The paper ledger does not move funds. Check the [Android build and verification guide](artifacts/paif-mobile/ANDROID_BUILD.md) for supported behavior and known device/build limitations.

## Development

Requires Node.js and pnpm. From the repository root:

```sh
pnpm install --frozen-lockfile
```

Run an individual workspace app with its corresponding command:

```sh
pnpm --filter @workspace/paif-web run dev
pnpm --filter @workspace/api-server run dev
pnpm --filter @workspace/paif-mobile run dev
```

The API server needs its development database and server-side provider configuration. Keep credentials in a secrets manager or an untracked local environment file; never commit keys, wallet seeds, or signing material.

## Mobile checks

```sh
pnpm --filter @workspace/paif-mobile typecheck
pnpm --filter @workspace/paif-mobile test
```

For Android native build prerequisites, prebuild steps, and the device acceptance checklist, see [ANDROID_BUILD.md](artifacts/paif-mobile/ANDROID_BUILD.md). The workspace verified Expo prebuild and JavaScript export but did not produce a signed or installable APK; physical-device MWA behavior has not been certified here.

## Risk notice

Crypto assets and trading involve substantial risk. Research data can be incomplete or stale and is not a safety guarantee or investment advice. Paper results are simulations, not evidence of live execution or returns.
