import { createResource, createSignal } from "solid-js"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { SettingsListV2 } from "./parts/list"
import { SettingsRowV2 } from "./parts/row"

export function SettingsPrimeKitAccount() {
  const [account] = createResource(() => window.api?.primekit?.state())
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
          ? "Кит может видеть экран и управлять этим компьютером."
          : result?.reason || "Разрешите Кит доступ в системных настройках.",
      )
    } finally {
      setChecking(false)
    }
  }

  return (
    <div class="settings-v2-section">
      <div class="settings-v2-tab-header">
        <div>
          <h2>Аккаунт</h2>
          <p>Профиль и доступ Кита к этому компьютеру.</p>
        </div>
      </div>
      <div class="settings-v2-tab-body">
        <SettingsListV2>
          <SettingsRowV2
            title={account()?.user?.display_name || "Кит"}
            description={account()?.user?.email || "Аккаунт подключён"}
          >
            <ButtonV2 size="normal" variant="neutral" onClick={() => void logout()}>
              Выйти
            </ButtonV2>
          </SettingsRowV2>
          <SettingsRowV2
            title="Доступ к компьютеру"
            description={computerStatus() || "Проверить системные разрешения один раз."}
          >
            <ButtonV2 size="normal" variant="neutral" disabled={checking()} onClick={() => void checkComputerAccess()}>
              {checking() ? "Проверяю…" : "Проверить"}
            </ButtonV2>
          </SettingsRowV2>
        </SettingsListV2>
      </div>
    </div>
  )
}
