import { spawn } from "node:child_process"
import { once } from "node:events"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { tmpdir } from "node:os"

const executable = resolve(process.argv[2] ?? "")
if (!process.argv[2] || !existsSync(executable)) throw new Error("Pass the packaged Kit executable path")

const baseURL = process.env.PRIMEKIT_E2E_BASE_URL ?? "http://127.0.0.1:18000"
const email = "universal-e2e@primekit.test"
const expected = "E2E_OK: файл создан локальным агентом и ответ синхронизирован в облачный чат."
const markerContent = "primekit-universal-agent-e2e\n"
const deadline = Date.now() + Number(process.env.PRIMEKIT_NATIVE_E2E_TIMEOUT_MS ?? 240_000)
const temporary = mkdtempSync(join(tmpdir(), "primekit-native-e2e-"))
const workspaceInput = join(temporary, "workspace")
const userData = join(temporary, "user-data")
const xdgRoot = join(temporary, "xdg")
const tokenFile = join(temporary, "tokens.json")
mkdirSync(workspaceInput)
const workspace = realpathSync(workspaceInput)
const marker = join(workspace, "E2E_NATIVE_MARKER.txt")
const restartMarker = join(workspace, "E2E_NATIVE_RESTART_MARKER.txt")
const deviceID = `${process.platform === "darwin" ? "macos" : process.platform}-e2e-${Date.now()}`
mkdirSync(userData)
for (const name of ["data", "config", "cache", "state"]) mkdirSync(join(xdgRoot, name), { recursive: true })

const delay = (ms) => new Promise((done) => setTimeout(done, ms))

async function request(path, init = {}, expectedStatus = 200) {
  const headers = new Headers(init.headers)
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json")
  const response = await fetch(`${baseURL}${path}`, { ...init, headers, signal: AbortSignal.timeout(15_000) })
  if (response.status !== expectedStatus) {
    throw new Error(`${init.method ?? "GET"} ${path}: ${response.status} ${await response.text()}`)
  }
  if (response.status === 204) return
  return response.json()
}

async function waitFor(label, read) {
  let latest
  while (Date.now() < deadline) {
    latest = await read()
    if (latest) return latest
    await delay(1_000)
  }
  throw new Error(`Timed out waiting for ${label}; last=${JSON.stringify(latest)}`)
}

let child
let passed = false
function startApp() {
  const launched = spawn(executable, [`--user-data-dir=${userData}`], {
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      PRIMEKIT_ACCOUNT_API_URL: baseURL,
      PRIMEKIT_WORKSPACE_PATH: workspace,
      PRIMEKIT_NATIVE_E2E: "1",
      PRIMEKIT_NATIVE_E2E_DEVICE_ID: deviceID,
      PRIMEKIT_NATIVE_E2E_TOKEN_FILE: tokenFile,
      PRIMEKIT_NATIVE_E2E_USER_DATA: userData,
      XDG_DATA_HOME: join(xdgRoot, "data"),
      XDG_CONFIG_HOME: join(xdgRoot, "config"),
      XDG_CACHE_HOME: join(xdgRoot, "cache"),
      XDG_STATE_HOME: join(xdgRoot, "state"),
      NO_PROXY: "127.0.0.1,localhost",
      no_proxy: "127.0.0.1,localhost",
    },
  })
  child = launched
  launched.stdout.on("data", (chunk) => process.stdout.write(`[app] ${chunk}`))
  launched.stderr.on("data", (chunk) => process.stderr.write(`[app] ${chunk}`))
  launched.once("exit", (code, signal) => {
    if (!passed && child === launched) {
      process.stderr.write(`Packaged Kit exited before E2E completion: code=${code} signal=${signal}\n`)
    }
  })
}

async function stopApp() {
  const running = child
  child = undefined
  if (!running || running.exitCode !== null) return
  running.kill()
  await Promise.race([once(running, "exit"), delay(10_000)])
  if (running.exitCode === null) running.kill("SIGKILL")
}

