import { createWriteStream } from "node:fs"
import { mkdir, rename, unlink } from "node:fs/promises"
import { basename, join } from "node:path"
import { app } from "electron"
import { createPrimeKitAccount, primeKitAccount } from "./primekit-account"
import {
  defaultPrimeKitWorkspace,
  getPrimeKitDeviceIdentity,
  readPrimeKitDeviceCredential,
  writePrimeKitDeviceCredential,
} from "./primekit-device"
import { syncPrimeKitFolderGrants } from "./primekit-folders"
import {
  currentPrimeKitAccessProfile,
  currentPrimeKitComputerPermissionState,
  requestPrimeKitFullDeviceAccess,
  setPrimeKitComputerPermissionState,
} from "./primekit-access"
import type { PrimeKitComputerMcp, PrimeKitComputerProbe } from "./primekit-computer-mcp"
import { subscribePrimeKitSidebarEvents } from "./primekit-sidebar-events"
import { getStore } from "./store"
import { PRIMEKIT_COMMAND_SESSIONS_KEY, PRIMEKIT_COMPUTER_PERMISSION_PROMPTED_KEY } from "./store-keys"
import { mirrorLocalAgentEvents, type MirroredPart } from "./primekit-command-events"
import { disposeProviderCacheRequest, modelTokenRequest } from "./primekit-connector-protocol"
import { commandWorkspace } from "./primekit-workspace"
import pkg from "../../package.json"

type Logger = { log: (message: string, meta?: unknown) => void; error: (message: string, meta?: unknown) => void }
type LocalServer = { url: string; username: string; password: string }
type Runtime = { id: number; device_token: string; device_token_expires_at: string }
type DeviceClient = {
  request: <T>(path: string, init?: RequestInit) => Promise<T>
  download: (path: string, init?: RequestInit) => Promise<Response>
}
type ModelCredential = {
  access_token: string
  expires_in: number
  gateway: { configured: boolean; model: string }
}
type Command = {
  id: number
  runtime_id: number
  status: string
  claim_token: string
  chat_id?: number | null
  action: string
  folder_grant_id?: number | null
  cwd_relative?: string | null
  args?: Record<string, unknown>
  expires_at?: string | null
  local_session_id?: string | null
  context_snapshot?: {
    summary?: string | null
    through_message_id?: number | null
    messages?: Array<{ role: string; content: string }>
  } | null
}
type CommandSession = { session_id: string; root: string; recorded_at: number }
type CommandEvent = { event_index: number }
type CommandAttachment = { file_id: string; filename: string; size?: number; type?: string | null }

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const abortableDelay = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason)
    const timer = setTimeout(resolve, ms)
    signal.addEventListener("abort", () => {
      clearTimeout(timer)
      reject(signal.reason)
    }, { once: true })
  })

function boundedSignal(signal?: AbortSignal | null, timeout = 15_000) {
  const signals = [AbortSignal.timeout(timeout), ...(signal ? [signal] : [])]
  return AbortSignal.any(signals)
}

class DeviceRequestError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
  }
}

function createDeviceClient(baseURL: string, token: string, connection: AbortController): DeviceClient {
  const send = async (path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers)
    headers.set("authorization", `Bearer ${token}`)
    if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json")
    const response = await fetch(`${baseURL}${path}`, {
      ...init,
      headers,
      signal: boundedSignal(AbortSignal.any([
        connection.signal,
        ...(init.signal ? [init.signal] : []),
      ])),
    })
    if (!response.ok) {
      const body = await response.json().catch(() => undefined) as { detail?: unknown } | undefined
      const error = new DeviceRequestError(
        response.status,
        typeof body?.detail === "string" ? body.detail : `PrimeKit device API returned ${response.status}`,
      )
      if (response.status === 401) connection.abort(error)
      throw error
    }
    return response
  }
  return {
    request: async <T>(path: string, init: RequestInit = {}) => {
      const response = await send(path, init)
      if (response.status === 204) return undefined as T
      return await response.json() as T
    },
    download: send,
  }
}

function commandAttachments(command: Command): CommandAttachment[] {
  const value = command.args?.attachments
  if (!Array.isArray(value)) return []
  return value.filter((item): item is CommandAttachment => {
    if (!item || typeof item !== "object") return false
    const attachment = item as Partial<CommandAttachment>
    return typeof attachment.file_id === "string" && typeof attachment.filename === "string"
  })
}

