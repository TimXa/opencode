#!/usr/bin/env node

import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"

const modulePath = process.argv[2]
if (!modulePath) throw new Error("Usage: cowork-node-smoke.mjs <built-node-module>")

const temporary = !process.env.COWORK_SMOKE_WORKSPACE
const workspace = process.env.COWORK_SMOKE_WORKSPACE ?? mkdtempSync(join(tmpdir(), "kit-cowork-node-"))
if (temporary) {
  const toolDirectory = join(workspace, ".opencode", "tool")
  mkdirSync(toolDirectory, { recursive: true })
  writeFileSync(
    join(toolDirectory, "smoke.ts"),
    [
      'import { tool } from "@opencode-ai/plugin"',
      "export default tool({",
      '  description: "Packaged Node custom-tool import smoke",',
      "  args: {},",
      '  async execute() { return "unused" },',
      "})",
      "",
    ].join("\n"),
  )
}

const username = "opencode"
const password = crypto.randomUUID()
const authorization = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`
let listener

const request = async (path, init = {}) => {
  const headers = new Headers(init.headers)
  headers.set("authorization", authorization)
  headers.set("x-opencode-directory", workspace)
  if (init.body) headers.set("content-type", "application/json")
  const response = await fetch(new URL(path, listener.url), { ...init, headers })
  const text = await response.text()
  if (!response.ok) throw new Error(`${init.method ?? "GET"} ${path} failed (${response.status}): ${text}`)
  return text ? JSON.parse(text) : undefined
}

try {
  const { Server } = await import(pathToFileURL(resolve(modulePath)).href)
  listener = await Server.listen({ hostname: "127.0.0.1", port: 0, username, password })
  const health = await request("/global/health")
  if (health.version === "local") throw new Error("Packaged Node runtime still reports the local version")

  const session = await request("/session", { method: "POST", body: "{}" })
  const result = await request(`/session/${session.id}/message`, {
    method: "POST",
    body: JSON.stringify({
      agent: "build",
      model: { providerID: "openai", modelID: "gpt-5.6-sol" },
      parts: [{ type: "text", text: "Ответь ровно: PACKAGED_NODE_OK" }],
    }),
  })
  const text = result.parts?.filter((part) => part.type === "text").map((part) => part.text).join("")
  if (text !== "PACKAGED_NODE_OK") throw new Error(`Unexpected assistant text: ${JSON.stringify(text)}`)

  let tool = "skipped"
  if (temporary) {
    const marker = join(workspace, "cowork-tool-smoke.txt")
    await request(`/session/${session.id}/message`, {
      method: "POST",
      body: JSON.stringify({
        agent: "build",
        model: { providerID: "openai", modelID: "gpt-5.6-sol" },
        parts: [
          {
            type: "text",
            text: `Используй write tool: создай файл ${marker} с точным содержимым COWORK_TOOL_OK. Затем ответь TOOL_DONE.`,
          },
        ],
      }),
    })
    if (!existsSync(marker) || readFileSync(marker, "utf8").trim() !== "COWORK_TOOL_OK") {
      throw new Error("Packaged Cowork did not execute the local write tool")
    }
    tool = "passed"
  }
  console.log(JSON.stringify({ status: "passed", version: health.version, text, tool }))
} finally {
  await listener?.stop(true)
  if (temporary) rmSync(workspace, { recursive: true, force: true })
}
