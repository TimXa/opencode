import { ScrollView } from "@opencode-ai/ui/scroll-view"
import { createHomeController } from "./home/home-controller"
import { createHomeProjectsController } from "./home/home-projects-controller"
import { HomeUtilityNav } from "./home/home-projects-view"
import { HomeProjects } from "./home/home-projects"
import { createHomeScrollController } from "./home/home-scroll-controller"
import { createHomeSessionSearchController } from "./home/home-session-search-controller"
import { createHomeSessionsController } from "./home/home-sessions-controller"
import { HomeSessions } from "./home/home-sessions"
import { Show } from "solid-js"

export function NewHome() {
  const primekit = Boolean(window.api?.primekit)
  const home = createHomeController()
  const projects = createHomeProjectsController(home)
  const sessions = createHomeSessionsController(home)
  const search = createHomeSessionSearchController(home, sessions)
  const scroll = createHomeScrollController(sessions.data.groups)
  return (
    <div
      data-kit-home={primekit ? "" : undefined}
      classList={{
        "min-h-0 flex-1 self-stretch overflow-hidden bg-v2-background-bg-base": true,
        "m-2 rounded-[10px] shadow-[var(--v2-elevation-raised)]": !primekit,
      }}
    >
      <ScrollView
        class="h-full [container-type:size]"
        thumbContainer={scroll.viewport.thumbTrack}
        thumbHoverTarget={scroll.viewport.hoverTarget}
        viewportRef={scroll.viewport.setViewport}
        onScroll={(event) => scroll.viewport.update(event.currentTarget.scrollTop)}
        onWheel={scroll.viewport.containOuterWheel}
      >
        <div
          classList={{
            "mx-auto min-h-full w-full px-3": true,
            "grid max-w-[1080px] grid-rows-[auto_minmax(0,1fr)_auto] gap-4 lg:grid-cols-[280px_minmax(0,720px)] lg:grid-rows-1 lg:gap-8 lg:px-6":
              !primekit,
            "flex max-w-[760px] flex-col px-6": primekit,
          }}
        >
          <Show when={!primekit}>
            <HomeProjects projects={projects} scroll={scroll} />
          </Show>
          <Show when={primekit}>
            <header data-kit-home-intro class="shrink-0 pt-12 pb-2">
              <p class="text-[12px] font-semibold uppercase tracking-[0.08em] text-v2-text-text-muted">Кит</p>
              <h1 class="mt-2 text-[24px] font-semibold tracking-[-0.025em] text-v2-text-text-strong">
                Продолжить работу
              </h1>
              <p class="mt-1 max-w-[58ch] text-[14px] leading-6 text-v2-text-text-muted">
                Выберите недавний чат или начните новую задачу для Джарвиса.
              </p>
            </header>
          </Show>
          <HomeSessions sessions={sessions} search={search} scroll={scroll} />
          <Show when={!primekit}>
            <HomeUtilityNav
              class="flex lg:hidden"
              onOpenSettings={projects.utility.settings}
              onOpenHelp={projects.utility.help}
              language={projects.copy.language}
            />
          </Show>
        </div>
      </ScrollView>
    </div>
  )
}
