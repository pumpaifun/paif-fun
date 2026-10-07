# PAIF.fun Android — submission checklist

## Build requirements

- Native Android APK, not a PWA/WebView wrapper.
- Solana Mobile Stack and Mobile Wallet Adapter integration.
- Meaningful Solana network interaction, demonstrated with real evidence.
- Mobile-specific design: native navigation/forms, Android wallet handoff,
  safe-area handling, and a persistent on-device Paper account.
- Functional app installed on a real Android phone for the recorded demo.

Existing code uses Expo/React Native and the Android MWA bridge. Integration in
source or an APK does not prove successful wallet handoff on a device.
The responsive website's Invaders game is not a native Android screen.

## Four required submission items

| Item | Completion condition | Current status |
| --- | --- | --- |
| Android APK | Fresh APK with current changes; install and run on an actual phone | Fresh arm64 APK built and signature/runtime inspected; actual-phone acceptance remains outstanding |
| GitHub source repository | Judges can access it, clone, install, and reproduce the Android build | Sanitized local clone installed and built successfully on Linux; no GitHub remote selected or upload approved |
| Three-minute demo video | Shows the actual installed app, wallet interaction and Solana functionality; paper clearly labeled | Not recorded |
| Pitch deck or brief presentation | Explains the problem, users, native product, Solana integration and limitations | Outline below; final shareable presentation not yet produced |

Before final submission, paste the four actual URLs into the portal and check them
from a separate browser/account with the same access judges will have. The APK URL
should download the APK directly, not a workspace preview or an inaccessible file.
The portal's repository-review UI supports public repositories and private
repositories accessed through a team member's connected GitHub App.

## Deadline and eligibility checks

