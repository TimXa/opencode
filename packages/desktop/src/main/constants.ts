type Channel = "dev" | "beta" | "prod"
const raw = import.meta.env.OPENCODE_CHANNEL
export const CHANNEL: Channel = raw === "dev" || raw === "beta" || raw === "prod" ? raw : "dev"

// Enable only after PrimeKit has its own signed release feed. This prevents a
// branded local build from ever checking or installing upstream OpenCode bits.
export const UPDATER_ENABLED = false
