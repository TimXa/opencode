type ComputerMcp = {
  type: "remote"
  url: string
  headers: Record<string, string>
  oauth: false
  timeout: number
}

export function getPrimeKitProviderConfig(computer?: ComputerMcp) {
  return JSON.stringify({
    model: "openai/gpt-5.6-sol",
    enabled_providers: ["openai"],
    // A user's global OpenCode config may disable OpenAI. Cowork deliberately
    // uses the direct Codex model path, so the desktop-owned config is authoritative.
    disabled_providers: [],
    share: "disabled",
    autoupdate: false,
    ...(computer ? { mcp: { primekit_computer: computer } } : {}),
    provider: {
      openai: {
        name: "Кит",
        whitelist: ["gpt-5.6-sol"],
        models: { "gpt-5.6-sol": { name: "Кит" } },
      },
    },
  })
}