- The live portal schedule was fetched on October 6, 2026 and gives
  **October 12, 2026 at 6:59 AM CDT (America/Chicago)**,
  equivalent to `2026-10-12T11:59:00.000Z`. The older announcement says October 8.
  Recheck the portal before submission because the organizer can change deadlines.
  [Live schedule data](https://align-api.radiant.nexus/hackathons/H5jQCFppZBd6wq2XLpazBjJMeLAn1HJSmrT9PpTLM1kb/dates)
- Read [the full current terms](https://solanamobile.radiant.nexus/legal/clock-in-terms.pdf)
  and [official portal](https://solanamobile.radiant.nexus/).
- Verify the project's start date against the three-month age rule. With the
  September 8 launch, the terms require a start no earlier than June 8, 2026.
  Existing web products also need significant new mobile development.
  Do not assume that a new Android companion automatically settles the age rule.
- Confirm the team roster and representative before submitting; the roster becomes
  fixed at submission. Only one entry is allowed per contestant.
- Disclose funding accurately: venture/angel-funded teams are ineligible for USDC
  prizes under the current terms.
- Finalists must complete the organizer's required verification/KYC. Winning apps
  subject to publication must be listed on the dApp Store within 30 calendar days
  of the first public winner announcement, unless a written extension is granted.

## Clean-clone review protocol

1. Assemble only current application/shared/backend source, build configuration,
   lockfile, required imported images, tests, and these instructions.
2. Exclude `.agents`, unrelated screenshots/uploads, `.migration-backup`,
   generated mockups, `.replit`, dependencies, caches, native outputs, and keys.
   Do not remove an image that the application actually imports.
3. Commit this review snapshot in a **temporary local repository**, not the
   owner's working branch or GitHub. Clone it into another empty directory.
4. Run `pnpm install --frozen-lockfile`, then build through `android:apk`.
   Run `test:android-build` for the build-helper safeguards.
5. Inspect the new APK's signer, package, version, ABI and bundled runtime.
6. Record results below. A local clone is not proof that the final GitHub URL,
   access settings, and submitted commit are correct; recheck those before submission.

## Verification record

Verified on October 6, 2026:

- A selected-source local repository was cloned into an empty directory.
  `pnpm install --frozen-lockfile` succeeded with Node 24.13.0 / pnpm 10.26.1.
  The dependency tree was new; the existing pnpm store, SDK and Gradle dependency
  caches were reused. This was not an all-downloads-from-zero or remote-GitHub test.
- Shared/mobile TypeScript checks, all **28 mobile tests**, and all **7 build-helper
  tests** passed. **351 selected source/config/asset files** matched the current
  workspace, excluding documentation and ignore-rule updates.
- Initial `/tmp` builds hit a Java performance-data crash and then an explicit
  disk-quota error. The clone was moved into workspace cache, generated native
  caches were cleared, and the Android project regenerated. Workspace-backed
  temporary files and the Java flags in the README were used.
- Gradle `assembleRelease` completed successfully: **994 tasks executed**.
- Fresh APK: `downloads/paif-android-swing-arm64-ab2586eb.apk`,
  **49.33 MiB**, debug-signed for demonstration.
- SHA-256: `ab2586eb7d56115ab3a230781bf400499b40929077b0c6ffe7638da354032891`.
- Android's APK signer verified a valid v2 signature. Package inspection confirmed
  `fun.paif.android`, version `1.0.0`, version code `1`, minimum API `24`, target API
  `36`, and only `arm64-v8a`.
- APK inspection confirmed bundled JavaScript, the Hermes VM library, Android
  MWA bridge classes, the latest full-sized hot-run Swing label, and the published
  API origin in native `assets/app.config`. The Invaders phone/desktop meter change
  is included in website source, not a native Android screen.
- The public hosted trending endpoint returned HTTP 200. All five paused workflows
  were restored, and mobile/web phone-size browser previews rendered.
  Expo's optional desktop DevTools reported a missing GTK library; browser
  resource/auth warnings were nonfatal and do not establish native-device behavior.

The local source-review repository is preserved in `.cache/paif-submission-source`.
Generated packages/caches and APKs remain excluded from the source snapshot.
No GitHub push, source-license change, payment change, funding, or test trade occurred.

After the Alpha oversight merge and homepage readability fix, the local source
snapshot was refreshed. Current shared/mobile type checks and all 28 mobile tests
passed, as did the website's paper-exit tests. The existing WebCrypto buffer-type
errors were subsequently fixed using byte-preserving copies. Website type checks
and synthetic legacy-vault/derivation compatibility tests passed. The APK evidence above refers to the
previous verified native build, not a new build of this refreshed snapshot.

Physical device, Android version, startup without Metro, wallet connect/reject/sign,
paper persistence, and bot create/edit/cancel: **not verified**. No healthy emulator
or physical Android phone has passed those native acceptance checks in this workspace.
See the Android build guide.
## Fresh public-source verification — 2026-10-06

The existing `pumpaifun/paif-fun` repository was cloned and refreshed with current
product source without removing remote-only files or replacing its history.
Frozen-lockfile dependency installation passed. Shared declarations were rebuilt.
Website and mobile type checks passed, as did the website paper-exit and three
synthetic wallet-compatibility tests, all 28 mobile tests, the API test command,
and all seven community/market contract checks. Website and API bundles built,
and the Android JavaScript/assets export completed.

The strict API type-check still reports 77 existing errors, reproduced in the
main workspace as well as the verification copy. The design sandbox separately
has React declaration conflicts. Neither full product validation nor the broader
all-workspace check is claimed to pass. This verification did not produce a new
native APK or certify physical-phone behavior.

The connected Stripe account is a sandbox, not evidence of live-account approval.
Live charging, paid-session webhooks/reconciliation, and refund/dispute handling
are not claimed ready. No charges or Stripe products were created in this check.

## Three-minute real-phone demo plan

Use the actual installed APK and a deliberately chosen test wallet. Never show
recovery phrases, private keys, a signing-key password, or other private information.
Do not bypass Access Pass/trial requirements or create/fund/start a live bot for testing.

| Time | Show | Explain |
| --- | --- | --- |
| 0:00–0:20 | Launch the installed Android app on camera | PAIF.fun brings token research and wallet-owned tools to Android; this is a native app |
| 0:20–1:00 | Discover, open a token, scan its Solana mint | Real network-backed evidence, confidence and missing-data warnings; not a safety guarantee |
| 1:00–1:35 | Wallet tab, native MWA handoff and harmless demo-message approval | The wallet keeps the keys; this signature proves ownership and sends no transaction |
| 1:35–2:10 | Manual Paper buy and saved position; reopen if timing permits | Simulated funds, persistent local practice; distinguish it clearly from live trading |
| 2:10–2:40 | Native Swing setup controls, with Paper default | Mobile-specific controls and owner approval; only show signed creation if an eligible trial/pass and device tests permit |
| 2:40–3:00 | Return to research and summarize | Core users, repeat use, native wallet integration, and the next development goal |

Rehearse against real loading times. Do not use edits to imply an untested action
worked. A message signature is **not** a Solana transaction: show real network data
separately. Only demonstrate a real transaction if the owner explicitly chooses
and approves it; neither the build nor this rehearsal authorizes spending funds.

## Brief presentation outline

1. **Problem and users:** mobile Solana traders need a clear way to research tokens,
   understand incomplete evidence, and practice before choosing live actions.
2. **Product:** native Discover/research, persistent Paper, Wallet and Swing
   setup/settings, alongside the existing PAIF.fun service.
3. **Mobile-specific work:** React Native screens, native navigation and forms,
   Android MWA handoff, local storage and wallet-approved owner signatures.
4. **Solana integration:** network-backed token research, MWA authorization and
   locally verified message signatures; wallet-approved Pump.fun/Jupiter trade
   paths and signed owner-linked bot APIs exist in source, but unverified flows
   must not be presented as tested.
5. **Business and trust:** existing Access Pass/trial entitlement rules remain;
   manual practice is separate from paid owner-linked tools. No claims of
   guaranteed returns or token safety.
6. **Evidence and next steps:** show only measured build/device/demo results;
   distinguish APK preparation from production signing and dApp Store publication.

## Source-sharing status

The user confirmed public visibility and approved updating the existing
`pumpaifun/paif-fun` repository. No general reuse-license change was requested.
The root package currently says MIT but has no top-level license text; licensing
has been left unchanged. Hackathon participation is
free; it does not require charging people for code. Private repository access can
limit public exposure, but the organizer explicitly treats submissions as
non-confidential and receives the use license described in section 7.
