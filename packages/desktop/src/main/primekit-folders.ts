import { access, realpath } from "node:fs/promises"
import { defaultPrimeKitWorkspace, primeKitWorkspaceName } from "./primekit-device"
import { getStore } from "./store"
import { PRIMEKIT_AUTHORIZED_FOLDERS_KEY } from "./store-keys"

type Account = { request: <T>(path: string, init?: RequestInit) => Promise<T> }
export type PrimeKitFolderGrant = {
  id: number
  runtime_id: number
  root_path_display: string
  active: boolean
}

export async function authorizePrimeKitFolder(path: string) {
  const root = await realpath(path)
  await access(root)
  const store = getStore()
  const current = store.get(PRIMEKIT_AUTHORIZED_FOLDERS_KEY)
  const folders = Array.isArray(current) ? current.filter((item): item is string => typeof item === "string") : []
  if (!folders.includes(root)) store.set(PRIMEKIT_AUTHORIZED_FOLDERS_KEY, [...folders, root])
  return root
}

export async function authorizedPrimeKitFolders() {
  const fallback = await defaultPrimeKitWorkspace()
  const current = getStore().get(PRIMEKIT_AUTHORIZED_FOLDERS_KEY)
  const candidates = [fallback, ...(Array.isArray(current) ? current : [])]
  const resolved = await Promise.all(
    candidates.map(async (item) => {
      if (typeof item !== "string") return
      try {
        const root = await realpath(item)
        await access(root)
        return root
      } catch {
        return
      }
    }),
  )
  return [...new Set(resolved.filter((item): item is string => Boolean(item)))]
}

export async function syncPrimeKitFolderGrants(account: Account, runtimeID: number) {
  const roots = await authorizedPrimeKitFolders()
  const grants = await account.request<PrimeKitFolderGrant[]>(`/desktop-agent/folder-grants?runtime_id=${runtimeID}`)
  const result = new Map<number, string>()
  for (const root of roots) {
    let grant = grants.find((item) => item.active && item.root_path_display === root)
    if (!grant) {
      grant = await account.request<PrimeKitFolderGrant>(`/desktop-agent/runtimes/${runtimeID}/folder-grants`, {
        method: "POST",
        body: JSON.stringify({
          display_name: primeKitWorkspaceName(root),
          root_path_display: root,
          capabilities: ["read", "write", "patch", "shell"],
        }),
      })
    }
    result.set(grant.id, root)
  }
  return result
}
