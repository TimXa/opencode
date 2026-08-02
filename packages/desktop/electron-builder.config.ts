import { execFile } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

import type { Configuration } from "electron-builder"

const execFileAsync = promisify(execFile)
const packageDir = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(packageDir, "../..")
const signScript = path.join(rootDir, "script", "sign-windows.ps1")
// The Electron 42 packaging update briefly installed Linux launchers/icons under
// "opencode-desktop". Keep that hidden desktop entry around so existing GNOME/KDE
// pins still resolve after the canonical app id changes back to ai.opencode.desktop.
const legacyDesktopEntry = path.join(packageDir, "resources", "linux", "opencode-desktop.desktop")
const legacyDesktopEntryFpm = `${legacyDesktopEntry}=/usr/share/applications/opencode-desktop.desktop`

const metainfoFpm = (appId: string) =>
  `${path.join(packageDir, "resources", `${appId}.metainfo.xml`)}=/usr/share/metainfo/${appId}.metainfo.xml`

async function signWindows(configuration: { path: string }) {
  if (process.platform !== "win32") return
  if (process.env.GITHUB_ACTIONS !== "true") return

  const signingConfigured = [
    process.env.AZURE_TRUSTED_SIGNING_ENDPOINT,
    process.env.AZURE_TRUSTED_SIGNING_ACCOUNT_NAME,
    process.env.AZURE_TRUSTED_SIGNING_CERTIFICATE_PROFILE,
    process.env.PRIMEKIT_WINDOWS_PUBLISHER_NAME,
  ].every(Boolean)
  if (!signingConfigured) {
    if (process.env.PRIMEKIT_UNSIGNED_QA === "1") return
    throw new Error("PrimeKit production Windows signing is not configured")
  }

  await execFileAsync(
    "pwsh",
    ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", signScript, configuration.path],
    { cwd: rootDir },
  )
}

const channel = (() => {
  const raw = process.env.OPENCODE_CHANNEL
  if (raw === "dev" || raw === "beta" || raw === "prod") return raw
  return "dev"
})()

const APP_IDS = {
  dev: "ru.primekit.kit.desktop.dev",
  beta: "ru.primekit.kit.desktop.beta",
  prod: "ru.primekit.kit.desktop",
} as const

function getPublish(): Configuration["publish"] {
  const value = process.env.PRIMEKIT_RELEASE_REPOSITORY?.trim()
  if (!value) return null
  const match = /^([^/]+)\/([^/]+)$/.exec(value)
  if (!match) throw new Error("PRIMEKIT_RELEASE_REPOSITORY must be owner/repo")
  return [{ provider: "github", owner: match[1], repo: match[2], channel: "latest" }]
}

const getBase = (appId: string): Configuration => ({
  artifactName: "kit-desktop-${os}-${arch}.${ext}",
  directories: {
    output: "dist",
    buildResources: "resources",
  },
  // Linux launchers are .desktop files, so this is the desktop file name,
  // not just the app id. For prod, app id "ai.opencode.desktop" becomes
  // "ai.opencode.desktop.desktop".
  // https://developer.gnome.org/documentation/guidelines/maintainer/integrating.html
  // https://www.electron.build/docs/linux/
  extraMetadata: {
    desktopName: `${appId}.desktop`,
  },
  // Never infer the updater feed from the upstream OpenCode package metadata.
  publish: getPublish(),
  files: ["out/**/*", "resources/**/*", "!resources/opencode-cli*"],
  asarUnpack: ["**/node_modules/@trycua/**/*", "**/node_modules/@ubjs/**/*"],
  extraResources: [
    {
      from: "resources/",
      to: "",
      filter: ["opencode-cli*"],
    },
    {
      from: "native/",
      to: "native/",
      filter: ["index.js", "index.d.ts", "build/Release/mac_window.node", "swift-build/**"],
    },
  ],
  mac: {
    category: "public.app-category.developer-tools",
    icon: `resources/icons/icon.icns`,
    hardenedRuntime: true,
    gatekeeperAssess: false,
    entitlements: "resources/entitlements.plist",
    entitlementsInherit: "resources/entitlements.plist",
    notarize: true,
    target: ["dmg", "zip"],
  },
  dmg: {
    sign: true,
  },
  protocols: {
    name: "Кит",
    schemes: ["primekit"],
  },
  win: {
    icon: `resources/icons/icon.ico`,
    signtoolOptions: {
      sign: signWindows,
      publisherName: process.env.PRIMEKIT_WINDOWS_PUBLISHER_NAME,
    },
    target: ["nsis"],
    verifyUpdateCodeSignature: true,
  },
  nsis: {
    oneClick: true,
    perMachine: false,
    installerIcon: `resources/icons/icon.ico`,
    installerHeaderIcon: `resources/icons/icon.ico`,
  },
  linux: {
    icon: `resources/icons`,
    category: "Development",
    executableName: appId,
    desktop: {
      entry: {
        // Match the installed .desktop file and hicolor icon basename so
        // Linux shells can associate the running Electron window with its launcher.
        StartupWMClass: appId,
      },
    },
    target: ["AppImage", "deb", "rpm"],
  },
})

function getConfig() {
  const appId = APP_IDS[channel]
  const base = getBase(appId)

  switch (channel) {
    case "dev": {
      return {
        ...base,
        appId,
        productName: "Кит Dev",
        deb: { fpm: [metainfoFpm(appId)] },
        rpm: { packageName: "opencode-dev", fpm: [metainfoFpm(appId)] },
      }
    }
    case "beta": {
      return {
        ...base,
        appId,
        productName: "Кит Beta",
        protocols: { name: "Кит Beta", schemes: ["primekit"] },
        deb: { fpm: [metainfoFpm(appId)] },
        rpm: { packageName: "opencode-beta", fpm: [metainfoFpm(appId)] },
      }
    }
    case "prod": {
      const unsignedQA = process.env.PRIMEKIT_UNSIGNED_QA === "1"
      return {
        ...base,
        appId,
        productName: "Кит",
        forceCodeSigning: !unsignedQA,
        mac: unsignedQA
          ? { ...base.mac, identity: null, notarize: false, hardenedRuntime: false }
          : base.mac,
        dmg: unsignedQA ? { ...base.dmg, sign: false } : base.dmg,
        protocols: { name: "Кит", schemes: ["primekit"] },
        deb: { fpm: [metainfoFpm(appId), legacyDesktopEntryFpm] },
        rpm: { packageName: "opencode", fpm: [metainfoFpm(appId), legacyDesktopEntryFpm] },
      }
    }
  }
}

export default getConfig()
