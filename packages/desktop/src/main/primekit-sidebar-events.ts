export type PrimeKitSidebarEvent = {
  type?: string
  chat_id?: number
  server_id?: number
  runtime_id?: number
}

const listeners = new Set<(event: PrimeKitSidebarEvent) => void>()

export function publishPrimeKitSidebarEvent(event: PrimeKitSidebarEvent) {
  for (const listener of listeners) listener(event)
}

export function subscribePrimeKitSidebarEvents(listener: (event: PrimeKitSidebarEvent) => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
