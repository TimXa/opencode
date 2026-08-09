import { describe, expect, test } from "bun:test"
import { isAbsolute } from "node:path"
import { primeKitJarvisWorkspacePath } from "./primekit-jarvis-workspace"

describe("PrimeKit Jarvis workspace", () => {
  test("uses one stable absolute directory for ordinary local chats", () => {
    const first = primeKitJarvisWorkspacePath()
    expect(isAbsolute(first)).toBe(true)
    expect(first).toBe(primeKitJarvisWorkspacePath())
    expect(first.endsWith("/PrimeKit/Jarvis")).toBe(true)
  })
})
