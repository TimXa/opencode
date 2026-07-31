export function getPrimeKitProviderConfig() {
  return JSON.stringify({
    model: "openai/gpt-5.4",
    enabled_providers: ["openai"],
    share: "disabled",
    autoupdate: false,
    provider: {
      openai: {
        name: "Кит",
        whitelist: ["gpt-5.4"],
        models: { "gpt-5.4": { name: "Кит" } },
      },
    },
  })
}
