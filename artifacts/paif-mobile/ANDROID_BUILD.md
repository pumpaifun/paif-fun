# PAIF.fun Android companion

## What this build is—and is not

The existing website remains PAIF.fun. This is a separate Android application
(`fun.paif.android`, version `1.0.0`, version code `1`). It reads PAIF's public
research endpoints, offers an independent on-device manual paper account, and
demonstrates Android Mobile Wallet Adapter authorization and message signing.
It does not trade real funds, send transactions, import private keys, port paid
bots, or treat a wallet address as backend authentication.

The icon and splash use the existing PAIF mascot. Manrope, Space Grotesk, DM Mono,
and both color palettes match the website.

## Backend configuration

The verified published origin is `https://www.paif.fun`, recorded in
`app.json` under `expo.extra.apiOrigin` and `walletIdentityUri`. A native build
can explicitly override the data origin using `EXPO_PUBLIC_API_URL` with an HTTPS
origin (never an API key). Set it at build time, not after bundling.

Browser preview requests use relative `/api/...` paths. Metro's companion-only
proxy forwards exactly these anonymous routes:

- `GET /api/trending-tokens`
- `GET /api/swing-bot/market-weather`
- `POST /api/scan` with a single bounded query

No cookies, authorization headers, paid operations, signing endpoints, or wallet
secrets are forwarded. The original website and API security policy are unchanged.
The Expo preview uses its own domain, separate from the website root.

## Local Android build (outside this workspace when tools are unavailable)

Use a machine with a supported Node.js version, pnpm, a compatible JDK and Android
SDK, and an Android device/emulator with an MWA-compatible wallet.

1. Install workspace packages at the repository root: `pnpm install --frozen-lockfile`.
2. Run the app's checks:
   `pnpm --filter @workspace/paif-mobile typecheck`
   and `pnpm --filter @workspace/paif-mobile test`.
3. In `artifacts/paif-mobile`, run `pnpm run android:check`.
4. Generate the native Android project: `pnpm exec expo prebuild --platform android`.
   Keep the package ID unchanged. Do not commit generated signing credentials.
5. With a local SDK configured, build a development client:
   `pnpm exec expo run:android`. MWA requires this custom native build; Expo Go
   can show research and practice but cannot supply the required Kotlin bridge.
6. For a standalone demonstration APK, follow the current Expo/React Native
   local release-build documentation and run the generated Gradle wrapper:
   `cd android && ./gradlew assembleRelease`.
   Check the generated release signing configuration. A generated debug signer
   is demonstration-only; do not represent it as an owner-signed store release.
   The output is normally under `app/build/outputs/apk/release/`.
7. For a submission/release APK, use the owner's private release signing key via
   local Gradle properties or the build environment, never through chat/source.
   Confirm the hackathon's current signing, package and distribution requirements
   rather than assuming that the browser preview meets them.

No EAS CLI or Replit iOS publishing flow is required or claimed for Android.
No Android APK has been created solely by configuring these scripts.

## Device acceptance checklist

Use a custom Android build on a physical phone (and the target Solana Mobile
device if required by the submission). Record device, OS, wallet and app versions.

- Discover loads real data; offline/failed API requests show errors with retry.
- Scan a valid Solana mint and Pump.fun link. Invalid addresses fail clearly.
- Risk confidence, incomplete evidence, historical snapshots and sanctions
  coverage remain visible; missing evidence never becomes a safety guarantee.
- Enter a manual paper buy with fresh positive pricing. Close the app, reopen,
  and confirm units, cost and cash persist. Sell with a new fresh quote and
  verify settled return. No wallet approval should occur for paper actions.
- Reject stale, future, missing and zero prices. A token leaving the discovery
  feed keeps its position; settlement is blocked until a verified quote returns.
  The first companion version deliberately has no separate quote source for
  tokens that leave the discovery feed.
- Test repeated taps, storage failures/corrupt storage, and explicit reset.
  Unreadable storage is never silently reset.
- Connect an installed MWA wallet, reject/cancel, test a missing wallet, approve
  the demo message, verify its exact displayed content and local signature.
- Switch wallet account and ensure signing fails until reconnecting. Disconnect
  clears local metadata and attempts wallet-side revocation; a failure is shown.
- Confirm no private keys/seeds are requested or stored. The demo proof must not
  unlock backend privileges or paid entitlements.
- Install the standalone APK without Metro, verify startup and data access, and
  check the icon, splash, back navigation, safe areas and text at narrow widths.

## Verification status

The workspace does not currently provide Java, adb or an Android SDK. The
prerequisite check reports these dependencies explicitly. Native APK creation,
physical-device wallet switching/signing, release signing, and hackathon
certification cannot be claimed from TypeScript checks or a browser preview.

Verified on 2026-10-05:

- TypeScript compilation and seven paper-ledger/message-verification tests passed.
- Expo package alignment and all 21 Expo Doctor checks passed.
- Android prebuild generated the native project, and autolinking recognized the
  Mobile Wallet Adapter native module.
- Android JavaScript/Hermes export completed successfully. This is a bundle,
  not an installable APK or proof of native Gradle compilation.
- At a 402×874 browser viewport, discovery loaded real data; research reported
  partial data, low confidence, and unavailable sanctions coverage honestly.
- A 100-chip buy, saved open position, full fresh-price sale, settled return and
  trade history all survived browser reloads. An over-budget amount was disabled.
- Browser wallet controls stayed disabled with the custom-Android-build notice;
  no native wallet approval/signing was claimed. No horizontal overflow was found.
