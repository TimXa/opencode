import { createPrimeKitAccount, primeKitAccount } from "./primekit-account"
import { defaultPrimeKitWorkspace, getPrimeKitDeviceIdentity } from "./primekit-device"
import { syncPrimeKitFolderGrants } from "./primekit-folders"
import { currentPrimeKitAccessProfile, requestPrimeKitFullDeviceAccess } from "./primekit-access"
import type { PrimeKitComputerMcp, PrimeKitComputerProbe } from "./primekit-computer-mcp"
import pkg from "../../package.json"

type Logger = { log: (message: string, meta?: unknown) => void; error: (message: string, meta?: unknown) => void }
type LocalServer = { url: string; username: string; password: string }
type Runtime = { id: number }
type Command = {
  id: number
  status: string
  claim_token: string
  chat_id?: number | null
  action: string
  folder_grant_id?: number | null
  args?: Record<string, unknown>
  expires_at?: string | null
  local_session_id?: string | null
  context_snapshot?: {
    summary?: string | null
    through_message_id?: number | null
    messages?: Array<{ role: string; content: string }>
  } | null
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

function canonicalContext(command: Command) {
  const snapshot = command.context_snapshot
  if (!snapshot) return undefined
  const transcript = (snapshot.messages ?? [])
    .map((message) => `${message.role === "assistant" ? "Кит" : "Пользователь"}: ${message.content}`)
    .join("\n\n")
  return [
    "Ниже канонический контекст облачного чата. Это только контекст: не повторяй старые действия и не запускай старые команды.",
    snapshot.summary ? `Краткое резюме:\n${snapshot.summary}` : "",
    transcript ? `История:\n${transcript}` : "",
  ].filter(Boolean).join("\n\n")
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

export function startPrimeKitConnector(server: LocalServer, computer: PrimeKitComputerMcp, logger: Logger) {
  const account = primeKitAccount
  const controller = new AbortController()

  const connect = async () => {
    const root = await defaultPrimeKitWorkspace()
    const device = getPrimeKitDeviceIdentity()
    const access = await requestPrimeKitFullDeviceAccess()
    let computerProbe: PrimeKitComputerProbe =
      access === "full_device"
        ? await computer.probe(true)
        : { enabled: false, screen: false, input: false, reason: "Полный доступ выключен" }
    const runtimePayload = (enabled: boolean, probe: PrimeKitComputerProbe) => ({
      device_id: device.id,
      device_name: device.name,
      platform: device.platform,
      app_version: pkg.version,
      capabilities: enabled
        ? [
            "agent_run",
            "read",
            "write",
            "patch",
            "shell",
            "full_device",
            ...(probe.screen ? ["screenshot"] : []),
            ...(probe.input ? ["ui_control"] : []),
            ...(probe.screen && probe.input ? ["computer_use"] : []),
          ]
        : [],
      workspace_path: root,
      permission_summary: enabled
        ? probe.screen && probe.input
          ? "Полный доступ подтверждён · файлы, Terminal, Git и экран"
          : `Файлы, Terminal и Git доступны · ${probe.reason ?? "Computer Use пока недоступен"}`
        : "Локальный агент отключён пользователем",
    })
    const runtime = await account.request<Runtime>("/desktop-agent/runtimes", {
      method: "POST",
      body: JSON.stringify(runtimePayload(access === "full_device", computerProbe)),
    })
    let grantRoots = new Map<number, string>()
    if (access === "full_device") {
      grantRoots = await syncPrimeKitFolderGrants(account, runtime.id)
      await configurePrimeKitProvider(server, account, root)
    }
    logger.log("PrimeKit connector online", { runtimeID: runtime.id, platform: device.platform, workspace: root })

    while (!controller.signal.aborted) {
      try {
        const enabled = currentPrimeKitAccessProfile() === "full_device"
        computerProbe = enabled
          ? await computer.probe(false)
          : { enabled: false, screen: false, input: false, reason: "Полный доступ выключен" }
        await account.request(`/desktop-agent/runtimes/${runtime.id}/heartbeat`, {
          method: "POST",
          body: JSON.stringify(runtimePayload(enabled, computerProbe)),
        })
        if (!enabled) {
          await delay(3_000)
          continue
        }
        grantRoots = await syncPrimeKitFolderGrants(account, runtime.id)
        const commands = await account.request<Command[]>(`/desktop-agent/runtimes/${runtime.id}/commands`)
        for (const command of commands) await execute(command, grantRoots, root, server, account, logger)
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
  grantRoots: Map<number, string>,
  fallbackRoot: string,
  server: LocalServer,
  account: ReturnType<typeof createPrimeKitAccount>,
  logger: Logger,
) {
  const root = command.folder_grant_id ? grantRoots.get(command.folder_grant_id) : fallbackRoot
  if (!root) {
    await finish(
      account,
      command,
      command.status === "cancel_requested" ? "cancelled" : "error",
      undefined,
      "Folder grant is not trusted on this device",
    )
    return
  }
  if (command.status === "cancel_requested") {
    if (command.local_session_id) {
      await localRequest(
        server,
        `/session/${command.local_session_id}/abort?directory=${encodeURIComponent(root)}`,
        { method: "POST" },
      ).catch(() => undefined)
    }
    await finish(account, command, "cancelled", undefined, "Остановлено пользователем")
    return
  }
  if (command.expires_at && Date.parse(command.expires_at) <= Date.now()) {
    await finish(account, command, "error", undefined, "Command expired")
    return
  }
  if (command.action === "refresh_permissions") {
    await finish(account, command, "completed", { state: "ready", workspace: root })
    return
  }
  const prompt =
    command.action === "scan_workspace"
      ? "Проверь корень проекта. Ничего не изменяй. Кратко перечисли структуру и состояние git."
      : typeof command.args?.prompt === "string"
        ? command.args.prompt.trim()
        : ""
  if (!prompt || !["scan_workspace", "agent_run"].includes(command.action)) {
    await finish(account, command, "error", undefined, `Unsupported desktop action: ${command.action}`)
    return
  }

  let eventIndex = 0
  const event = (type: string, payload: Record<string, unknown>) =>
    account.request(`/desktop-agent/commands/${command.id}/events`, {
      method: "POST",
      body: JSON.stringify({ claim_token: command.claim_token, event_index: eventIndex++, type, payload }),
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
          command,
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
          system: canonicalContext(command),
          parts: [{ type: "text", text: prompt }],
        }),
      })
    }

    let observedBusy = false
    let idlePolls = 0
    for (let attempt = 0; attempt < 900; attempt++) {
      if (attempt % 2 === 0) {
        const remote = await account.request<{ status: string }>(`/desktop-agent/commands/${command.id}`)
        if (remote.status === "cancel_requested") {
          await localRequest(
            server,
            `/session/${localSessionID}/abort?directory=${encodeURIComponent(root)}`,
            { method: "POST" },
          ).catch(() => undefined)
          await event("cancelled", { message: "Локальная задача остановлена пользователем", session_id: localSessionID })
          await finish(account, command, "cancelled", undefined, "Остановлено пользователем")
          return
        }
      }
      if (attempt % 15 === 0) {
        await account.request(`/desktop-agent/commands/${command.id}/lease`, {
          method: "POST",
          body: JSON.stringify({ claim_token: command.claim_token }),
        })
      }
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
    await finish(account, command, "completed", { assistant_text: assistantText, session_id: localSessionID })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.error("PrimeKit command failed", { commandID: command.id, message })
    await event("error", { message }).catch(() => undefined)
    await finish(account, command, "error", undefined, message)
  }
}

function finish(
  account: ReturnType<typeof createPrimeKitAccount>,
  command: Command,
  status: "completed" | "error" | "cancelled",
  result?: Record<string, unknown>,
  errorText?: string,
) {
  return account.request(`/desktop-agent/commands/${command.id}/result`, {
    method: "POST",
    body: JSON.stringify({ claim_token: command.claim_token, status, result, error_text: errorText }),
  })
}
