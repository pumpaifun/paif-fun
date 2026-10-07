const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function sdkRequirements() {
  const versions = fs.readFileSync(
    path.join(path.dirname(require.resolve('react-native/package.json')), 'gradle/libs.versions.toml'),
    'utf8',
  );
  const read = (name) => {
    const value = versions.match(new RegExp(`^${name}\\s*=\\s*"([^"]+)"`, 'm'))?.[1];
    if (!value) throw new Error(`Cannot determine Android ${name} from React Native.`);
    return value;
  };
  return { platform: read('compileSdk'), buildTools: read('buildTools'), ndk: read('ndkVersion') };
}

function checkPrerequisites() {
  const missing = [];
  const java = process.env.JAVA_HOME
    ? path.join(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'java.exe' : 'java')
    : 'java';
  const result = spawnSync(java, ['-version'], { encoding: 'utf8' });
  const version = `${result.stderr || ''}\n${result.stdout || ''}`.match(/version "(\d+)(?:\.(\d+))?/);
  const major = version && Number(version[1] === '1' ? version[2] : version[1]);
  if (result.status !== 0 || !major || major < 17) missing.push('Java JDK 17 or newer (check JAVA_HOME)');

  const requirements = sdkRequirements();
  const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  if (!sdk || !fs.existsSync(sdk)) {
    missing.push('ANDROID_HOME pointing to an installed Android SDK');
  } else {
    for (const component of [
      `platforms/android-${requirements.platform}/android.jar`,
      `build-tools/${requirements.buildTools}/source.properties`,
      `ndk/${requirements.ndk}/source.properties`,
      'cmake/3.22.1/source.properties',
    ]) {
      if (!fs.existsSync(path.join(sdk, component))) missing.push(`SDK component: ${component}`);
    }
  }
  if (missing.length) {
    console.error(`Android APK build prerequisites missing:\n- ${missing.join('\n- ')}`);
    console.error('Install the Android command-line tools and review/accept the SDK licenses yourself with sdkmanager --licenses.');
    console.error(`Then run: sdkmanager "platform-tools" "platforms;android-${requirements.platform}" "build-tools;${requirements.buildTools}" "ndk;${requirements.ndk}" "cmake;3.22.1"`);
    console.error('See ANDROID_BUILD.md. A web preview is not APK or device verification.');
    return false;
  }
  console.log(`Java ${major} and Android SDK build components are present. adb is needed for device installation, not APK compilation.`);
  return true;
}

if (require.main === module) {
  try {
    if (!checkPrerequisites()) process.exitCode = 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { checkPrerequisites, sdkRequirements };
