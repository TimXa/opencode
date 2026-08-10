export const primeKitReasoningEfforts = ["low", "medium", "high", "xhigh", "max", "ultra"] as const

export type PrimeKitReasoningEffort = (typeof primeKitReasoningEfforts)[number]

export function normalizePrimeKitReasoningEffort(value?: string | null): PrimeKitReasoningEffort {
  return primeKitReasoningEfforts.includes(value as PrimeKitReasoningEffort)
    ? (value as PrimeKitReasoningEffort)
    : "high"
}

export function jarvisReasoningEffort(value: PrimeKitReasoningEffort) {
  return value === "ultra" ? "max" : value
}
