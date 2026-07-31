export function getPrimeKitProviderConfig() {
  return JSON.stringify({
    $schema: "https://opencode.ai/config.json",
    model: "openai/gpt-5.4",
    provider: {
      openai: {
        name: "Кит",
        models: { "gpt-5.4": { name: "Кит" } },
      },
    },
  })
}
