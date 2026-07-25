// conditions.js — v5.1
// Porting 1:1 di Conditions.swift + parte di Locations.swift (MyPureMac).
// Database di regole per-app, esclusioni di sistema e liste di skip usate
// dal motore euristico appPathFinder.js e dall'orphan finder.
//
// NOTA: la lista `skipReverse` è duplicata in CleanMac.command (op33), che deve
// funzionare standalone senza Node. Tenerle allineate.

'use strict';

const os = require('os');
const path = require('path');
const { normalizeForMatching } = require('./stringNormalization');

const HOME = os.homedir();

// ---------------------------------------------------------------------------
// Condizioni per-app: termini extra di include/exclude e path forzati.
// I path force* vengono verificati (esistenza) al momento dell'uso, non qui.
// ---------------------------------------------------------------------------
function cond(bundleID, includeTerms, excludeTerms, forceIncludePaths, forceExcludePaths) {
  return {
    bundleID: normalizeForMatching(bundleID),
    includeTerms: includeTerms.map(normalizeForMatching),
    excludeTerms: excludeTerms.map(normalizeForMatching),
    forceIncludePaths: forceIncludePaths || [],
    forceExcludePaths: forceExcludePaths || [],
  };
}

const appConditions = [
  // --- Apple Developer Tools ---
  cond('com.apple.dt.xcode',
    ['com.apple.dt', 'xcode', 'simulator'],
    ['com.robotsandpencils.xcodesapp', 'com.xcodesorg.xcodesapp',
     'com.oneminutegames.xcodecleaner', 'io.hyperapp.xcodecleaner',
     'available-xcodes', 'xcodes', 'cleaner for xcode'],
    [`${HOME}/Library/Containers/com.apple.iphonesimulator.ShareExtension`]),
  cond('com.robotsandpencils.xcodesapp', [],
    ['com.apple.dt.xcode', 'com.oneminutegames.xcodecleaner', 'io.hyperapp.xcodecleaner']),
  cond('com.xcodesorg.xcodesapp', [],
    ['com.apple.dt.xcode', 'com.oneminutegames.xcodecleaner', 'io.hyperapp.xcodecleaner']),
  cond('io.hyperapp.xcodecleaner', [],
    ['com.robotsandpencils.xcodesapp', 'com.oneminutegames.xcodecleaner',
     'com.apple.dt.xcode', 'xcodes.json']),

  // --- Comunicazione & Videoconferenze ---
  cond('us.zoom.xos', ['zoom'], []),
  cond('com.microsoft.teams2', [], ['office']),

  // --- Browser ---
  cond('com.brave.browser', ['brave'], []),
  cond('com.google.chrome', ['google', 'chrome'], ['iterm', 'chromefeaturestate', 'monochrome']),
  cond('com.microsoft.edgemac', [], ['vscode', 'rdc', 'appcenter', 'office', 'oneauth']),
  cond('org.mozilla.firefox', ['firefox'], ['thunderbird']),
  cond('org.mozilla.firefox.nightly', ['mozilla', 'firefox'], ['thunderbird']),
  cond('org.mozilla.thunderbird', [], ['firefox']),
  cond('company.thebrowser.Browser', ['firestore'], [],
    [`${HOME}/Library/Application Support/Arc/`, `${HOME}/Library/Caches/Arc/`]),

  // --- Developer Tools & IDE ---
  cond('com.microsoft.VSCode', ['vscode'], ['vscodeinsiders', 'insiders'],
    [`${HOME}/Library/Application Support/Code/`]),
  cond('com.microsoft.VSCodeInsiders', ['vscodeinsiders', 'insiders'], [],
    [`${HOME}/Library/Application Support/Code - Insiders/`]),
  cond('com.github.githubclient', ['comgithubelectron'], []),
  cond('jetbrains', ['jcef'], [],
    [`${HOME}/Library/Application Support/JetBrains/`,
     `${HOME}/Library/Caches/JetBrains/`,
     `${HOME}/Library/Logs/JetBrains/`]),
  cond('com.native-instruments.nativeaccess', ['comnative', 'nativeinstruments'], []),

  // --- Produttività & Utility ---
  cond('com.logi.optionsplus', ['logi', 'logipluginservice'], ['login', 'logic']),
  cond('com.1password.1password', ['waveboxapp', 'sidekick'], []),
  cond('eu.exelban.stats', [], ['video']),
  cond('me.mhaeuser.BatteryToolkit', ['memhaeuser'], []),
  cond('com.okta.mobile', ['okta'], []),

  // --- Virtualizzazione & Accesso remoto ---
  cond('com.now.gg.BlueStacks', ['bst_boost_interprocess'], []),
  cond('com.electron.sdm', ['strongdm'], []),

  // --- Social & Messaging ---
  cond('com.facebook.archon.developerid', ['archon.loginhelper'], []),
];

