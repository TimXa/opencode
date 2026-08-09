import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { mkdir } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { primeKitAccount } from "./primekit-account"
import { publishPrimeKitSidebarEvent, type PrimeKitSidebarEvent } from "./primekit-sidebar-events"
import { assignPrimeKitChatFiles, type PrimeKitChatFile } from "./primekit-chat-files"
import pkg from "../../package.json"

type LocalServer = { url: string; username: string; password: string }
type Logger = { log: (message: string, meta?: unknown) => void; error: (message: string, meta?: unknown) => void }
type Chat = {
  id: number
  title: string
  created_at: string
  updated_at?: string | null
  messages?: ChatMessage[]
  active_task_id?: number | null
  is_pinned?: boolean
  chat_files?: PrimeKitChatFile[]
}
type Space = {
  id: number
  name: string
  created_at: string
  icon_color?: string | null
  icon_border_color?: string | null
  icon_fg_color?: string | null
  icon_index?: number | null
  project_type?: string | null
}
type UniversalTurnResponse = {
  task_id: number | null
  user_message_id: number
  status: string
}
type UploadedFile = { file_id: string; filename: string; size: number; type?: string }
type ChatLocation = { kind: "general"; chatID: number } | { kind: "space"; spaceID: number; chatID: number }
type ChatMessage = {
  id: number
  role: "user" | "assistant"
  content: string
  created_at: string
  client_message_id?: string | null
  steps_json?: PrimeKitStep[] | null
  tool_calls_json?: PrimeKitStep[] | null
  attached_files_json?: Array<{ file_id?: string; filename?: string; name?: string; size?: number; type?: string }> | null
}
type PrimeKitStep = {
  type?: string
  content?: string
  phase?: string
  name?: string
  displayName?: string
  args?: string | Record<string, unknown>
  result?: string
  success?: boolean
  status?: string
  item_id?: string
  codex_item_id?: string
  items?: Array<{ step?: string; text?: string; content?: string; status?: string }>
}
type PrimeKitStreamEvent = PrimeKitStep & {
  type: string
  delta?: string
  output?: string
  file_id?: string
  filename?: string
  size?: number
  mime_type?: string
  steps?: PrimeKitStep[]
}

const directory = homedir()
const personalDirectory = join(directory, "PrimeKit", "Личные чаты")
const safeName = (value: string) => value.replace(/[\\/:*?"<>|]/g, "-").trim() || "Пространство"
const spaceDirectory = (space: Pick<Space, "id" | "name">) => join(directory, "PrimeKit", safeName(space.name))
const sessionID = (location: ChatLocation) =>
  location.kind === "general" ? `ses_pk_${location.chatID}` : `ses_pks_${location.spaceID}_${location.chatID}`
const chatLocation = (id: string): ChatLocation | undefined => {
  const general = /^ses_pk_(\d+)$/.exec(id)
  if (general) return { kind: "general", chatID: Number(general[1]) }
  const space = /^ses_pks_(\d+)_(\d+)$/.exec(id)
  if (space) return { kind: "space", spaceID: Number(space[1]), chatID: Number(space[2]) }
}
const chatPath = (location: ChatLocation, suffix = "") =>
  location.kind === "general"
    ? `/chats/${location.chatID}${suffix}`
    : `/servers/${location.spaceID}/chats/${location.chatID}${suffix}`
const messageID = (message: ChatMessage) =>
  message.client_message_id?.startsWith("msg") ? message.client_message_id : `msg_pk_${message.id}`
const millis = (value?: string | null) => (value ? Date.parse(value) || Date.now() : Date.now())
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const basic = (server: LocalServer) => `Basic ${Buffer.from(`${server.username}:${server.password}`).toString("base64")}`
const downloadMarker = /\[DOWNLOAD:(\w+):([^\]]+)\]/g
let fileOrigin = ""
const coworkModel = {
  id: "gpt-5.6-sol",
  providerID: "openai",
  api: { id: "gpt-5.6-sol", url: "", npm: "@ai-sdk/openai" },
  name: "Кит",
  capabilities: {
    temperature: false,
    reasoning: true,
    attachment: true,
    toolcall: true,
    input: { text: true, audio: false, image: true, video: false, pdf: true },
    output: { text: true, audio: false, image: true, video: false, pdf: false },
  },
  cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
  limit: { context: 1_000_000, output: 100_000 },
  status: "active",
  options: {},
  headers: {},
}
const coworkProvider = {
  id: "openai",
  name: "Кит",
  source: "custom",
  env: [],
  options: {},
  models: { "gpt-5.6-sol": coworkModel },
}
const spaceIcon = (space: Space) => {
  const fallback = space.project_type === "channel" ? 109 : space.project_type === "group" ? 165 : 286
  return `https://primekit-job.ru/tg-icons-svg/${String(space.icon_index || fallback).padStart(4, "0")}.svg`
}

function session(chat: Chat, space?: Space) {
  const location: ChatLocation = space
    ? { kind: "space", spaceID: space.id, chatID: chat.id }
    : { kind: "general", chatID: chat.id }
  return {
    id: sessionID(location),
    slug: `primekit-${chat.id}`,
    projectID: space ? `primekit-space-${space.id}` : "primekit-personal",
    directory: space ? spaceDirectory(space) : personalDirectory,
    title: chat.title || "Новый чат",
    version: pkg.version,
    model: { providerID: "kit", modelID: "kit" },
    agent: "build",
    isPinned: Boolean(chat.is_pinned),
    time: { created: millis(chat.created_at), updated: millis(chat.updated_at ?? chat.created_at) },
  }
}

const objectArgs = (value: PrimeKitStep["args"]) => {
  if (!value) return {}
  if (typeof value === "object") return value
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === "object" ? parsed : { value }
  } catch {
    return { value }
  }
}

