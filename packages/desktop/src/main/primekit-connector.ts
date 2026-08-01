import { createPrimeKitAccount, primeKitAccount } from "./primekit-account"
import { defaultPrimeKitWorkspace, getPrimeKitDeviceIdentity, primeKitWorkspaceName } from "./primekit-device"
import pkg from "../../package.json"

type Logger = { log: (message: string, meta?: unknown) => void; error: (message: string, meta?: unknown) => void }
type LocalServer = { url: string; username: string; password: string }
type Runtime = { id: number }
type Grant = { id: number; runtime_id: number; root_path_display: string; active: boolean }
type Command = {
  id: number
  chat_id?: number | null
  action: string
  folder_grant_id?: number | null
  args?: Record<string, unknown>
  expires_at?: string | null
  local_session_id?: string | null
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function basic(server: LocalServer) {
  return `Basic ${Buffer.from(`${server.username}:${server.password}`).toString("base64")}`
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

function textFromMessages(messages: unknown, parentID: string) {
  if (!Array.isArray(messages)) return ""
  for (const item of [...messages].reverse()) {
    if (!item || typeof item !== "object") continue
    const row = item as { info?: { role?: string; parentID?: string }; parts?: Array<{ type?: string; text?: string }> }
    if (row.info?.role !== "assistant" || row.info.parentID !== parentID) continue
    const text = (row.parts ?? []).filter((part) => part.type === "text").map((part) => part.text ?? "").join("\n")
    if (text.trim()) return text.trim()
  }
  return ""
}

async function activeModel(server: LocalServer, root: string) {
  await localRequest(server, `/config?directory=${encodeURIComponent(root)}`)
  return { providerID: "openai", modelID: "kit" }
}

async function configurePrimeKitProvider(
  server: LocalServer,
  account: ReturnType<typeof createPrimeKitAccount>,
  root: string,
) {
  const key = await account.credential()
  const api = `${account.baseURL}/v1`
  await localRequest(server, "/auth/openai", {
    method: "PUT",
    body: JSON.stringify({ type: "api", key }),
  })
  await localRequest(server, "/global/config", {
    method: "PATCH",
    body: JSON.stringify({
      model: "openai/kit",
      permission: "allow",
      provider: {
        openai: {
          name: "Кит",
          npm: "@ai-sdk/openai-compatible",
          api,
          models: { kit: { name: "Кит" } },
          options: { baseURL: api },
        },
      },
    }),
  })
  await localRequest(server, "/global/dispose", { method: "POST" })
  await localRequest(server, `/config?directory=${encodeURIComponent(root)}`, {
    method: "PATCH",
    body: JSON.stringify({
      model: "openai/kit",
      permission: "allow",
      provider: {
        openai: {
          name: "Кит",
          npm: "@ai-sdk/openai-compatible",
          api,
          models: { kit: { name: "Кит" } },
          options: { baseURL: api },
        },
      },
    }),
  })
  await localRequest(server, `/instance/dispose?directory=${encodeURIComponent(root)}`, { method: "POST" })
}

export function startPrimeKitConnector(server: LocalServer, logger: Logger) {
  const account = primeKitAccount
  const controller = new AbortController()

  const connect = async () => {
    const root = await defaultPrimeKitWorkspace()
    const device = getPrimeKitDeviceIdentity()
    const runtimePayload = {
      device_id: device.id,
      device_name: device.name,
      platform: device.platform,
      app_version: pkg.version,
      capabilities: ["agent_run", "read", "write", "patch", "shell"],
      workspace_path: root,
      permission_summary: "Разрешения Кита · локальная папка проекта",
    }
    const runtime = await account.request<Runtime>("/desktop-agent/runtimes", {
      method: "POST",
      body: JSON.stringify(runtimePayload),
    })
    const grants = await account.request<Grant[]>(`/desktop-agent/folder-grants?runtime_id=${runtime.id}`)
    let grant = grants.find((item) => item.active && item.root_path_display === root)
    if (!grant) {
      grant = await account.request<Grant>(`/desktop-agent/runtimes/${runtime.id}/folder-grants`, {
        method: "POST",
        body: JSON.stringify({
          display_name: primeKitWorkspaceName(root),
          root_path_display: root,
          capabilities: ["read", "write", "patch", "shell"],
        }),
      })
    }
    await configurePrimeKitProvider(server, account, root)
    logger.log("PrimeKit connector online", { runtimeID: runtime.id, platform: device.platform, workspace: root })

    while (!controller.signal.aborted) {
      try {
        await account.request(`/desktop-agent/runtimes/${runtime.id}/heartbeat`, {
          method: "POST",
          body: JSON.stringify(runtimePayload),
        })
        const commands = await account.request<Command[]>(`/desktop-agent/runtimes/${runtime.id}/commands`)
        for (const command of commands) await execute(command, grant!.id, root, server, account, logger)
      } catch (error) {
        logger.error("PrimeKit connector poll failed", { message: error instanceof Error ? error.message : String(error) })
      }
      await delay(3_000)
    }
  }

  const supervise = async () => {
    while (!controller.signal.aborted) {
      if (!account.signedIn()) {
        await delay(3_000)
        continue
      }
      try {
        await connect()
      } catch (error) {
        logger.error("PrimeKit connector reconnecting", {
          message: error instanceof Error ? error.message : String(error),
        })
      }
      if (!controller.signal.aborted) await delay(10_000)
    }
  }

  void supervise()
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
    await finish(account, command.id, "error", undefined, "Folder grant is not trusted on this device")
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
    }).catch(() => undefined)
  await event("progress", { message: "Кит запустил локального агента", workspace: root })
  try {
    let localSessionID = command.local_session_id ?? undefined
    if (localSessionID) {
      const exists = await localRequest<{ id: string }>(
        server,
        `/session/${localSessionID}?directory=${encodeURIComponent(root)}`,
      ).then(
        () => true,
        () => false,
      )
      if (!exists) {
        await finish(
          account,
          command.id,
          "error",
          undefined,
          "Local execution state was lost after the command started; retry explicitly after checking the workspace",
        )
        return
      }
    }
    if (!localSessionID) {
      const created = await localRequest<{ id: string }>(server, `/session?directory=${encodeURIComponent(root)}`, {
        method: "POST",
        body: JSON.stringify({ title: `PrimeKit chat #${command.chat_id ?? command.id}` }),
      })
      localSessionID = created.id
    }
    await event("session", { message: "Локальная сессия подключена", session_id: localSessionID })
    await configurePrimeKitProvider(server, account, root)
    const model = await activeModel(server, root)
    logger.log("PrimeKit local agent selected", model)
    const localMessageID = `msg_pk_cmd_${command.id}`
    const existingMessages = await localRequest<Array<{ info?: { id?: string } }>>(
      server,
      `/session/${localSessionID}/message?directory=${encodeURIComponent(root)}&limit=100`,
    )
    const alreadySubmitted = existingMessages.some((message) => message.info?.id === localMessageID)
    if (!alreadySubmitted) {
      await localRequest(server, `/session/${localSessionID}/prompt_async?directory=${encodeURIComponent(root)}`, {
        method: "POST",
        body: JSON.stringify({
          messageID: localMessageID,
          agent: "build",
          model,
          parts: [{ type: "text", text: prompt }],
        }),
      })
    }

    let observedBusy = false
    let idlePolls = 0
    for (let attempt = 0; attempt < 900; attempt++) {
      const statuses = await localRequest<Record<string, { type: string }>>(
        server,
        `/session/status?directory=${encodeURIComponent(root)}`,
      )
      const status = statuses[localSessionID]
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
      `/session/${localSessionID}/message?directory=${encodeURIComponent(root)}&limit=100`,
    )
    const assistantText = textFromMessages(messages, localMessageID)
    if (!assistantText) throw new Error("Local agent completed without a matching assistant response")
    await event("result", { message: assistantText, session_id: localSessionID })
    await finish(account, command.id, "completed", { assistant_text: assistantText, session_id: localSessionID })
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
