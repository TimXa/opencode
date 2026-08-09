import { expect, test } from "bun:test"
import { updaterEnabled } from "./constants"

test("enables the release updater only for production bundles", () => {
  expect(updaterEnabled("prod")).toBe(true)
  expect(updaterEnabled("beta")).toBe(false)
  expect(updaterEnabled("dev")).toBe(false)
})
