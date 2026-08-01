type LocalAgentPart = {
  id?: string
  type?: string
  text?: string
  tool?: string
  state?: {
    status?: string
    input?: Record<string, unknown>
    title?: string
    output?: string
    error?: string
  }
}

type LocalAgentMessage = {
  info?: { role?: string; parentID?: string }
  parts?: LocalAgentPart[]
}

export type MirroredPart = { status?: string; textLength: number }

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
        mirrored.set(id, { ...previous, textLength: part.text.length })
        continue
      }
      if (part.type !== "tool" || !part.tool || !part.state?.status) continue
      const status = part.state.status
      if (!previous.status) {
        await emit("tool_start", {
          name: part.tool,
          displayName: part.state.title || part.tool,
          args: limitedJSON(part.state.input),
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
      }
      mirrored.set(id, { ...previous, status })
    }
  }
}
