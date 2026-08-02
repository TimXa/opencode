import { mkdir, realpath } from "node:fs/promises"
import { isAbsolute, relative, resolve, sep } from "node:path"

export async function commandWorkspace(trustedRoot: string, cwdRelative?: string | null) {
  const root = await realpath(trustedRoot)
  if (!cwdRelative) return root
  if (isAbsolute(cwdRelative) || cwdRelative.includes("\0")) {
    throw new Error("Invalid chat workspace path")
  }
  const candidate = resolve(root, cwdRelative)
  const lexical = relative(root, candidate)
  if (!lexical || lexical === ".." || lexical.startsWith(`..${sep}`) || isAbsolute(lexical)) {
    throw new Error("Chat workspace must stay inside the trusted folder")
  }
  await mkdir(candidate, { recursive: true })
  const workspace = await realpath(candidate)
  const scoped = relative(root, workspace)
  if (!scoped || scoped === ".." || scoped.startsWith(`..${sep}`) || isAbsolute(scoped)) {
    throw new Error("Chat workspace escaped the trusted folder")
  }
  return workspace
}
