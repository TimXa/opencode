export function modelTokenRequest(commandID: number, claimToken: string) {
  return {
    path: `/desktop-agent/commands/${commandID}/model-token`,
    init: {
      method: "POST",
      body: JSON.stringify({ claim_token: claimToken }),
    } satisfies RequestInit,
  }
}
