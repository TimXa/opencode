import { describe, expect, test } from "bun:test"
import { openPrimeKitTaskStream } from "./primekit-task-stream"

describe("PrimeKit task stream", () => {
  test("uses the unbounded streaming transport", async () => {
    const calls: Array<{ path: string; accept: string | null }> = []
    const response = new Response('data: {"type":"task_done"}\n\n', {
      headers: { "content-type": "text/event-stream" },
    })

    const result = await openPrimeKitTaskStream(
      {
        stream: async (path, init) => {
          calls.push({ path, accept: new Headers(init?.headers).get("accept") })
          return response
        },
      },
      "/chats/1686/tasks/5251/stream?after=0",
    )

    expect(result).toBe(response)
    expect(calls).toEqual([
      { path: "/chats/1686/tasks/5251/stream?after=0", accept: "text/event-stream" },
    ])
  })
})