const richParts = (item: ChatMessage, sid: string, mid: string, created: number, chatFiles: PrimeKitChatFile[] = []) => {
  const parts: Array<Record<string, unknown>> = []
  const steps = item.steps_json?.length ? item.steps_json : item.tool_calls_json ?? []
  let hasText = false
  let index = 0
  const id = (prefix: string, step?: PrimeKitStep) =>
    `prt_pk_${item.id}_${prefix}_${step?.item_id || step?.codex_item_id || index++}`

  for (const step of steps) {
    if (step.type === "text_block" && step.content) {
      hasText = true
      parts.push({ id: id("text", step), sessionID: sid, messageID: mid, type: "text", text: step.content, time: { start: created, end: created }, metadata: { phase: step.phase } })
      continue
    }
    if (step.type === "thinking" && step.content) {
      parts.push({ id: id("reasoning", step), sessionID: sid, messageID: mid, type: "reasoning", text: step.content, time: { start: created, end: created } })
      continue
    }
    if (step.type === "plan" && step.items?.length) {
      const input = {
        todos: step.items.map((todo) => ({
          content: todo.step || todo.text || todo.content || "Задача",
          status: todo.status || "pending",
          priority: "medium",
        })),
      }
      parts.push({
        id: id("plan", step), sessionID: sid, messageID: mid, type: "tool", callID: step.item_id || `plan-${index}`,
        tool: "todowrite", state: { status: "completed", input, output: "План обновлён", title: "План", metadata: {}, time: { start: created, end: created } },
      })
      continue
    }
    if (step.type === "tool" || step.name) {
      const callID = step.item_id || step.codex_item_id || `tool-${index}`
      const running = step.status === "running"
      const failed = step.success === false || step.status === "error" || step.status === "interrupted"
      const state = running
        ? { status: "running", input: objectArgs(step.args), title: step.displayName || step.name, time: { start: created } }
        : failed
          ? { status: "error", input: objectArgs(step.args), error: step.result || "Команда завершилась с ошибкой", time: { start: created, end: created } }
          : { status: "completed", input: objectArgs(step.args), output: step.result || "", title: step.displayName || step.name || "Инструмент", metadata: {}, time: { start: created, end: created } }
      parts.push({ id: id("tool", step), sessionID: sid, messageID: mid, type: "tool", callID, tool: step.name || "tool", state })
    }
  }

  if (!hasText && item.content) {
    parts.push({ id: id("text"), sessionID: sid, messageID: mid, type: "text", text: item.content, time: { start: created, end: created } })
  }

  const files = [...(item.attached_files_json ?? []), ...chatFiles]
  for (const step of steps) {
    for (const match of String(step.result || "").matchAll(downloadMarker)) {
      files.push({ file_id: match[1], filename: match[2] })
    }
  }
  const seen = new Set<string>()
  for (const file of files) {
    const fileID = file.file_id
    const filename = file.filename || file.name
    if (!fileID || !filename || seen.has(fileID)) continue
    seen.add(fileID)
    parts.push({
      id: id("file"), sessionID: sid, messageID: mid, type: "file", filename,
      mime: file.type || ("mime_type" in file ? file.mime_type : undefined) || "application/octet-stream", url: `${fileOrigin}/primekit/files/${encodeURIComponent(fileID)}/download`,
      metadata: { source: "source" in file ? file.source : undefined, size: file.size },
    })
  }
  return parts
}

