// @refresh reload

import {
  ACCEPTED_FILE_EXTENSIONS,
  AppBaseProviders,
  AppInterface,
  handleNotificationClick,
  loadLocaleDict,
  normalizeLocale,
  type Locale,
  type Platform,
  PlatformProvider,
  ServerConnection,
  useCommand,
  useWslServers,
} from "@opencode-ai/app"
import type { UpdaterState } from "@opencode-ai/app/updater"
import * as Sentry from "@sentry/solid"
import type { AsyncStorage } from "@solid-primitives/storage"
import { createMemoryHistory, MemoryRouter, type BaseRouterProps } from "@solidjs/router"
import { createEffect, createMemo, createResource, createSignal, onCleanup, onMount, Show } from "solid-js"
import { render } from "solid-js/web"
import pkg from "../../package.json"
import { initI18n, t } from "./i18n"
import { initializationData, initializationReady } from "./initialization"
import { DesktopFirstLaunchOnboarding } from "./onboarding"
import { resetZoom, setPinchZoomEnabled, webviewZoom, zoomIn, zoomOut } from "./webview-zoom"
import { windowFullscreen } from "./window-fullscreen"
import { availableStartupServer, readyWslConnections } from "./wsl/connections"
import "./styles.css"
import { KitOrbit, Splash } from "@opencode-ai/ui/logo"
import { useTheme } from "@opencode-ai/ui/theme/context"

const root = document.getElementById("root")
if (import.meta.env.DEV && !(root instanceof HTMLElement)) {
  throw new Error(t("error.dev.rootNotFound"))
}

if (!localStorage.getItem("opencode-color-scheme")) localStorage.setItem("opencode-color-scheme", "dark")

if (import.meta.env.VITE_SENTRY_DSN) {
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: import.meta.env.VITE_SENTRY_ENVIRONMENT ?? import.meta.env.MODE,
    release: import.meta.env.VITE_SENTRY_RELEASE ?? `desktop@${pkg.version}`,
    initialScope: {
      tags: {
        platform: "desktop",
      },
    },
    integrations: (integrations) => {
      return integrations.filter(
        (i) =>
          i.name !== "Breadcrumbs" &&
          !(
            import.meta.env.OPENCODE_CHANNEL === "prod" &&
            (i.name === "GlobalHandlers" || i.name === "BrowserApiErrors")
          ),
      )
    },
  })
}

void initI18n()

const [updaterState, setUpdaterState] = createSignal<UpdaterState>({ status: "disabled" })
void window.api.updater.subscribe(setUpdaterState)

const deepLinkEvent = "opencode:deep-link"

type DesktopWindowState = {
  id?: string
}

const emitDeepLinks = (urls: string[]) => {
  if (urls.length === 0) return
  window.__OPENCODE__ ??= {}
  const pending = window.__OPENCODE__.deepLinks ?? []
  window.__OPENCODE__.deepLinks = [...pending, ...urls]
  window.dispatchEvent(new CustomEvent(deepLinkEvent, { detail: { urls } }))
}

const listenForDeepLinks = () => {
  void window.api.consumeInitialDeepLinks().then((urls) => emitDeepLinks(urls))
  return window.api.onDeepLink((urls) => emitDeepLinks(urls))
}

function windowLastActiveUrlKey(windowID: string) {
  return `opencode.desktop.window.${windowID}.last-active-url`
}

function getLastActiveUrl(windowID: string) {
  if (typeof localStorage !== "object") return "/"
  try {
    const value = localStorage.getItem(windowLastActiveUrlKey(windowID))
    if (value?.includes("/session/") && !value.includes("/session/ses_pk_")) return "/"
    if (value?.startsWith("/") && !value.startsWith("//")) return value
  } catch {}
  return "/"
}

function setLastActiveUrl(windowID: string, value: string) {
  if (typeof localStorage !== "object") return
  try {
    localStorage.setItem(windowLastActiveUrlKey(windowID), value)
  } catch {}
}

function DesktopMemoryRouter(props: BaseRouterProps & { windowID: string }) {
  const history = createMemoryHistory()
  const initialUrl = getLastActiveUrl(props.windowID)
  if (initialUrl !== "/") history.set({ value: initialUrl, replace: true, scroll: false })
  onCleanup(history.listen((value) => setLastActiveUrl(props.windowID, value)))
  return <MemoryRouter {...props} history={history} />
}

