/**
 * electron-builder packaging config (spec 11). Explained for humans in
 * docs/guides/testing-and-ci-explained.md ("Releases").
 *
 * It is a script instead of YAML for one reason: signing is optional. Every signing step
 * switches on only when its secrets are present in the environment, so the same config
 * builds unsigned installers on a fork or a laptop and signed ones in the release workflow.
 *
 *   macOS    CSC_LINK + CSC_KEY_PASSWORD sign; APPLE_API_KEY (path to the .p8), APPLE_API_KEY_ID
 *            and APPLE_API_ISSUER also notarize. Without them the app is unsigned.
 *   Windows  AZURE_* variables (Microsoft's cloud signing service) or WIN_CSC_LINK +
 *            WIN_CSC_KEY_PASSWORD (a certificate) sign. SignPath Foundation signs the finished
 *            installer in a separate workflow step instead (see docs/HUMAN-TODO.md).
 *   Linux    not signed by the OS; releases ship a SHA256SUMS file.
 */

/**
 * @param {Record<string, string | undefined>} env
 * @returns {import('electron-builder').Configuration}
 */
export function createConfig(env = process.env) {
  const azure = azureSigning(env);
  // macOS signing is on when a certificate is provided as CSC_LINK (electron-builder imports
  // it), or already sits in the keychain (the release workflow sets RAML_KQL_SIGN_MAC).
  const macSigning = Boolean(env['CSC_LINK'] || env['RAML_KQL_SIGN_MAC']);
  return {
    appId: 'ch.raml.kql',
    productName: 'Raml KQL',
    artifactName: 'Raml-KQL-${version}-${os}-${arch}.${ext}',
    directories: { output: 'release', buildResources: 'build' },
    files: ['out/**', 'package.json'],
    asar: true,

    // The auto-updater reads this (written into the app as app-update.yml) and the release
    // workflow uploads to it. A private repository can't be read by the updater without a
    // token, so updates start working once the repository is public.
    publish: { provider: 'github', owner: 'luca-ramseyer', repo: 'raml-kql' },

    // Electron fuses (spec 01): switched off at packaging time, so they can't be flipped back
    // on by a user, an environment variable or a command-line flag.
    electronFuses: {
      runAsNode: false,
      enableNodeOptionsEnvironmentVariable: false,
      enableNodeCliInspectArguments: false,
      enableEmbeddedAsarIntegrityValidation: true,
      onlyLoadAppFromAsar: true,
      enableCookieEncryption: true,
      // Flipping fuses invalidates the ad-hoc signature Electron ships with, and Apple Silicon
      // kills an app whose signature is invalid. Unsigned builds re-sign ad hoc; signed builds
      // are signed by electron-builder afterwards.
      ...(macSigning ? {} : { resetAdHocDarwinSignature: true }),
    },

    mac: {
      category: 'public.app-category.developer-tools',
      // dmg for people, zip because the macOS auto-updater installs from the zip.
      target: [
        { target: 'dmg', arch: ['arm64', 'x64'] },
        { target: 'zip', arch: ['arm64', 'x64'] },
      ],
      // Unsigned unless a certificate is provided: without this, a developer's own Apple
      // certificate in the keychain would be picked up by a plain `pnpm dist`.
      ...(macSigning ? {} : { identity: null }),
      hardenedRuntime: true,
      gatekeeperAssess: false,
      // The minimum Electron needs under the hardened runtime: V8 compiles JavaScript at run
      // time. No camera, microphone, location or Apple Events: Raml KQL only connects out.
      // (No comments inside the plist itself: macOS's own parser rejects them.)
      entitlements: 'build/entitlements.mac.plist',
      entitlementsInherit: 'build/entitlements.mac.plist',
      // Notarization switches on by itself when the APPLE_API_* variables are set.
      notarize: true,
    },

    win: {
      target: [{ target: 'nsis', arch: ['x64', 'arm64'] }],
      ...(azure === undefined ? {} : { azureSignOptions: azure }),
    },
    nsis: {
      oneClick: false,
      // Per-user by default (no administrator rights needed); the installer offers per-machine.
      perMachine: false,
      allowToChangeInstallationDirectory: true,
    },

    // rpm package names can't contain spaces (the productName does), and a plain lowercase name
    // is what Linux users expect from `dnf` and `apt` anyway.
    deb: { packageName: 'raml-kql' },
    rpm: { packageName: 'raml-kql' },

    linux: {
      // AppImage is the only target the auto-updater can update. deb and rpm get their
      // updates from the package manager.
      target: ['AppImage', 'deb', 'rpm'].map((target) => ({ target, arch: ['x64'] })),
      category: 'Development',
      executableName: 'raml-kql',
      maintainer: 'Raml KQL contributors',
      // electron-builder's deb/rpm install scripts set the chrome-sandbox permissions, so the
      // Chromium sandbox keeps working. Never ship with --no-sandbox.
    },
  };
}

/**
 * Microsoft's cloud signing service, enabled only when all of its settings exist. The
 * credentials themselves (AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET) are read by
 * electron-builder from the environment.
 */
function azureSigning(env) {
  const endpoint = env['AZURE_SIGNING_ENDPOINT'];
  const codeSigningAccountName = env['AZURE_SIGNING_ACCOUNT'];
  const certificateProfileName = env['AZURE_SIGNING_PROFILE'];
  const publisherName = env['AZURE_SIGNING_PUBLISHER'];
  if (!endpoint || !codeSigningAccountName || !certificateProfileName || !publisherName) {
    return undefined;
  }
  return { endpoint, codeSigningAccountName, certificateProfileName, publisherName };
}

export default createConfig();
