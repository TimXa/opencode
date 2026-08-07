import { createResource, createSignal, Show } from "solid-js"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { SettingsListV2 } from "./parts/list"
import { SettingsRowV2 } from "./parts/row"

export function SettingsPrimeKitAccount() {
  const [account, { refetch }] = createResource(() => window.api?.primekit?.state())
  const [email, setEmail] = createSignal("")
  const [code, setCode] = createSignal("")
  const [codeSent, setCodeSent] = createSignal(false)
  const [authError, setAuthError] = createSignal("")
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

  const signIn = async () => {
    setAuthError("")
    try {
      if (!codeSent()) {
        await window.api?.primekit?.requestEmailCode(email().trim())
        setCodeSent(true)
        return
      }
      await window.api?.primekit?.verifyEmailCode(email().trim(), code().trim())
      await refetch()
    } catch (cause) {
      setAuthError(cause instanceof Error ? cause.message : String(cause))
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
          <Show
            when={account()?.signedIn}
            fallback={
              <SettingsRowV2 title="Облако" description={authError() || (codeSent() ? "Введите код из письма" : "Войдите, чтобы видеть чаты с сайта") }>
                <div class="flex items-center gap-2">
                  <input
                    class="h-8 w-44 rounded-md border border-border-weak bg-background-base px-2 text-sm"
                    type={codeSent() ? "text" : "email"}
                    placeholder={codeSent() ? "Код" : "Email"}
                    value={codeSent() ? code() : email()}
                    onInput={(event) => codeSent() ? setCode(event.currentTarget.value) : setEmail(event.currentTarget.value)}
                  />
                  <ButtonV2 size="normal" variant="neutral" onClick={() => void signIn()}>
                    {codeSent() ? "Войти" : "Получить код"}
                  </ButtonV2>
                </div>
              </SettingsRowV2>
            }
          >
            <SettingsRowV2 title={account()?.user?.display_name || "Кит"} description={account()?.user?.email || "Аккаунт подключён"}>
              <ButtonV2 size="normal" variant="neutral" onClick={() => void logout()}>Выйти</ButtonV2>
            </SettingsRowV2>
          </Show>
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
