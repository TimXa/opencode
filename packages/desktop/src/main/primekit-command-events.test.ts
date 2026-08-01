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
})
