import { Icon } from "@opencode-ai/ui/icon"
import { Icon as IconV2 } from "@opencode-ai/ui/v2/icon"
import { MenuV2 } from "@opencode-ai/ui/v2/menu-v2"
import { createMemo, createResource, For, Show } from "solid-js"

function chatID(sessionID: string) {
  const personal = /^ses_pk_(\d+)$/.exec(sessionID)
  if (personal) return Number(personal[1])
  const space = /^ses_pks_\d+_(\d+)$/.exec(sessionID)
  return space ? Number(space[1]) : undefined
}

export function PrimeKitExecutionTarget(props: { sessionID: string }) {
  const id = createMemo(() => chatID(props.sessionID))
  const [options] = createResource(
    () => (id() && window.api?.primekit ? true : undefined),
    () => window.api!.primekit!.executionOptions(),
  )
  const [target, { refetch }] = createResource(
    () => id(),
    (value) => window.api!.primekit!.executionTarget(value),
  )
  const label = createMemo(() => {
    const value = target()
    if (!value || value.kind === "cloud") return "Облако"
    return `${value.runtime_name ?? "Устройство"} · ${value.folder_name ?? "Папка"}`
  })
  const selectCloud = async () => {
    const value = id()
    if (!value) return
    await window.api!.primekit!.setExecutionTarget(value, { kind: "cloud" })
    await refetch()
  }
  const selectDesktop = async (runtimeID: number, grantID: number) => {
    const value = id()
    if (!value) return
    await window.api!.primekit!.setExecutionTarget(value, {
      kind: "desktop",
      runtime_id: runtimeID,
      folder_grant_id: grantID,
    })
    await refetch()
  }

  return (
    <Show when={id() && window.api?.primekit}>
      <MenuV2 placement="top-start" gutter={4}>
        <MenuV2.Trigger class="flex h-7 min-w-0 max-w-[260px] items-center gap-1.5 rounded-sm px-1.5 text-[13px] hover:bg-v2-overlay-simple-overlay-hover focus-visible:bg-v2-overlay-simple-overlay-hover focus-visible:outline-none data-[expanded]:bg-v2-overlay-simple-overlay-pressed">
          <IconV2 name={target()?.kind === "desktop" ? "monitor" : "cloud"} class="shrink-0 text-v2-icon-icon-muted" />
          <span class="min-w-0 truncate">{label()}</span>
          <Show when={target()?.kind === "desktop" && !target()?.available}>
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
                <Show when={target()?.kind === "cloud"}><Icon name="check" size="small" /></Show>
              </MenuV2.Item>
            </MenuV2.Group>
            <MenuV2.Separator />
            <MenuV2.Group>
              <For each={options()?.grants.filter((grant) => grant.active)}>
                {(grant) => {
                  const runtime = () => options()?.runtimes.find((item) => item.id === grant.runtime_id)
                  const online = () => runtime()?.status === "online"
                  return (
                    <MenuV2.Item disabled={!online()} onSelect={() => void selectDesktop(grant.runtime_id, grant.id)}>
                      <IconV2 name="monitor" />
                      <span class="min-w-0 flex-1">
                        <span class="block truncate">{runtime()?.device_name ?? "Устройство"}</span>
                        <span class="block truncate text-[11px] text-v2-text-text-faint">{grant.display_name}{online() ? "" : " · не в сети"}</span>
                      </span>
                      <Show when={target()?.runtime_id === grant.runtime_id && target()?.folder_grant_id === grant.id}>
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
          </MenuV2.Content>
        </MenuV2.Portal>
      </MenuV2>
    </Show>
  )
}
