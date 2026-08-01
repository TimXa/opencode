import { expect, test } from "bun:test"
import { modelTokenRequest } from "./primekit-connector-protocol"

test("issues the runtime-bound model credential with POST", () => {
  expect(modelTokenRequest(42)).toEqual({
    path: "/desktop-agent/runtimes/42/model-token",
    init: { method: "POST" },
  })
})