// ---------------------------------------------------------------------------
// Skip di sistema: prefissi/percorsi da non toccare mai durante lo scan.
// ---------------------------------------------------------------------------
const skipConditions = [
  {
    skipPrefixes: ['mobiledocuments', 'reminders', 'dsstore', 'comapplepasswordmanager'],
    allowPrefixes: [
      'comappleconfigurator', 'comappledt', 'comappleiwork', 'comapplesfsymbols',
      'comappletestflight', 'comapplesharedfilelist', 'comapplelssharedfilelist',
    ],
    skipPaths: [
      `${HOME}/.Trash`,
      '/Library/SystemExtensions',
      '/System/Volumes/Preboot/Cryptexes/App/System/Library/CoreServices/PasswordManagerBrowserExtensionHelper.app/Contents/MacOS/PasswordManagerBrowserExtensionHelper',
      `${HOME}/Library/Application Support/Chromium/NativeMessagingHosts/com.apple.passwordmanager.json`,
      `${HOME}/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.apple.passwordmanager.json`,
    ],
  },
];

// ---------------------------------------------------------------------------
// Sottodirectory del Library escluse dalla deep search (depth 2):
// directory di sistema macOS che non contengono mai file di app di terze parti.
// ---------------------------------------------------------------------------
const skipDeepSearch = new Set([
  // Core System
  'Apple', 'Audio', 'Bluetooth', 'ColorSync', 'Components', 'CoreAnalytics',
  'CoreMediaIO', 'DirectoryServices', 'Filesystems', 'GPUBundles', 'Graphics',
  'KernelCollections', 'OSAnalytics', 'OpenDirectory', 'Sandbox', 'Security',
  'SystemExtensions', 'SystemMigration', 'SystemProfiler', 'StagedDriverExtensions',
  'StagedExtensions', 'StartupItems',
  // User Data & System Services
  'Accessibility', 'Accounts', 'AppleMediaServices', 'Assistant', 'Assistants',
  'Autosave Information', 'Biome', 'Calendars', 'CallServices', 'CloudStorage',
  'Contacts', 'Cookies', 'DataAccess', 'DataDeliveryServices', 'DoNotDisturb',
  'DuetExpertCenter', 'Finance', 'FinanceBackup', 'FrontBoard', 'GameKit',
  'GroupContainersAlias', 'HomeKit', 'IdentityServices', 'IntelligencePlatform',
  'Intents', 'KeyboardServices', 'LanguageModeling', 'LockdownMode', 'Mail',
  'MediaAnalysis', 'Messages', 'Metadata', 'Mobile Documents', 'MobileDevice',
  'News', 'Passes', 'PersonalizationPortrait', 'Photos', 'PrivateCloudCompute',
  'Reminders', 'ResponseKit', 'Safari', 'SafariSafeBrowsing', 'SafariSandboxBroker',
  'ScreenRecordings', 'StatusKit', 'Suggestions', 'SyncedPreferences', 'Translation',
  'UnifiedAssetFramework', 'Weather', 'homeenergyd', 'studentd',
  // Development & System Tools
  'Developer', 'Perl', 'Ruby', 'Java', 'Python', 'Catacomb', 'InstallerSandboxes',
  'Trial', 'Updates', 'Staging', 'ContainerManager', 'Daemon Containers',
  // Additional System Directories
  'ColorPickers', 'Colors', 'Compositions', 'Contextual Menu Items', 'Documentation',
  'DriverExtensions', 'Favorites', 'FontCollections', 'Fonts', 'Image Capture',
  'Input Methods', 'Jupyter', 'Keyboard', 'Keyboard Layouts', 'Keychains',
  'Managed Preferences', 'PDF Services', 'Printers', 'QuickLook', 'Receipts',
  'Screen Savers', 'ScriptingAdditions', 'Scripts', 'Sharing', 'Shortcuts',
  'Sounds', 'Speech', 'Spelling', 'Spotlight', 'User Pictures', 'User Template',
  'Video', 'WebServer', 'Workflows',
  // Apple Service Bundles
  'com.apple.AppleMediaServices', 'com.apple.WatchListKit', 'com.apple.aiml.instrumentation',
  'com.apple.appleaccountd', 'com.apple.bluetooth.services.cloud', 'com.apple.bluetoothuser',
  'com.apple.familycircled', 'com.apple.iTunesCloud', 'com.apple.internal.ck',
  // iCloud & Sync Infrastructure
  'com.apple.cloudpaird', 'com.apple.iCloudHelper', 'com.apple.nsurlsessiond',
  'com.apple.sbd', 'com.apple.touristd',
  // System Agents & Daemons
  'com.apple.AMPLibraryAgent', 'com.apple.bird', 'com.apple.coreduetd',
  'com.apple.homed', 'com.apple.photoanalysisd', 'com.apple.routined',
  'com.apple.siriactionsd', 'com.apple.suggestd',
  // Frameworks & Runtime
  'com.apple.AppStoreComponents', 'com.apple.ScreenTimeUI',
  'com.apple.TelephonyUtilities', 'com.apple.WebInspector',
]);