const applyStreamEvent = (item: ChatMessage, event: PrimeKitStreamEvent) => {
  const steps = item.steps_json ?? (item.steps_json = [])
  const itemID = event.item_id || event.codex_item_id
  if (event.type === "answer") {
    if (event.steps?.length) item.steps_json = event.steps
    if (event.content) item.content = event.content
    return
  }
  if (event.type === "text_delta" && event.content) {
    const last = steps.at(-1)
    if (last?.type === "text_block" && (last.item_id || last.codex_item_id) === itemID && last.phase === event.phase) {
      last.content = `${last.content || ""}${event.content}`
    } else {
      steps.push({ type: "text_block", content: event.content, phase: event.phase, item_id: itemID })
    }
    return
  }
  if (event.type === "thinking" && event.content) {
    const last = steps.at(-1)
    if (last?.type === "thinking" && (last.item_id || last.codex_item_id) === itemID) {
      last.content = `${last.content || ""}${event.content}`
    } else {
      steps.push({ type: "thinking", content: event.content, item_id: itemID })
    }
    return
  }
  if (event.type === "tool_start") {
    steps.push({ ...event, type: "tool", status: "running", item_id: itemID })
    return
  }
  if (event.type === "tool_delta") {
    const target = [...steps].reverse().find((step) => step.type === "tool" && (!itemID || step.item_id === itemID))
    if (target) target.result = `${target.result || ""}${event.content || event.delta || event.output || ""}`
    return
  }
  if (event.type === "tool_result") {
    const target = [...steps].reverse().find((step) => step.type === "tool" && (!itemID || step.item_id === itemID))
    if (target) Object.assign(target, event, { type: "tool", status: event.success === false ? "error" : "done", item_id: itemID })
    else steps.push({ ...event, type: "tool", status: event.success === false ? "error" : "done", item_id: itemID })
    return
  }
  if (event.type === "plan_update" && event.items?.length) {
    const plan = steps.find((step) => step.type === "plan")
    if (plan) plan.items = event.items
    else steps.push({ type: "plan", items: event.items, item_id: itemID })
    return
  }
  if (event.type === "file_available" && event.file_id && event.filename) {
    const files = item.attached_files_json ?? (item.attached_files_json = [])
    if (!files.some((file) => file.file_id === event.file_id)) {
      files.push({ file_id: event.file_id, filename: event.filename, size: event.size, type: event.mime_type })
    }
    return
  }
  if (event.type === "rag_result" || event.type === "system" || event.type === "error") {
    steps.push({ type: event.type === "error" ? "tool" : "thinking", name: event.type, content: event.content, result: event.content, success: event.type !== "error", status: "done", item_id: itemID })
  }
}

function message(
  message: ChatMessage,
  chat: Chat,
  previousUserID: string,
  location: ChatLocation = { kind: "general", chatID: chat.id },
  chatFiles: PrimeKitChatFile[] = [],
) {
  const id = messageID(message)
  const created = millis(message.created_at)
  const info =
    message.role === "user"
      ? {
          id,
          sessionID: sessionID(location),
          role: "user",
          time: { created },
          agent: "build",
          model: { providerID: "kit", modelID: "kit" },
        }
      : {
          id,
          sessionID: sessionID(location),
          role: "assistant",
          time: { created, completed: created },
          parentID: previousUserID,
          modelID: "kit",
          providerID: "kit",
          mode: "build",
          agent: "build",
          path: { cwd: directory, root: directory },
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        }
  return { info, parts: richParts(message, sessionID(location), id, created, chatFiles) }
}

/**
 * The website returns files created by Kit in `chat_files`, separately from
 * message attachments. Keep the UI protocol message-shaped by associating
 * explicit message ids first and placing any remaining resources on the last
 * assistant response. This mirrors the website workspace without duplicating
 * the same file in the timeline.
 */
export function mapPrimeKitChatMessages(
  chat: Chat,
  location: ChatLocation = { kind: "general", chatID: chat.id },
) {
  const items = chat.messages ?? []
  const resources = assignPrimeKitChatFiles(items, chat.chat_files ?? [])
  let parent = `msg_pk_root_${chat.id}`
  return items.map((item) => {
    const mapped = message(item, chat, parent, location, resources.get(item.id))
    if (item.role === "user") parent = mapped.info.id
    return mapped
  })
}

async function body(request: IncomingMessage) {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  return Buffer.concat(chunks)
}

