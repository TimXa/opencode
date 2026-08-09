import { createEffect, createMemo, createResource, For, Show, Suspense, type ParentProps } from "solid-js"
import { createStore } from "solid-js/store"
import { useLocation, useNavigate } from "@solidjs/router"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { Icon as IconV2 } from "@opencode-ai/ui/v2/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { DebugBar } from "@/components/debug-bar"
import { TabsInfoPopup } from "@/components/help-button"
import { useLayout } from "@/context/layout"
import { useServerSync } from "@/context/server-sync"
import { displayName, sortedRootSessions } from "./layout/helpers"
import { sessionTitle } from "@/utils/session-title"
import { setNavigate } from "@/utils/notification-click"
import { setV2Toast, ToastRegion } from "@/utils/toast"
import { useSettingsDialog } from "@/components/settings-dialog"
import { useServerSDK } from "@/context/server-sdk"
import type { Session } from "@opencode-ai/sdk/v2/client"
import { ProjectIcon, compactAge } from "./layout/sidebar-items"

export default function NewLayout(props: ParentProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const layout = useLayout()
  const serverSync = useServerSync()
  const serverSDK = useServerSDK()
  const showSettings = useSettingsDialog(window.api?.primekit ? "primekit" : "general")
  setNavigate(navigate)
  const [state, setState] = createStore({
    debugTools: true,
    expanded: {} as Record<string, boolean>,
    spaceLimit: {} as Record<string, number>,
    personalLimit: 16,
    agent: "cowork" as "cloud" | "cowork",
  })
  const [account] = createResource(async () => window.api?.primekit?.state())

  createEffect(() => setV2Toast(true))
  createEffect(() => {
    if (!layout.ready()) return
    for (const project of layout.projects.list()) {
      void serverSync().project.loadSessions(project.worktree, { limit: 1_000 })
    }
  })

  const projects = createMemo(() => layout.projects.list())
  const personalProject = createMemo(() => projects().find((project) => project.id === "primekit-personal"))
  const cloudProject = (id?: string) => id === "primekit-personal" || id?.startsWith("primekit-space-") === true
  const visibleProjects = createMemo(() =>
    projects().filter((project) =>
      state.agent === "cloud"
        ? cloudProject(project.id) && project.id !== "primekit-personal"
        : !cloudProject(project.id),
    ),
  )
  const startNewChat = (
    worktree = state.agent === "cloud" ? personalProject()?.worktree : visibleProjects()[0]?.worktree,
  ) => {
    if (!worktree) return
    navigate(`/${base64Encode(worktree)}/session`)
  }
  const selectAgent = async (agent: "cloud" | "cowork") => {
    setState("agent", agent)
    if (agent === "cowork") await window.api?.primekit?.requestComputerAccess()
    const project = agent === "cloud" ? personalProject() : projects().find((item) => !cloudProject(item.id))
    if (project) navigate(`/${base64Encode(project.worktree)}/session`)
  }
  const agents = [
    { id: "cloud" as const, label: "Облако", description: "Чаты и пространства Кита" },
    { id: "cowork" as const, label: "Джарвис", description: "Работа с файлами и приложениями Mac" },
  ]
  const selectAdjacentAgent = (event: KeyboardEvent, agent: "cloud" | "cowork") => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return
    event.preventDefault()
    void selectAgent(agent === "cloud" ? "cowork" : "cloud")
  }
  const accountName = createMemo(() => {
    const user = account()?.user
    return user?.display_name?.trim() || user?.email?.split("@")[0] || "Профиль"
  })
  const accountAvatar = createMemo(() => {
    const value = account()?.user?.photo_url?.trim()
    if (!value) return
    if (/^https?:\/\//.test(value)) return value
    return `https://primekit-job.ru${value.startsWith("/") ? value : `/${value}`}`
  })
  const isPinned = (session: unknown) => Boolean((session as { isPinned?: boolean }).isPinned)
  const renameChat = async (session: Session) => {
    const title = window.prompt("Новое название чата", sessionTitle(session.title))?.trim()
    if (!title || title === session.title) return
    await serverSDK().api.session.rename({ sessionID: session.id, directory: session.directory, title })
  }
  const removeChat = async (session: Session) => {
    if (!window.confirm(`Удалить чат «${sessionTitle(session.title)}»?`)) return
    await serverSDK().api.session.remove({ sessionID: session.id, directory: session.directory })
  }
  const pinChat = async (session: Session) => {
    await serverSDK().client.session.update({
      sessionID: session.id,
      directory: session.directory,
      metadata: { primekit_is_pinned: !isPinned(session) },
    })
  }

  return (
    <div
      data-kit-shell
      class="relative bg-v2-background-bg-deep flex-1 min-h-0 min-w-0 flex flex-col select-none [&_input]:select-text [&_textarea]:select-text [&_[contenteditable]]:select-text"
      style={{
        "padding-top": "env(safe-area-inset-top, 0px)",
        "padding-bottom": "env(safe-area-inset-bottom, 0px)",
      }}
    >
      <div class="flex min-h-0 min-w-0 flex-1">
        <aside
          data-kit-sidebar
          class="flex w-[clamp(260px,22vw,320px)] shrink-0 flex-col overflow-hidden bg-[#3d372e] text-[#f3f0e8]"
        >
          <div class="shrink-0 px-4 pb-3 pt-10 [-webkit-app-region:drag]">
            <div class="flex h-9 items-center justify-between [-webkit-app-region:no-drag]">
              <div class="flex min-w-0 items-center px-1.5 py-1">
                <span data-kit-brand class="truncate text-[18px] font-semibold tracking-[-0.02em]">
                  Кит
                </span>
              </div>
              <div class="flex items-center gap-1">
                <IconButton
                  icon="magnifying-glass"
                  variant="ghost"
                  size="large"
                  aria-label="Поиск"
                  onClick={() => navigate("/")}
                />
              </div>
            </div>
            <button
              type="button"
              data-kit-primary-action
              class="mt-3 flex h-9 w-full items-center gap-2 rounded-lg px-2.5 text-[14px] font-medium text-white/90 transition-colors hover:bg-[rgba(255,255,255,0.09)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30 motion-reduce:transition-none [-webkit-app-region:no-drag]"
              onClick={() => startNewChat()}
            >
              <IconV2 name="edit" size="small" />
              Новый чат
            </button>
            <div
              data-kit-mode-switch
              role="tablist"
              aria-label="Режим работы"
              class="mt-2 grid grid-cols-2 rounded-lg bg-black/15 p-0.5 [-webkit-app-region:no-drag]"
            >
              <For each={agents}>
                {(item) => (
                  <button
                    type="button"
                    role="tab"
                    aria-selected={state.agent === item.id}
                    aria-label={`${item.label}. ${item.description}`}
                    data-kit-mode-tab
                    classList={{
                      "h-8 rounded-md text-[13px] font-medium transition-colors": true,
                      "bg-white/12 text-white": state.agent === item.id,
                      "text-white/50 hover:text-white/80": state.agent !== item.id,
                    }}
                    onClick={() => void selectAgent(item.id)}
                    onKeyDown={(event) => selectAdjacentAgent(event, item.id)}
                  >
                    {item.label}
                  </button>
                )}
              </For>
            </div>
          </div>

          <div class="mx-4 h-px shrink-0 bg-[rgba(255,255,255,0.08)]" />
          <div class="min-h-0 flex-1 overflow-y-auto px-2 pb-4 pt-4 no-scrollbar">
            <div
              data-kit-section-label
              class="px-2 pb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-white/40"
            >
              {state.agent === "cloud" ? "Пространства" : "Рабочие папки"}
            </div>
            <div class="flex flex-col gap-1">
              <For each={visibleProjects()}>
                {(project) => {
                  const slug = base64Encode(project.worktree)
                  const [projectStore] = serverSync().child(project.worktree)
                  const sessions = createMemo(() => sortedRootSessions(projectStore, Date.now()))
                  const sessionLimit = createMemo(() => state.spaceLimit[project.worktree] ?? 8)
                  const selected = createMemo(() => location.pathname.startsWith(`/${slug}`))
                  const expanded = createMemo(() => state.expanded[project.worktree] ?? selected())
                  return (
                    <section class="group/project min-w-0">
                      <div
                        data-kit-project-row
                        classList={{
                          "flex h-11 w-full min-w-0 items-center gap-2 rounded-xl px-2 text-left transition-colors motion-reduce:transition-none": true,
                          "bg-[rgba(255,255,255,0.11)] text-white": selected(),
                          "text-white/80 hover:bg-[rgba(255,255,255,0.08)]": !selected(),
                        }}
                      >
                        <button
                          type="button"
                          class="flex size-6 shrink-0 items-center justify-center rounded-md text-white/55 hover:bg-[rgba(255,255,255,0.09)] focus-visible:outline-none"
                          aria-label={expanded() ? "Свернуть" : "Развернуть"}
                          onClick={() => setState("expanded", project.worktree, !expanded())}
                        >
                          <svg viewBox="0 0 20 20" class="size-4" fill="none" aria-hidden="true">
                            <path
                              d={expanded() ? "M5.5 7.5 10 12l4.5-4.5" : "M7.5 5.5 12 10l-4.5 4.5"}
                              stroke="currentColor"
                              stroke-width="1.6"
                              stroke-linecap="round"
                              stroke-linejoin="round"
                            />
                          </svg>
                        </button>
                        <button
                          type="button"
                          class="flex h-full min-w-0 flex-1 items-center gap-2 text-left focus-visible:outline-none"
                          onClick={() => setState("expanded", project.worktree, !expanded())}
                        >
                          <ProjectIcon project={project} class="!size-7 !rounded-full" />
                          <span class="min-w-0 flex-1 truncate text-[14px] font-medium">{displayName(project)}</span>
                        </button>
                        <button
                          type="button"
                          class="flex size-7 shrink-0 items-center justify-center rounded-md text-white/45 opacity-0 transition-opacity hover:bg-[rgba(255,255,255,0.10)] hover:text-white group-hover/project:opacity-100 focus:opacity-100 motion-reduce:transition-none"
                          aria-label={`Новый чат в ${displayName(project)}`}
                          onClick={() => startNewChat(project.worktree)}
                        >
                          <IconV2 name="edit" size="small" />
                        </button>
                      </div>
                      <Show when={expanded()}>
                        <div class="ml-[38px] mt-1 flex min-w-0 flex-col border-l border-[rgba(255,255,255,0.12)] pl-1">
                          <button
                            type="button"
                            class="flex h-8 items-center gap-2 rounded-lg px-2 text-left text-[13px] text-[#9caa87] transition-colors hover:bg-[rgba(255,255,255,0.08)] hover:text-[#dce5ce] motion-reduce:transition-none"
                            onClick={() => startNewChat(project.worktree)}
                          >
                            <span class="text-base leading-none">＋</span> Новый чат
                          </button>
                          <For each={sessions().slice(0, sessionLimit())}>
                            {(session) => (
                              <div
                                classList={{
                                  "group/chat flex h-8 min-w-0 items-center rounded-lg px-2 text-[13px] transition-colors motion-reduce:transition-none": true,
                                  "bg-[rgba(255,255,255,0.12)] text-white": location.pathname.endsWith(
                                    `/session/${session.id}`,
                                  ),
                                  "text-white/65 hover:bg-[rgba(255,255,255,0.08)] hover:text-white":
                                    !location.pathname.endsWith(`/session/${session.id}`),
                                }}
                              >
                                <button
                                  type="button"
                                  class="min-w-0 flex-1 truncate text-left"
                                  onClick={() => navigate(`/${slug}/session/${session.id}`)}
                                >
                                  {sessionTitle(session.title)}
                                </button>
                                <span class="shrink-0 text-[11px] text-white/35 group-hover/chat:hidden">
                                  {compactAge(session.time.created)}
                                </span>
                                <div class="hidden shrink-0 items-center group-hover/chat:flex">
                                  <button
                                    type="button"
                                    class="flex size-6 items-center justify-center rounded-md text-white/45 hover:bg-white/10 hover:text-white"
                                    aria-label="Переименовать"
                                    onClick={() => void renameChat(session)}
                                  >
                                    <IconV2 name="edit" size="small" />
                                  </button>
                                  <button
                                    type="button"
                                    class="flex size-6 items-center justify-center rounded-md text-white/45 hover:bg-white/10 hover:text-red-300"
                                    aria-label="Удалить"
                                    onClick={() => void removeChat(session)}
                                  >
                                    <IconV2 name="trash" size="small" />
                                  </button>
                                </div>
                              </div>
                            )}
                          </For>
                          <Show when={sessions().length > sessionLimit()}>
                            <button
                              type="button"
                              class="h-7 truncate rounded-md px-2 text-left text-[13px] text-white/35 hover:bg-white/7 hover:text-white/65"
                              onClick={() => setState("spaceLimit", project.worktree, sessionLimit() + 24)}
                            >
                              Ещё {sessions().length - sessionLimit()}
                            </button>
                          </Show>
                        </div>
                      </Show>
                    </section>
                  )
                }}
              </For>
              <Show when={state.agent === "cowork" && visibleProjects().length === 0}>
                <button
                  type="button"
                  class="rounded-lg border border-white/10 px-3 py-3 text-left text-[13px] text-white/65 hover:bg-white/8 hover:text-white"
                  onClick={async () => {
                    const directory = await window.api?.openDirectoryPicker({
                      title: "Выберите рабочую папку для Джарвиса",
                    })
                    if (typeof directory === "string") startNewChat(directory)
                  }}
                >
                  Открыть папку на Mac
                </button>
              </Show>
            </div>

            <Show when={state.agent === "cloud" ? personalProject() : undefined} keyed>
              {(project) => {
                const slug = base64Encode(project.worktree)
                const [projectStore] = serverSync().child(project.worktree)
                const sessions = createMemo(() =>
                  [...sortedRootSessions(projectStore, Date.now())].sort(
                    (a, b) => Number(isPinned(b)) - Number(isPinned(a)),
                  ),
                )
                return (
                  <section class="mt-5 min-w-0 border-t border-[rgba(255,255,255,0.09)] pt-4">
                    <div class="flex h-8 items-center justify-between px-2">
                      <span class="text-[11px] font-semibold uppercase tracking-[0.12em] text-white/55">Ваши чаты</span>
                      <span class="text-[12px] tabular-nums text-white/35">{sessions().length}</span>
                    </div>
                    <div class="flex min-w-0 flex-col gap-0.5">
                      <For each={sessions().slice(0, state.personalLimit)}>
                        {(session) => (
                          <div
                            classList={{
                              "group/chat flex h-9 min-w-0 items-center gap-2 rounded-lg px-2 text-left text-[13px] transition-colors motion-reduce:transition-none": true,
                              "bg-[rgba(255,255,255,0.13)] text-white": location.pathname.endsWith(
                                `/session/${session.id}`,
                              ),
                              "text-white/72 hover:bg-[rgba(255,255,255,0.09)] hover:text-white":
                                !location.pathname.endsWith(`/session/${session.id}`),
                            }}
                          >
                            <Show when={isPinned(session)} fallback={<span class="size-4 shrink-0" />}>
                              <svg
                                viewBox="0 0 20 20"
                                class="size-4 shrink-0 text-white/55"
                                fill="none"
                                aria-hidden="true"
                              >
                                <path
                                  d="m7 3 6 6m-4.8-4.8L5.7 6.7l1.6 1.6-3.2 4.4 3.2 3.2 4.4-3.2 1.6 1.6 2.5-2.5"
                                  stroke="currentColor"
                                  stroke-width="1.35"
                                  stroke-linecap="round"
                                  stroke-linejoin="round"
                                />
                              </svg>
                            </Show>
                            <button
                              type="button"
                              class="min-w-0 flex-1 truncate text-left"
                              onClick={() => navigate(`/${slug}/session/${session.id}`)}
                            >
                              {sessionTitle(session.title)}
                            </button>
                            <span class="shrink-0 text-[11px] text-white/35 group-hover/chat:hidden">
                              {compactAge(session.time.created)}
                            </span>
                            <div class="hidden shrink-0 items-center group-hover/chat:flex">
                              <button
                                type="button"
                                class="flex size-6 items-center justify-center rounded-md text-white/45 hover:bg-white/10 hover:text-white"
                                aria-label={isPinned(session) ? "Открепить" : "Закрепить"}
                                onClick={() => void pinChat(session)}
                              >
                                <svg viewBox="0 0 20 20" class="size-3.5" fill="none" aria-hidden="true">
                                  <path
                                    d="m7 3 6 6-2 1 3 3-1 1-3-3-1 2-6-6 4-4Z"
                                    stroke="currentColor"
                                    stroke-linejoin="round"
                                  />
                                  <path d="m7.5 12.5-4 4" stroke="currentColor" stroke-linecap="round" />
                                </svg>
                              </button>
                              <button
                                type="button"
                                class="flex size-6 items-center justify-center rounded-md text-white/45 hover:bg-white/10 hover:text-white"
                                aria-label="Переименовать"
                                onClick={() => void renameChat(session)}
                              >
                                <IconV2 name="edit" size="small" />
                              </button>
                              <button
                                type="button"
                                class="flex size-6 items-center justify-center rounded-md text-white/45 hover:bg-white/10 hover:text-red-300"
                                aria-label="Удалить"
                                onClick={() => void removeChat(session)}
                              >
                                <IconV2 name="trash" size="small" />
                              </button>
                            </div>
                          </div>
                        )}
                      </For>
                      <Show when={sessions().length > state.personalLimit}>
                        <button
                          type="button"
                          class="h-8 rounded-lg px-8 text-left text-[13px] text-white/45 transition-colors hover:bg-[rgba(255,255,255,0.08)] hover:text-white/75 motion-reduce:transition-none"
                          onClick={() => setState("personalLimit", (value) => value + 24)}
                        >
                          Показать ещё
                        </button>
                      </Show>
                    </div>
                  </section>
                )
              }}
            </Show>
          </div>

          <div data-kit-profile class="shrink-0 border-t border-white/8 p-2">
            <button
              type="button"
              class="flex h-12 w-full min-w-0 items-center gap-3 rounded-xl px-2 text-left transition-colors hover:bg-[rgba(255,255,255,0.09)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30 motion-reduce:transition-none"
              onClick={showSettings}
            >
              <span class="flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#e482b4] text-[11px] font-semibold text-white">
                <Show when={accountAvatar()} fallback={accountName().slice(0, 2).toUpperCase()}>
                  {(url) => <img src={url()} alt="" class="size-full object-cover" />}
                </Show>
              </span>
              <span class="min-w-0 flex-1 truncate text-[14px] font-medium text-white/82">{accountName()}</span>
              <IconV2 name="settings-gear" size="small" class="text-white/38" />
            </button>
          </div>
        </aside>
        <main
          data-kit-main
          class="min-h-0 min-w-0 flex-1 overflow-x-hidden flex flex-col items-start contain-strict border-t border-white/8 bg-v2-background-bg-deep rounded-tl-[12px]"
        >
          <Suspense>{props.children}</Suspense>
        </main>
      </div>
      {import.meta.env.DEV && state.debugTools && <DebugBar inline />}
      <TabsInfoPopup />
      <ToastRegion v2 />
    </div>
  )
}
