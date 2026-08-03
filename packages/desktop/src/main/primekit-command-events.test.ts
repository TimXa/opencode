import { describe, expect, test } from "bun:test"
import { mirrorLocalAgentEvents, type MirroredPart } from "./primekit-command-events"

describe("PrimeKit command event mirror", () => {
  test("emits incremental reasoning, text, and each tool transition exactly once", async () => {
    const mirrored = new Map<string, MirroredPart>()
    const events: Array<{ type: string; payload: Record<string, unknown> }> = []
    const emit = async (type: string, payload: Record<string, unknown>) => {
      events.push({ type, payload })
    }
    const message = (reasoning: string, text: string, status: string) => [{
      info: { role: "assistant", parentID: "browser-message" },
      parts: [
        { id: "reasoning-1", type: "reasoning", text },
        { id: "text-1", type: "text", text: reasoning },
        {
          id: "tool-1",
          type: "tool",
          tool: "bash",
          state: {
            status,
            input: { command: "git status" },
            title: "Проверяю Git",
            output: status === "completed" ? "clean" : undefined,
          },
        },
      ],
    }]

    await mirrorLocalAgentEvents(message("Готов", "Думаю", "running"), "browser-message", mirrored, emit)
    await mirrorLocalAgentEvents(message("Готово", "Думаю дальше", "completed"), "browser-message", mirrored, emit)
    await mirrorLocalAgentEvents(message("Готово", "Думаю дальше", "completed"), "browser-message", mirrored, emit)

    expect(events.map(event => event.type)).toEqual([
      "thinking",
      "text_delta",
      "tool_start",
      "thinking",
      "text_delta",
      "tool_result",
    ])
    expect(events.at(-1)?.payload).toMatchObject({ name: "bash", result: "clean", success: true })
  })

  test("ignores messages from another local prompt", async () => {
    const events: string[] = []
    await mirrorLocalAgentEvents([{
      info: { role: "assistant", parentID: "other-message" },
      parts: [{ id: "text-1", type: "text", text: "Чужой ответ" }],
    }], "browser-message", new Map(), async type => { events.push(type) })
    expect(events).toEqual([])
  })

  test("publishes OpenCode patch parts as canonical file-change tool blocks once", async () => {
    const mirrored = new Map<string, MirroredPart>()
    const events: Array<{ type: string; payload: Record<string, unknown> }> = []
    const messages = [{
      info: { role: "assistant", parentID: "browser-message" },
      parts: [{ id: "patch-1", type: "patch", files: ["src/app.tsx", "src/app.css"] }],
    }]

    await mirrorLocalAgentEvents(messages, "browser-message", mirrored, async (type, payload) => {
      events.push({ type, payload })
    })
    await mirrorLocalAgentEvents(messages, "browser-message", mirrored, async (type, payload) => {
      events.push({ type, payload })
    })

    expect(events.map(event => event.type)).toEqual(["tool_start", "tool_result"])
    expect(events[0]?.payload).toMatchObject({ name: "file_change", item_id: "patch-1" })
    expect(events[1]?.payload.result).toContain("src/app.tsx")
  })

  test("publishes text completion, plans, tool deltas, and files through the canonical contract", async () => {
    const mirrored = new Map<string, MirroredPart>()
    const events: Array<{ type: string; payload: Record<string, unknown> }> = []
    const emit = async (type: string, payload: Record<string, unknown>) => { events.push({ type, payload }) }
    const publishFile = async () => ({ file_id: "file-1", filename: "result.png", size: 12, mime_type: "image/png" })

    await mirrorLocalAgentEvents([{
      info: { role: "assistant", parentID: "browser-message" },
      parts: [
        { id: "text-1", type: "text", text: "Готово", time: { end: 1 } },
        { id: "plan-1", type: "tool", tool: "todowrite", state: { status: "running", input: { todos: [{ content: "Проверить", status: "in_progress" }] } } },
        { id: "tool-1", type: "tool", tool: "bash", state: { status: "running", input: {}, output: "line 1\n" } },
        { id: "file-part-1", type: "file", filename: "result.png", mime: "image/png", url: "data:image/png;base64,AA==" },
      ],
    }], "browser-message", mirrored, emit, publishFile)

    expect(events.map(event => event.type)).toEqual([
      "text_delta",
      "text_completed",
      "plan_update",
      "tool_start",
      "tool_delta",
      "file_available",
    ])
    expect(events.at(-1)?.payload).toMatchObject({ file_id: "file-1", filename: "result.png" })
  })
})
