import { expect, test } from "bun:test"
import { getPrimeKitProviderConfig } from "./primekit-provider"

test("configures Cowork to use the direct Codex model path with Kit branding", () => {
  const config = JSON.parse(getPrimeKitProviderConfig())

  expect(config.model).toBe("openai/gpt-5.6-sol")
  expect(config.enabled_providers).toEqual(["openai"])
  expect(config.disabled_providers).toEqual([])
  expect(config.share).toBe("disabled")
  expect(config.autoupdate).toBe(false)
  expect(config.$schema).toBeUndefined()
  expect(config.provider.openai.name).toBe("Кит")
  expect(config.provider.openai.whitelist).toEqual(["gpt-5.6-sol"])
  expect(config.provider.openai.models["gpt-5.6-sol"].name).toBe("Кит")
})

test("does not route Cowork through the PrimeKit server model gateway", () => {
  const config = JSON.parse(getPrimeKitProviderConfig())
  expect(config.provider.openai.options?.baseURL).toBeUndefined()
  expect(JSON.stringify(config)).not.toContain("primekit-job.ru/api/v1")
})
