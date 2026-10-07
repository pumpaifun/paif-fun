# PAIF.fun Android companion

For a fresh repository checkout, start with the root `README.md`.
The current evidence record is in root `SUBMISSION_CHECKLIST.md`.
Historical APK results below do not establish that the latest source has been
built or tested on a device.

## What this build is—and is not

The existing website remains PAIF.fun. This is a separate Android application
(`fun.paif.android`, version `1.0.0`, version code `1`). It reads PAIF's public
research endpoints, offers an independent on-device manual paper account, and
uses Android Mobile Wallet Adapter for owner signatures and wallet-approved
Solana transactions. The Research screen supports real Pump.fun bonding-curve
and Jupiter-routed buys and sells. A separate Bots screen can manage existing
owner-linked Swing Bots and automated strategies through their signed APIs.
Swing Bot setup/settings are available natively; scheduled auto-strategy setup
remains on PAIF.fun. Funding is a separate wallet action. The app never
imports or stores a user's private key and never treats a wallet address alone
as backend authentication.

The mobile setup is labeled **Swing**, with icon-only back navigation. Crypto
Swing controls include automatic or custom profit targets, profit set-aside,
loss cool-off, automatic or custom loss room and winner protection, recovery
holding, end-of-run token handling, optional extra buys and full-size hot-run
overrides. Creation also supports unlimited runs and watch-token comeback
re-entry with tighter or wider profit protection. Paper and owner approval
remain the scanner defaults; live creation does not fund or start a bot.
Creation-only choices are not silently changed by the running-bot editor.

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

## Repeatable Android APK build

Java 17 is installed in this Replit workspace, and the app's existing generated
Gradle wrapper runs successfully with it. The Android SDK is also installed under
`.cache/android-sdk`, with `ANDROID_HOME` set for development only. The SDK is
not committed to source control; reinstall it if the workspace cache is removed.
Java and the SDK are build tools; the APK is the installable app file.

Install Android Studio's SDK or Google's Android command-line tools. Set
`ANDROID_HOME` to the SDK directory. The SDK user must review and accept Google's
license terms using `sdkmanager --licenses`; the build script does not accept
terms automatically. With the current React Native version, install:

```sh
sdkmanager "platform-tools" "platforms;android-36" "build-tools;36.0.0" "ndk;27.1.12297006" "cmake;3.22.1"
```

