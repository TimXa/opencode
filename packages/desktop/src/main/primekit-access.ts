import { dialog } from "electron"
import { getStore } from "./store"
import { PRIMEKIT_ACCESS_PROFILE_KEY } from "./store-keys"

export type PrimeKitAccessProfile = "full_device" | "restricted"

export function currentPrimeKitAccessProfile(): PrimeKitAccessProfile | undefined {
  const value = getStore().get(PRIMEKIT_ACCESS_PROFILE_KEY)
  return value === "full_device" || value === "restricted" ? value : undefined
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
      "Кит сможет читать и изменять файлы, запускать Terminal и Git от вашего имени. Папку для работы вы выбираете отдельно. Разрешение сохранится для этого приложения — повторно подтверждать каждую команду не потребуется.",
    buttons: ["Разрешить полный доступ", "Не сейчас"],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  })
  const profile: PrimeKitAccessProfile = result.response === 0 ? "full_device" : "restricted"
  getStore().set(PRIMEKIT_ACCESS_PROFILE_KEY, profile)
  return profile
}
