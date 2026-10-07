const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { checkPrerequisites } = require('./android-prerequisites.cjs');

const appDir = path.resolve(__dirname, '..');
const rootDir = path.resolve(appDir, '../..');
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';

if (process.argv.includes('--help')) {
  console.log('Build a standalone, debug-signed demonstration APK (not a store release).');
  console.log('Usage: pnpm --filter @workspace/paif-mobile android:apk');
  console.log('Requires JDK 17+, Android SDK and licenses accepted by the SDK user.');
  console.log('Defaults to arm64-v8a. Set PAIF_ANDROID_ARCHITECTURES to a comma-separated');
  console.log('list of arm64-v8a, armeabi-v7a, x86 or x86_64 for other devices.');
  console.log('Uses one Gradle worker by default. PAIF_ANDROID_GRADLE_WORKERS can select 1–4.');
  console.log('Output: android/app/build/outputs/apk/release/app-release.apk');
  process.exit(0);
}
if (process.argv.length > 2) {
  console.error('Unknown argument. Use --help for build instructions.');
  process.exit(1);
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    env: { ...process.env, CI: '1', NODE_ENV: 'production' },
    shell: process.platform === 'win32',
  });
  if (result.error) console.error(result.error.message);
  if (result.status !== 0) process.exit(result.status || 1);
}

try {
  const architectures = process.env.PAIF_ANDROID_ARCHITECTURES || 'arm64-v8a';
  if (!architectures.split(',').every((value) => ['arm64-v8a', 'armeabi-v7a', 'x86', 'x86_64'].includes(value))) {
    throw new Error('Unsupported PAIF_ANDROID_ARCHITECTURES. Use --help for allowed values.');
  }
  const workers = process.env.PAIF_ANDROID_GRADLE_WORKERS || '1';
  if (!/^[1-4]$/.test(workers)) {
    throw new Error('Unsupported PAIF_ANDROID_GRADLE_WORKERS. Use an integer from 1 to 4.');
  }
  if (!checkPrerequisites()) process.exit(1);
  run(pnpm, ['run', 'typecheck:libs'], rootDir);
  run(pnpm, ['run', 'typecheck'], appDir);
  run(pnpm, ['run', 'test'], appDir);

  const androidDir = path.join(appDir, 'android');
  const wrapper = path.join(androidDir, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew');
  if (!fs.existsSync(wrapper)) {
    run(pnpm, ['exec', 'expo', 'prebuild', '--platform', 'android', '--no-install'], appDir);
  }
  console.log('Building a debug-signed demonstration APK. No publishing or live trading is performed.');
  run(
    process.platform === 'win32' ? wrapper : 'sh',
    [
      ...(process.platform === 'win32' ? [] : [wrapper]),
      'assembleRelease', '--no-daemon', `--max-workers=${workers}`,
      '-Dorg.gradle.parallel=false',
      `-PreactNativeArchitectures=${architectures}`,
    ],
    androidDir,
  );
  const apk = path.join(androidDir, 'app/build/outputs/apk/release/app-release.apk');
  if (!fs.existsSync(apk)) throw new Error('Gradle exited without the expected APK; inspect its build output.');
  console.log(`Demonstration APK built: ${apk}`);
  console.log('Install on a compatible Android phone to verify startup and Mobile Wallet Adapter.');
  console.log('This debug-signed APK is not an owner-signed store release.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
