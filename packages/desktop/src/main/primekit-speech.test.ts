import { describe, expect, test } from "bun:test"
import { speechWebSocketConfig } from "./primekit-speech-config"

describe("PrimeKit speech websocket config", () => {
  test("keeps the short-lived ticket inside same-origin websocket URLs", () => {
    const result = speechWebSocketConfig("https://primekit-job.ru/api", {
      nexara_ws_url: "/speech/nexara",
      nexara_ready: true,
      ws_ticket: "short-lived",
    })
    expect(result).toEqual({
      primaryURL: "wss://primekit-job.ru/api/speech/nexara?access_token=short-lived",
      fallbackURL: "wss://primekit-job.ru/api/speech/stream?access_token=short-lived",
      primaryReady: true,
    })
  })

  test("does not leak the PrimeKit ticket to an external provider URL", () => {
    const result = speechWebSocketConfig("https://primekit-job.ru/api", {
      nexara_ws_url: "wss://speech.example.test/live",
      nexara_ready: true,
      ws_ticket: "short-lived",
    })
    expect(result.primaryURL).toBe("wss://speech.example.test/live")
    expect(result.fallbackURL).toContain("access_token=short-lived")
  })
})
