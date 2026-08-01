import { existsSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { spawnSync } from "node:child_process"

const executable = resolve(process.argv[2] ?? "")
if (!process.argv[2] || !existsSync(executable)) throw new Error("Pass the packaged Kit executable path")

const resources = process.platform === "darwin" ? join(dirname(dirname(executable)), "Resources") : join(dirname(executable), "resources")
const moduleURL = pathToFileURL(
  join(resources, "app.asar.unpacked", "node_modules", "@trycua", "cua-driver", "dist", "index.js"),
).href
const code = `import(${JSON.stringify(moduleURL)}).then(async m=>{const d=m.CuaDriver.create(undefined);const x=await d.metadata();console.log(JSON.stringify({version:x.driverVersion,embedded:x.embedded,electron:process.versions.electron}));await d.shutdown();d.uniffiDestroy()}).catch(e=>{console.error(e);process.exit(1)})`
const result = spawnSync(executable, ["-e", code], {
  encoding: "utf8",
  env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
})
if (result.status !== 0) throw new Error(result.stderr || result.stdout || `Packaged smoke exited ${result.status}`)
const output = JSON.parse(result.stdout.trim())
if (output.version !== "0.14.2" || output.embedded !== true || !output.electron) throw new Error(result.stdout)
console.log(JSON.stringify(output))
