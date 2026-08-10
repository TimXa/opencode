export type PrimeKitTaskStreamClient = {
  stream(path: string, init?: RequestInit): Promise<Response>
}

export function openPrimeKitTaskStream(client: PrimeKitTaskStreamClient, path: string) {
  return client.stream(path, { headers: { accept: "text/event-stream" } })
}
