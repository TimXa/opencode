type ComputerMcp = {
  type: "remote"
  url: string
  headers: Record<string, string>
  oauth: false
  timeout: number
}

export function getPrimeKitProviderConfig(computer?: ComputerMcp) {
  return JSON.stringify({
    model: "openai/gpt-5.4",
    enabled_providers: ["openai"],
    share: "disabled",
    autoupdate: false,
    ...(computer ? { mcp: { primekit_computer: computer } } : {}),
    provider: {
      openai: {
        name: "Кит",
        whitelist: ["gpt-5.4"],
        models: { "gpt-5.4": { name: "Кит" } },
      },
    },
  })
}
