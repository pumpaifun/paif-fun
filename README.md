# PAIF.fun

PAIF.fun provides Solana token research, paper practice, wallet-approved trading,
and owner-linked trading tools. This repository contains a **native Expo /
React Native Android companion**, the existing website, and shared/backend source.
It is not a PWA or a website packaged in a WebView.

## Android: clone, build, install

```sh
git clone https://github.com/pumpaifun/paif-fun.git
cd paif-fun
```

After installing dependencies, `pnpm run validate:product` checks the shared
libraries, API, website, and mobile app and runs their product tests. It does not
include the separate design sandbox. The broader all-workspace `pnpm validate`
also checks that sandbox, which currently has mixed React declaration errors.
Do not treat a product-check pass as a pass for the experimental canvas.

The current API strict type-check also reports existing external-response and
storage-payload typing errors. Therefore `validate:product` is not fully green
yet, even though the API bundle and the tested contracts build/pass. The verified
website build command is:

```sh
PORT=5173 BASE_PATH=/ pnpm --filter @workspace/paif-web build
pnpm --filter @workspace/api-server build
```

Building is not the same as self-hosting: the API still needs its own PostgreSQL
database, authentication/provider configuration, and service routing. Private
configuration is intentionally not included in GitHub.

The repeatability check uses **Linux x86-64**, Node **24.13.0**, pnpm **10.26.1**,
JDK **17**, and the Android SDK. Windows reviewers can use Linux through WSL2 for
compilation and Windows platform-tools for phone installation. Native Windows and
macOS installs are not verified; the workspace currently excludes several
non-Linux native dependency binaries. Do not assume cross-platform installation
from this test.

1. Clone the submitted GitHub repository into a normal workspace/home directory
   and open its root. Avoid `/tmp` on this Replit host: its separate quota blocked
   native compilation despite `df` showing free space.
   A private repository requires access for the judges.
2. Install Node 24.13.0 (`nvm install && nvm use` if using nvm), then enable
   Corepack: `corepack enable`. The root package pins pnpm 10.26.1.
3. Install JDK 17 and Android Studio's SDK or Google's Android command-line tools.
   Set `JAVA_HOME` and `ANDROID_HOME` to your own installed tool locations.
   Review and accept the SDK licenses yourself with `sdkmanager --licenses`.
4. Install these SDK components:

   ```sh
   sdkmanager "platform-tools" "platforms;android-36" "build-tools;36.0.0" "ndk;27.1.12297006" "cmake;3.22.1"
   ```

5. From the repository root:

   ```sh
   pnpm install --frozen-lockfile
   pnpm --filter @workspace/paif-mobile android:check
   mkdir -p .cache/android-tmp
   TMPDIR="$PWD/.cache/android-tmp" \
   JAVA_TOOL_OPTIONS="-XX:ActiveProcessorCount=2 -XX:-UsePerfData -Djava.io.tmpdir=$PWD/.cache/android-tmp" \
   CMAKE_BUILD_PARALLEL_LEVEL=1 \
   pnpm --filter @workspace/paif-mobile android:apk
   ```

   The build runs shared/mobile type checks and mobile tests, generates the
   ignored Android project when missing, and builds a standalone **arm64-v8a**
   APK. JavaScript is bundled; Metro and Replit are not needed to start this APK.
   Internet access is needed for dependency downloads and live data.
   One Gradle worker is the default to reduce resource use.
   The build-only Java flags limit reported CPU count and disable performance-data
   mapping. The targeted retry also moves temporary files into workspace storage.
   These settings do not change the Android app. On a healthy host the unprefixed
   `pnpm --filter @workspace/paif-mobile android:apk` command is also available.

6. With USB debugging enabled and a compatible Android phone connected:

   ```sh
   adb devices
   adb install -r artifacts/paif-mobile/android/app/build/outputs/apk/release/app-release.apk
   adb shell monkey -p fun.paif.android -c android.intent.category.LAUNCHER 1
   ```

   Select a device with `adb -s DEVICE_SERIAL ...` if more than one is connected.
   Installation updates the app; it does not deliberately clear its data. If an
   older install uses a different signing key, **do not uninstall it blindly**:
   uninstalling can erase local paper positions and settings.

The APK is **debug-signed for demonstration**, not an owner-signed store release.
Never commit release keys, wallet recovery phrases, API secrets, or `.env` files.
The APK path is `artifacts/paif-mobile/android/app/build/outputs/apk/release/app-release.apk`.
Supported minimum Android API is 24 (Android 7.0); the default APK needs arm64.

## Running and reviewing the companion

The native app defaults to the public PAIF.fun API origin in its app configuration.
No private API keys are required to compile the app or use anonymous research and
the independent manual Paper account. This is **not a self-hosted backend setup**.
Hosted data, wallet-owned bots, and paid tools depend on the PAIF service.
An optional HTTPS `EXPO_PUBLIC_API_URL` override must be supplied at build time.

Mobile Wallet Adapter requires a compatible installed Android wallet and the
custom native APK, not Expo Go or a browser preview. Message signing proves wallet
ownership but is not an on-chain transaction. Live trades, bot actions, and funding
need separate explicit owner approval. Access Pass/trial rules remain unchanged.

## Payments and tokenized stocks

Stripe card checkout is for the existing paper-tool Access Passes, not wallet
funding, token/stock purchases, or a trading balance. Every pass duration has the
same eligible paper-tool access. The tokenized-stock bot remains paper-only.

A Stripe connection alone is not live-payment readiness. Sandbox checkout,
durable server-side fulfillment (including a customer who does not return after
payment), refunds/disputes, and the published return/webhook URLs must be verified
before launch. The current card integration confirms a paid session when the
browser returns; a durable webhook/reconciliation path is still outstanding.
The repository does not include Stripe credentials. Live activation requires
Stripe business verification and confirmation that PAIF's actual crypto/trading
offerings are permitted. Access-pass wording is not a substitute for approval.

Android includes Discover/research, Paper, Wallet, and native Swing setup/settings.
The **PAIF Invaders meter change is in the website**; there is no native Invaders
screen in this APK. The repository includes that website change without
misrepresenting it as an Android feature.

For a native development client (not the standalone demonstration):

```sh
pnpm --filter @workspace/paif-mobile android
```

This starts the Expo Android development workflow and requires a connected device
or healthy emulator. It is not physical-device acceptance evidence by itself.

## Verification and submission

- [Android build details and acceptance checklist](artifacts/paif-mobile/ANDROID_BUILD.md)
- [Submission checklist, review status, and three-minute demo plan](SUBMISSION_CHECKLIST.md)
- [Organizer requirements, eligibility, and legal sources](artifacts/paif-mobile/HACKATHON_READINESS.md)

A build, a browser preview, and a real-phone test are different checks. Until
recorded in the checklist, do not claim phone startup, wallet interaction, or
full bot create/edit behavior has been verified.

## Source ownership and licensing

The root package currently labels its license `MIT`, but this repository has no
top-level `LICENSE` file. This documentation does not add an evaluation license,
change that label, or settle the owner's intended reuse terms. Resolve this before
publishing source. Each third-party dependency retains its own license.

The hackathon requires accessible source for judging; its terms do not require
charging people to use the code. The organizer's portal describes public
repositories and connected private repositories. Private submission is not a
confidentiality agreement: submitted materials are subject to the organizer's
judging/publicity license and non-confidentiality terms.
