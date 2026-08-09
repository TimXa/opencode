import { describe, expect, test } from "bun:test"
import { sessionTitle } from "./session-title"

describe("sessionTitle", () => {
  test("keeps persisted generated titles while localizing their presentation in Kit", () => {
    const title = "New session - 2026-08-10T00:00:00.000Z"
    expect(sessionTitle(title, true)).toBe("Новый чат")
    expect(sessionTitle(title, false)).toBe("New session")
    expect(title).toBe("New session - 2026-08-10T00:00:00.000Z")
  })

  test("localizes generated child sessions and leaves custom titles unchanged", () => {
    expect(sessionTitle("Child session - 2026-08-10T00:00:00.000Z", true)).toBe("Ветка чата")
    expect(sessionTitle("Дизайн главного экрана", true)).toBe("Дизайн главного экрана")
  })
})
