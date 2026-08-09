export type Channel = "dev" | "beta" | "prod"
const raw = import.meta.env.OPENCODE_CHANNEL
export const CHANNEL: Channel = raw === "dev" || raw === "beta" || raw === "prod" ? raw : "dev"

export const updaterEnabled = (channel: Channel) => channel === "prod"

// Dev and beta bundles never contact a release feed. Production packages embed
// PrimeKit's explicit GitHub feed through electron-builder's app-update.yml.
export const UPDATER_ENABLED = updaterEnabled(CHANNEL)
