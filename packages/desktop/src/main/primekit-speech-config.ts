export type PrimeKitSpeechWebSocketConfig = {
  primaryURL: string
  fallbackURL: string
  primaryReady: boolean
}

type ProviderConfig = {
  nexara_ws_url?: unknown
  nexara_ready?: unknown
  ws_ticket?: unknown
}

export function speechWebSocketConfig(baseURL: string, input: ProviderConfig): PrimeKitSpeechWebSocketConfig {
  const configured = typeof input.nexara_ws_url === "string" ? input.nexara_ws_url.trim() : ""
  const ticket = typeof input.ws_ticket === "string" ? input.ws_ticket.trim() : ""
  if (!configured || !ticket) throw new Error("Сервис диктовки вернул неполную конфигурацию")
  const wsBase = baseURL.replace(/^http/, "ws").replace(/\/$/, "")
  const primary = new URL(
    configured.startsWith("ws://") || configured.startsWith("wss://")
      ? configured
      : `${wsBase}/${configured.replace(/^\/+/, "")}`,
  )
  if (primary.origin === new URL(wsBase).origin) primary.searchParams.set("access_token", ticket)
  const fallback = new URL(`${wsBase}/speech/stream`)
  fallback.searchParams.set("access_token", ticket)
  return { primaryURL: primary.toString(), fallbackURL: fallback.toString(), primaryReady: input.nexara_ready === true }
}
