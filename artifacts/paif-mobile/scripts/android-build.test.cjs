const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { sdkRequirements } = require('./android-prerequisites.cjs');

function invoke(script, args = [], env = {}) {
  return spawnSync(process.execPath, [path.join(__dirname, script), ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

test('SDK requirements come from the installed React Native build metadata', () => {
  const requirements = sdkRequirements();
  assert.match(requirements.platform, /^\d+$/);
  assert.match(requirements.buildTools, /^\d+\.\d+\.\d+$/);
  assert.match(requirements.ndk, /^\d+\.\d+\.\d+$/);
});

test('APK help describes demonstration signing and standalone output', () => {
  const result = invoke('android-apk.cjs', ['--help']);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /debug-signed demonstration APK/);
  assert.match(result.stdout, /app-release\.apk/);
});

test('invalid architectures fail before running Gradle or installing anything', () => {
  const result = invoke('android-apk.cjs', [], { PAIF_ANDROID_ARCHITECTURES: 'unknown' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unsupported PAIF_ANDROID_ARCHITECTURES/);
});

test('invalid Gradle worker counts fail before running build tools', () => {
  for (const workers of ['0', '5', '1.5', '2 --daemon']) {
    const result = invoke('android-apk.cjs', [], { PAIF_ANDROID_GRADLE_WORKERS: workers });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Unsupported PAIF_ANDROID_GRADLE_WORKERS/);
  }
});

test('missing tools fail explicitly without accepting SDK licenses', () => {
  const result = invoke('android-prerequisites.cjs', [], {
    JAVA_HOME: path.join(__dirname, 'does-not-exist'),
    ANDROID_HOME: '',
    ANDROID_SDK_ROOT: '',
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Java JDK 17/);
  assert.match(result.stderr, /ANDROID_HOME/);
  assert.match(result.stderr, /sdkmanager --licenses/);
  assert.doesNotMatch(result.stdout, /are present/);
});

test('emulator smoke help describes its limited scope', () => {
  const result = invoke('android-smoke.cjs', ['--help']);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /already booted Android emulator/);
  assert.match(result.stdout, /Does not reset app data/);
});

test('automated smoke checks refuse to operate on owner phones', () => {
  const result = invoke('android-smoke.cjs', [], { PAIF_ANDROID_SERIAL: 'physical-phone' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /restricted to Android emulators/);
});
