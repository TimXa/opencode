import { spawn, spawnSync } from "node:child_process"
import { once } from "node:events"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { tmpdir } from "node:os"

const executable = resolve(process.argv[2] ?? "")
if (!process.argv[2] || !existsSync(executable)) throw new Error("Pass the packaged Kit executable path")

const baseURL = process.env.PRIMEKIT_E2E_BASE_URL ?? "http://127.0.0.1:18000"
const email = "universal-e2e@primekit.test"
const expected = "E2E_OK: файл создан локальным агентом и ответ синхронизирован в облачный чат."
const markerContent = "primekit-universal-agent-e2e\n"
const terminalMarkerContent = "primekit-terminal-e2e"
const waitTimeout = Number(process.env.PRIMEKIT_NATIVE_E2E_TIMEOUT_MS ?? 240_000)
const temporary = mkdtempSync(join(tmpdir(), "primekit-native-e2e-"))
const workspaceInput = join(temporary, "workspace")
const userData = join(temporary, "user-data")
const xdgRoot = join(temporary, "xdg")
const tokenFile = join(temporary, "tokens.json")
mkdirSync(workspaceInput)
const workspace = realpathSync(workspaceInput)
const marker = join(workspace, "E2E_NATIVE_MARKER.txt")
const restartMarker = join(workspace, "E2E_NATIVE_RESTART_MARKER.txt")
const terminalMarker = join(workspace, "E2E_NATIVE_TERMINAL_MARKER.txt")
const platform = process.platform === "darwin" ? "macos" : process.platform === "win32" ? "windows" : process.platform
const configuredDeviceID = process.env.PRIMEKIT_NATIVE_E2E_DEVICE_ID
const deviceID = configuredDeviceID?.startsWith(`${platform}-e2e-`)
  ? configuredDeviceID
  : `${platform}-e2e-${Date.now()}`
const uiMode = process.env.PRIMEKIT_NATIVE_E2E_UI === "1"
const requireComputer = process.env.PRIMEKIT_NATIVE_E2E_REQUIRE_COMPUTER === "1"
const readyFile = process.env.PRIMEKIT_NATIVE_E2E_READY_FILE
const crossDeviceSequences = (process.env.PRIMEKIT_NATIVE_E2E_CROSS_SEQUENCES ?? "")
  .split(",")
  .map(value => Number(value.trim()))
  .filter(value => Number.isInteger(value) && value > 0)
const crossDeviceWorker = crossDeviceSequences.length > 0
mkdirSync(userData)
for (const name of ["data", "config", "cache", "state"]) mkdirSync(join(xdgRoot, name), { recursive: true })

const delay = (ms) => new Promise((done) => setTimeout(done, ms))

function canonicalPath(value) {
  try {
    const path = realpathSync(value)
    return process.platform === "win32" ? path.toLowerCase() : path
  } catch {
    const path = resolve(value)
    return process.platform === "win32" ? path.toLowerCase() : path
  }
}

const samePath = (left, right) => (
  typeof left === "string" && typeof right === "string" && (
    canonicalPath(left) === canonicalPath(right) || (() => {
      try {
        const leftStat = statSync(left, { bigint: true })
        const rightStat = statSync(right, { bigint: true })
        return leftStat.dev === rightStat.dev && leftStat.ino === rightStat.ino
      } catch {
        return false
      }
    })()
  )
)

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
  const deadline = Date.now() + waitTimeout
  let latest
  while (Date.now() < deadline) {
    latest = await read()
    if (latest) return latest
    await delay(1_000)
  }
  throw new Error(`Timed out waiting for ${label}; last=${JSON.stringify(latest)}`)
}