async function materializeCommandAttachments(command: Command, device: DeviceClient) {
  const attachments = commandAttachments(command)
  if (attachments.length === 0) return []
  const directory = join(app.getPath("userData"), "primekit-attachments", String(command.chat_id ?? "chat"))
  await mkdir(directory, { recursive: true })
  const paths: Array<{ filename: string; path: string }> = []
  for (const attachment of attachments) {
    const filename = basename(attachment.filename).replaceAll("\0", "") || "attachment"
    const target = join(directory, `${attachment.file_id}_${filename}`)
    const temporary = `${target}.part`
    const response = await device.download(
      `/desktop-agent/device/commands/${command.id}/files/${encodeURIComponent(attachment.file_id)}`,
    )
    if (!response.body) throw new Error(`Вложение ${filename} вернулось без содержимого`)
    await unlink(temporary).catch(() => undefined)
    try {
      const output = createWriteStream(temporary, { mode: 0o600 })
      const reader = response.body.getReader()
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          await new Promise<void>((resolve, reject) => {
            output.write(value, (error) => error ? reject(error) : resolve())
          })
        }
        await new Promise<void>((resolve, reject) => {
          output.end((error?: Error | null) => error ? reject(error) : resolve())
        })
      } catch (error) {
        output.destroy()
        throw error
      }
      await rename(temporary, target)
    } catch (error) {
      await unlink(temporary).catch(() => undefined)
      throw error
    }
    paths.push({ filename, path: target })
  }
  return paths
}

function commandSessions() {
  const value = getStore().get(PRIMEKIT_COMMAND_SESSIONS_KEY)
  if (!value || typeof value !== "object" || Array.isArray(value)) return {} as Record<string, CommandSession>
  return value as Record<string, CommandSession>
}

function rememberedSession(commandID: number, root: string) {
  const value = commandSessions()[String(commandID)]
  return value?.root === root && typeof value.session_id === "string" ? value.session_id : undefined
}

function rememberSession(commandID: number, root: string, sessionID: string) {
  const entries = Object.entries({
    ...commandSessions(),
    [String(commandID)]: { session_id: sessionID, root, recorded_at: Date.now() },
  }).sort(([, left], [, right]) => right.recorded_at - left.recorded_at)
  getStore().set(PRIMEKIT_COMMAND_SESSIONS_KEY, Object.fromEntries(entries.slice(0, 100)))
}

function forgetSession(commandID: number) {
  const sessions = commandSessions()
  delete sessions[String(commandID)]
  getStore().set(PRIMEKIT_COMMAND_SESSIONS_KEY, sessions)
}

function basic(server: LocalServer) {
  return `Basic ${Buffer.from(`${server.username}:${server.password}`).toString("base64")}`
}

