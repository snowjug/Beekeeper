// electron-builder configuration (Windows only). Run through `npm run dist` / `npm run release`.
//
// BEEKEEPER_BUILD_OUT redirects the output folder, e.g. to a path that OneDrive does not sync
// (OneDrive can hold file locks and make electron-builder fail with EPERM/EBUSY).

/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: 'com.atharv.beekeeper',
  productName: 'Beekeeper',
  copyright: 'Copyright (c) 2026 Atharv Shukla',
  directories: {
    output: process.env.BEEKEEPER_BUILD_OUT || 'release',
    buildResources: 'assets',
  },
  files: [
    'out/**',
    'assets/**',
    'package.json',
    '!assets/**/*.svg',
    '!assets/icons/**',
    '!assets/tray/*.png',
    '!**/*.map',
  ],
  extraResources: [
    // PowerShell helpers of the system commands (volume, brightness, apps ...).
    { from: 'resources/scripts', to: 'scripts', filter: ['*.ps1'] },
    // Offline OCR language data for Circle to Search.
    {
      from: 'node_modules/@tesseract.js-data/eng/4.0.0_best_int',
      to: 'tessdata',
      filter: ['eng.traineddata.gz'],
    },
  ],
  // The OCR worker thread is started from real files (see src/main/capture/ocr-assets.ts).
  asarUnpack: [
    'node_modules/tesseract.js/src/**',
    'node_modules/tesseract.js-core/tesseract-core*-lstm.js',
    'node_modules/tesseract.js-core/tesseract-core*-lstm.wasm',
    'node_modules/regenerator-runtime/**',
    'node_modules/is-url/**',
    'node_modules/bmp-js/**',
    'node_modules/wasm-feature-detect/**',
  ],
  compression: 'maximum',
  win: {
    icon: 'assets/icon.ico',
    target: [
      { target: 'nsis', arch: ['x64'] },
      { target: 'portable', arch: ['x64'] },
    ],
    // Unsigned builds: SmartScreen shows "More info -> Run anyway".
    forceCodeSigning: false,
  },
  nsis: {
    artifactName: 'Beekeeper-Setup-${version}.exe',
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: 'Beekeeper',
    runAfterFinish: true,
    deleteAppDataOnUninstall: false,
    installerIcon: 'assets/icon.ico',
    uninstallerIcon: 'assets/icon.ico',
    installerSidebar: 'assets/installer/installer-sidebar.bmp',
    uninstallerSidebar: 'assets/installer/installer-sidebar.bmp',
    installerHeader: 'assets/installer/installer-header.bmp',
  },
  portable: {
    artifactName: 'Beekeeper-Portable-${version}.exe',
  },
  publish: {
    provider: 'github',
    owner: 'snowjug',
    repo: 'Beekeeper',
    releaseType: 'release',
  },
};
