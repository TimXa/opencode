import { randomUUID } from "node:crypto"
import { existsSync } from "node:fs"
import type { IncomingMessage, ServerResponse } from "node:http"
import type { AddressInfo } from "node:net"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import * as z from "zod/v4"

type Logger = { log: (message: string, meta?: unknown) => void; error: (message: string, meta?: unknown) => void }
type CuaModule = typeof import("@trycua/cua-driver")
type CuaDriver = ReturnType<CuaModule["CuaDriver"]["create"]>
type McpRequest = IncomingMessage & { body: unknown }
type McpResponse = ServerResponse & {
  headersSent: boolean
  status: (code: number) => McpResponse
  json: (body: unknown) => void
}

export type PrimeKitComputerProbe = {
  enabled: boolean
  screen: boolean
  input: boolean
  reason?: string
}

export type PrimeKitComputerMcp = {
  config: { type: "remote"; url: string; headers: Record<string, string>; oauth: false; timeout: number }
  probe: (prompt?: boolean) => Promise<PrimeKitComputerProbe>
  stop: () => Promise<void>
}

const text = (value: string, isError = false) => ({ content: [{ type: "text" as const, text: value }], isError })

const cuaModule = (entry = "index.js") => {
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
  return resourcesPath && existsSync(join(resourcesPath, "app.asar"))
    ? pathToFileURL(
        join(resourcesPath, "app.asar.unpacked", "node_modules", "@trycua", "cua-driver", "dist", entry),
      ).href
    : entry === "index.js"
      ? "@trycua/cua-driver"
      : "@trycua/cua-driver/electron"
}

