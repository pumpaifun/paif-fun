# PAIF.fun — CLOCK IN submission readiness

Checked on October 6, 2026 against the organizer's live portal, full terms,
official announcement, and the owner's portal screenshots:
https://solanamobile.radiant.nexus/
https://solanamobile.radiant.nexus/legal/clock-in-terms.pdf
https://solanamobile.com/blog/clock-in-the-solana-mobile-hackathon

## Submission deadline and materials

The live portal schedule fetched on October 6 gives
**October 12, 2026 at 6:59 AM CDT (America/Chicago)**,
equivalent to `2026-10-12T11:59:00.000Z`. The older announcement says October 8.
Recheck the live portal before submission; the organizer can change deadlines.
The full terms prevail over conflicting promotional copy.
Live schedule source:
https://align-api.radiant.nexus/hackathons/H5jQCFppZBd6wq2XLpazBjJMeLAn1HJSmrT9PpTLM1kb/dates

Technical requirements:

- Functional Android-only APK with Solana Mobile Stack and Mobile Wallet Adapter.
- Meaningful Solana network interaction.
- Significant mobile-specific development; direct web ports/PWA wrappers score poorly.
- A three-minute demo on an actual device, not only a simulator.

Required materials:

- **Functional Android APK:** the fresh arm64 demonstration APK is
  `downloads/paif-android-swing-arm64-ab2586eb.apk` (49.33 MiB), built from the
  isolated local clone with signature, package and bundled-runtime checks passed.
  Older test-signed APKs predate the latest changes. Native installation and wallet testing
  were blocked by the Replit host's unstable software emulator. A real phone
  still needs to pass startup, wallet, network-data and persistence checks.
  A successful build alone is not proof of functionality on a device.
- **GitHub repository containing the source code:** use the owner's intended
  submission repository and confirm that it includes the Android app and
  reproducible build instructions. No repository has been published or changed
  as part of these native-build checks.
- **Three-minute demo video showing the app in use:** outstanding. Use the actual Android
  app, label paper-mode simulation clearly, and show wallet signing without
  revealing recovery phrases or private keys.
- **Pitch deck or short presentation:** outstanding. Explain the product,
  users, mobile workflow, Solana integration and current limitations honestly.

Register/submit through the organizer's official site:
https://solanamobile.radiant.nexus/

See the root `README.md` for clone/build/install instructions and
`SUBMISSION_CHECKLIST.md` for the evidence record, demo plan and presentation outline.

## Ownership, source access, and eligibility

- Full terms section 7: participants retain ownership. The organizer receives a
  perpetual, worldwide, non-exclusive, royalty-free license to use submitted
  materials for administration, judging, technical review, archival, publicity
  and marketing. Submissions are not confidential.
- Section 1: participation is free. No requirement to charge people for source
  code or to adopt a general public open-source license was found in these terms.
  This is a summary, not a replacement for the owner's review of the full terms.
- The portal's repository-review interface describes public repositories and
  private repositories accessed via a team member's connected GitHub App.
  Confirm that access works before final submission. Private access does not
  override the organizer's non-confidentiality terms.
- The root package currently says MIT, with no top-level LICENSE file. The
  owner's intended source license must be resolved before uploading; this
  preparation does not change it or add anti-scraping/evaluation-only terms.
- Section 6.1: the project must have started no earlier than three months before
  the September 8 launch (June 8, 2026). Pre-existing projects also need significant
  new mobile development. Verify PAIF's eligibility instead of assuming it.
- Only one entry is allowed per contestant. Team composition becomes fixed on
  submission. USDC prize eligibility excludes VC/angel-funded teams, and finalists
  must complete the organizer's required verification/KYC.

## Hackathon submission is not dApp Store publication

The full terms require applicable winning apps to be published and publicly
listed on the dApp Store within **30 calendar days** of the first public winner
announcement. A review submission alone is insufficient; extensions require
written organizer approval. The public announcement
requires a functional APK but does not specify that the hackathon APK must
already use an owner's production release key. Confirm any additional
conditions displayed by the actual submission form.

Store publication separately requires:

- A release-ready APK signed with the owner's release key.
- Listing metadata, screenshots and icon.
- An owner-managed publisher account and KYC/KYB.
- The owner's publisher wallet and explicit transaction approvals.
- Review of the store's publisher policy and developer agreement.

Store guide: https://docs.solanamobile.com/dapp-store/submit-new-app

The generated Android debug signer is **not** an owner's production signing key.
Do not change the package identifier or discard the eventual release key;
Android updates require signer continuity. Never send signing keys, passwords
or wallet recovery phrases through chat or source control.

## Verification boundaries

The native test wallet is isolated and unfunded. Testing must not create live
trades, send funds, bypass Access Pass requirements, or use an owner's wallet.
No Stripe configuration or website behavior is changed by this work.

Standard Android/emulator testing is allowed; a Seeker is not required to start.
Emulator testing alone does not satisfy the portal's actual-device demo condition
and does not validate Seeker-specific Seed Vault behavior.

Development-wallet guidance:
https://docs.solanamobile.com/get-started/development-setup
