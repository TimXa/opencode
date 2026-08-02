import { Icon } from "@opencode-ai/ui/icon"
import { Icon as IconV2 } from "@opencode-ai/ui/v2/icon"
import { MenuV2 } from "@opencode-ai/ui/v2/menu-v2"
import { createMemo, createResource, For, Show } from "solid-js"
import {
  executionDeviceLabel,
  runtimeReady,
  visibleExecutionRuntimes,
} from "./primekit-execution-target-model"

export { executionDeviceLabel, visibleExecutionRuntimes } from "./primekit-execution-target-model"

export type PrimeKitExecutionTargetValue =
  | { kind: "cloud" }
  | { kind: "desktop"; runtime_id: number; folder_grant_id?: number }

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
  const [options] = createResource(
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
    return {
      ...value,
      runtime_name: runtime?.device_name,
      available: runtimeReady(runtime),
    }
  })
  const selectedDesktop = createMemo(() => {
    const value = selected()
    return value?.kind === "desktop" ? value : undefined
  })
  const visibleRuntimes = createMemo(() =>
    visibleExecutionRuntimes(options()?.runtimes ?? [], selectedDesktop()?.runtime_id ?? undefined),
  )
  const label = createMemo(() => {
    const value = selected()
    if (!value || value.kind === "cloud") return "Облако"
    return executionDeviceLabel(value.runtime_name ?? "Устройство")
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
  const selectDesktop = async (runtimeID: number) => {
    if ("onChange" in props) {
      props.onChange({ kind: "desktop", runtime_id: runtimeID })
      return
    }
    const value = id()
    if (!value) return
    await window.api!.primekit!.setExecutionTarget(value, {
      kind: "desktop",
      runtime_id: runtimeID,
    })
    await refetch()
  }

  return (
    <Show when={window.api?.primekit && (id() || controlled())}>
      <MenuV2 placement="top-start" gutter={4}>
        <MenuV2.Trigger class="flex h-7 min-w-0 max-w-[260px] items-center gap-1.5 rounded-sm px-1.5 text-[13px] hover:bg-v2-overlay-simple-overlay-hover focus-visible:bg-v2-overlay-simple-overlay-hover focus-visible:outline-none data-[expanded]:bg-v2-overlay-simple-overlay-pressed">
          <IconV2
            name={selected()?.kind === "desktop" ? "monitor" : "cloud"}
            class="shrink-0 text-v2-icon-icon-muted"
          />
          <span class="min-w-0 truncate">{label()}</span>
          <Show when={selectedDesktop() && !selectedDesktop()?.available}>
            <span
              class="size-1.5 shrink-0 rounded-full bg-v2-icon-icon-critical-base"
              aria-label="Устройство недоступно"
            />
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
                <Show when={selected()?.kind === "cloud"}>
                  <Icon name="check" size="small" />
                </Show>
              </MenuV2.Item>
            </MenuV2.Group>
            <MenuV2.Separator />
            <MenuV2.Group>
              <For each={visibleRuntimes()}>
                {(runtime) => {
                  const available = () => runtimeReady(runtime)
                  return (
                    <MenuV2.Item disabled={!available()} onSelect={() => void selectDesktop(runtime.id)}>
                      <IconV2 name="monitor" />
                      <span class="min-w-0 flex-1 truncate">{executionDeviceLabel(runtime.device_name)}</span>
                      <Show when={selectedDesktop()?.runtime_id === runtime.id}>
                        <Icon name="check" size="small" />
                      </Show>
                    </MenuV2.Item>
                  )
                }}
              </For>
              <Show when={!options.loading && !visibleRuntimes().length}>
                <div class="px-3 py-2 text-[12px] text-v2-text-text-faint">
                  Нет доступных компьютеров. Откройте Кит на Mac или Windows.
                </div>
              </Show>
            </MenuV2.Group>
          </MenuV2.Content>
        </MenuV2.Portal>
      </MenuV2>
    </Show>
  )
}
