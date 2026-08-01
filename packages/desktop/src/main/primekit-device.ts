import { createHash, randomUUID } from "node:crypto"
import { access, mkdir, realpath } from "node:fs/promises"
import { homedir, hostname } from "node:os"
import { basename, join } from "node:path"
import { getStore } from "./store"
import { PRIMEKIT_DEVICE_ID_KEY } from "./store-keys"

export type PrimeKitPlatform = "macos" | "windows" | "linux"

export function primeKitPlatform(platform = process.platform): PrimeKitPlatform {
  if (platform === "darwin") return "macos"
  if (platform === "win32") return "windows"
  return "linux"
}

export function legacyMacDeviceID(home = homedir(), host = hostname()) {
  return `mac-${createHash("sha256").update(`${home}\0${host}`).digest("hex").slice(0, 32)}`
}

export function getPrimeKitDeviceIdentity() {
  const store = getStore()
  const saved = store.get(PRIMEKIT_DEVICE_ID_KEY)
  const platform = primeKitPlatform()
  const id =
    typeof saved === "string" && saved.length >= 3
      ? saved
      : platform === "macos"
        ? legacyMacDeviceID()
        : `${platform}-${randomUUID()}`
  if (saved !== id) store.set(PRIMEKIT_DEVICE_ID_KEY, id)
  const fallback = platform === "macos" ? "Кит Mac" : platform === "windows" ? "Кит Windows" : "Кит Linux"
  return { id, name: hostname() || fallback, platform }
}

export async function defaultPrimeKitWorkspace() {
  const configured = process.env.PRIMEKIT_WORKSPACE_PATH
  const legacyMac = join(homedir(), "Desktop", "Проекты", "PrimeKit")
  const candidate = configured || (process.platform === "darwin" ? legacyMac : join(homedir(), "PrimeKit"))
  try {
    await access(candidate)
  } catch {
    await mkdir(candidate, { recursive: true })
  }
  return realpath(candidate)
}

export const primeKitWorkspaceName = (root: string) => basename(root) || "PrimeKit"