const createPlatform = (windowState: DesktopWindowState): Platform => {
  const attachmentPaths = new WeakMap<File, string>()
  const os = (() => {
    const ua = navigator.userAgent
    if (ua.includes("Mac")) return "macos"
    if (ua.includes("Windows")) return "windows"
    if (ua.includes("Linux")) return "linux"
    return undefined
  })()

  const runDesktopMenuAction: Platform["runDesktopMenuAction"] = (action) => {
    switch (action) {
      case "view.resetZoom":
        resetZoom()
        return
      case "view.zoomIn":
        zoomIn()
        return
      case "view.zoomOut":
        zoomOut()
        return
    }

    return window.api.runDesktopMenuAction(action)
  }

  const storage = (() => {
    const cache = new Map<string, AsyncStorage>()

    const createStorage = (name: string) => {
      const api: AsyncStorage = {
        getItem: (key: string) => window.api.storeGet(name, key),
        setItem: (key: string, value: string) => window.api.storeSet(name, key, value),
        removeItem: (key: string) => window.api.storeDelete(name, key),
        clear: () => window.api.storeClear(name),
        key: async (index: number) => (await window.api.storeKeys(name))[index],
        getLength: () => window.api.storeLength(name),
        get length() {
          return api.getLength()
        },
      }
      return api
    }

    return (name = "default.dat") => {
      const cached = cache.get(name)
      if (cached) return cached
      const api = createStorage(name)
      cache.set(name, api)
      return api
    }
  })()

  const wslServersApi = os === "windows" ? window.api.wslServers : undefined

  return {
    platform: "desktop",
    os,
    version: pkg.version,
    windowID: windowState.id,

    async openDirectoryPickerDialog(opts) {
      return window.api.openDirectoryPicker({
        multiple: opts?.multiple ?? false,
        title: opts?.title ?? t("desktop.dialog.chooseFolder"),
      })
    },

    async openAttachmentPickerDialog(opts, onFile) {
      const result = await window.api.openFilePicker({
        multiple: opts?.multiple ?? false,
        title: opts?.title ?? t("desktop.dialog.chooseFile"),
        defaultPath: opts?.defaultPath,
        extensions: opts?.extensions ?? ACCEPTED_FILE_EXTENSIONS,
      })
      if (!result) return
      try {
        for (const file of result.files) {
          const selected = new File([await window.api.readPickedFile(result.token, file.path)], file.name)
          attachmentPaths.set(selected, file.path)
          await onFile(selected)
        }
      } finally {
        await window.api.releasePickedFiles(result.token)
      }
    },

    getPathForFile(file) {
      return attachmentPaths.get(file) ?? window.api.getPathForFile(file)
    },

    async saveFilePickerDialog(opts) {
      return window.api.saveFilePicker({
        title: opts?.title ?? t("desktop.dialog.saveFile"),
        defaultPath: opts?.defaultPath,
      })
    },

    openLink(url: string) {
      window.api.openLink(url)
    },
    async openPath(path: string, app?: string) {
      if (os === "windows") {
        const resolvedApp = app ? await window.api.resolveAppPath(app).catch(() => null) : null
        return window.api.openPath(path, resolvedApp ?? undefined)
      }
      return window.api.openPath(path, app)
    },
    async revealPath(path: string) {
      return window.api.revealPath(path)
    },

    back() {
      window.history.back()
    },

    forward() {
      window.history.forward()
    },

    storage,

    updater: {
      state: updaterState,
      check: () => window.api.updater.check(),
      install: () => window.api.updater.install(),
    },

    exportDebugLogs: () => window.api.exportDebugLogs(),

    setForceFocus: (enabled) => window.api.setForceFocus(enabled),

    recordFatalRendererError: (error) => window.api.recordFatalRendererError(error),

    restart: async () => {
      await window.api.killSidecar().catch(() => undefined)
      window.api.relaunch()
    },

    notify: async (title, description, href) => {
      const focused = await window.api.getWindowFocused().catch(() => document.hasFocus())
      if (focused) return

      const notification = new Notification(title, {
        body: description ?? "",
        icon: "/favicon-96x96-v3.png",
      })
      notification.onclick = () => {
        void window.api.showWindow()
        void window.api.setWindowFocus()
        handleNotificationClick(href)
        notification.close()
      }
    },

    fetch: (input, init) => {
      if (input instanceof Request) return fetch(input)
      return fetch(input, init)
    },

    getDefaultServer: async () => {
      const url = await window.api.getDefaultServerUrl().catch(() => null)
      if (!url) return null
      return ServerConnection.Key.make(url)
    },

    setDefaultServer: async (url: string | null) => {
      await window.api.setDefaultServerUrl(url)
    },

    wslServers: wslServersApi,

    getDisplayBackend: async () => {
      return window.api.getDisplayBackend().catch(() => null)
    },

    setDisplayBackend: async (backend) => {
      await window.api.setDisplayBackend(backend)
    },

    parseMarkdown: (markdown: string) => window.api.parseMarkdownCommand(markdown),

    webviewZoom,

    windowFullscreen,

    getPinchZoomEnabled: () => window.api.getPinchZoomEnabled(),

    setPinchZoomEnabled,

    runDesktopMenuAction,

    checkAppExists: async (appName: string) => {
      return window.api.checkAppExists(appName)
    },

    async readClipboardImage() {
      const image = await window.api.readClipboardImage().catch(() => null)
      if (!image) return null
      const blob = new Blob([image.buffer], { type: "image/png" })
      return new File([blob], `pasted-image-${Date.now()}.png`, {
        type: "image/png",
      })
    },
  }
}

