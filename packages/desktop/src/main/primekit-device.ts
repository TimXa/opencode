import { createHash, randomUUID } from "node:crypto"
import { app, safeStorage } from "electron"
import { chmodSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs"
import { access, mkdir, realpath } from "node:fs/promises"
import { homedir, hostname } from "node:os"
import { basename, join } from "node:path"
import { getStore } from "./store"
import { PRIMEKIT_DEVICE_ID_KEY } from "./store-keys"

const DEVICE_CREDENTIAL_FILE = "primekit.device-credential.v1.bin"
const DEVICE_CREDENTIAL_QA_FILE = "primekit.device-credential.qa.json"
const UNSIGNED_QA = import.meta.env.PRIMEKIT_UNSIGNED_QA

export type PrimeKitDeviceCredential = {
  device_id: string
  runtime_id: number
  device_token: string
  device_token_expires_at: string
}

function validDeviceCredential(value: unknown): value is PrimeKitDeviceCredential {
  if (!value || typeof value !== "object") return false
  const credential = value as Partial<PrimeKitDeviceCredential>
  return typeof credential.device_id === "string"
    && typeof credential.runtime_id === "number"
    && typeof credential.device_token === "string"
    && credential.device_token.startsWith("pkd_")
    && typeof credential.device_token_expires_at === "string"
}

function encryptedDeviceCredentialEnabled() {
  return process.platform === "win32" || (process.platform === "darwin" && app.isPackaged && !UNSIGNED_QA)
}

function deviceCredentialPath(encrypted = encryptedDeviceCredentialEnabled()) {
  return join(app.getPath("userData"), encrypted ? DEVICE_CREDENTIAL_FILE : DEVICE_CREDENTIAL_QA_FILE)
}

export function readPrimeKitDeviceCredential(deviceID: string) {
  const parse = (encrypted: boolean) => {
    const raw = readFileSync(deviceCredentialPath(encrypted))
    const value = JSON.parse(encrypted ? safeStorage.decryptString(raw) : raw.toString("utf8")) as unknown
    return validDeviceCredential(value) && value.device_id === deviceID ? value : undefined
  }
  const encrypted = encryptedDeviceCredentialEnabled()
  try {
    return parse(encrypted)
  } catch {
    if (!encrypted) return
    try {
      const qaCredential = parse(false)
      if (!qaCredential) return
      writePrimeKitDeviceCredential(qaCredential)
      unlinkSync(deviceCredentialPath(false))
      return qaCredential
    } catch {}
    return
  }
}

export function writePrimeKitDeviceCredential(credential: PrimeKitDeviceCredential) {
  const encrypted = encryptedDeviceCredentialEnabled()
  if (encrypted && !safeStorage.isEncryptionAvailable()) {
    throw new Error("Защищённое хранилище устройства недоступно")
  }
  const path = deviceCredentialPath(encrypted)
  const temporary = `${path}.tmp`
  mkdirSync(app.getPath("userData"), { recursive: true })
  const body = encrypted
    ? safeStorage.encryptString(JSON.stringify(credential))
    : Buffer.from(`${JSON.stringify(credential)}\n`)
  writeFileSync(temporary, body, { mode: 0o600 })
  chmodSync(temporary, 0o600)
  renameSync(temporary, path)
}

export function clearPrimeKitDeviceCredential() {
  for (const encrypted of [true, false]) {
    try {
      unlinkSync(deviceCredentialPath(encrypted))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
    }
  }
}

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
  const nativeE2EDeviceID = UNSIGNED_QA && app.isPackaged
    ? process.env.PRIMEKIT_NATIVE_E2E_DEVICE_ID
    : undefined
  const id =
    typeof nativeE2EDeviceID === "string" && nativeE2EDeviceID.startsWith(`${platform}-e2e-`)
      ? nativeE2EDeviceID
      : typeof saved === "string" && saved.length >= 3
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
  const candidate = configured || join(homedir(), "PrimeKit")
  try {
    await access(candidate)
  } catch {
    await mkdir(candidate, { recursive: true })
  }
  return realpath(candidate)
}

export const primeKitWorkspaceName = (root: string) => basename(root) || "PrimeKit"
