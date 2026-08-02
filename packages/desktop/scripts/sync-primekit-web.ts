#!/usr/bin/env bun
import { cp, mkdir, rm, stat } from "node:fs/promises"
import { resolve } from "node:path"

const source = resolve(
  Bun.env.PRIMEKIT_WEB_DIST ?? resolve(import.meta.dir, "../../../../Omar1/ReactSR-master/dist-desktop"),
)
const destination = resolve(import.meta.dir, "../resources/primekit-web")

if (!(await stat(resolve(source, "index.html")).catch(() => null))) {
  throw new Error(`PrimeKit desktop renderer is missing: ${source}. Run the canonical web build first.`)
}

await rm(destination, { recursive: true, force: true })
await mkdir(destination, { recursive: true })
await cp(source, destination, { recursive: true })
console.log(`Bundled PrimeKit renderer from ${source}`)