// ---------------------------------------------------------------------------
// Prefissi (normalizzati) da ignorare nella ricerca inversa (orphan finder):
// item di sistema macOS, daemon Apple e infrastruttura condivisa che non vanno
// mai segnalati come residui di app di terze parti.
// ---------------------------------------------------------------------------
const skipReverse = [
  // Apple & System
  'apple', 'temporary', 'btserver', 'proapps', 'scripteditor', 'ilife',
  'livefsd', 'siritoday', 'addressbook', 'animoji', 'appstore',
  'askpermission', 'callhistory', 'clouddocs', 'diskimages', 'dock',
  'facetime', 'fileprovider', 'instruments', 'knowledge', 'mobilesync',
  'syncservices', 'homeenergyd', 'icloud', 'icdd', 'networkserviceproxy',
  'familycircle', 'geoservices', 'installation', 'passkit',
  'sharedimagecache', 'desktop', 'mbuseragent', 'swiftpm', 'baseband',
  'coresimulator', 'photoslegacyupgrade', 'photosupgrade', 'siritts',
  'ipod', 'globalpreferences',
  // Analytics & Telemetry
  'apmanalytics', 'apmexperiment', 'avatarcache', 'byhost',
  'contextstoreagent', 'mobilemeaccounts', 'mobiledocuments', 'mobile',
  'intentbuilderc', 'loginwindow', 'momc', 'replayd', 'sharedfilelistd',
  // Build Tools & Compilers
  'clang', 'audiocomponent', 'csexattrcryptoservice',
  'livetranscriptionagent', 'sandboxhelper', 'statuskitagent',
  // System Daemons
  'betaenrollmentd', 'contentlinkingd', 'diagnosticextensionsd', 'gamed',
  'heard', 'homed', 'itunescloudd', 'lldb', 'mds', 'mediaanalysisd',
  'metrickitd', 'mobiletimerd', 'proactived', 'ptpcamerad', 'studentd',
  'talagent', 'watchlistd', 'apptranslocation', 'xcrun',
  // Generic Infrastructure
  'ds_store', 'caches', 'crashreporter', 'trash',
  // CleanMac stesso (mai segnalare i propri file)
  'puremac', 'cleanmac',
  // Common SDKs and Shared Components
  'amsdatamigratortool', 'arfilecache', 'assistant', 'chromium',
  'cloudkit', 'webkit', 'databases', 'diagnostic', 'cache', 'gamekit',
  'homebrew', 'logi', 'microsoft', 'mozilla', 'sync', 'google',
  'sentinel', 'hexnode', 'sentry', 'tvappservices', 'reminders', 'pbs',
  'notarytool', 'differentialprivacy', 'storeassetd', 'webpush',
  'storedownloadd', 'fsck', 'crash', 'python', 'discrecording',
  'photossearch', 'pylint', 'jamf', 'scopedbookmarkagent', 'anonymous',
  'identifier', 'isolated', 'nobackup', 'privacypreservingmeasurement',
  'symbols', 'stickersd', 'privatecloudcomputed', 'tipsd',
  'controlcenter', 'contactsd', 'staticcheck', 'index', 'segment',
  'sparkle', 'summaryevents', 'launchdarkly', 'identityservicesd',
  'embeddedbinaryvalidationutility', 'aaprofilepicture', 'minilauncher',
  'jna', 'automator', 'locationaccessstored', 'spotlight', 'cef',
].map(normalizeForMatching);

// ---------------------------------------------------------------------------
// Sottodirectory standard del Library (da Locations.swift): usate per decidere
// se un match a depth 2 deve includere la cartella genitore (vendor folder)
// oppure solo l'item trovato.
// ---------------------------------------------------------------------------
const standardLibrarySubdirectories = new Set([
  'Application Scripts', 'Application Support', 'Caches',
  'Containers', 'Group Containers', 'HTTPStorages',
  'Internet Plug-Ins', 'LaunchAgents', 'LaunchDaemons',
  'Logs', 'Preferences', 'PreferencePanes',
  'PrivilegedHelperTools', 'Saved Application State',
  'Services', 'WebKit', 'Extensions', 'Frameworks',
]);

