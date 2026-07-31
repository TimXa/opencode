import { createHash } from "node:crypto"
import { access, realpath } from "node:fs/promises"
import { homedir, hostname } from "node:os"
import { join } from "node:path"
import { createPrimeKitAccount } from "./primekit-account"

type Logger = { log: (message: string, meta?: unknown) => void; error: (message: string, meta?: unknown) => void }
type LocalServer = { url: string; username: string; password: string }
type Runtime = { id: number }
type Grant = { id: number; runtime_id: number; root_path_display: string; active: boolean }
type Command = {
  id: number
  action: string
  folder_grant_id?: number | null
  args?: Record<string, unknown>
  expires_at?: string | null
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function basic(server: LocalServer) {
  return `Basic ${Buffer.from(`${server.username}:${server.password}`).toString("base64")}`
}

function deviceID() {
  return `mac-${createHash("sha256").update(`${homedir()}\0${hostname()}`).digest("hex").slice(0, 32)}`
}

async function defaultWorkspace() {
  const configured = process.env.PRIMEKIT_WORKSPACE_PATH
  const candidate = configured || join(homedir(), "Desktop", "Проекты", "PrimeKit")
  try {
    await access(candidate)
    return await realpath(candidate)
  } catch {
    return await realpath(homedir())
  }
}

function localRequest<T>(server: LocalServer, path: string, init: RequestInit = {}): Promise<T> {
  return fetch(`${server.url}${path}`, {
    ...init,
    headers: { authorization: basic(server), "content-type": "application/json", ...init.headers },
  }).then(async (response) => {
    if (!response.ok) throw new Error(`Local Kit ${path} failed (${response.status})`)
    if (response.status === 204) return undefined as T
    return (await response.json()) as T
  })
}

function textFromMessages(messages: unknown) {
  if (!Array.isArray(messages)) return ""
  for (const item of [...messages].reverse()) {
    if (!item || typeof item !== "object") continue
    const row = item as { info?: { role?: string }; parts?: Array<{ type?: string; text?: string }> }
    if (row.info?.role !== "assistant") continue
    const text = (row.parts ?? []).filter((part) => part.type === "text").map((part) => part.text ?? "").join("\n")
    if (text.trim()) return text.trim()
  }
  return ""
}

export function startPrimeKitConnector(server: LocalServer, logger: Logger) {
  const account = createPrimeKitAccount()
  const controller = new AbortController()

  const run = async () => {
    const root = await defaultWorkspace()
    const runtime = await account.request<Runtime>("/desktop-agent/runtimes", {
      method: "POST",
      body: JSON.stringify({
        device_id: deviceID(),
        device_name: hostname() || "Кит Mac",
        platform: "macos",
        app_version: "1.18.10",
        capabilities: ["agent_run", "read", "write", "patch", "shell"],
        workspace_path: root,
        permission_summary: "OpenCode permissions · local workspace scope",
      }),
    })
    const grants = await account.request<Grant[]>(`/desktop-agent/folder-grants?runtime_id=${runtime.id}`)
    let grant = grants.find((item) => item.active && item.root_path_display === root)
    if (!grant) {
      grant = await account.request<Grant>(`/desktop-agent/runtimes/${runtime.id}/folder-grants`, {
        method: "POST",
        body: JSON.stringify({
          display_name: root.split("/").at(-1) || "PrimeKit",
          root_path_display: root,
          capabilities: ["read", "write", "patch", "shell"],
        }),
      })
    }
    logger.log("PrimeKit Mac connector online", { runtimeID: runtime.id, workspace: root })

    while (!controller.signal.aborted) {
      try {
        await account.request(`/desktop-agent/runtimes/${runtime.id}/heartbeat`, {
          method: "POST",
          body: JSON.stringify({
            device_id: deviceID(),
            device_name: hostname() || "Кит Mac",
            platform: "macos",
            app_version: "1.18.10",
            capabilities: ["agent_run", "read", "write", "patch", "shell"],
            workspace_path: root,
            permission_summary: "OpenCode permissions · local workspace scope",
          }),
        })
        const commands = await account.request<Command[]>(`/desktop-agent/runtimes/${runtime.id}/commands`)
        for (const command of commands) await execute(command, grant!.id, root, server, account, logger)
      } catch (error) {
        logger.error("PrimeKit connector poll failed", { message: error instanceof Error ? error.message : String(error) })
      }
      await delay(3_000)
    }
  }

  void run().catch((error) => logger.error("PrimeKit connector stopped", { message: String(error) }))
  return { stop: () => controller.abort() }
}

async function execute(
  command: Command,
  localGrantID: number,
  root: string,
  server: LocalServer,
  account: ReturnType<typeof createPrimeKitAccount>,
  logger: Logger,
) {
  if (command.expires_at && Date.parse(command.expires_at) <= Date.now()) {
    await finish(account, command.id, "error", undefined, "Command expired")
    return
  }
  if (command.folder_grant_id && command.folder_grant_id !== localGrantID) {
    await finish(account, command.id, "error", undefined, "Folder grant is not trusted on this Mac")
    return
  }
  if (command.action === "refresh_permissions") {
    await finish(account, command.id, "completed", { state: "ready", workspace: root })
    return
  }
  const prompt =
    command.action === "scan_workspace"
      ? "Проверь корень проекта. Ничего не изменяй. Кратко перечисли структуру и состояние git."
      : typeof command.args?.prompt === "string"
        ? command.args.prompt.trim()
        : ""
  if (!prompt || !["scan_workspace", "agent_run"].includes(command.action)) {
    await finish(account, command.id, "error", undefined, `Unsupported desktop action: ${command.action}`)
    return
  }

  let eventIndex = 0
  const event = (type: string, payload: Record<string, unknown>) =>
    account.request(`/desktop-agent/commands/${command.id}/events`, {
      method: "POST",
      body: JSON.stringify({ event_index: eventIndex++, type, payload }),
    })
  await event("progress", { message: "Кит запустил локального агента", workspace: root })
  try {
    const session = await localRequest<{ id: string }>(server, `/session?directory=${encodeURIComponent(root)}`, {
      method: "POST",
      body: JSON.stringify({ title: `PrimeKit command #${command.id}` }),
    })
    await localRequest(server, `/session/${session.id}/prompt_async?directory=${encodeURIComponent(root)}`, {
      method: "POST",
      body: JSON.stringify({
        agent: "build",
        model: { providerID: "openai", modelID: "gpt-5.4" },
        parts: [{ type: "text", text: prompt }],
      }),
    })
    await event("progress", { message: "Локальная сессия создана", session_id: session.id })

    let observedBusy = false
    let idlePolls = 0
    for (let attempt = 0; attempt < 900; attempt++) {
      const statuses = await localRequest<Record<string, { type: string }>>(
        server,
        `/session/status?directory=${encodeURIComponent(root)}`,
      )
      const status = statuses[session.id]
      if (status) {
        observedBusy = true
        idlePolls = 0
      } else {
        idlePolls++
      }
      // Very short tasks may finish before the first status poll.
      if (!status && (observedBusy || idlePolls >= 3)) break
      await delay(1_000)
    }
    const messages = await localRequest<unknown>(
      server,
      `/session/${session.id}/message?directory=${encodeURIComponent(root)}&limit=100`,
    )
    const assistantText = textFromMessages(messages) || "Кит завершил локальную задачу."
    await event("result", { message: assistantText, session_id: session.id })
    await finish(account, command.id, "completed", { assistant_text: assistantText, session_id: session.id })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.error("PrimeKit command failed", { commandID: command.id, message })
    await event("error", { message }).catch(() => undefined)
    await finish(account, command.id, "error", undefined, message)
  }
}

function finish(
  account: ReturnType<typeof createPrimeKitAccount>,
  commandID: number,
  status: "completed" | "error",
  result?: Record<string, unknown>,
  errorText?: string,
) {
  return account.request(`/desktop-agent/commands/${commandID}/result`, {
    method: "POST",
    body: JSON.stringify({ status, result, error_text: errorText }),
  })
}
