export type LocalAgentFile = {
  filename?: string
  mime?: string
  url?: string
  source?: { path?: string }
}

type LocalAgentPart = LocalAgentFile & {
  id?: string
  type?: string
  text?: string
  tool?: string
  files?: string[]
  time?: { end?: number }
  state?: {
    status?: string
    input?: Record<string, unknown>
    title?: string
    output?: string
    error?: string
    attachments?: LocalAgentFile[]
  }
}

type LocalAgentMessage = {
  info?: { role?: string; parentID?: string }
  parts?: LocalAgentPart[]
}

export type MirroredPart = {
  status?: string
  textLength: number
  outputLength?: number
  completed?: boolean
  planSignature?: string
}

const MAX_LIVE_CHUNK_CHARS = 8_000
const MAX_TOOL_EVENT_CHARS = 50_000

function limitedJSON(value: unknown) {
  const json = JSON.stringify(value ?? {})
  return json.length <= MAX_TOOL_EVENT_CHARS
    ? json
    : `${json.slice(0, MAX_TOOL_EVENT_CHARS)}\n… вывод сокращён в live-событии`
}

export async function mirrorLocalAgentEvents(
  messages: unknown,
  parentID: string,
  mirrored: Map<string, MirroredPart>,
  emit: (type: string, payload: Record<string, unknown>) => Promise<unknown>,
  publishFile?: (file: LocalAgentFile) => Promise<{ file_id: string; filename: string; size?: number; mime_type?: string }>,
) {
  if (!Array.isArray(messages)) return
  const assistantMessages = (messages as LocalAgentMessage[]).filter(
    (message) => message.info?.role === "assistant" && message.info.parentID === parentID,
  )
  for (const message of assistantMessages) {
    for (const part of message.parts ?? []) {
      const id = part.id
      if (!id || !part.type) continue
      const previous = mirrored.get(id) ?? { textLength: 0 }
      if ((part.type === "text" || part.type === "reasoning") && typeof part.text === "string") {
        const content = part.text.slice(previous.textLength)
        if (content) {
          for (let offset = 0; offset < content.length; offset += MAX_LIVE_CHUNK_CHARS) {
            await emit(part.type === "reasoning" ? "thinking" : "text_delta", {
              content: content.slice(offset, offset + MAX_LIVE_CHUNK_CHARS),
              item_id: id,
            })
          }
        }
        const completed = part.type === "text" && Boolean(part.time?.end)
        if (completed && !previous.completed) {
          await emit("text_completed", { content: part.text, item_id: id })
        }
        mirrored.set(id, { ...previous, textLength: part.text.length, completed })
        continue
      }
      if (part.type === "file" && publishFile && !previous.status) {
        const file = await publishFile(part)
        await emit("file_available", file)
        mirrored.set(id, { ...previous, status: "completed" })
        continue
      }
      if (part.type === "patch" && Array.isArray(part.files) && !previous.status) {
        const changes = part.files.map((path) => ({ path }))
        await emit("tool_start", {
          name: "file_change",
          displayName: changes.length === 1 ? "Изменяю файл" : "Изменяю файлы",
          args: limitedJSON({ changes }),
          item_id: id,
        })
        await emit("tool_result", {
          name: "file_change",
          result: limitedJSON({ changes }),
          success: true,
          item_id: id,
        })
        mirrored.set(id, { ...previous, status: "completed" })
        continue
      }
      if (part.type !== "tool" || !part.tool || !part.state?.status) continue
      const status = part.state.status
      if (["todowrite", "update_plan"].includes(part.tool.toLowerCase())) {
        const todos = Array.isArray(part.state.input?.todos)
          ? part.state.input.todos
          : Array.isArray(part.state.input?.plan)
            ? part.state.input.plan
            : []
        const items = todos.map((item) => {
          const todo = item && typeof item === "object" ? item as Record<string, unknown> : {}
          return {
            text: String(todo.content ?? todo.text ?? todo.step ?? "Задача"),
            status: String(todo.status ?? "pending"),
          }
        })
        const signature = JSON.stringify(items)
        if (items.length > 0 && previous.planSignature !== signature) {
          await emit("plan_update", { items, item_id: id })
        }
        mirrored.set(id, { ...previous, status, planSignature: signature })
        continue
      }
      if (!previous.status) {
        await emit("tool_start", {
          name: part.tool,
          displayName: part.state.title || part.tool,
          args: limitedJSON(part.state.input),
          item_id: id,
        })
      }
      const output = part.state.output || ""
      if (status === "running" && output.length > (previous.outputLength ?? 0)) {
        await emit("tool_delta", {
          name: part.tool,
          content: output.slice(previous.outputLength ?? 0),
          item_id: id,
        })
      }
      if (["completed", "error"].includes(status) && previous.status !== status) {
        await emit("tool_result", {
          name: part.tool,
          result: (status === "completed" ? part.state.output || "" : part.state.error || "Ошибка инструмента")
            .slice(0, MAX_TOOL_EVENT_CHARS),
          success: status === "completed",
          item_id: id,
        })
        if (publishFile) {
          for (const [attachmentIndex, attachment] of (part.state.attachments ?? []).entries()) {
            const attachmentID = `${id}:attachment:${attachmentIndex}`
            if (mirrored.has(attachmentID)) continue
            const file = await publishFile(attachment)
            await emit("file_available", file)
            mirrored.set(attachmentID, { textLength: 0, status: "completed" })
          }
        }
      }
      mirrored.set(id, { ...previous, status, outputLength: output.length })
    }
  }
}
