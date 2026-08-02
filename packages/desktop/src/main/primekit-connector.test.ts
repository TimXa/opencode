import { expect, test } from "bun:test"
import { disposeProviderCacheRequest, modelTokenRequest } from "./primekit-connector-protocol"

test("issues the runtime-bound model credential with POST", () => {
  expect(modelTokenRequest(42, "claim-token-1234567890")).toEqual({
    path: "/desktop-agent/commands/42/model-token",
    init: {
      method: "POST",
      body: JSON.stringify({ claim_token: "claim-token-1234567890" }),
    },
  })
})

test("disposes the workspace provider cache after rotating the model credential", () => {
  expect(disposeProviderCacheRequest("C:\\Users\\Тимофей\\PrimeKit Agent")).toEqual({
    path: "/instance/dispose?directory=C%3A%5CUsers%5C%D0%A2%D0%B8%D0%BC%D0%BE%D1%84%D0%B5%D0%B9%5CPrimeKit%20Agent",
    init: { method: "POST" },
  })
})
