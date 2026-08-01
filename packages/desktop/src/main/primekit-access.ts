import { dialog } from "electron"
import { getStore } from "./store"
import { PRIMEKIT_ACCESS_PROFILE_KEY, PRIMEKIT_COMPUTER_PERMISSION_STATE_KEY } from "./store-keys"

export type PrimeKitAccessProfile = "full_device" | "restricted"
export type PrimeKitComputerPermissionState = "not_requested" | "incomplete" | "ready"

export function currentPrimeKitAccessProfile(): PrimeKitAccessProfile | undefined {
  const value = getStore().get(PRIMEKIT_ACCESS_PROFILE_KEY)
  return value === "full_device" || value === "restricted" ? value : undefined
}

export function currentPrimeKitComputerPermissionState(): PrimeKitComputerPermissionState {
  const value = getStore().get(PRIMEKIT_COMPUTER_PERMISSION_STATE_KEY)
  return value === "incomplete" || value === "ready" ? value : "not_requested"
}

export function setPrimeKitComputerPermissionState(state: PrimeKitComputerPermissionState) {
  getStore().set(PRIMEKIT_COMPUTER_PERMISSION_STATE_KEY, state)
}

export async function requestPrimeKitFullDeviceAccess(force = false): Promise<PrimeKitAccessProfile> {
  const current = currentPrimeKitAccessProfile()
  if (current === "full_device") return current
  if (current === "restricted" && !force) return current

  const result = await dialog.showMessageBox({
    type: "question",
    title: "Доступ Кита к этому компьютеру",
    message: "Разрешить Киту выполнять локальные задачи?",
    detail:
      "Кит сможет читать и изменять любые файлы, доступные вашей учётной записи, а также запускать Terminal и Git от вашего имени. Выбранная папка задаёт рабочую директорию задачи, но не ограничивает системный доступ. Разрешение сохранится для этого приложения — повторно подтверждать каждую команду не потребуется.",
    buttons: ["Разрешить полный доступ", "Не сейчас"],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  })
  const profile: PrimeKitAccessProfile = result.response === 0 ? "full_device" : "restricted"
  getStore().set(PRIMEKIT_ACCESS_PROFILE_KEY, profile)
  return profile
}