async function uploadPromptFiles(parts: Array<{ type?: string; url?: string; filename?: string; mime?: string }>) {
  return Promise.all(
    parts.flatMap((part) => {
      if (part.type !== "file" || !part.url?.startsWith("data:") || !part.filename) return []
      return [
        (async () => {
          const source = await fetch(part.url!)
          if (!source.ok) throw new Error(`Не удалось прочитать файл ${part.filename}`)
          const blob = await source.blob()
          const form = new FormData()
          form.append("file", blob, part.filename)
          const response = await primeKitAccount.open("/chat/upload", { method: "POST", body: form })
          if (!response.ok) throw new Error(`Не удалось загрузить файл ${part.filename} (${response.status})`)
          const uploaded = (await response.json()) as {
            file_id: string
            filename: string
            size: number
            content_type?: string
          }
          return { ...uploaded, type: uploaded.content_type || part.mime } satisfies UploadedFile
        })(),
      ]
    }),
  )
}

function json(response: ServerResponse, status: number, value?: unknown) {
  response.statusCode = status
  if (value === undefined) return response.end()
  response.setHeader("content-type", "application/json")
  response.end(JSON.stringify(value))
}

export async function startPrimeKitBridge(sidecar: LocalServer, logger: Logger) {
  const clients = new Set<ServerResponse>()
  const statuses = new Map<string, { type: "busy" }>()
  const knownChats = new Map<string, Chat>()
  const controller = new AbortController()
  const emit = (type: string, properties: Record<string, unknown>) => {
    const data = `data: ${JSON.stringify({ directory, payload: { type, properties } })}\n\n`
    for (const client of clients) client.write(data)
  }
  const publishChat = async (chat: Chat, created = false, space?: Space) => {
    const location: ChatLocation = space
      ? { kind: "space", spaceID: space.id, chatID: chat.id }
      : { kind: "general", chatID: chat.id }
    knownChats.set(sessionID(location), chat)
    const info = session(chat, space)
    emit(created ? "session.created" : "session.updated", { sessionID: info.id, info })
    const detail = chat.messages ? chat : await primeKitAccount.request<Chat>(chatPath(location, "?limit=40"))
    for (const mapped of mapPrimeKitChatMessages(detail, location)) {
      emit("message.updated", { sessionID: info.id, info: mapped.info })
      for (const part of mapped.parts) emit("message.part.updated", { sessionID: info.id, part, time: Date.now() })
    }
  }

  const streamTask = async (chat: Chat, location: ChatLocation, taskID: number, parentID: string) => {
    const sid = sessionID(location)
    const mid = `msg_pktask_${taskID}`
    let text = ""
    let started = false
    const startedAt = Date.now()
    const live: ChatMessage = {
      id: -taskID,
      role: "assistant",
      content: "",
      created_at: new Date(startedAt).toISOString(),
      steps_json: [],
      attached_files_json: [],
    }
    const ensureStarted = () => {
      if (started) return
      started = true
      emit("message.updated", {
        sessionID: sid,
        info: {
          id: mid,
          sessionID: sid,
          role: "assistant",
          time: { created: startedAt },
          parentID,
          modelID: "kit",
          providerID: "kit",
          mode: "build",
          agent: "build",
          path: { cwd: directory, root: directory },
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        },
      })
    }
    const publishLive = () => {
      ensureStarted()
      for (const part of richParts(live, sid, mid, startedAt)) {
        emit("message.part.updated", { sessionID: sid, part, time: Date.now() })
      }
    }
    try {
      const response = await primeKitAccount.open(chatPath(location, `/tasks/${taskID}/stream?after=0`), {
        headers: { accept: "text/event-stream" },
      })
      if (!response.ok || !response.body) throw new Error(`Поток Кита недоступен (${response.status})`)
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let pending = ""
      for (;;) {
        const next = await reader.read()
        if (next.done) break
        pending += decoder.decode(next.value, { stream: true })
        const frames = pending.split("\n\n")
        pending = frames.pop() ?? ""
        for (const frame of frames) {
          const raw = frame
            .split("\n")
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trim())
            .join("\n")
          if (!raw) continue
          const event = JSON.parse(raw) as PrimeKitStreamEvent
          applyStreamEvent(live, event)
          if (event.type === "text_delta" && event.content) {
            text += event.content
          }
          if (event.type === "answer" && event.content && !text) text = event.content
          if (!["usage", "connected", "heartbeat"].includes(event.type)) publishLive()
        }
      }
      if (started) publishLive()
      const fresh = await primeKitAccount.request<Chat>(chatPath(location, "?limit=20"))
      const persisted = [...(fresh.messages ?? [])].reverse().find((item) => item.role === "assistant")
      if (persisted) {
        const mapped = message(persisted, fresh, parentID, location)
        if (mapped.info.id !== mid) emit("message.removed", { sessionID: sid, messageID: mid })
        emit("message.updated", { sessionID: sid, info: mapped.info })
        for (const part of mapped.parts) emit("message.part.updated", { sessionID: sid, part, time: Date.now() })
      }
    } catch (cause) {
      logger.error("PrimeKit chat stream failed", { chatID: chat.id, taskID, message: cause instanceof Error ? cause.message : String(cause) })
    } finally {
      statuses.delete(sid)
      emit("session.status", { sessionID: sid, status: { type: "idle" } })
      emit("session.idle", { sessionID: sid })
    }
  }

  const cloudSessions = async () => {
    if (!primeKitAccount.signedIn()) return { chats: [], spaces: [], grouped: [] }
    const [chats, spaces] = await Promise.all([
      primeKitAccount.request<Chat[]>("/chats/"),
      primeKitAccount.request<Space[]>("/servers/"),
    ])
    await Promise.all([mkdir(personalDirectory, { recursive: true }), ...spaces.map((space) => mkdir(spaceDirectory(space), { recursive: true }))])
    const grouped = await Promise.all(
      spaces.map(async (space) => ({
        space,
        chats: await primeKitAccount.request<Chat[]>(`/servers/${space.id}/chats`),
      })),
    )
    return { chats, spaces, grouped }
  }

  const proxy = async (request: IncomingMessage, response: ServerResponse, url: URL) => {
    const payload = request.method === "GET" || request.method === "HEAD" ? undefined : await body(request)
    const headers = new Headers()
    for (const [key, value] of Object.entries(request.headers)) {
      if (key === "host" || key === "authorization" || value === undefined) continue
      headers.set(key, Array.isArray(value) ? value.join(",") : value)
    }
    headers.set("authorization", basic(sidecar))
    const upstream = await fetch(`${sidecar.url}${url.pathname}${url.search}`, {
      method: request.method,
      headers,
      body: payload?.length ? payload : undefined,
      redirect: "manual",
    })
    response.statusCode = upstream.status
    upstream.headers.forEach((value, key) => {
      if (
        key.startsWith("access-control-") ||
        key === "vary" ||
        key === "content-encoding" ||
        key === "content-length" ||
        key === "transfer-encoding"
      )
        return
      response.setHeader(key, value)
    })
    if (!upstream.body) return response.end()
    const reader = upstream.body.getReader()
    for (;;) {
      const next = await reader.read()
      if (next.done) break
      response.write(Buffer.from(next.value))
    }
    response.end()
  }

  const localJSON = async <T>(url: URL | string) => {
    const target = typeof url === "string" ? url : `${url.pathname}${url.search}`
    const response = await fetch(`${sidecar.url}${target}`, { headers: { authorization: basic(sidecar) } })
    if (!response.ok) throw new Error(`Local OpenCode request failed (${response.status})`)
    return response.json() as Promise<T>
  }

  const http = createServer(async (request, response) => {
    try {
      response.setHeader("access-control-allow-origin", "oc://renderer")
      response.setHeader("access-control-allow-methods", "GET, HEAD, POST, PATCH, DELETE, OPTIONS")
      response.setHeader(
        "access-control-allow-headers",
        request.headers["access-control-request-headers"] ?? "authorization, content-type",
      )
      response.setHeader("vary", "Origin, Access-Control-Request-Headers")
      if (request.method === "OPTIONS") {
        response.statusCode = 204
        return response.end()
      }
      const localURL = new URL(request.url ?? "/", "http://127.0.0.1")
      const fileMatch = localURL.pathname.match(/^\/primekit\/files\/([^/]+)\/download$/)
      if (fileMatch && request.method === "GET") {
        const upstream = await primeKitAccount.open(`/files/${encodeURIComponent(decodeURIComponent(fileMatch[1]))}/download`)
        response.statusCode = upstream.status
        for (const header of ["content-type", "content-disposition", "content-length"]) {
          const value = upstream.headers.get(header)
          if (value) response.setHeader(header, value)
        }
        if (!upstream.body) return response.end()
        const reader = upstream.body.getReader()
        for (;;) {
          const next = await reader.read()
          if (next.done) break
          response.write(Buffer.from(next.value))
        }
        return response.end()
      }
      if (request.headers.authorization !== basic(sidecar)) return json(response, 401, { error: "Unauthorized" })
      const url = localURL
      if (url.pathname === "/global/health") return json(response, 200, { healthy: true, version: pkg.version })
      if (url.pathname === "/global/event") {
        response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" })
        clients.add(response)
        response.write(`data: ${JSON.stringify({ directory, payload: { type: "server.connected", properties: {} } })}\n\n`)
        const keepAlive = setInterval(() => response.write(": heartbeat\n\n"), 15_000)
        request.once("close", () => {
          clearInterval(keepAlive)
          clients.delete(response)
        })
        return
      }
      if (url.pathname === "/provider" && request.method === "GET") {
        return json(response, 200, {
          all: [coworkProvider],
          default: { openai: "gpt-5.6-sol" },
          connected: ["openai"],
        })
      }
      if (url.pathname === "/provider/auth" && request.method === "GET") return json(response, 200, {})
      if (url.pathname === "/config/providers" && request.method === "GET") {
        return json(response, 200, {
          providers: [coworkProvider],
          default: { openai: "gpt-5.6-sol" },
        })
      }
      if (url.pathname === "/api/session" && request.method === "GET") {
        const [local, cloud] = await Promise.all([
          localJSON<{ data: unknown[]; cursor: unknown }>(url),
          cloudSessions(),
        ])
        const items = [
          ...cloud.chats.map((chat) => session(chat)),
          ...cloud.grouped.flatMap(({ space, chats: entries }) => entries.map((chat) => session(chat, space))),
        ].map((item) => ({
          id: item.id,
          projectID: item.projectID,
          location: { directory: item.directory },
          title: item.title,
          agent: item.agent,
          model: { id: "kit", providerID: "kit" },
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          time: item.time,
          isPinned: item.isPinned,
        }))
        return json(response, 200, { ...local, data: [...local.data, ...items] })
      }
      if (url.pathname === "/api/health") return json(response, 404, { error: "PrimeKit uses the stable desktop protocol" })
      if (url.pathname === "/project" && request.method === "GET") {
        const [local, spaces] = await Promise.all([
          localJSON<unknown[]>(url),
          primeKitAccount.signedIn() ? primeKitAccount.request<Space[]>("/servers/") : Promise.resolve([]),
        ])
        await Promise.all([mkdir(personalDirectory, { recursive: true }), ...spaces.map((space) => mkdir(spaceDirectory(space), { recursive: true }))])
        const projects = [
          {
            id: "primekit-personal",
            name: "Ваши чаты",
            worktree: personalDirectory,
            icon: { color: "#84796a" },
            time: { created: Date.now() },
          },
          ...spaces.map((space) => ({
            id: `primekit-space-${space.id}`,
            name: space.name,
            worktree: spaceDirectory(space),
            icon: { color: space.icon_color || "#84796a", url: spaceIcon(space) },
            time: { created: millis(space.created_at) },
          })),
        ]
        return json(response, 200, [...local, ...projects])
      }
      if (url.pathname === "/project/current" && request.method === "GET") {
        const target = url.searchParams.get("directory") ?? personalDirectory
        const spaces = primeKitAccount.signedIn() ? await primeKitAccount.request<Space[]>("/servers/") : []
        const space = spaces.find((item) => spaceDirectory(item) === target)
        if (target !== personalDirectory && !space) return await proxy(request, response, url)
        return json(response, 200, {
          id: space ? `primekit-space-${space.id}` : "primekit-personal",
          name: space?.name ?? "Ваши чаты",
          worktree: space ? spaceDirectory(space) : personalDirectory,
          icon: { color: space?.icon_color || "#84796a", url: space ? spaceIcon(space) : undefined },
          time: { created: space ? millis(space.created_at) : Date.now() },
        })
      }
      if (url.pathname === "/session/status" && request.method === "GET") {
        const local = await localJSON<Record<string, unknown>>(url)
        return json(response, 200, { ...local, ...Object.fromEntries(statuses) })
      }
      if (url.pathname === "/session" && request.method === "GET") {
        const [local, cloud] = await Promise.all([localJSON<unknown[]>(url), cloudSessions()])
        const result = [
          ...cloud.chats.map((chat) => session(chat)),
          ...cloud.grouped.flatMap(({ space, chats: items }) => items.map((chat) => session(chat, space))),
        ]
        for (const chat of cloud.chats) knownChats.set(session(chat).id, chat)
        for (const { space, chats: items } of cloud.grouped) {
          for (const chat of items) knownChats.set(session(chat, space).id, chat)
        }
        return json(response, 200, [...local, ...result])
      }
      if (url.pathname === "/session" && request.method === "POST") {
        const targetDirectory = url.searchParams.get("directory")
        const spaces = targetDirectory && primeKitAccount.signedIn() ? await primeKitAccount.request<Space[]>("/servers/") : []
        const space = spaces.find((item) => spaceDirectory(item) === targetDirectory)
        if (targetDirectory !== personalDirectory && !space) return await proxy(request, response, url)
        const input = JSON.parse((await body(request)).toString() || "{}") as { title?: string }
        const endpoint = space ? `/servers/${space.id}/chats` : "/chats/"
        const chat = await primeKitAccount.request<Chat>(endpoint, {
          method: "POST",
          body: JSON.stringify({ title: input.title || "Новый чат", engine_version: "gpt", reasoning_effort: "high" }),
        })
        const info = session(chat, space)
        emit("session.created", { sessionID: info.id, info })
        return json(response, 200, info)
      }
      const match = url.pathname.match(/^\/session\/(ses_(?:pk_\d+|pks_\d+_\d+))(?:\/(.*))?$/)
      if (!match) return await proxy(request, response, url)
      const sid = match[1]
      const child = match[2] ?? ""
      const location = chatLocation(sid)
      if (!location) return json(response, 404, { error: "Чат не найден" })
      const id = location.chatID
      if (child === "message" && request.method === "GET") {
        const chat = await primeKitAccount.request<Chat>(chatPath(location, `?limit=${url.searchParams.get("limit") ?? "120"}`))
        return json(response, 200, mapPrimeKitChatMessages(chat, location))
      }
      if (child.startsWith("message/") && request.method === "GET") {
        const wanted = decodeURIComponent(child.slice("message/".length))
        const chat = await primeKitAccount.request<Chat>(chatPath(location, "?limit=120"))
        for (const mapped of mapPrimeKitChatMessages(chat, location)) {
          if (mapped.info.id === wanted) return json(response, 200, mapped)
        }
        return json(response, 404, { error: "Сообщение не найдено" })
      }
      if (child === "prompt_async" && request.method === "POST") {
        const input = JSON.parse((await body(request)).toString() || "{}") as {
          messageID?: string
          parts?: Array<{ type?: string; text?: string; url?: string; filename?: string; mime?: string }>
        }
        const prompt = (input.parts ?? []).filter((part) => part.type === "text").map((part) => part.text ?? "").join("\n").trim()
        const uploadedFiles = await uploadPromptFiles(input.parts ?? [])
        if (!prompt && uploadedFiles.length === 0) return json(response, 400, { error: "Добавьте текст или файл" })
        if (uploadedFiles.length) {
          await primeKitAccount.request(chatPath(location, "/files"), {
            method: "POST",
            body: JSON.stringify({
              files: uploadedFiles.map((file) => ({ file_id: file.file_id, filename: file.filename, source: "user" })),
            }),
          })
        }
        const task = await primeKitAccount.request<UniversalTurnResponse>(`/desktop-agent/chats/${id}/turn`, {
          method: "POST",
          body: JSON.stringify({
            message: prompt,
            client_message_id: input.messageID,
            reasoning_effort: "high",
            uploaded_files: uploadedFiles.length ? uploadedFiles : undefined,
            execution_target: { kind: "cloud" },
          }),
        })
        const chat = await primeKitAccount.request<Chat>(chatPath(location, "?limit=120"))
        const persistedUser = [...(chat.messages ?? [])].reverse().find((item) => item.role === "user")
        if (input.messageID && persistedUser && input.messageID !== messageID(persistedUser)) {
          emit("message.removed", { sessionID: sid, messageID: input.messageID })
        }
        const space =
          location.kind === "space"
            ? (await primeKitAccount.request<Space[]>("/servers/")).find((item) => item.id === location.spaceID)
            : undefined
        await publishChat(chat, false, space)
        if (!task.task_id) return json(response, 204)
        statuses.set(sid, { type: "busy" })
        emit("session.status", { sessionID: sid, status: { type: "busy" } })
        void streamTask(chat, location, task.task_id, persistedUser ? messageID(persistedUser) : `msg_pk_${task.user_message_id}`)
        return json(response, 204)
      }
      if (child === "abort" && request.method === "POST") {
        const active = await primeKitAccount.request<{ task_id?: number | null }>(chatPath(location, "/active-task"))
        if (active.task_id) await primeKitAccount.request(chatPath(location, `/tasks/${active.task_id}/cancel`), { method: "POST" })
        return json(response, 200, true)
      }
      if (!child && request.method === "GET") {
        const chat = await primeKitAccount.request<Chat>(chatPath(location))
        const space = location.kind === "space" ? (await primeKitAccount.request<Space[]>("/servers/")).find((item) => item.id === location.spaceID) : undefined
        return json(response, 200, session(chat, space))
      }
      if (!child && request.method === "PATCH") {
        const input = JSON.parse((await body(request)).toString() || "{}") as {
          title?: string
          metadata?: { primekit_is_pinned?: boolean }
        }
        let chat = input.title
          ? await primeKitAccount.request<Chat>(chatPath(location), {
              method: "PATCH",
              body: JSON.stringify({ title: input.title }),
            })
          : await primeKitAccount.request<Chat>(chatPath(location))
        const pinned = input.metadata?.primekit_is_pinned
        if (typeof pinned === "boolean" && Boolean(chat.is_pinned) !== pinned) {
          chat = await primeKitAccount.request<Chat>(chatPath(location, "/pin"), { method: "POST" })
        }
        const space = location.kind === "space" ? (await primeKitAccount.request<Space[]>("/servers/")).find((item) => item.id === location.spaceID) : undefined
        return json(response, 200, session(chat, space))
      }
      if (!child && request.method === "DELETE") {
        await primeKitAccount.request(chatPath(location), { method: "DELETE" })
        return json(response, 200, true)
      }
      if (["children", "todo", "diff"].includes(child) && request.method === "GET") return json(response, 200, [])
      return json(response, 404, { error: "PrimeKit route not found" })
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      logger.error("PrimeKit bridge request failed", { url: request.url, message })
      return json(response, message.includes("Войдите") || message.includes("Сессия") ? 401 : 502, { error: message })
    }
  })

  await new Promise<void>((resolve, reject) => {
    http.once("error", reject)
    http.listen(0, "127.0.0.1", () => resolve())
  })
  const address = http.address()
  if (!address || typeof address === "string") throw new Error("Не удалось запустить PrimeKit bridge")
  fileOrigin = `http://127.0.0.1:${address.port}`

  const sidebarEvents = async () => {
    while (!controller.signal.aborted) {
      if (!primeKitAccount.signedIn()) {
        await new Promise((resolve) => setTimeout(resolve, 3_000))
        continue
      }
      try {
        const response = await primeKitAccount.stream("/servers/sidebar-events", {
          headers: { accept: "text/event-stream" },
          signal: controller.signal,
        })
        if (!response.ok || !response.body) throw new Error(`sidebar stream ${response.status}`)
        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let pending = ""
        for (;;) {
          const next = await reader.read()
          if (next.done) break
          pending += decoder.decode(next.value, { stream: true })
          const frames = pending.split("\n\n")
          pending = frames.pop() ?? ""
          for (const frame of frames) {
            const raw = frame
              .split("\n")
              .filter((line) => line.startsWith("data:"))
              .map((line) => line.slice(5).trim())
              .join("\n")
            if (!raw) continue
            const event = JSON.parse(raw) as PrimeKitSidebarEvent
            publishPrimeKitSidebarEvent(event)
            if (!event.chat_id) continue
            const spaces = event.server_id ? await primeKitAccount.request<Space[]>("/servers/") : []
            const space = spaces.find((item) => item.id === event.server_id)
            const location: ChatLocation = space
              ? { kind: "space", spaceID: space.id, chatID: event.chat_id }
              : { kind: "general", chatID: event.chat_id }
            try {
              const chat = await primeKitAccount.request<Chat>(chatPath(location, "?limit=40"))
              await publishChat(chat, !knownChats.has(sessionID(location)), space)
            } catch {
              const previous = knownChats.get(sessionID(location))
              if (previous) {
                knownChats.delete(sessionID(location))
                const info = session(previous, space)
                emit("session.deleted", { sessionID: info.id, info })
              }
            }
          }
        }
      } catch (cause) {
        if (!controller.signal.aborted) {
          logger.error("PrimeKit sidebar stream reconnecting", {
            message: cause instanceof Error ? cause.message : String(cause),
          })
          await new Promise((resolve) => setTimeout(resolve, 3_000))
        }
      }
    }
  }
  void sidebarEvents()
  const localEvents = async () => {
    while (!controller.signal.aborted) {
      try {
        const response = await fetch(`${sidecar.url}/global/event`, {
          headers: { accept: "text/event-stream", authorization: basic(sidecar) },
          signal: controller.signal,
        })
        if (!response.ok || !response.body) throw new Error(`local event stream ${response.status}`)
        const reader = response.body.getReader()
        for (;;) {
          const next = await reader.read()
          if (next.done) break
          const chunk = Buffer.from(next.value)
          for (const client of clients) client.write(chunk)
        }
      } catch (cause) {
        if (!controller.signal.aborted) {
          logger.error("Local OpenCode event stream reconnecting", {
            message: cause instanceof Error ? cause.message : String(cause),
          })
          await delay(1_000)
        }
      }
    }
  }
  void localEvents()
  logger.log("PrimeKit bridge online", { port: address.port })
  return {
    url: `http://127.0.0.1:${address.port}`,
    username: sidecar.username,
    password: sidecar.password,
    stop: () => {
      controller.abort()
      for (const client of clients) client.end()
      return new Promise<void>((resolve) => http.close(() => resolve()))
    },
  }
}
