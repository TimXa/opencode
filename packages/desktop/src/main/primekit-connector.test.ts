import { expect, test } from "bun:test"
import { modelTokenRequest } from "./primekit-connector-protocol"

test("issues the runtime-bound model credential with POST", () => {
  expect(modelTokenRequest(42, "claim-token-1234567890")).toEqual({
    path: "/desktop-agent/commands/42/model-token",
    init: {
      method: "POST",
      body: JSON.stringify({ claim_token: "claim-token-1234567890" }),
    },
  })
})
