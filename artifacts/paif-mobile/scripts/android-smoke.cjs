const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

if (process.argv.includes('--help')) {
  console.log('Install and launch the test APK on an already booted Android emulator.');
  console.log('Usage: pnpm --filter @workspace/paif-mobile android:smoke');
  console.log('Defaults to emulator-5554; override with PAIF_ANDROID_SERIAL.');
  console.log('Requires an APK built with x86_64 support on an x86_64 emulator.');
  console.log('Does not reset app data, install wallets, sign messages, trade or publish.');
  process.exit(0);
}

const appDir = path.resolve(__dirname, '..');
const rootDir = path.resolve(appDir, '../..');
const serial = process.env.PAIF_ANDROID_SERIAL || 'emulator-5554';
const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;

function fail(message) {
  console.error(message);
  process.exit(1);
}
if (process.argv.length > 2) fail('Unknown argument. Use --help.');
if (!/^emulator-\d+$/.test(serial)) fail('This automated smoke check is restricted to Android emulators, not owner phones.');
if (!sdk) fail('Set ANDROID_HOME to the installed Android SDK.');
const adb = path.join(sdk, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb');
const apk = path.join(appDir, 'android/app/build/outputs/apk/release/app-release.apk');
if (!fs.existsSync(apk)) fail('Build the test APK first using android:apk.');

function command(args, timeout = 30000, binary = false) {
  const result = spawnSync(adb, ['-s', serial, ...args], {
    encoding: binary ? undefined : 'utf8',
    timeout,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    fail(result.error?.message || String(result.stderr || result.stdout || 'adb command failed'));
  }
  return result.stdout;
}

if (command(['get-state']).trim() !== 'device') fail('The Android emulator is not online.');
if (command(['shell', 'getprop', 'sys.boot_completed']).trim() !== '1') {
  fail('The emulator has not finished booting. No APK installation or app verification was performed.');
}
for (const service of ['package', 'activity']) {
  if (!command(['shell', 'service', 'check', service]).includes(': found')) {
    fail(`Android ${service} service is unavailable. The emulator framework is not healthy; no app verification was performed.`);
  }
}
console.log('Installing the test APK without clearing existing emulator app data.');
console.log(command(['install', '--no-streaming', '-r', apk], 180000).trim());
console.log(command(['shell', 'am', 'start', '-W', '-n', 'fun.paif.android/.MainActivity'], 120000).trim());

// Give native startup failures time to surface before checking the process.
Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10000);
const pid = command(['shell', 'pidof', 'fun.paif.android']).trim();
if (!/^\d+$/.test(pid)) fail('PAIF is not running after launch. Inspect Android runtime logs.');
const log = command(['logcat', '-d', '--pid', pid, '-v', 'brief', '-s', 'AndroidRuntime', 'ReactNativeJS']);
const outputDir = path.join(rootDir, 'screenshots');
fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(path.join(outputDir, 'android-smoke.log'), log);
fs.writeFileSync(path.join(outputDir, 'android-smoke.png'), command(['exec-out', 'screencap', '-p'], 30000, true));
if (/FATAL EXCEPTION|JavascriptException|Invariant Violation|Unable to load script/.test(log)) {
  fail('A startup exception was found. See screenshots/android-smoke.log.');
}
console.log('APK installation succeeded and the app process stayed running after launch.');
console.log('Screenshot/log saved under screenshots/. Inspect the screenshot before claiming rendered UI.');
console.log('Wallet authorization, signatures, paper persistence and live trading are NOT verified by this smoke check.');
