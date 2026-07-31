import { safeStorage } from "electron"
import { getStore, removeStoreFileIfEmpty } from "./store"

const STORE = "primekit.account.dat"
const KEY = "tokens"

type AuthTokens = { access_token: string; refresh_token: string }
export type PrimeKitUser = {
  id: string
  email?: string | null
  display_name?: string | null
  photo_url?: string | null
}

function readTokens(): AuthTokens | undefined {
  const encrypted = getStore(STORE).get(KEY)
  if (typeof encrypted !== "string" || !encrypted) return
  if (!safeStorage.isEncryptionAvailable()) return
  try {
    return JSON.parse(safeStorage.decryptString(Buffer.from(encrypted, "base64"))) as AuthTokens
  } catch {
    return
  }
}

function writeTokens(tokens: AuthTokens) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error("Защищённое хранилище macOS недоступно")
  const encrypted = safeStorage.encryptString(JSON.stringify(tokens)).toString("base64")
  getStore(STORE).set(KEY, encrypted)
}

function clearTokens() {
  getStore(STORE).delete(KEY)
  void removeStoreFileIfEmpty(STORE)
}

async function errorMessage(response: Response) {
  const body = await response.json().catch(() => undefined)
  if (body && typeof body === "object" && "detail" in body && typeof body.detail === "string") return body.detail
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
    const send = () =>
      fetch(`${baseURL}${path}`, {
        ...init,
        headers: { authorization: `Bearer ${tokens!.access_token}`, ...init.headers },
      })
    let response = await send()
    if (response.status === 401) {
      await refresh()
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
