import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"

import { startPrimeKitComputerMcp } from "../src/main/primekit-computer-mcp.ts"

const computer = await startPrimeKitComputerMcp(() => true, { log() {}, error: console.error })
const client = new Client({ name: "primekit-computer-smoke", version: "1.0.0" })

try {
  const transport = new StreamableHTTPClientTransport(new URL(computer.config.url), {
    requestInit: { headers: computer.config.headers },
  })
  await client.connect(transport)
  const tools = await client.listTools()
  const screenshot = await client.callTool({ name: "screenshot", arguments: {} })
  const names = tools.tools.map((tool) => tool.name)
  if (!names.includes("screenshot") || !screenshot.content.some((item) => item.type === "image")) {
    throw new Error("PrimeKit Computer Use did not return a screenshot")
  }
  console.log(JSON.stringify({ tools: names, screenshot: "ok" }))
} finally {
  await client.close().catch(() => undefined)
  await computer.stop()
}
