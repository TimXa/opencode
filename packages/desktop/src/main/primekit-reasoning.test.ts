import { expect, test } from "bun:test"
import { jarvisReasoningEffort, normalizePrimeKitReasoningEffort } from "./primekit-reasoning"

test("keeps every reasoning mode supported by the PrimeKit cloud runtime", () => {
  for (const effort of ["low", "medium", "high", "xhigh", "max", "ultra"]) {
    expect(normalizePrimeKitReasoningEffort(effort)).toBe(effort)
  }
})

test("defaults invalid modes to the website default and maps Ultra to Jarvis max", () => {
  expect(normalizePrimeKitReasoningEffort()).toBe("high")
  expect(normalizePrimeKitReasoningEffort("unexpected")).toBe("high")
  expect(jarvisReasoningEffort("ultra")).toBe("max")
  expect(jarvisReasoningEffort("xhigh")).toBe("xhigh")
})
