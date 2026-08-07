import { expect, test } from "bun:test"
import { getPrimeKitProviderConfig } from "./primekit-provider"

test("configures the first-party Kit provider without upstream model branding", () => {
  const config = JSON.parse(getPrimeKitProviderConfig())

  expect(config.model).toBe("kit/kit")
  expect(config.enabled_providers).toEqual(["kit"])
  expect(config.share).toBe("disabled")
  expect(config.autoupdate).toBe(false)
  expect(config.$schema).toBeUndefined()
  expect(config.provider.kit.name).toBe("Кит")
  expect(config.provider.kit.whitelist).toEqual(["kit"])
  expect(config.provider.kit.models.kit.name).toBe("Кит")
})

test("passes the signed-in Kit credential to the local agent", () => {
  const config = JSON.parse(getPrimeKitProviderConfig(undefined, "secret"))
  expect(config.provider.kit.options.headers.Authorization).toBe("Bearer secret")
})