async function verifyComputerCapability(runtimeID, auth) {
  if (!requireComputer) return
  await waitFor("packaged Computer Use screenshot and input probe", async () => {
    const runtimes = await request("/desktop-agent/runtimes", { headers: auth })
    const runtime = runtimes.find((item) => item.id === runtimeID && item.status === "online")
    return runtime?.capabilities?.includes("computer_use") ? runtime : undefined
  })
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
  if (process.platform === "win32" && running.pid) {
    spawnSync("taskkill", ["/PID", String(running.pid), "/T", "/F"], { stdio: "ignore" })
    await Promise.race([once(running, "exit"), delay(10_000)])
    return
  }
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

  if (uiMode || crossDeviceWorker) {
    startApp()
    const runtime = await waitFor("packaged UI runtime registration", async () => {
      const runtimes = await request("/desktop-agent/runtimes", { headers: auth })
      return runtimes.find((item) => (
        item.device_id === deviceID && item.status === "online"
      ))
    })
    if (!samePath(runtime.workspace_path, workspace)) {
      throw new Error(`Packaged UI runtime registered the wrong workspace: ${runtime.workspace_path}`)
    }
    await verifyComputerCapability(runtime.id, auth)
    const grant = await waitFor("packaged UI workspace grant", async () => {
      const grants = await request(`/desktop-agent/folder-grants?runtime_id=${runtime.id}`, { headers: auth })
      return grants.find((item) => item.active && samePath(item.root_path_display, workspace))
    })
    if (crossDeviceWorker) {
      const markers = crossDeviceSequences.map(sequence => join(workspace, `E2E_NATIVE_CROSS_${sequence}.txt`))
      const ready = {
        status: "cross-device-ready",
        device_id: deviceID,
        device_name: runtime.device_name,
        platform: process.platform,
        runtime_id: runtime.id,
        folder_grant_id: grant.id,
        workspace,
        sequences: crossDeviceSequences,
        markers,
      }
      if (readyFile) writeFileSync(readyFile, `${JSON.stringify(ready)}\n`, { mode: 0o600 })
      console.log(JSON.stringify(ready))

      const canonical = await waitFor("cross-device browser turns", async () => {
        if (!markers.every(path => existsSync(path) && readFileSync(path, "utf8") === markerContent)) return
        const chats = await request("/chats/", { headers: auth })
        for (const summary of chats.slice(0, 30)) {
          const chat = await request(`/chats/${summary.id}`, { headers: auth })
          const completedEveryPrompt = markers.every(path => {
            const promptIndex = chat.messages.findIndex(message => (
              message.role === "user" && message.content?.includes(path)
            ))
            if (promptIndex < 0) return false
            const nextUserOffset = chat.messages.slice(promptIndex + 1).findIndex(message => message.role === "user")
            const turnEnd = nextUserOffset < 0 ? chat.messages.length : promptIndex + 1 + nextUserOffset
            const matches = chat.messages.slice(promptIndex + 1, turnEnd).filter(message => (
              message.role === "assistant" && message.content === expected
            ))
            if (matches.length > 1) throw new Error(`Cross-device result for ${path} was persisted more than once`)
            return matches.length === 1
          })
          if (completedEveryPrompt) return { chat }
        }
      })
      if (readyFile) {
        writeFileSync(readyFile, `${JSON.stringify({ ...ready, status: "cross-device-completed", chat_id: canonical.chat.id })}\n`, { mode: 0o600 })
      }
      passed = true
      console.log(JSON.stringify({
        status: "passed",
        mode: "cross-device-worker",
        platform: process.platform,
        chat_id: canonical.chat.id,
        runtime_id: runtime.id,
        sequences: crossDeviceSequences,
        markers,
      }))
    } else {
    const ready = {
      status: "ui-ready",
      device_name: runtime.device_name,
      runtime_id: runtime.id,
      folder_grant_id: grant.id,
      marker,
      prompt: `Выполни нативную проверку локального write tool.\nPRIMEKIT_NATIVE_MARKER=${marker}`,
    }
    if (readyFile) writeFileSync(readyFile, `${JSON.stringify(ready)}\n`, { mode: 0o600 })
    console.log(JSON.stringify(ready))

    const canonical = await waitFor("canonical cloud response submitted through the web UI", async () => {
      if (!existsSync(marker) || readFileSync(marker, "utf8") !== markerContent) return
      const chats = await request("/chats/", { headers: auth })
      for (const summary of chats.slice(0, 30)) {
        const chat = await request(`/chats/${summary.id}`, { headers: auth })
        const hasCurrentPrompt = chat.messages.some(message => (
          message.role === "user" && message.content?.includes(marker)
        ))
        if (!hasCurrentPrompt) continue
        const matches = chat.messages.filter((message) => message.role === "assistant" && message.content === expected)
        if (matches.length === 1) return { chat, matches }
        if (matches.length > 1) throw new Error("Canonical web UI result was persisted more than once")
      }
    })
    if (readyFile) {
      writeFileSync(readyFile, `${JSON.stringify({ ...ready, status: "ui-completed", chat_id: canonical.chat.id })}\n`, { mode: 0o600 })
    }
    passed = true
    console.log(JSON.stringify({
      status: "passed",
      mode: "web-ui",
      platform: process.platform,
      chat_id: canonical.chat.id,
      runtime_id: runtime.id,
      marker,
    }))
    }
  } else {
  const chat = await request("/chats/", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ title: "Native packaged Universal Agent E2E" }),
  }, 201)

  startApp()

  const runtime = await waitFor("packaged runtime registration", async () => {
    const runtimes = await request("/desktop-agent/runtimes", { headers: auth })
    return runtimes.find((item) => (
      item.device_id === deviceID && item.status === "online"
    ))
  })
  if (!samePath(runtime.workspace_path, workspace)) {
    throw new Error(`Packaged runtime registered the wrong workspace: ${runtime.workspace_path}`)
  }
  await verifyComputerCapability(runtime.id, auth)
  const grant = await waitFor("packaged workspace grant", async () => {
    const grants = await request(`/desktop-agent/folder-grants?runtime_id=${runtime.id}`, { headers: auth })
    return grants.find((item) => item.active && samePath(item.root_path_display, workspace))
  })
  await request(`/desktop-agent/chats/${chat.id}/target`, {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ kind: "desktop", runtime_id: runtime.id, folder_grant_id: grant.id }),
  })
  const runTurn = async (targetMarker, sequence, tool = "write") => {
    const admittedAt = Date.now()
    const markerKey = tool === "terminal" ? "PRIMEKIT_NATIVE_TERMINAL_MARKER" : "PRIMEKIT_NATIVE_MARKER"
    const turn = await request(`/desktop-agent/chats/${chat.id}/turn`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        message: `Выполни нативную проверку локального ${tool} tool.\n${markerKey}=${targetMarker}`,
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
    const wakeLatencyMs = Date.parse(command.delivered_at) - admittedAt
    if (!Number.isFinite(wakeLatencyMs) || wakeLatencyMs > 10_000) {
      throw new Error(`Packaged device wakeup took ${wakeLatencyMs}ms; SSE delivery is not working`)
    }
    const expectedMarker = tool === "terminal" ? terminalMarkerContent : markerContent
    if (!existsSync(targetMarker) || readFileSync(targetMarker, "utf8").trimEnd() !== expectedMarker.trimEnd()) {
      throw new Error(`Packaged local agent did not create marker ${sequence}`)
    }
    return { ...command, wake_latency_ms: wakeLatencyMs }
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
  const terminalCommand = await runTurn(terminalMarker, 3, "terminal")
  if (terminalCommand.result?.session_id !== command.result.session_id) {
    throw new Error("Packaged Terminal turn lost the local agent session")
  }
  const canonical = await request(`/chats/${chat.id}`, { headers: auth })
  const assistant = canonical.messages.filter((message) => message.role === "assistant" && message.content === expected)
  if (assistant.length !== 3) throw new Error("Canonical cloud chat did not converge after packaged Terminal turn")

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
    terminal_marker: terminalMarker,
    restart_verified: true,
    terminal_verified: true,
    wake_latency_ms: command.wake_latency_ms,
    restart_wake_latency_ms: restartedCommand.wake_latency_ms,
  }))
  }
} finally {
  await stopApp()
  if (passed && process.env.PRIMEKIT_NATIVE_E2E_KEEP !== "1") rmSync(temporary, { recursive: true, force: true })
  else if (!passed) console.error(`Native E2E artifacts preserved at ${temporary}`)
}
