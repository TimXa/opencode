import { createEffect } from "solid-js"
import { createStore } from "solid-js/store"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { usePlatform } from "@/context/platform"
import { persisted } from "@/utils/persist"

type Store = { version?: string }

export const { use: useHighlights, provider: HighlightsProvider } = createSimpleContext({
  name: "PrimeKitHighlights",
  gate: false,
  init: () => {
    const platform = usePlatform()
    const [store, setStore, _, ready] = persisted("primekit.highlights.v1", createStore<Store>({ version: undefined }))

    const markSeen = () => {
      if (platform.version) setStore("version", platform.version)
    }

    createEffect(() => {
      if (!ready() || !platform.version) return
      markSeen()
    })

    return {
      ready,
      from: () => undefined,
      to: () => undefined,
      get last() {
        return store.version
      },
      markSeen,
    }
  },
})
