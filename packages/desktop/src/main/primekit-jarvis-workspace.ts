import { mkdir } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"

/**
 * Jarvis still needs a cwd internally, but ordinary chats should not force the
 * user to choose a project. Keep those chats in one stable app-owned workspace.
 */
export const primeKitJarvisWorkspacePath = () => join(homedir(), "PrimeKit", "Jarvis")

export async function ensurePrimeKitJarvisWorkspace() {
  const path = primeKitJarvisWorkspacePath()
  await mkdir(path, { recursive: true })
  return path
}
