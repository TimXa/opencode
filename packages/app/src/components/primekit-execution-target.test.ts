import { describe, expect, test } from "bun:test"
import { visibleExecutionRuntimes } from "./primekit-execution-target"

const runtime = (id: number, status: "online" | "offline", capabilities = ["agent_run"]) => ({
  id,
  status,
  capabilities,
})

describe("visibleExecutionRuntimes", () => {
  test("shows ready devices and hides stale offline registrations", () => {
    expect(
      visibleExecutionRuntimes([
        runtime(1, "offline"),
        runtime(2, "online"),
        runtime(3, "online", []),
      ]).map((item) => item.id),
    ).toEqual([2])
  })

  test("keeps an unavailable selected device visible for recovery context", () => {
    expect(visibleExecutionRuntimes([runtime(1, "offline"), runtime(2, "online")], 1).map((item) => item.id)).toEqual([
      1,
      2,
    ])
  })
})
