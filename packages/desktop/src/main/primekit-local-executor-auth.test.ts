import { afterEach, expect, test } from "bun:test"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { authorizeLocalExecutor } from "./primekit-local-executor-auth"

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

test("refreshes an existing OpenCode OAuth record from the current Codex login", async () => {
  const root = await mkdtemp(join(tmpdir(), "kit-auth-sync-"))
  roots.push(root)
  const source = join(root, "codex", "auth.json")
  const target = join(root, "opencode", "auth.json")
  await mkdir(dirname(source), { recursive: true })
  await mkdir(dirname(target), { recursive: true })
  await writeFile(
    source,
    JSON.stringify({ tokens: { access_token: "new-access", refresh_token: "new-refresh", account_id: "new-account" } }),
  )
  await writeFile(
    target,
    JSON.stringify({ openai: { type: "oauth", access: "old-access", refresh: "old-refresh", expires: 1 }, other: { type: "api", key: "keep" } }),
  )

  expect(await authorizeLocalExecutor({ source, target })).toBe(true)
  const saved = JSON.parse(await readFile(target, "utf8"))
  expect(saved.openai).toMatchObject({
    type: "oauth",
    access: "new-access",
    refresh: "new-refresh",
    accountId: "new-account",
  })
  expect(saved.other).toEqual({ type: "api", key: "keep" })
})

test("does not replace auth when the Codex login is incomplete", async () => {
  const root = await mkdtemp(join(tmpdir(), "kit-auth-sync-"))
  roots.push(root)
  const source = join(root, "codex", "auth.json")
  const target = join(root, "opencode", "auth.json")
  await mkdir(dirname(source), { recursive: true })
  await mkdir(dirname(target), { recursive: true })
  await writeFile(source, JSON.stringify({ tokens: { access_token: "access-only" } }))
  await writeFile(target, JSON.stringify({ openai: { type: "oauth", access: "kept" } }))

  expect(await authorizeLocalExecutor({ source, target })).toBe(false)
  expect(JSON.parse(await readFile(target, "utf8")).openai.access).toBe("kept")
})