// ---------------------------------------------------------------------------
// Location di ricerca (da Locations.swift, appSearch).
// ~/Library e /Library sono "Library root" e vengono scandagliate a depth 2.
// ---------------------------------------------------------------------------
function appSearchPaths() {
  return [
    // User home
    HOME,
    path.join(HOME, '.config'),
    path.join(HOME, 'Documents'),
    path.join(HOME, 'Desktop'),
    path.join(HOME, 'Applications'),
    // User Library
    path.join(HOME, 'Library'),
    path.join(HOME, 'Library/Application Scripts'),
    path.join(HOME, 'Library/Application Support'),
    path.join(HOME, 'Library/Application Support/CrashReporter'),
    path.join(HOME, 'Library/Application Support/com.apple.sharedfilelist/com.apple.LSSharedFileList.ApplicationRecentDocuments'),
    path.join(HOME, 'Library/Containers'),
    path.join(HOME, 'Library/Caches'),
    path.join(HOME, 'Library/Caches/com.apple.helpd/Generated'),
    path.join(HOME, 'Library/Caches/com.crashlytics'),
    path.join(HOME, 'Library/Caches/com.google.SoftwareUpdate'),
    path.join(HOME, 'Library/Caches/com.google.Keystone'),
    path.join(HOME, 'Library/Caches/org.sparkle-project.Sparkle'),
    path.join(HOME, 'Library/Caches/com.segment.analytics'),
    path.join(HOME, 'Library/Caches/SentryCrash'),
    path.join(HOME, 'Library/Caches/Rollbar'),
    path.join(HOME, 'Library/Caches/Amplitude'),
    path.join(HOME, 'Library/Caches/Realm'),
    path.join(HOME, 'Library/Caches/Parse'),
    path.join(HOME, 'Library/Group Containers'),
    path.join(HOME, 'Library/HTTPStorages'),
    path.join(HOME, 'Library/Internet Plug-Ins'),
    path.join(HOME, 'Library/LaunchAgents'),
    path.join(HOME, 'Library/Logs'),
    path.join(HOME, 'Library/Logs/DiagnosticReports'),
    path.join(HOME, 'Library/Preferences'),
    path.join(HOME, 'Library/PreferencePanes'),
    path.join(HOME, 'Library/Preferences/ByHost'),
    path.join(HOME, 'Library/Saved Application State'),
    path.join(HOME, 'Library/Services'),
    path.join(HOME, 'Library/WebKit'),
    // System-wide
    '/Applications',
    '/Users/Shared',
    '/Users/Shared/Library/Application Support',
    '/Library',
    '/Library/Application Support',
    '/Library/Application Support/CrashReporter',
    '/Library/Caches',
    '/Library/Extensions',
    '/Library/Internet Plug-Ins',
    '/Library/LaunchAgents',
    '/Library/LaunchDaemons',
    '/Library/Logs',
    '/Library/Logs/DiagnosticReports',
    '/Library/Preferences',
    '/Library/PrivilegedHelperTools',
    '/private/var/db/receipts',
    '/private/tmp',
    '/usr/local/bin',
    '/usr/local/etc',
    '/usr/local/opt',
    '/usr/local/sbin',
    '/usr/local/share',
    '/usr/local/var',
  ];
}

// Location della ricerca inversa (orphan finder), da Locations.swift.
function reverseSearchPaths() {
  return [
    path.join(HOME, 'Library/Application Scripts'),
    path.join(HOME, 'Library/Application Support'),
    path.join(HOME, 'Library/Application Support/Caches'),
    path.join(HOME, 'Library/Application Support/com.apple.sharedfilelist/com.apple.LSSharedFileList.ApplicationRecentDocuments'),
    path.join(HOME, 'Library/Containers'),
    path.join(HOME, 'Library/Caches'),
    path.join(HOME, 'Library/HTTPStorages'),
    path.join(HOME, 'Library/Internet Plug-Ins'),
    path.join(HOME, 'Library/LaunchAgents'),
    path.join(HOME, 'Library/Logs'),
    path.join(HOME, 'Library/Preferences'),
    path.join(HOME, 'Library/PreferencePanes'),
    path.join(HOME, 'Library/Preferences/ByHost'),
    path.join(HOME, 'Library/Saved Application State'),
    path.join(HOME, 'Library/WebKit'),
    '/Users/Shared/Library/Application Support',
    '/Library/Application Support',
    '/Library/Application Support/CrashReporter',
    '/Library/Internet Plug-Ins',
    '/Library/LaunchAgents',
    '/Library/LaunchDaemons',
    '/Library/PrivilegedHelperTools',
  ];
}

module.exports = {
  appConditions,
  skipConditions,
  skipDeepSearch,
  skipReverse,
  standardLibrarySubdirectories,
  appSearchPaths,
  reverseSearchPaths,
};