let menuTrigger = null as null | ((id: string) => void)
window.api.onMenuCommand((id) => {
  menuTrigger?.(id)
})
listenForDeepLinks()

function LoadingSplash() {
  const tips = [
    "Нужен быстрый ответ? В меню «+» выберите более высокую скорость.",
    "Сложная задача? Повышенный режим мышления помогает Киту тщательнее проверить решение.",
    "Прикрепите исходный файл — так Кит точнее сохранит структуру и оформление.",
    "Для работы с файлами выберите папку проекта и оставьте Mac включённым.",
    "Если направление неверное, остановите задачу и уточните ожидаемый результат.",
  ]
  const [tip, setTip] = createSignal(0)
  onMount(() => {
    const timer = setInterval(() => setTip((value) => (value + 1) % tips.length), 5_500)
    onCleanup(() => clearInterval(timer))
  })
  return (
    <div class="kit-loading-screen">
      <KitOrbit class="kit-loading-orbit" />
      <p class="kit-loading-title">Кит подключается</p>
      <p class="kit-loading-tip" aria-live="off"><Show when={tips[tip()]} keyed>{(text) => <span>{text}</span>}</Show></p>
    </div>
  )
}

function PrimeKitLogin(props: { onSignedIn: () => Promise<unknown> | void }) {
  const [email, setEmail] = createSignal("")
  const [code, setCode] = createSignal("")
  const [sent, setSent] = createSignal(false)
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal("")
  const submit = async (event: SubmitEvent) => {
    event.preventDefault()
    setBusy(true)
    setError("")
    try {
      if (!sent()) {
        await window.api.primekit.requestEmailCode(email().trim())
        setSent(true)
      } else {
        await window.api.primekit.verifyEmailCode(email().trim(), code().trim())
        await props.onSignedIn()
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message.replace(/^Error invoking remote method '[^']+': Error:\s*/, "") : String(cause))
    } finally {
      setBusy(false)
    }
  }
  return (
    <main class="kit-auth-shell">
      <section class="kit-auth-story" aria-label="Возможности Кита">
        <div class="kit-auth-glow" />
        <div class="kit-auth-story-content">
          <Splash class="kit-auth-logo" />
          <h1>Кит на вашем Mac.</h1>
          <p>Облачные чаты и локальный Cowork работают под одним аккаунтом Кита.</p>
          <div class="kit-auth-steps">
            <div class="is-active"><span>1</span><strong>Войдите</strong><small>Подключитесь к серверам Кита</small></div>
            <div><span>2</span><strong>Выберите режим</strong><small>Облако или Cowork на этом Mac</small></div>
            <div><span>3</span><strong>Начните задачу</strong><small>Кит готов работать с проектом</small></div>
          </div>
        </div>
      </section>
      <form onSubmit={submit} class="kit-auth-form">
        <div class="kit-auth-form-inner" classList={{ "is-code": sent() }}>
          <Splash class="kit-auth-mobile-logo" />
          <p class="kit-auth-eyebrow">PRIMEKIT ДЛЯ MAC</p>
          <h2>{sent() ? "Проверьте почту" : "Вход в Кит"}</h2>
          <p class="kit-auth-copy">{sent() ? `Код отправлен на ${email()}` : "Войдите, чтобы подключить приложение к серверам Кита."}</p>
          <label class="block text-sm text-text-base mb-2" for="primekit-auth-value">{sent() ? "Код" : "Email"}</label>
          <input
            id="primekit-auth-value"
            class="kit-auth-input"
            type={sent() ? "text" : "email"}
            autocomplete={sent() ? "one-time-code" : "email"}
            required
            value={sent() ? code() : email()}
            onInput={(event) => sent() ? setCode(event.currentTarget.value.replace(/\D/g, "").slice(0, 6)) : setEmail(event.currentTarget.value)}
          />
          <Show when={error()}>{(message) => <p class="kit-auth-error" role="alert">{message()}</p>}</Show>
          <button type="submit" disabled={busy()} class="kit-auth-submit">
            {busy() ? "Подождите…" : sent() ? "Войти" : "Получить код"}
          </button>
          <Show when={sent()}><button type="button" class="kit-auth-back" onClick={() => setSent(false)}>Изменить email</button></Show>
        </div>
      </form>
    </main>
  )
}

function DesktopRoot(props: { windowState: DesktopWindowState }) {
  const platform = createPlatform(props.windowState)
  const loadLocale = async () => {
    const current = await platform.storage?.("opencode.global.dat").getItem("language")
    const legacy = current ? undefined : await platform.storage?.().getItem("language.v1")
    const raw = current ?? legacy
    if (!raw) return
    const locale = raw.match(/"locale"\s*:\s*"([^"]+)"/)?.[1]
    if (!locale) return
    const next = normalizeLocale(locale)
    if (next !== "en") await loadLocaleDict(next)
    return next satisfies Locale
  }

  const [windowCount] = createResource(() => window.api.getWindowCount())
  const [account, { refetch: refetchAccount }] = createResource(() => window.api.primekit.state())
  // Fetch sidecar credentials (available immediately, before health check)
  const [sidecar] = createResource(() => window.api.awaitInitialization())

  const [defaultServer] = createResource(() => platform.getDefaultServer?.())
  const [locale] = createResource(loadLocale)
  const router = (props: BaseRouterProps) => (
    <DesktopMemoryRouter {...props} windowID={platform.windowID ?? "browser"} />
  )
  const onboarding = Promise.withResolvers<void>()

  function handleClick(e: MouseEvent) {
    const link = (e.target as HTMLElement).closest("a.external-link") as HTMLAnchorElement | null
    if (link?.href) {
      e.preventDefault()
      platform.openLink(link.href)
    }
  }

  function Inner() {
    const cmd = useCommand()
    menuTrigger = (id) => cmd.trigger(id)

    const theme = useTheme()

    createEffect(() => {
      theme.themeId()
      theme.mode()
      const bg = getComputedStyle(document.documentElement).getPropertyValue("--background-base").trim()
      if (bg) {
        void window.api.setBackgroundColor(bg)
      }
    })

    return null
  }

  function App() {
    const wslServers = useWslServers()
    const ready = createMemo(
      () =>
        !defaultServer.loading && !sidecar.loading && !windowCount.loading && !locale.loading && !wslServers.isLoading,
    )
    const servers = createMemo(() => {
      const data = initializationData(sidecar)
      const list: ServerConnection.Any[] = []
      if (data) {
        list.push({
          displayName: "Кит",
          type: "sidecar",
          variant: "base",
          http: {
            url: data.url,
            username: data.username ?? undefined,
            password: data.password ?? undefined,
          },
        })
      }
      list.push(...readyWslConnections(wslServers.data))
      return list
    })
    const effectiveDefaultServer = createMemo(() =>
      ServerConnection.Key.make(availableStartupServer(defaultServer.latest, wslServers.data)),
    )
    return (
      <Show when={ready()} fallback={<LoadingSplash />}>
        <Show when={effectiveDefaultServer()} keyed>
          {(key) => (
            <AppInterface
              defaultServer={key}
              servers={servers()}
              router={router}
              startup={onboarding.promise}
              serverScoped={
                <DesktopFirstLaunchOnboarding
                  initialUrl={getLastActiveUrl(platform.windowID ?? "browser")}
                  onLoaded={onboarding.resolve}
                />
              }
            >
              <Inner />
            </AppInterface>
          )}
        </Show>
      </Show>
    )
  }

  onMount(() => {
    document.addEventListener("click", handleClick)
    onCleanup(() => {
      document.removeEventListener("click", handleClick)
    })
  })

  return (
    <PlatformProvider value={platform}>
      <AppBaseProviders locale={locale.latest}>
        <Show when={!account.loading} fallback={<LoadingSplash />}>
          <Show when={account()?.signedIn} fallback={<PrimeKitLogin onSignedIn={async () => { await refetchAccount() }} />}>
            <App />
          </Show>
        </Show>
      </AppBaseProviders>
    </PlatformProvider>
  )
}

render(() => {
  const [windowState] = createResource(async () => {
    const api = window.api as typeof window.api & {
      getWindowID?: () => Promise<string>
    }
    return { id: await api.getWindowID?.() }
  })

  return (
    <Show when={windowState.latest} fallback={<LoadingSplash />} keyed>
      {(state) => <DesktopRoot windowState={state} />}
    </Show>
  )
}, root!)
