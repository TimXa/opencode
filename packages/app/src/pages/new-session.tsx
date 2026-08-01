import { createPromptProjectController } from "@/components/prompt-project-selector"
import {
  PrimeKitExecutionTarget,
  primeKitChatID,
  type PrimeKitExecutionTargetValue,
} from "@/components/primekit-execution-target"
import { useTitlebarRightMount } from "@/components/titlebar"
import { useSettings } from "@/context/settings"
import { createEffect, createResource, createSignal } from "solid-js"
import { createNewSessionDraftController } from "./new-session/new-session-draft-controller"
import { NewSessionStatus, NewSessionView } from "./new-session/new-session-view"
import { createNewSessionWorkspaceController } from "./new-session/new-session-workspace-controller"
import { useNewSessionCommands } from "./new-session/use-new-session-commands"

/** The draft-only V2 session page. Submitting promotes the draft into a real session. */
export default function NewSessionPage() {
  const settings = useSettings()
  const rightMount = useTitlebarRightMount()
  const workspace = createNewSessionWorkspaceController()
  const [executionTarget, setExecutionTarget] = createSignal<PrimeKitExecutionTargetValue>({ kind: "cloud" })
  const draft = createNewSessionDraftController({
    worktree: workspace.selection.value,
    resetWorktree: workspace.selection.reset,
    beforeFirstPrompt: async (sessionID) => {
      const target = executionTarget()
      if (target.kind === "cloud") return
      const api = window.api?.primekit
      const id = primeKitChatID(sessionID)
      if (!api || !id) throw new Error("Не удалось определить облачный чат")
      const options = await api.executionOptions()
      const runtime = options.runtimes.find((item) => item.id === target.runtime_id)
      const grant = options.grants.find((item) => item.id === target.folder_grant_id)
      if (runtime?.status !== "online" || !grant?.active) throw new Error("Выбранное устройство сейчас не в сети")
      await api.setExecutionTarget(id, target)
    },
  })
  const project = createPromptProjectController({
    controls: draft.project.controls,
    onDone: draft.input.restoreFocus,
  })
  useNewSessionCommands({
    restoreFocus: draft.input.restoreFocus,
    project: {
      empty: project.empty,
      open: () => project.setOpen(true),
    },
  })
  createEffect(() => {
    if (!draft.prompt.ready()) return
    draft.input.restoreFocus()
  })
  const ready = Promise.resolve()
  const [suspendUntilPromptReady] = createResource(
    () => draft.prompt.readyPromise() ?? ready,
    (promise) => promise.then(() => true),
  )

  return (
    <div class="relative size-full overflow-hidden flex flex-col">
      {suspendUntilPromptReady()}
      <NewSessionStatus mount={rightMount} visible={settings.visibility.status} />
      <div class="flex-1 min-h-0 flex flex-col gap-2 p-2">
        <NewSessionView
          input={draft.input}
          project={project}
          workspace={workspace}
          executionTargetControl={<PrimeKitExecutionTarget value={executionTarget()} onChange={setExecutionTarget} />}
        />
      </div>
    </div>
  )
}
