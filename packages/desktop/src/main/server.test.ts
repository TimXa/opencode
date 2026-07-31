import { expect, test } from "bun:test"
import { getPrimeKitProviderConfig } from "./primekit-provider"

test("configures ChatGPT Codex as the branded Kit provider", () => {
  const config = JSON.parse(getPrimeKitProviderConfig())

  expect(config.model).toBe("openai/gpt-5.4")
  expect(config.enabled_providers).toEqual(["openai"])
  expect(config.share).toBe("disabled")
  expect(config.autoupdate).toBe(false)
  expect(config.$schema).toBeUndefined()
  expect(config.provider.openai.name).toBe("Кит")
  expect(config.provider.openai.whitelist).toEqual(["gpt-5.4"])
  expect(config.provider.openai.models["gpt-5.4"].name).toBe("Кит")
})
