const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const missing = [];
for (const tool of ['java', 'adb']) {
  const result = spawnSync('sh', ['-c', `command -v ${tool}`], { encoding: 'utf8' });
  if (result.status !== 0) missing.push(tool);
}
const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
if (!sdk || !fs.existsSync(sdk)) missing.push('ANDROID_HOME pointing to an installed Android SDK');
if (missing.length) {
  console.error(`Android APK build is unavailable on this machine. Missing: ${missing.join(', ')}.`);
  console.error('See ANDROID_BUILD.md. No APK or device verification is implied by a web preview.');
  process.exit(1);
}
console.log('Java, adb and Android SDK are present. Use the project Gradle wrapper after Expo prebuild.');
