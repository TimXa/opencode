import { For, Show, createResource, createSignal } from "solid-js"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { SettingsListV2 } from "./parts/list"
import { SettingsRowV2 } from "./parts/row"

export function SettingsPrimeKitAccount() {
  const [account] = createResource(() => window.api?.primekit?.state())
  const [devices] = createResource(() => window.api?.primekit?.executionOptions())
  const [computerStatus, setComputerStatus] = createSignal<string>()
  const [checking, setChecking] = createSignal(false)

  const logout = async () => {
    await window.api?.primekit?.logout()
    window.location.reload()
  }

  const checkComputerAccess = async () => {
    setChecking(true)
    try {
      const result = await window.api?.primekit?.requestComputerAccess()
      setComputerStatus(
        result?.screen && result.input
          ? "Экран и управление вводом готовы."
          : result?.reason || "Системные разрешения пока не выданы полностью.",
      )
    } finally {
      setChecking(false)
    }
  }

  return (
    <div class="settings-v2-section">
      <h3 class="settings-v2-section-title">Аккаунт PrimeKit</h3>
      <SettingsListV2>
        <SettingsRowV2
          title={account()?.user?.display_name || "Кит"}
          description={account()?.user?.email || "Аккаунт подключён"}
        >
          <ButtonV2 size="normal" variant="neutral" onClick={() => void logout()}>
            Выйти
          </ButtonV2>
        </SettingsRowV2>
      </SettingsListV2>

      <h3 class="settings-v2-section-title mt-6">Локальный доступ</h3>
      <SettingsListV2>
        <SettingsRowV2
          title="Экран и управление компьютером"
          description={computerStatus() || "Проверить системные разрешения этого Mac или Windows один раз."}
        >
          <ButtonV2 size="normal" variant="neutral" disabled={checking()} onClick={() => void checkComputerAccess()}>
            {checking() ? "Проверяю…" : "Проверить доступ"}
          </ButtonV2>
        </SettingsRowV2>
      </SettingsListV2>

      <h3 class="settings-v2-section-title mt-6">Подключённые устройства</h3>
      <SettingsListV2>
        <Show
          when={(devices()?.runtimes.length ?? 0) > 0}
          fallback={
            <SettingsRowV2
              title="Нет подключённых устройств"
              description="Установите Кит на Mac или Windows и войдите в этот аккаунт."
            >
              <span />
            </SettingsRowV2>
          }
        >
          <For each={devices()?.runtimes ?? []}>
            {(runtime) => (
              <SettingsRowV2
                title={runtime.device_name}
                description={runtime.permission_summary || `${runtime.platform} · локальный агент`}
              >
                <span
                  classList={{
                    "text-[13px] font-medium": true,
                    "text-[#8eaa76]": runtime.status === "online",
                    "text-v2-text-weak": runtime.status !== "online",
                  }}
                >
                  {runtime.status === "online" ? "В сети" : "Не в сети"}
                </span>
              </SettingsRowV2>
            )}
          </For>
        </Show>
      </SettingsListV2>

      <p class="mt-4 max-w-[620px] text-[13px] leading-5 text-v2-text-weak">
        Выбор устройства и разрешённой папки сохраняется отдельно для каждого чата. Системные разрешения macOS
        и Windows принадлежат конкретной подписанной установке Кита.
      </p>
    </div>
  )
}
