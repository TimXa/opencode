export type PrimeKitChatFile = {
  file_id?: string
  filename?: string
  name?: string
  size?: number
  type?: string
  mime_type?: string
  source?: string
  message_id?: number | string | null
  chat_message_id?: number | string | null
}

type MessageWithFiles = {
  id: number | string
  role: "user" | "assistant"
  attached_files_json?: PrimeKitChatFile[] | null
}

/** Associates the website's chat-level workspace files with timeline messages. */
export function assignPrimeKitChatFiles(messages: MessageWithFiles[], chatFiles: PrimeKitChatFile[]) {
  const attached = new Set(
    messages.flatMap((message) => message.attached_files_json ?? []).flatMap((file) => (file.file_id ? [file.file_id] : [])),
  )
  const available = chatFiles.filter((file) => file.file_id && !attached.has(file.file_id))
  const owner = [...messages].reverse().find((message) => message.role === "assistant") ?? messages.at(-1)
  const result = new Map<number | string, PrimeKitChatFile[]>()

  for (const message of messages) {
    const explicit = available.filter(
      (file) => String(file.message_id ?? file.chat_message_id ?? "") === String(message.id),
    )
    const explicitIDs = new Set(explicit.map((file) => file.file_id))
    const fallback = message === owner
      ? available.filter((file) => !file.message_id && !file.chat_message_id && !explicitIDs.has(file.file_id))
      : []
    if (explicit.length || fallback.length) result.set(message.id, [...explicit, ...fallback])
  }
  return result
}
