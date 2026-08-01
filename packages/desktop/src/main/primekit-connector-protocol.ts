export function modelTokenRequest(runtimeID: number) {
  return {
    path: `/desktop-agent/runtimes/${runtimeID}/model-token`,
    init: { method: "POST" } satisfies RequestInit,
  }
}
