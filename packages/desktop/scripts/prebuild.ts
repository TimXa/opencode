#!/usr/bin/env bun
import { $ } from "bun"

import { downloadCliToResources, resolveChannel } from "./utils"

const channel = resolveChannel()
if (channel === "prod" || Bun.env.PRIMEKIT_BUNDLE_WEB === "1") {
  await $`bun ./scripts/sync-primekit-web.ts`
}
await $`bun ./scripts/copy-icons.ts ${channel}`
await $`bun ./scripts/copy-metainfo.ts ${channel}`

await $`cd ../opencode && bun script/build-node.ts`
if (channel === "dev") await downloadCliToResources()
