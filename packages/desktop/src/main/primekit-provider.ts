type ComputerMcp = {
  type: "remote"
  url: string
  headers: Record<string, string>
  oauth: false
  timeout: number
}

export function getPrimeKitProviderConfig(computer?: ComputerMcp, credential?: string) {
  const api = `${process.env.PRIMEKIT_ACCOUNT_API_URL ?? "https://primekit-job.ru/api"}/v1`
  return JSON.stringify({
    model: "kit/kit",
    enabled_providers: ["kit"],
    share: "disabled",
    autoupdate: false,
    ...(computer ? { mcp: { primekit_computer: computer } } : {}),
    provider: {
      kit: {
        name: "Кит",
        npm: "@ai-sdk/openai-compatible",
        api,
        options: { baseURL: api, ...(credential ? { headers: { Authorization: `Bearer ${credential}` } } : {}) },
        whitelist: ["kit"],
        models: { kit: { name: "Кит" } },
      },
    },
  })
}
