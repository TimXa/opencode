import { primeKitAccount } from "./primekit-account"
import { speechWebSocketConfig } from "./primekit-speech-config"

export async function getPrimeKitSpeechWebSocketConfig() {
  const config = await primeKitAccount.request<{
    nexara_ws_url?: unknown
    nexara_ready?: unknown
    ws_ticket?: unknown
  }>("/speech/provider-config")
  return speechWebSocketConfig(primeKitAccount.baseURL, config)
}
