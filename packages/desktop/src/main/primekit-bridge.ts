import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { mkdir } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { primeKitAccount } from "./primekit-account"
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
type AskResponse = { task_id: number | null; user_message_id: number; status: string }
type ChatLocation = { kind: "general"; chatID: number } | { kind: "space"; spaceID: number; chatID: number }
type ChatMessage = {
  id: number
  role: "user" | "assistant"
  content: string
  created_at: string
  client_message_id?: string | null
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
const basic = (server: LocalServer) => `Basic ${Buffer.from(`${server.username}:${server.password}`).toString("base64")}`
const kitModel = {
  id: "kit",
  providerID: "kit",
  api: { id: "kit", url: "", npm: "primekit" },
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
const kitProvider = { id: "kit", name: "Кит", source: "custom", env: [], options: {}, models: { kit: kitModel } }
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

function message(message: ChatMessage, chat: Chat, previousUserID: string, location: ChatLocation = { kind: "general", chatID: chat.id }) {
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
  return {
    info,
    parts: [
      {
        id: `prt_pk_${message.id}`,
        sessionID: sessionID(location),
        messageID: id,
        type: "text",
        text: message.content ?? "",
        time: { start: created, end: created },
      },
    ],
  }
}

async function body(request: IncomingMessage) {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  return Buffer.concat(chunks)
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
    let parent = `msg_pk_root_${chat.id}`
    for (const item of detail.messages ?? []) {
      const mapped = message(item, detail, parent, location)
      if (item.role === "user") parent = mapped.info.id
      emit("message.updated", { sessionID: info.id, info: mapped.info })
      for (const part of mapped.parts) emit("message.part.updated", { sessionID: info.id, part, time: Date.now() })
    }
  }

  const streamTask = async (chat: Chat, location: ChatLocation, taskID: number, parentID: string) => {
    const sid = sessionID(location)
    const mid = `msg_pktask_${taskID}`
    const pid = `prt_pktask_${taskID}`
    let text = ""
    let started = false
    const startedAt = Date.now()
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
          const event = JSON.parse(raw) as { type?: string; content?: string }
          if (event.type === "text_delta" && event.content) {
            if (!started) {
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
              emit("message.part.updated", {
                sessionID: sid,
                part: { id: pid, sessionID: sid, messageID: mid, type: "text", text: "", time: { start: startedAt } },
                time: startedAt,
              })
            }
            text += event.content
            emit("message.part.delta", { sessionID: sid, messageID: mid, partID: pid, field: "text", delta: event.content })
          }
          if (event.type === "answer" && event.content && !text) text = event.content
        }
      }
      emit("message.part.updated", {
        sessionID: sid,
        part: { id: pid, sessionID: sid, messageID: mid, type: "text", text, time: { start: startedAt, end: Date.now() } },
        time: Date.now(),
      })
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
      if (request.headers.authorization !== basic(sidecar)) return json(response, 401, { error: "Unauthorized" })
      const url = new URL(request.url ?? "/", "http://127.0.0.1")
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
        return json(response, 200, { all: [kitProvider], default: { kit: "kit" }, connected: ["kit"] })
      }
      if (url.pathname === "/provider/auth" && request.method === "GET") return json(response, 200, {})
      if (url.pathname === "/config/providers" && request.method === "GET") {
        return json(response, 200, { providers: [kitProvider], default: { kit: "kit" } })
      }
      if (url.pathname === "/api/session" && request.method === "GET") {
        const { chats, grouped } = await cloudSessions()
        const items = [
          ...chats.map((chat) => session(chat)),
          ...grouped.flatMap(({ space, chats: entries }) => entries.map((chat) => session(chat, space))),
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
        return json(response, 200, { data: items, cursor: {} })
      }
      if (url.pathname === "/api/health") return json(response, 404, { error: "PrimeKit uses the stable desktop protocol" })
      if (url.pathname === "/project" && request.method === "GET") {
        const spaces = await primeKitAccount.request<Space[]>("/servers/")
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
        return json(response, 200, projects)
      }
      if (url.pathname === "/project/current" && request.method === "GET") {
        const target = url.searchParams.get("directory") ?? personalDirectory
        const spaces = await primeKitAccount.request<Space[]>("/servers/")
        const space = spaces.find((item) => spaceDirectory(item) === target)
        return json(response, 200, {
          id: space ? `primekit-space-${space.id}` : "primekit-personal",
          name: space?.name ?? "Ваши чаты",
          worktree: space ? spaceDirectory(space) : personalDirectory,
          icon: { color: space?.icon_color || "#84796a", url: space ? spaceIcon(space) : undefined },
          time: { created: space ? millis(space.created_at) : Date.now() },
        })
      }
      if (url.pathname === "/session/status" && request.method === "GET") return json(response, 200, Object.fromEntries(statuses))
      if (url.pathname === "/session" && request.method === "GET") {
        const { chats, grouped } = await cloudSessions()
        const result = [
          ...chats.map((chat) => session(chat)),
          ...grouped.flatMap(({ space, chats: items }) => items.map((chat) => session(chat, space))),
        ]
        for (const chat of chats) knownChats.set(session(chat).id, chat)
        for (const { space, chats: items } of grouped) {
          for (const chat of items) knownChats.set(session(chat, space).id, chat)
        }
        return json(response, 200, result)
      }
      if (url.pathname === "/session" && request.method === "POST") {
        const input = JSON.parse((await body(request)).toString() || "{}") as { title?: string }
        const targetDirectory = url.searchParams.get("directory")
        const spaces = targetDirectory ? await primeKitAccount.request<Space[]>("/servers/") : []
        const space = spaces.find((item) => spaceDirectory(item) === targetDirectory)
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
        let parent = `msg_pk_root_${id}`
        const messages = (chat.messages ?? []).map((item) => {
          const mapped = message(item, chat, parent, location)
          if (item.role === "user") parent = mapped.info.id
          return mapped
        })
        return json(response, 200, messages)
      }
      if (child.startsWith("message/") && request.method === "GET") {
        const wanted = decodeURIComponent(child.slice("message/".length))
        const chat = await primeKitAccount.request<Chat>(chatPath(location, "?limit=120"))
        let parent = `msg_pk_root_${id}`
        for (const item of chat.messages ?? []) {
          const mapped = message(item, chat, parent, location)
          if (item.role === "user") parent = mapped.info.id
          if (mapped.info.id === wanted) return json(response, 200, mapped)
        }
        return json(response, 404, { error: "Сообщение не найдено" })
      }
      if (child === "prompt_async" && request.method === "POST") {
        const input = JSON.parse((await body(request)).toString() || "{}") as { messageID?: string; parts?: Array<{ type?: string; text?: string }> }
        const prompt = (input.parts ?? []).filter((part) => part.type === "text").map((part) => part.text ?? "").join("\n").trim()
        if (!prompt) return json(response, 400, { error: "Добавьте текст" })
        const task = await primeKitAccount.request<AskResponse>(chatPath(location, "/ask"), {
          method: "POST",
          body: JSON.stringify({
            message: prompt,
            client_message_id: input.messageID,
            reasoning_effort: "high",
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
        const input = JSON.parse((await body(request)).toString() || "{}") as { title?: string }
        const chat = await primeKitAccount.request<Chat>(chatPath(location), { method: "PATCH", body: JSON.stringify(input) })
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

  const sidebarEvents = async () => {
    while (!controller.signal.aborted) {
      if (!primeKitAccount.signedIn()) {
        await new Promise((resolve) => setTimeout(resolve, 3_000))
        continue
      }
      try {
        const response = await primeKitAccount.open("/servers/sidebar-events", {
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
            const event = JSON.parse(raw) as { chat_id?: number; server_id?: number; type?: string }
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