function localRequest<T>(server: LocalServer, path: string, init: RequestInit = {}, timeout = 15_000): Promise<T> {
  return fetch(`${server.url}${path}`, {
    ...init,
    signal: boundedSignal(init.signal, timeout),
    headers: { authorization: basic(server), "content-type": "application/json", ...init.headers },
  })
    .then(async (response) => {
      if (!response.ok) throw new Error(`Local Kit ${path} failed (${response.status})`)
      if (response.status === 204) return undefined as T
      return (await response.json()) as T
    })
    .catch((error) => {
      if (error instanceof Error && error.message.startsWith("Local Kit ")) throw error
      throw new Error(`Local Kit ${path} failed: ${error instanceof Error ? error.message : String(error)}`)
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

function activeModel() {
  return { providerID: "kit", modelID: "kit" }
}

async function configurePrimeKitProvider(
  server: LocalServer,
  modelToken: string,
  directory: string,
) {
  const api = `${primeKitAccount.baseURL}/v1`
  await localRequest(server, "/auth/kit", {
    method: "PUT",
    body: JSON.stringify({ type: "api", key: modelToken }),
  })
  await localRequest(server, "/global/config", {
    method: "PATCH",
    body: JSON.stringify({
      model: "kit/kit",
      enabled_providers: ["kit"],
      permission: "allow",
      provider: {
        kit: {
          name: "Кит",
          npm: "@ai-sdk/openai-compatible",
          api,
          models: { kit: { name: "Кит" } },
          options: { baseURL: api },
        },
      },
    }),
  })
  const dispose = disposeProviderCacheRequest(directory)
  await localRequest(server, dispose.path, dispose.init)
}

export function startPrimeKitConnector(server: LocalServer, computer: PrimeKitComputerMcp, logger: Logger) {
  const account = primeKitAccount
  const controller = new AbortController()

  const connect = async () => {
    const root = await defaultPrimeKitWorkspace()
    const device = getPrimeKitDeviceIdentity()
    const savedDeviceCredential = readPrimeKitDeviceCredential(device.id)
    const access = await requestPrimeKitFullDeviceAccess()
    let computerProbe: PrimeKitComputerProbe =
      access === "full_device"
        ? { enabled: true, screen: false, input: false, reason: "Computer Use проверяется в фоне" }
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
            "command_attachments",
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
      headers: savedDeviceCredential
        ? { "x-primekit-device-credential": savedDeviceCredential.device_token }
        : undefined,
      body: JSON.stringify(runtimePayload(access === "full_device", computerProbe)),
    })
    writePrimeKitDeviceCredential({
      device_id: device.id,
      runtime_id: runtime.id,
      device_token: runtime.device_token,
      device_token_expires_at: runtime.device_token_expires_at,
    })
    const connection = new AbortController()
    const deviceClient = createDeviceClient(account.baseURL, runtime.device_token, connection)
    let grantRoots = new Map<number, string>()
    if (access === "full_device") {
      grantRoots = await syncPrimeKitFolderGrants(account, runtime.id)
    }
    logger.log("PrimeKit connector online", { runtimeID: runtime.id, platform: device.platform, workspace: root })

    let wakeGeneration = 0
    let observedWakeGeneration = 0
    let wakeResolver: (() => void) | undefined
    const wake = () => {
      wakeGeneration += 1
      wakeResolver?.()
    }
    const unsubscribeWake = subscribePrimeKitSidebarEvents((event) => {
      if (event.runtime_id === runtime.id && event.type?.startsWith("desktop-command-")) wake()
    })
    const waitForWake = async () => {
      if (wakeGeneration !== observedWakeGeneration) {
        observedWakeGeneration = wakeGeneration
        return
      }
      const waitingFor = wakeGeneration
      await Promise.race([
        new Promise<void>((resolve) => {
          wakeResolver = resolve
          if (wakeGeneration !== waitingFor) resolve()
        }),
        abortableDelay(30_000, connection.signal),
      ]).catch(() => undefined)
      wakeResolver = undefined
      observedWakeGeneration = wakeGeneration
    }

    let computerCheck: Promise<void> | undefined
    const checkComputer = (prompt: boolean) => {
      if (computerCheck) return
      computerCheck = computer
        .probe(prompt)
        .then((probe) => {
          computerProbe = probe
          setPrimeKitComputerPermissionState(probe.screen && probe.input ? "ready" : "incomplete")
        })
        .catch((error) => logger.error("PrimeKit computer check failed", error))
        .finally(() => {
          computerCheck = undefined
        })
    }
    if (access === "full_device") {
      const legacyPrompted = getStore().get(PRIMEKIT_COMPUTER_PERMISSION_PROMPTED_KEY) === true
      const prompt = currentPrimeKitComputerPermissionState() === "not_requested" && !legacyPrompted
      checkComputer(prompt)
    }

    let heartbeatStopped = false
    const heartbeat = async () => {
      while (!controller.signal.aborted && !connection.signal.aborted && !heartbeatStopped) {
        try {
          const enabled = currentPrimeKitAccessProfile() === "full_device"
          if (enabled) checkComputer(false)
          else computerProbe = { enabled: false, screen: false, input: false, reason: "Полный доступ выключен" }
          await deviceClient.request(`/desktop-agent/runtimes/${runtime.id}/heartbeat`, {
            method: "POST",
            body: JSON.stringify(runtimePayload(enabled, computerProbe)),
          })
        } catch (error) {
          if (error instanceof DeviceRequestError && error.status === 401) return
          logger.error("PrimeKit heartbeat failed", {
            message: error instanceof Error ? error.message : String(error),
          })
        }
        await delay(20_000)
      }
    }
    const heartbeatTask = heartbeat()
    try {
      while (!controller.signal.aborted && !connection.signal.aborted) {
        try {
          const enabled = currentPrimeKitAccessProfile() === "full_device"
          if (!enabled) {
            await delay(3_000)
            continue
          }
          grantRoots = await syncPrimeKitFolderGrants(account, runtime.id)
          const commands = await deviceClient.request<Command[]>(`/desktop-agent/runtimes/${runtime.id}/commands?limit=1`)
          for (const command of commands) {
            await execute(command, grantRoots, root, server, deviceClient, connection.signal, logger)
          }
        } catch (error) {
          if (error instanceof DeviceRequestError && error.status === 401) throw error
          logger.error("PrimeKit connector poll failed", {
            message: error instanceof Error ? error.message : String(error),
          })
        }
        await waitForWake()
      }
      if (connection.signal.aborted) throw connection.signal.reason
    } finally {
      unsubscribeWake()
      wake()
      heartbeatStopped = true
      await heartbeatTask
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
  device: DeviceClient,
  connectionSignal: AbortSignal,
  logger: Logger,
) {
  const trustedRoot = command.folder_grant_id ? grantRoots.get(command.folder_grant_id) : fallbackRoot
  if (!trustedRoot) {
    await finish(
      device,
      command,
      command.status === "cancel_requested" ? "cancelled" : "error",
      undefined,
      "Folder grant is not trusted on this device",
    )
    return
  }
  let root: string
  try {
    root = await commandWorkspace(trustedRoot, command.cwd_relative)
  } catch (error) {
    await finish(
      device,
      command,
      "error",
      undefined,
      error instanceof Error ? error.message : String(error),
    )
    return
  }
  if (command.status === "cancel_requested") {
    const localSessionID = command.local_session_id ?? rememberedSession(command.id, root)
    if (localSessionID) {
      await localRequest(
        server,
        `/session/${localSessionID}/abort?directory=${encodeURIComponent(root)}`,
        { method: "POST" },
      ).catch(() => undefined)
    }
    await finish(device, command, "cancelled", undefined, "Остановлено пользователем")
    forgetSession(command.id)
    return
  }
  if (command.expires_at && Date.parse(command.expires_at) <= Date.now()) {
    await finish(device, command, "error", undefined, "Command expired")
    return
  }
  if (command.action === "refresh_permissions") {
    await finish(device, command, "completed", { state: "ready", workspace: root })
    return
  }
  const prompt =
    command.action === "scan_workspace"
      ? "Проверь корень проекта. Ничего не изменяй. Кратко перечисли структуру и состояние git."
      : typeof command.args?.prompt === "string"
        ? command.args.prompt.trim()
        : ""
  if (!prompt || !["scan_workspace", "agent_run"].includes(command.action)) {
    await finish(device, command, "error", undefined, `Unsupported desktop action: ${command.action}`)
    return
  }

  let previousEventIndex = -1
  while (true) {
    const existingEvents = await device.request<CommandEvent[]>(
      `/desktop-agent/device/commands/${command.id}/events?after=${previousEventIndex}&limit=500`,
    )
    if (existingEvents.length === 0) break
    previousEventIndex = existingEvents.reduce(
      (maximum, item) => Math.max(maximum, item.event_index),
      previousEventIndex,
    )
    if (existingEvents.length < 500) break
  }
  let eventIndex = previousEventIndex + 1
  const event = (type: string, payload: Record<string, unknown>) =>
    device.request(`/desktop-agent/commands/${command.id}/events`, {
      method: "POST",
      body: JSON.stringify({ claim_token: command.claim_token, event_index: eventIndex++, type, payload }),
    })
  const credentialRequest = modelTokenRequest(command.id, command.claim_token)
  const modelCredential = await device.request<ModelCredential>(credentialRequest.path, credentialRequest.init)
  if (!modelCredential.gateway.configured) {
    const message = "Модельный шлюз PrimeKit не настроен на сервере"
    await event("error", { message }).catch(() => undefined)
    await finish(device, command, "error", undefined, message)
    return
  }
  await event("progress", { message: "Кит запустил локального агента", workspace: root }).catch(() => undefined)
  let localSessionID = command.local_session_id ?? rememberedSession(command.id, root)
  let executionController: AbortController | undefined
  let leaseTask: Promise<void> | undefined
  let leaseFailure: unknown
  const abortLocalSession = async () => {
    if (!localSessionID) return
    await localRequest(
      server,
      `/session/${localSessionID}/abort?directory=${encodeURIComponent(root)}`,
      { method: "POST" },
    ).catch(() => undefined)
  }
  const stopLease = async () => {
    executionController?.abort()
    await leaseTask?.catch(() => undefined)
  }
  try {
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
          device,
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
    rememberSession(command.id, root, localSessionID)
    executionController = new AbortController()
    const executionSignal = AbortSignal.any([connectionSignal, executionController.signal])
    leaseTask = (async () => {
      while (!executionSignal.aborted) {
        try {
          await device.request(`/desktop-agent/commands/${command.id}/lease`, {
            method: "POST",
            body: JSON.stringify({ claim_token: command.claim_token }),
            signal: executionSignal,
          })
        } catch (error) {
          if (!executionSignal.aborted) {
            leaseFailure = error
            executionController?.abort(error)
          }
          return
        }
        await abortableDelay(20_000, executionSignal).catch(() => undefined)
      }
    })()
    await event("session", { message: "Локальная сессия подключена", session_id: localSessionID })
    const localAttachments = await materializeCommandAttachments(command, device)
    if (localAttachments.length > 0) {
      await event("progress", {
        message: `Загружено вложений: ${localAttachments.length}`,
        files: localAttachments.map((attachment) => attachment.filename),
      })
    }
    const attachmentContext = localAttachments.length > 0
      ? [
          "ПРИКРЕПЛЁННЫЕ ФАЙЛЫ УЖЕ ЗАГРУЖЕНЫ НА ЭТО УСТРОЙСТВО.",
          "Используй указанные абсолютные пути напрямую; не проси пользователя загрузить файлы повторно:",
          ...localAttachments.map((attachment) => `- ${attachment.filename}: ${attachment.path}`),
        ].join("\n")
      : ""
    const effectivePrompt = [attachmentContext, prompt].filter(Boolean).join("\n\n")
    await configurePrimeKitProvider(server, modelCredential.access_token, root)
    const model = activeModel()
    logger.log("PrimeKit local agent selected", model)
    const localMessageID = `msg_pk_cmd_${command.id}`
    const mirroredParts = new Map<string, MirroredPart>()
    const existingMessages = await localRequest<Array<{ info?: { id?: string } }>>(
      server,
      `/session/${localSessionID}/message?directory=${encodeURIComponent(root)}&limit=100`,
      { signal: executionSignal },
    )
    const alreadySubmitted = existingMessages.some((message) => message.info?.id === localMessageID)
    let promptFailure: unknown
    let promptTask: Promise<void> | undefined
    if (!alreadySubmitted) {
      promptTask = localRequest(server, `/session/${localSessionID}/message?directory=${encodeURIComponent(root)}`, {
        method: "POST",
        signal: executionSignal,
        body: JSON.stringify({
          messageID: localMessageID,
          agent: "build",
          model,
          system: canonicalContext(command),
          parts: [{ type: "text", text: effectivePrompt }],
        }),
      }, 15 * 60_000).then(
        () => undefined,
        (error) => {
          promptFailure = error
        },
      )
    }

    let assistantText = ""
    for (let attempt = 0; attempt < 900; attempt++) {
      if (promptFailure) throw promptFailure
      if (attempt % 2 === 0) {
        const remote = await device.request<{ status: string }>(`/desktop-agent/device/commands/${command.id}`, {
          signal: executionSignal,
        })
        if (remote.status === "cancel_requested") {
          await abortLocalSession()
          await stopLease()
          await event("cancelled", { message: "Локальная задача остановлена пользователем", session_id: localSessionID })
          await finish(device, command, "cancelled", undefined, "Остановлено пользователем")
          return
        }
      }
      const statuses = await localRequest<Record<string, { type: string }>>(
        server,
        `/session/status?directory=${encodeURIComponent(root)}`,
        { signal: executionSignal },
      )
      const status = statuses[localSessionID]
      const messages = await localRequest<unknown>(
        server,
        `/session/${localSessionID}/message?directory=${encodeURIComponent(root)}&limit=100`,
        { signal: executionSignal },
      )
      await mirrorLocalAgentEvents(messages, localMessageID, mirroredParts, event)
      assistantText = textFromMessages(messages, localMessageID)
      if (!status && assistantText) break
      await abortableDelay(1_000, executionSignal)
    }
    await promptTask
    if (promptFailure) throw promptFailure
    if (!assistantText) throw new Error("Local agent completed without a matching assistant response")
    await stopLease()
    await event("result", { message: assistantText, session_id: localSessionID })
    await finish(device, command, "completed", { assistant_text: assistantText, session_id: localSessionID })
    forgetSession(command.id)
  } catch (error) {
    await stopLease()
    const controlLoss = leaseFailure ?? (connectionSignal.aborted ? connectionSignal.reason : undefined)
    if (controlLoss instanceof DeviceRequestError && [401, 409].includes(controlLoss.status)) {
      await abortLocalSession()
      forgetSession(command.id)
      throw controlLoss
    }
    const message = error instanceof Error ? error.message : String(error)
    logger.error("PrimeKit command failed", { commandID: command.id, message })
    await abortLocalSession()
    await event("error", { message }).catch(() => undefined)
    await finish(device, command, "error", undefined, message).catch(() => undefined)
    forgetSession(command.id)
  } finally {
    await stopLease()
  }
}

function finish(
  device: DeviceClient,
  command: Command,
  status: "completed" | "error" | "cancelled",
  result?: Record<string, unknown>,
  errorText?: string,
) {
  return device.request(`/desktop-agent/commands/${command.id}/result`, {
    method: "POST",
    body: JSON.stringify({ claim_token: command.claim_token, status, result, error_text: errorText }),
  })
}
