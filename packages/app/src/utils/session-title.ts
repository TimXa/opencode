const pattern = /^(New session|Child session) - \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

export function sessionTitle(title?: string, primekit = typeof window === "object" && Boolean(window.api?.primekit)) {
  if (!title) return title
  const match = title.match(pattern)
  if (!match) return title
  if (!primekit) return match[1]
  return match[1] === "Child session" ? "Ветка чата" : "Новый чат"
}