Use the root-pinned Node 24.13.0 and pnpm 10.26.1. Linux x86-64 is the tested build
platform. From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm --filter @workspace/paif-mobile android:check
pnpm --filter @workspace/paif-mobile android:apk
```

The APK command checks prerequisites, compiles shared/mobile types, runs mobile
tests, generates the native project if absent, and invokes Gradle. It stops on
failure rather than claiming an APK exists. It uses the existing demonstration
debug signer, builds for `arm64-v8a` by default, and bundles JavaScript so Metro
is not required to use the APK. Output:
`artifacts/paif-mobile/android/app/build/outputs/apk/release/app-release.apk`.
Set `PAIF_ANDROID_ARCHITECTURES=x86_64` for an x86_64 emulator, or a comma-separated
list for multiple architectures. `adb` is optional for compilation and required
only for device installation. Updating code and rerunning the command rebuilds
the APK; it does not remotely update an already installed app.

The build uses one Gradle worker and disables parallel Gradle projects to reduce
peak resource use. `PAIF_ANDROID_GRADLE_WORKERS` accepts an integer from 1 to 4.
Stop unnecessary previews before a memory-intensive native build.

On the clean-clone check in this Replit host, OpenJDK 17.0.15 crashed with
`SIGBUS` in `PerfLongVariant::sample`, with the faulting address inside its
`/tmp/hsperfdata` mapping. Cgroup OOM counters remained zero. A subsequent retry
reached the C++ compiler, which explicitly reported `Disk quota exceeded` while
writing under `/tmp`, despite `df` showing free space. Free-space output does not
rule out a separate quota. Keep the checkout and build temporary files in workspace
storage, not `/tmp`. The targeted build-only retry uses:

```sh
mkdir -p .cache/android-tmp
TMPDIR="$PWD/.cache/android-tmp" \
JAVA_TOOL_OPTIONS="-XX:ActiveProcessorCount=2 -XX:-UsePerfData -Djava.io.tmpdir=$PWD/.cache/android-tmp" \
CMAKE_BUILD_PARALLEL_LEVEL=1 \
pnpm --filter @workspace/paif-mobile android:apk
```

These flags do not alter Android app behavior. The workspace-backed retry succeeded;
see the current evidence record for the measured results. Do not assume that flags
alone guarantee a successful build on another host.

For one APK containing phone and x86-64 emulator native libraries:

```sh
PAIF_ANDROID_ARCHITECTURES=arm64-v8a,x86_64 pnpm --filter @workspace/paif-mobile android:apk
```

The older dual-architecture test download is
`downloads/paif-android-phone-and-emulator-test.apk` (approximately 74 MB).
This older build includes the corrected wallet-safety notice and verified with
Android's APK signing tool. It predates the latest Swing changes and must not be
described as the updated submission APK. It remains debug-signed.

### Where these commands run

In this project, run commands in **Replit's Shell**, from the repository root.
The APK itself is installed on an Android phone or emulator; it is not opened
in a web browser. A rebuild creates a new file, which must be installed as an
update on the test device.

### Native smoke check

On a fully booted, healthy Android emulator with a matching APK architecture:

```sh
pnpm --filter @workspace/paif-mobile android:smoke
```

The command defaults to `emulator-5554` (`PAIF_ANDROID_SERIAL` can select another
emulator). It refuses owner phones, checks boot/framework readiness, installs
without clearing app data, launches PAIF and captures a screenshot/runtime log.
It does not install wallets, sign messages, approve actions, trade or publish.
Inspect the captured screenshot before claiming rendered UI; the script checks
process survival, not full app behavior.

The current Replit host has **no `/dev/kvm` hardware acceleration**. Two
software-emulator configurations were attempted on 2026-10-06:

- The initial headless two-core software-rendered emulator crashed before PAIF
  installation.
- A single-core, smaller-display configuration finished booting, but the Android
  package service failed during installation and then became unavailable.
  PAIF installation, startup and MWA interaction were not verified.

These are emulator/framework failures, not evidence of a PAIF runtime crash.
Further device verification should use a stable hardware-accelerated emulator
or a normal Android phone. No Seeker is required for general Android/MWA tests.
Do not describe a successful host build or a boot-completed flag as a passing
device test.

The official Solana Mobile development test wallet was obtained from
`solana-mobile/mobile-wallet-adapter`'s `v2.2.0` release and its published SHA-256
digest was verified. It was not installed or used because the emulator's package
service failed. Never use an owner's funded wallet for these automated checks.

This is a **debug-signed demonstration APK**, not a store submission or production
signing setup. No publishing, payment changes, funding or trades occur during
the build. The first native Gradle build finished successfully on 2026-10-06.
Compilation does not prove installation, startup or wallet behavior on a device.

## Manual Android build steps

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
- With a test wallet, request a Pump.fun quote and a graduated-token Jupiter
  quote. Check the displayed input, minimum receive, and slippage; cancel in the
  wallet and confirm nothing was sent. Approve a small test trade, verify its
  signature on Solana Explorer, and confirm an unknown confirmation state does
  not encourage an automatic resubmission.
- Unlock Swing Bots and automated strategies separately. Confirm each read
  session is signed by the connected owner, switching wallets clears access,
  and each start/pause/stop action requires a new signature.
- Create a crypto scanner and a single-token watch Swing Bot. Paper mode and
  scanner buy approval should be selected by default. A wallet-owned paper
  bot must still require an existing Access Pass or trial; do not bypass it.
- Edit a bot's saved name, position cap, scanner filters, approval choice,
  profit target, profit set-aside, and loss cool-off count. Reject signing and
  verify nothing was changed. Change owners during a request and confirm old
  responses cannot appear under the new owner. Stock-bot settings and
  scheduled auto-strategy creation remain website-only.
- Approve and dismiss pending scanner suggestions. Paper approvals simulate
  buys; live approvals must explicitly warn about a real buy at the current
  price and require a fresh owner signature bound to that exact suggestion.
- Create a live Swing Bot without sending funds or starting it automatically.
  Check its public funding address and server-recommended funding amount.
  Funding remains a separate action in the user's wallet; starting a funded
  bot requires the existing explicit live-start confirmation and signature.
- Interrupt a create/save/approval request. The app must warn that the outcome
  is unknown, never automatically retry, and require checking saved state
  before a new submission.
- Verify that a Swing Bot pause leaves positions open and pauses exits; its
  Stop action is clearly confirmed as sell-and-return-funds. For strategies,
  verify Cancel/withdraw is distinct from Sell everything, and that funds can
  only return to the owner fixed when the strategy was created.
- Confirm no private keys/seeds are requested or stored. A message signature
  must not be treated as a transaction approval or unlock paid entitlements.
- Install the standalone APK without Metro, verify startup and data access, and
  check the icon, splash, back navigation, safe areas and text at narrow widths.

## Verification status

As of 2026-10-06, Java 17 is installed and `./gradlew --version` succeeds with
Gradle 9.3.1. The Android SDK license was explicitly accepted by the user, and the
required SDK, NDK, CMake and packaging tools are installed and runnable.
The prerequisite check reports any missing build components. Physical-device
wallet switching/signing, production release signing, and hackathon
certification cannot be claimed from compilation or a browser preview.

### Latest clean-clone build — 2026-10-06

The current APK is `downloads/paif-android-swing-arm64-ab2586eb.apk` (49.33 MiB).
It contains the latest native Swing source, not native Invaders. Shared/mobile
type checks, all 28 mobile tests and all 7 build-helper tests passed; the regenerated
Android build completed 994 tasks successfully.

The APK signer verified its v2 demonstration signature. Package tools confirmed
`fun.paif.android`, version `1.0.0` / code `1`, API 24 minimum / API 36 target,
and `arm64-v8a`. The APK includes JavaScript/Hermes assets, `libhermesvm.so`,
MWA bridge classes, the latest full-sized hot-run label and native API configuration
pointing to the published service.

SHA-256:
`ab2586eb7d56115ab3a230781bf400499b40929077b0c6ffe7638da354032891`.

See root `SUBMISSION_CHECKLIST.md` for the clean-clone procedure, host limitations,
and full evidence record. No physical-device acceptance, native wallet interaction
or production signing is established by this successful build.

### Historical first native APK

Verified on 2026-10-06 for the first native APK:

- The repeatable `android:apk` command passed shared/mobile TypeScript checks
  and all 23 mobile tests, then completed Gradle `assembleRelease` successfully.
- Four separate build-script tests passed.
- Android's `apksigner verify --verbose` verified a valid APK Signature Scheme
  v2 signature. Signing is the generated demonstration debug signer, not an
  owner's production release key.
- Android package tools confirmed `fun.paif.android`, version `1.0.0`, version
  code `1`, minimum Android API `24`, target API `36`, and `arm64-v8a` native code.
- APK inspection confirmed the bundled Android JavaScript/Hermes assets,
  native React Native libraries and Solana Mobile Wallet Adapter bridge classes.
- A downloadable copy is available as `downloads/paif-android-demo.apk`
  (approximately 50 MB). Generated APKs are excluded from source control.
- No Android device or emulator was used. Installation, app startup without
  Metro, MWA wallet authorization/signing and Seeker-specific behavior remain
  unverified. An ordinary Android emulator with a compatible wallet can cover
  general Android/MWA tests; it is not proof of Seeker Seed Vault behavior.

Subsequent verification on 2026-10-06:

- A second native build succeeded for both `arm64-v8a` and `x86_64`. Its APK
  signature verified and package metadata confirmed both architectures.
- Six build/smoke-helper tests passed. The mobile's 23 tests and TypeScript
  checks passed before the updated native build.
- Software-emulator verification was attempted but blocked by the emulator
  and Android framework failures described above. Native app installation,
  startup, authorization, signing and paper persistence remain unverified.
- See `HACKATHON_READINESS.md` for the official submission materials, deadline
  and distinction between hackathon entry and later dApp Store publication.

Historical verification before the native APK build follows.

Verified on 2026-10-05:

- TypeScript compilation and 11 paper-ledger, trade-amount, wallet-proof, and
  owner-signature-protocol tests passed.
- Expo package alignment and all 21 Expo Doctor checks passed.
- Android prebuild generated the native project, and autolinking recognized the
  Mobile Wallet Adapter native module.
- The Android JavaScript/Hermes export completed successfully with the live
  trade and bot screens included. This is a bundle, not an installable APK or
  proof of native Gradle compilation. The APK prerequisite check confirmed
  Java, adb, and `ANDROID_HOME` are unavailable in this workspace.
- At a 402×874 browser viewport, discovery loaded real data; research reported
  partial data, low confidence, and unavailable sanctions coverage honestly.
- A 100-chip buy, saved open position, full fresh-price sale, settled return and
  trade history all survived browser reloads. An over-budget amount was disabled.
- Browser wallet controls stayed disabled with the custom-Android-build notice;
  no native wallet approval/signing or live trade was claimed. No horizontal
  overflow was found.

Verified on 2026-10-06 for Android bot setup/settings:

- Shared OpenAPI client generation, shared-library types and mobile TypeScript
  checks passed. No website, Stripe, database schema, or backend route behavior
  was changed.
- All 23 mobile tests passed, including paper-first defaults, owner-signature
  messages, scanner/watch payload separation, editable versus immutable fields,
  saved-setting round trips, generated request serialization, entitlement
  rejection, and unknown-outcome/timeout handling without retries.
- Android JavaScript/Hermes export completed with the setup and settings screen
  included. Solana dependency export-map fallback warnings remained nonfatal.
- The phone-size browser preview rendered the setup form with paper selected
  and submission disabled for its unsupported wallet environment. The first
  capture during Metro/font startup was blank; the warmed capture rendered.
- This setup-screen verification did not include a rebuilt native APK or device
  wallet/backend mutation flows. Java/SDK tools are now installed, but the
  latest source must still be rebuilt and tested on a real phone.
