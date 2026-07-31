import { mkdir, readFile, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join } from "node:path"

type CodexAuth = {
  tokens?: { access_token?: string; refresh_token?: string; account_id?: string }
}

function dataHome() {
  return process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share")
}

function jwtExpiry(token: string) {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString())
    if (typeof payload.exp === "number") return payload.exp * 1000
  } catch {}
  return Date.now() + 60 * 60 * 1000
}

/** Authorize only the hidden on-device executor. Cloud chat always goes through PrimeKit. */
export async function authorizeLocalExecutor(): Promise<boolean> {
  const source = join(homedir(), ".codex", "auth.json")
  const target = join(dataHome(), "opencode", "auth.json")
  let codex: CodexAuth
  try {
    codex = JSON.parse(await readFile(source, "utf8"))
  } catch {
    return false
  }
  const access = codex.tokens?.access_token
  const refresh = codex.tokens?.refresh_token
  if (!access || !refresh) return false

  let current: Record<string, unknown> = {}
  try {
    current = JSON.parse(await readFile(target, "utf8"))
  } catch {}
  if (current.openai) return true
  current.openai = {
    type: "oauth",
    access,
    refresh,
    expires: jwtExpiry(access),
    ...(codex.tokens?.account_id ? { accountId: codex.tokens.account_id } : {}),
  }
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, `${JSON.stringify(current, null, 2)}\n`, { mode: 0o600 })
  return true
}
