import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, realpath, rm, symlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { commandWorkspace } from "./primekit-workspace"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function temporaryRoot() {
  const root = await mkdtemp(join(tmpdir(), "primekit-workspace-"))
  roots.push(root)
  return root
}

describe("commandWorkspace", () => {
  test("creates and reuses one isolated directory per chat", async () => {
    const root = await temporaryRoot()
    const first = await commandWorkspace(root, "Chats/42")
    expect(first).toBe(resolve(await realpath(root), "Chats/42"))
    expect(await commandWorkspace(root, "Chats/42")).toBe(first)
    expect(await commandWorkspace(root, "Chats/43")).not.toBe(first)
  })

  test("rejects traversal and absolute paths", async () => {
    const root = await temporaryRoot()
    await expect(commandWorkspace(root, "../outside")).rejects.toThrow("trusted folder")
    await expect(commandWorkspace(root, resolve(root, "outside"))).rejects.toThrow("Invalid")
  })

  test("rejects a symlink escape", async () => {
    const root = await temporaryRoot()
    const outside = await temporaryRoot()
    await mkdir(join(root, "Chats"))
    await symlink(outside, join(root, "Chats", "42"))
    await expect(commandWorkspace(root, "Chats/42")).rejects.toThrow("escaped")
  })
})
