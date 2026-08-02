import assert from "node:assert/strict"
import test from "node:test"
import { publishPrimeKitSidebarEvent, subscribePrimeKitSidebarEvents } from "./primekit-sidebar-events.ts"

test("publishes command wakeups only while subscribed", () => {
  const received: number[] = []
  const unsubscribe = subscribePrimeKitSidebarEvents((event) => {
    if (event.runtime_id) received.push(event.runtime_id)
  })

  publishPrimeKitSidebarEvent({ type: "desktop-command-created", runtime_id: 42 })
  unsubscribe()
  publishPrimeKitSidebarEvent({ type: "desktop-command-created", runtime_id: 99 })

  assert.deepEqual(received, [42])
})