try {
  const requested = await request("/auth/email/request-code", {
    method: "POST",
    body: JSON.stringify({ email }),
  })
  if (!requested.dev_code) throw new Error("E2E backend did not return dev_code")
  const tokens = await request("/auth/email/verify-code", {
    method: "POST",
    body: JSON.stringify({ email, code: requested.dev_code }),
  })
  writeFileSync(tokenFile, `${JSON.stringify(tokens)}\n`, { mode: 0o600 })
  const auth = { authorization: `Bearer ${tokens.access_token}` }
  const chat = await request("/chats/", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ title: "Native packaged Universal Agent E2E" }),
  }, 201)

  startApp()

  const runtime = await waitFor("packaged runtime registration", async () => {
    const runtimes = await request("/desktop-agent/runtimes", { headers: auth })
    return runtimes.find((item) => item.workspace_path === workspace && item.status === "online")
  })
  const grant = await waitFor("packaged workspace grant", async () => {
    const grants = await request(`/desktop-agent/folder-grants?runtime_id=${runtime.id}`, { headers: auth })
    return grants.find((item) => item.active && item.root_path_display === workspace)
  })
  await request(`/desktop-agent/chats/${chat.id}/target`, {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ kind: "desktop", runtime_id: runtime.id, folder_grant_id: grant.id }),
  })
  const runTurn = async (targetMarker, sequence) => {
    const turn = await request(`/desktop-agent/chats/${chat.id}/turn`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        message: `Выполни нативную проверку локального write tool.\nPRIMEKIT_NATIVE_MARKER=${targetMarker}`,
        client_message_id: `native-e2e-${sequence}-${Date.now()}`,
      }),
    })
    if (turn.resolved_target?.runtime_id !== runtime.id) throw new Error("Turn routed to the wrong runtime")
    const command = await waitFor(`native command ${sequence} completion`, async () => {
      const value = await request(`/desktop-agent/commands/${turn.desktop_command_id}`, { headers: auth })
      if (["error", "cancelled", "expired"].includes(value.status)) {
        throw new Error(`Native command failed: ${value.status} ${value.error_text ?? ""}`)
      }
      return value.status === "completed" ? value : undefined
    })
    if (!existsSync(targetMarker) || readFileSync(targetMarker, "utf8") !== markerContent) {
      throw new Error(`Packaged local agent did not create marker ${sequence}`)
    }
    return command
  }

  const command = await runTurn(marker, 1)
  if (typeof command.result?.session_id !== "string") throw new Error("Native result lost local session identity")
  await stopApp()
  const restartedAt = Date.now()
  startApp()
  await waitFor("packaged runtime reconnect after restart", async () => {
    const runtimes = await request("/desktop-agent/runtimes", { headers: auth })
    const value = runtimes.find((item) => item.id === runtime.id && item.status === "online")
    return value && Date.parse(value.last_seen_at) >= restartedAt - 1_000 ? value : undefined
  })
  const restartedCommand = await runTurn(restartMarker, 2)
  if (restartedCommand.result?.session_id !== command.result.session_id) {
    throw new Error("Packaged restart lost the local agent session")
  }
  const canonical = await request(`/chats/${chat.id}`, { headers: auth })
  const assistant = canonical.messages.filter((message) => message.role === "assistant" && message.content === expected)
  if (assistant.length !== 2) throw new Error("Canonical cloud chat did not converge after packaged restart")

  passed = true
  console.log(JSON.stringify({
    status: "passed",
    platform: process.platform,
    chat_id: chat.id,
    runtime_id: runtime.id,
    command_id: command.id,
    restarted_command_id: restartedCommand.id,
    marker,
    restart_marker: restartMarker,
    restart_verified: true,
  }))
} finally {
  await stopApp()
  if (passed && process.env.PRIMEKIT_NATIVE_E2E_KEEP !== "1") rmSync(temporary, { recursive: true, force: true })
  else if (!passed) console.error(`Native E2E artifacts preserved at ${temporary}`)
}
