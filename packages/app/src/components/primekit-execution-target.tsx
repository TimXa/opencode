import { Icon } from "@opencode-ai/ui/icon"
import { Icon as IconV2 } from "@opencode-ai/ui/v2/icon"
import { MenuV2 } from "@opencode-ai/ui/v2/menu-v2"
import { createMemo, createResource, For, Show } from "solid-js"
import { showToast } from "@/utils/toast"

export type PrimeKitExecutionTargetValue =
  | { kind: "cloud" }
  | { kind: "desktop"; runtime_id: number; folder_grant_id: number }

const runtimeReady = (runtime: { status: string; capabilities: string[] } | undefined) =>
  runtime?.status === "online" && runtime.capabilities.includes("agent_run")

const grantReady = (
  grant: { active: boolean; capabilities: string[]; runtime_id: number } | undefined,
  runtimeID?: number,
) =>
  Boolean(
    grant?.active &&
      grant.runtime_id === runtimeID &&
      ["read", "write", "patch", "shell"].every((capability) => grant.capabilities.includes(capability)),
  )

export function primeKitChatID(sessionID: string) {
  const personal = /^ses_pk_(\d+)$/.exec(sessionID)
  if (personal) return Number(personal[1])
  const space = /^ses_pks_\d+_(\d+)$/.exec(sessionID)
  return space ? Number(space[1]) : undefined
}

type Props =
  | { sessionID: string }
  | { value: PrimeKitExecutionTargetValue; onChange: (value: PrimeKitExecutionTargetValue) => void }

export function PrimeKitExecutionTarget(props: Props) {
  const controlled = () => "value" in props
  const id = createMemo(() => ("sessionID" in props ? primeKitChatID(props.sessionID) : undefined))
  const [options, { refetch: refetchOptions }] = createResource(
    () => (window.api?.primekit && (id() || controlled()) ? true : undefined),
    () => window.api!.primekit!.executionOptions(),
  )
  const [target, { refetch }] = createResource(
    () => id(),
    (value) => window.api!.primekit!.executionTarget(value),
  )
  const selected = createMemo(() => {
    if (!("value" in props)) return target()
    const value = props.value
    if (value.kind === "cloud") return value
    const runtime = options()?.runtimes.find((item) => item.id === value.runtime_id)
    const grant = options()?.grants.find((item) => item.id === value.folder_grant_id)
    return {
      ...value,
      runtime_name: runtime?.device_name,
      folder_name: grant?.display_name,
      available: runtimeReady(runtime) && grantReady(grant, runtime?.id),
    }
  })
  const selectedDesktop = createMemo(() => {
    const value = selected()
    return value?.kind === "desktop" ? value : undefined
  })
  const label = createMemo(() => {
    const value = selected()
    if (!value || value.kind === "cloud") return "Облако"
    return `${value.runtime_name ?? "Устройство"} · ${value.folder_name ?? "Папка"}`
  })
  const selectCloud = async () => {
    if ("onChange" in props) {
      props.onChange({ kind: "cloud" })
      return
    }
    const value = id()
    if (!value) return
    await window.api!.primekit!.setExecutionTarget(value, { kind: "cloud" })
    await refetch()
  }
  const selectDesktop = async (runtimeID: number, grantID: number) => {
    if ("onChange" in props) {
      props.onChange({ kind: "desktop", runtime_id: runtimeID, folder_grant_id: grantID })
      return
    }
    const value = id()
    if (!value) return
    await window.api!.primekit!.setExecutionTarget(value, {
      kind: "desktop",
      runtime_id: runtimeID,
      folder_grant_id: grantID,
    })
    await refetch()
  }
  const addFolder = async () => {
    try {
      const path = await window.api!.openDirectoryPicker({ title: "Разрешить Киту доступ к папке" })
      if (!path || Array.isArray(path)) return
      await window.api!.primekit!.authorizeExecutionFolder(path)
      await refetchOptions()
    } catch (error) {
      showToast({
        title: "Не удалось подключить папку",
        description: error instanceof Error ? error.message : String(error),
        variant: "error",
      })
    }
  }

  return (
    <Show when={window.api?.primekit && (id() || controlled())}>
      <MenuV2 placement="top-start" gutter={4}>
        <MenuV2.Trigger class="flex h-7 min-w-0 max-w-[260px] items-center gap-1.5 rounded-sm px-1.5 text-[13px] hover:bg-v2-overlay-simple-overlay-hover focus-visible:bg-v2-overlay-simple-overlay-hover focus-visible:outline-none data-[expanded]:bg-v2-overlay-simple-overlay-pressed">
          <IconV2 name={selected()?.kind === "desktop" ? "monitor" : "cloud"} class="shrink-0 text-v2-icon-icon-muted" />
          <span class="min-w-0 truncate">{label()}</span>
          <Show when={selectedDesktop() && !selectedDesktop()?.available}>
            <span class="size-1.5 shrink-0 rounded-full bg-v2-icon-icon-critical-base" aria-label="Устройство недоступно" />
          </Show>
          <Icon name="chevron-down" size="small" class="shrink-0 text-v2-icon-icon-muted" />
        </MenuV2.Trigger>
        <MenuV2.Portal>
          <MenuV2.Content class="w-[280px]">
            <MenuV2.Group>
              <MenuV2.GroupLabel>Где работает Кит</MenuV2.GroupLabel>
              <MenuV2.Item onSelect={() => void selectCloud()}>
                <IconV2 name="cloud" />
                <span class="min-w-0 flex-1 truncate">Облако</span>
                <Show when={selected()?.kind === "cloud"}><Icon name="check" size="small" /></Show>
              </MenuV2.Item>
            </MenuV2.Group>
            <MenuV2.Separator />
            <MenuV2.Group>
              <For each={options()?.grants.filter((grant) => grant.active)}>
                {(grant) => {
                  const runtime = () => options()?.runtimes.find((item) => item.id === grant.runtime_id)
                  const available = () => runtimeReady(runtime()) && grantReady(grant, runtime()?.id)
                  return (
                    <MenuV2.Item disabled={!available()} onSelect={() => void selectDesktop(grant.runtime_id, grant.id)}>
                      <IconV2 name="monitor" />
                      <span class="min-w-0 flex-1">
                        <span class="block truncate">{runtime()?.device_name ?? "Устройство"}</span>
                        <span class="block truncate text-[11px] text-v2-text-text-faint">
                          {grant.display_name}{available() ? "" : " · недоступно"}
                        </span>
                      </span>
                      <Show when={selectedDesktop()?.runtime_id === grant.runtime_id && selectedDesktop()?.folder_grant_id === grant.id}>
                        <Icon name="check" size="small" />
                      </Show>
                    </MenuV2.Item>
                  )
                }}
              </For>
              <Show when={!options.loading && !options()?.grants.some((grant) => grant.active)}>
                <div class="px-3 py-2 text-[12px] text-v2-text-text-faint">Откройте папку в приложении на Mac или Windows.</div>
              </Show>
            </MenuV2.Group>
            <MenuV2.Separator />
            <MenuV2.Item onSelect={() => void addFolder()}>
              <IconV2 name="folder-add" />
              Подключить папку на этом компьютере…
            </MenuV2.Item>
          </MenuV2.Content>
        </MenuV2.Portal>
      </MenuV2>
    </Show>
  )
}
