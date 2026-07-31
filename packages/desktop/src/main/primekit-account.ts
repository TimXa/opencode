import { execFile } from "node:child_process"
import { promisify } from "node:util"

const run = promisify(execFile)
const service = "ru.primekit.kit.macos"

type AuthTokens = { access_token: string; refresh_token: string }

async function readKeychain(account: string) {
  try {
    const result = await run("/usr/bin/security", ["find-generic-password", "-s", service, "-a", account, "-w"])
    return result.stdout.trim() || undefined
  } catch {
    return undefined
  }
}

async function writeKeychain(account: string, value: string) {
  await run("/usr/bin/security", [
    "add-generic-password",
    "-U",
    "-s",
    service,
    "-a",
    account,
    "-w",
    value,
  ])
}

export function createPrimeKitAccount(baseURL = process.env.PRIMEKIT_ACCOUNT_API_URL ?? "https://primekit-job.ru/api") {
  let access = ""

  const refresh = async () => {
    const refreshToken = await readKeychain("refresh_token")
    if (!refreshToken) throw new Error("PrimeKit account is not signed in")
    const response = await fetch(`${baseURL}/auth/refresh`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken }),
    })
    if (!response.ok) throw new Error(`PrimeKit token refresh failed (${response.status})`)
    const tokens = (await response.json()) as AuthTokens
    access = tokens.access_token
    await Promise.all([
      writeKeychain("access_token", tokens.access_token),
      writeKeychain("refresh_token", tokens.refresh_token),
    ])
  }

  const request = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
    if (!access) access = (await readKeychain("access_token")) ?? ""
    if (!access) throw new Error("PrimeKit account is not signed in")
    const send = () =>
      fetch(`${baseURL}${path}`, {
        ...init,
        headers: {
          authorization: `Bearer ${access}`,
          "content-type": "application/json",
          ...init.headers,
        },
      })
    let response = await send()
    if (response.status === 401) {
      await refresh()
      response = await send()
    }
    if (!response.ok) throw new Error(`PrimeKit ${path} failed (${response.status})`)
    if (response.status === 204) return undefined as T
    return (await response.json()) as T
  }

  return { request }
}
