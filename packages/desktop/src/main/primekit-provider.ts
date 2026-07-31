const DEFAULT_API_URL = "https://primekit-job.ru/v1"

export function getPrimeKitProviderConfig(baseURL = DEFAULT_API_URL) {
  return JSON.stringify({
    $schema: "https://opencode.ai/config.json",
    model: "kit/kit",
    provider: {
      kit: {
        npm: "@ai-sdk/openai-compatible",
        name: "Кит",
        options: { baseURL },
        models: { kit: { name: "Кит" } },
      },
    },
  })
}