export async function startPrimeKitComputerMcp(
  enabled: () => boolean,
  logger: Logger,
): Promise<PrimeKitComputerMcp> {
  const token = randomUUID()
  const session = `primekit-${randomUUID()}`
  let cua: CuaModule | undefined
  let driver: CuaDriver | undefined
  let started = false
  let stopping = false
  let queue: Promise<void> = Promise.resolve()
  let cached: { at: number; value: PrimeKitComputerProbe } | undefined

  const serial = <T>(run: () => Promise<T>) => {
    const task = queue.then(run, run)
    queue = task.then(
      () => undefined,
      () => undefined,
    )
    return task
  }

  const closeDriver = async () => {
    const current = driver
    driver = undefined
    cached = undefined
    if (!current) return
    try {
      if (started && cua) await current.endSession(cua.EndSessionInput.new({ session }))
    } catch (error) {
      logger.error("PrimeKit computer session cleanup failed", error)
    } finally {
      started = false
      try {
        await current.shutdown()
      } finally {
        ;(current as CuaDriver & { uniffiDestroy: () => void }).uniffiDestroy()
      }
    }
  }

  const permissions = async (prompt: boolean) => {
    if (process.platform !== "darwin") return { accessibility: true, screenRecording: true }
    cua ??= (await import(cuaModule())) as CuaModule
    let status = cua.currentMacOsPermissionStatus()
    if (prompt && (!status.accessibility || !status.screenRecording)) {
      const electron = (await import(cuaModule("electron.js"))) as typeof import("@trycua/cua-driver/electron")
      status = electron.requestMacOSPermissions()
      if (!status.screenRecording) await electron.openMacOSScreenRecordingSettings()
    }
    return status
  }

  const ensureSession = async () => {
    if (stopping) throw new Error("Computer Use is stopping")
    cua ??= (await import(cuaModule())) as CuaModule
    driver ??= cua.CuaDriver.create(undefined)
    if (!started) {
      await driver.startSession(cua.StartSessionInput.new({ session, captureScope: cua.CaptureScope.Desktop }))
      started = true
    }
    return { cua, driver }
  }

  const observe = async () => {
    const runtime = await ensureSession()
    return runtime.driver.getDesktopState(runtime.cua.GetDesktopStateInput.new({ session }))
  }

  const probeUnsafe = async (prompt = false): Promise<PrimeKitComputerProbe> => {
    if (!enabled()) return { enabled: false, screen: false, input: false, reason: "Полный доступ выключен" }
    if (!prompt && cached && Date.now() - cached.at < 15_000) return cached.value
    try {
      const status = await permissions(prompt)
      if (!status.accessibility || !status.screenRecording) {
        const value = {
          enabled: true,
          screen: false,
          input: false,
          reason: "Разрешите Киту запись экрана и управление компьютером в настройках системы",
        }
        cached = { at: Date.now(), value }
        return value
      }
      const shot = await observe()
      const screen = !shot.isError && shot.images.length > 0
      const cursor = screen
        ? await driver!.getCursorPosition(cua!.GetCursorPositionInput.new({ session }))
        : undefined
      const input = screen && !cursor?.isError
      const value = {
        enabled: true,
        screen,
        input,
        reason: screen
          ? input
            ? undefined
            : cursor?.text || "Не удалось проверить управление вводом"
          : shot.text || "Не удалось проверить захват экрана",
      }
      cached = { at: Date.now(), value }
      return value
    } catch (error) {
      await closeDriver().catch(() => undefined)
      const value = {
        enabled: true,
        screen: false,
        input: false,
        reason: error instanceof Error ? error.message : String(error),
      }
      cached = { at: Date.now(), value }
      return value
    }
  }
  const probe = (prompt = false) => serial(() => probeUnsafe(prompt))

  const result = (value: Awaited<ReturnType<CuaDriver["getDesktopState"]>>) => ({
    content: [
      { type: "text" as const, text: value.text },
      ...value.images.map((image) => ({
        type: "image" as const,
        data: image.dataBase64,
        mimeType: image.mimeType,
      })),
    ],
    isError: value.isError,
  })

  const mutate = async (run: (runtime: Awaited<ReturnType<typeof ensureSession>>) => Promise<unknown>) => {
    try {
      await run(await ensureSession())
      return result(await observe())
    } catch (error) {
      return text(`Результат действия неизвестен: ${error instanceof Error ? error.message : String(error)}.`, true)
    }
  }

  const createServer = (state: PrimeKitComputerProbe) => {
    const server = new McpServer({ name: "primekit-computer", version: "1.0.0" })
    server.registerTool(
      "status",
      { description: "Проверить готовность локального экрана и управления вводом." },
      async () => text(JSON.stringify(await probe(false))),
    )
    if (state.screen) {
      server.registerTool(
        "screenshot",
        { description: "Сделать актуальный снимок всего рабочего стола этого устройства." },
        async () => serial(async () => result(await observe())),
      )
    }
    if (state.input) {
      server.registerTool(
        "click",
        {
          description: "Нажать левую кнопку мыши по абсолютным координатам актуального снимка рабочего стола.",
          inputSchema: { x: z.number().int().nonnegative(), y: z.number().int().nonnegative() },
        },
        async ({ x, y }) =>
          serial(() => mutate(({ cua, driver }) =>
            driver.click(
              cua.ClickInput.new({
                x,
                y,
                scope: cua.DesktopScope.Desktop,
                session,
                button: cua.ClickButton.Left,
                count: 1,
              }),
            ),
          )),
      )
      server.registerTool(
        "type_text",
        {
          description: "Ввести текст в активное поле на этом устройстве.",
          inputSchema: { text: z.string().min(1).max(50_000) },
        },
        async ({ text: value }) =>
          serial(() => mutate(({ cua, driver }) =>
            driver.typeText(
              cua.TypeTextInput.new({ text: value, scope: cua.DesktopScope.Desktop, session }),
            ),
          )),
      )
      server.registerTool(
        "press_key",
        {
          description: "Нажать клавишу на этом устройстве, например ENTER, ESCAPE или TAB.",
          inputSchema: { key: z.string().min(1).max(64) },
        },
        async ({ key }) =>
          serial(() => mutate(({ cua, driver }) =>
            driver.pressKey(cua.PressKeyInput.new({ key, scope: cua.DesktopScope.Desktop, session })),
          )),
      )
    }
    return server
  }

  const app = createMcpExpressApp({ host: "127.0.0.1" })
  app.use("/mcp", (request: McpRequest, response: McpResponse, next: () => void) => {
    if (request.headers.authorization === `Bearer ${token}`) return next()
    response.status(401).json({ error: "unauthorized" })
  })
  app.post("/mcp", async (request: McpRequest, response: McpResponse) => {
    if (stopping) {
      response.status(503).json({ error: "computer_use_stopping" })
      return
    }
    const server = createServer(await probe(false))
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
    try {
      await server.connect(transport)
      await transport.handleRequest(request, response, request.body)
    } catch (error) {
      logger.error("PrimeKit computer MCP request failed", error)
      if (!response.headersSent) response.status(500).json({ error: "computer_use_failed" })
    } finally {
      await transport.close().catch(() => undefined)
      await server.close().catch(() => undefined)
    }
  })
  app.get("/mcp", (_request: McpRequest, response: McpResponse) => response.status(405).end())
  app.delete("/mcp", (_request: McpRequest, response: McpResponse) => response.status(405).end())

  const listener = await new Promise<ReturnType<typeof app.listen>>((resolve, reject) => {
    const value = app.listen(0, "127.0.0.1", () => resolve(value))
    value.once("error", reject)
  })
  const address = listener.address() as AddressInfo
  logger.log("PrimeKit computer MCP listening", { port: address.port })
  let stopPromise: Promise<void> | undefined

  const stop = () => {
    if (stopPromise) return stopPromise
    stopping = true
    stopPromise = (async () => {
      await new Promise<void>((resolve) => {
        let settled = false
        let timeout: ReturnType<typeof setTimeout>
        const done = () => {
          if (settled) return
          settled = true
          clearTimeout(timeout)
          resolve()
        }
        timeout = setTimeout(() => {
          listener.closeAllConnections?.()
          done()
        }, 5_000)
        listener.close(done)
      })
      await queue
      await closeDriver()
    })()
    return stopPromise
  }

  return {
    config: {
      type: "remote",
      url: `http://127.0.0.1:${address.port}/mcp`,
      headers: { authorization: `Bearer ${token}` },
      oauth: false,
      timeout: 60_000,
    },
    probe,
    stop,
  }
}
