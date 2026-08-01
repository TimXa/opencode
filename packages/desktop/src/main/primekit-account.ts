import { app, safeStorage } from "electron"
import { chmodSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { getStore, removeStoreFileIfEmpty } from "./store"

const STORE = "primekit.account.dat"
const KEY = "tokens"
const SESSION_FILE = "primekit.session.json"
const SECURE_SESSION_FILE = "primekit.session.v1.bin"

type AuthTokens = { access_token: string; refresh_token: string }
export type PrimeKitUser = {
  id: string
  email?: string | null
  display_name?: string | null
  photo_url?: string | null
}

function validTokens(value: unknown): value is AuthTokens {
  if (!value || typeof value !== "object") return false
  const tokens = value as Partial<AuthTokens>
  return typeof tokens.access_token === "string" && typeof tokens.refresh_token === "string"
}

function readPlainTokens(): AuthTokens | undefined {
  try {
    const value = JSON.parse(readFileSync(join(app.getPath("userData"), SESSION_FILE), "utf8")) as unknown
    return validTokens(value) ? value : undefined
  } catch {
    return
  }
}

function securePath() {
  return join(app.getPath("userData"), SECURE_SESSION_FILE)
}

function writeSecureTokens(tokens: AuthTokens) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error("Защищённое хранилище Windows недоступно")
  const path = securePath()
  const temporary = `${path}.tmp`
  mkdirSync(app.getPath("userData"), { recursive: true })
  writeFileSync(temporary, safeStorage.encryptString(JSON.stringify(tokens)))
  renameSync(temporary, path)
}

function readTokens(): AuthTokens | undefined {
  // ponytail: ad-hoc development signatures change between builds, so macOS Keychain
  // repeatedly asks the user to trust the rebuilt app. Keep this local session
  // file owner-only until release builds use a stable Developer ID signature.
  getStore(STORE).delete(KEY)
  void removeStoreFileIfEmpty(STORE)
  if (process.platform !== "win32") return readPlainTokens()
  try {
    if (!safeStorage.isEncryptionAvailable()) return
    const value = JSON.parse(safeStorage.decryptString(readFileSync(securePath()))) as unknown
    return validTokens(value) ? value : undefined
  } catch {
    const legacy = readPlainTokens()
    if (!legacy) return
    try {
      writeSecureTokens(legacy)
      const verified = JSON.parse(safeStorage.decryptString(readFileSync(securePath()))) as unknown
      if (!validTokens(verified)) return
      unlinkSync(join(app.getPath("userData"), SESSION_FILE))
      return verified
    } catch {
      return
    }
  }
}

function writeTokens(tokens: AuthTokens) {
  if (process.platform === "win32") {
    writeSecureTokens(tokens)
    return
  }
  const directory = app.getPath("userData")
  const path = join(directory, SESSION_FILE)
  mkdirSync(directory, { recursive: true })
  writeFileSync(path, `${JSON.stringify(tokens)}\n`, { mode: 0o600 })
  chmodSync(path, 0o600)
}

function clearTokens() {
  try {
    unlinkSync(join(app.getPath("userData"), SESSION_FILE))
  } catch {}
  try {
    unlinkSync(securePath())
  } catch {}
  getStore(STORE).delete(KEY)
  void removeStoreFileIfEmpty(STORE)
}

async function errorMessage(response: Response) {
  const body = await response.json().catch(() => undefined)
  if (body && typeof body === "object" && "detail" in body) {
    const responseDetail = (body as { detail?: unknown }).detail
    if (typeof responseDetail === "string") return responseDetail
    if (Array.isArray(responseDetail)) {
      return responseDetail
        .map((item: unknown) => {
          if (!item || typeof item !== "object") return String(item)
          const detail = item as { loc?: unknown[]; msg?: string }
          const field = detail.loc?.filter((part) => part !== "body").join(".")
          return field ? `${field}: ${detail.msg ?? "Некорректное значение"}` : (detail.msg ?? "Некорректное значение")
        })
        .join("; ")
    }
  }
  return `PrimeKit вернул ошибку ${response.status}`
}

export function createPrimeKitAccount(baseURL = process.env.PRIMEKIT_ACCOUNT_API_URL ?? "https://primekit-job.ru/api") {
  let tokens: AuthTokens | undefined

  const load = () => (tokens ??= readTokens())
  const refresh = async () => {
    const current = load()
    if (!current?.refresh_token) throw new Error("Войдите в аккаунт PrimeKit")
    const response = await fetch(`${baseURL}/auth/refresh`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refresh_token: current.refresh_token }),
    })
    if (!response.ok) {
      clearTokens()
      tokens = undefined
      throw new Error("Сессия PrimeKit истекла. Войдите снова")
    }
    tokens = (await response.json()) as AuthTokens
    writeTokens(tokens)
  }

  const open = async (path: string, init: RequestInit = {}) => {
    const current = load()
    if (!current?.access_token) throw new Error("Войдите в аккаунт PrimeKit")
    const headers = new Headers(init.headers)
    headers.set("authorization", `Bearer ${current.access_token}`)
    const send = () =>
      fetch(`${baseURL}${path}`, {
        ...init,
        headers,
      })
    let response = await send()
    if (response.status === 401) {
      await refresh()
      headers.set("authorization", `Bearer ${tokens!.access_token}`)
      response = await send()
    }
    return response
  }

  const request = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
    const headers = new Headers(init.headers)
    if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json")
    const response = await open(path, { ...init, headers })
    if (!response.ok) throw new Error(await errorMessage(response))
    if (response.status === 204) return undefined as T
    return (await response.json()) as T
  }

  const publicRequest = async <T>(path: string, body: unknown): Promise<T> => {
    const response = await fetch(`${baseURL}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
    if (!response.ok) throw new Error(await errorMessage(response))
    return (await response.json()) as T
  }

  return {
    baseURL,
    open,
    request,
    signedIn: () => Boolean(load()?.access_token),
    credential: async () => {
      await request<PrimeKitUser>("/auth/me")
      return tokens!.access_token
    },
    state: async () => {
      if (!load()?.access_token) return { signedIn: false as const }
      try {
        const user = await request<PrimeKitUser>("/auth/me")
        return { signedIn: true as const, user }
      } catch {
        return { signedIn: false as const }
      }
    },
    requestEmailCode: (email: string) => publicRequest<{ status: string; email: string }>("/auth/email/request-code", { email }),
    verifyEmailCode: async (email: string, code: string) => {
      tokens = await publicRequest<AuthTokens>("/auth/email/verify-code", { email, code })
      writeTokens(tokens)
      return request<PrimeKitUser>("/auth/me")
    },
    logout: () => {
      tokens = undefined
      clearTokens()
    },
  }
}

export const primeKitAccount = createPrimeKitAccount()
