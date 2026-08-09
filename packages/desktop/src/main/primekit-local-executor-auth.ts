import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises"
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

type AuthPaths = { source?: string; target?: string }

/** Authorize only the hidden on-device executor. Cloud chat always goes through PrimeKit. */
export async function authorizeLocalExecutor(paths: AuthPaths = {}): Promise<boolean> {
  const source = paths.source ?? join(homedir(), ".codex", "auth.json")
  const target = paths.target ?? join(dataHome(), "opencode", "auth.json")
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
  const next = {
    type: "oauth",
    access,
    refresh,
    expires: jwtExpiry(access),
    ...(codex.tokens?.account_id ? { accountId: codex.tokens.account_id } : {}),
  }
  const existing = current.openai
  if (existing && JSON.stringify(existing) === JSON.stringify(next)) return true
  current.openai = next
  await mkdir(dirname(target), { recursive: true })
  const temporary = `${target}.${process.pid}.tmp`
  await writeFile(temporary, `${JSON.stringify(current, null, 2)}\n`, { mode: 0o600 })
  await rename(temporary, target)
  await chmod(target, 0o600)
  return true
}
