import { expect, test } from "bun:test"
import { getPrimeKitProviderConfig } from "./primekit-provider"

test("configures Kit as the branded default provider", () => {
  const config = JSON.parse(getPrimeKitProviderConfig("https://kit.example/v1"))

  expect(config.model).toBe("kit/kit")
  expect(config.provider.kit.name).toBe("Кит")
  expect(config.provider.kit.options.baseURL).toBe("https://kit.example/v1")
  expect(config.provider.kit.npm).toBe("@ai-sdk/openai-compatible")
})
