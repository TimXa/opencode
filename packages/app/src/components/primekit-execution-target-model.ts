export const executionDeviceLabel = (name: string) => name.replace(/\.local$/i, "")

const runtimeReady = (runtime: { status: string; capabilities: string[] } | undefined) =>
  runtime?.status === "online" && runtime.capabilities.includes("agent_run")

export const visibleExecutionRuntimes = <T extends { id: number; status: string; capabilities: string[] }>(
  runtimes: T[],
  selectedRuntimeID?: number,
) => runtimes.filter((runtime) => runtimeReady(runtime) || runtime.id === selectedRuntimeID)

export { runtimeReady }
