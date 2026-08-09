import { expect, test } from "@playwright/test"
import { mockOpenCodeServer } from "../utils/mock-server"

const directory = "C:/PrimeKit-OpenCode"

test("renders the branded Kit shell without upstream names", async ({ page }) => {
  await mockOpenCodeServer(page, {
    directory,
    project: {
      id: "proj_primekit_shell",
      worktree: directory,
      vcs: "git",
      name: "PrimeKit-OpenCode",
      time: { created: 1700000000000, updated: 1700000000000 },
      sandboxes: [],
    },
    provider: { all: [], connected: [], default: {} },
    sessions: [
      {
        id: "ses_primekit_shell",
        directory,
        title: "New session - 2026-08-10T00:00:00.000Z",
        time: { created: 1700000000000, updated: 1700000000000 },
      },
    ],
    pageMessages: () => ({ items: [] }),
  })

  await page.addInitScript(() => {
    Object.defineProperty(window, "api", {
      configurable: true,
      value: {
        primekit: {
          state: async () => ({
            signedIn: true,
            user: { id: "user_test", display_name: "Тимофей", email: "test@example.com" },
          }),
          requestComputerAccess: async () => ({ accessibility: true, screen: true }),
        },
      },
    })
    localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: false, releaseNotes: false } }))
    localStorage.setItem("opencode.global.dat:language", JSON.stringify({ locale: "ru" }))
  })

  await page.goto("/")

  const shell = page.locator("[data-kit-shell]")
  await expect(shell).toBeVisible()
  await expect(page.getByRole("tab", { name: /^Джарвис/ })).toHaveAttribute("aria-selected", "true")
  await expect(page.getByRole("tab", { name: /^Облако/ })).toHaveAttribute("aria-selected", "false")
  await expect(page.getByText("PrimeKit", { exact: true }).first()).toBeVisible()
  await expect(page.getByText("Новый чат", { exact: true }).first()).toBeVisible()
  await expect(page.getByRole("heading", { name: "Продолжить работу" })).toBeVisible()

  const visibleText = await shell.innerText()
  expect(visibleText).not.toMatch(/OpenCode|Codex|Cowork/i)

  const primary = page.locator("[data-kit-primary-action]")
  const mode = page.locator("[data-kit-mode-tab]").first()
  const project = page.locator("[data-kit-project-row]").first()
  expect((await primary.boundingBox())?.height).toBeGreaterThanOrEqual(40)
  expect((await mode.boundingBox())?.height).toBeGreaterThanOrEqual(36)
  expect((await project.boundingBox())?.height).toBeGreaterThanOrEqual(40)

  const contrast = async (selector: string, backgroundSelector: string) =>
    page.evaluate(
      ({ selector, backgroundSelector }) => {
        const element = document.querySelector(selector)
        const background = document.querySelector(backgroundSelector)
        if (!element || !background) throw new Error(`Missing contrast target: ${selector}`)
        const luminance = (value: string) => {
          const canvas = document.createElement("canvas")
          canvas.width = 1
          canvas.height = 1
          const context = canvas.getContext("2d")!
          context.fillStyle = value
          context.fillRect(0, 0, 1, 1)
          const channels = Array.from(context.getImageData(0, 0, 1, 1).data.slice(0, 3)).map((channel) => {
            const normalized = channel / 255
            return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
          })
          return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722
        }
        const foreground = luminance(getComputedStyle(element).color)
        const surface = luminance(getComputedStyle(background).backgroundColor)
        return (Math.max(foreground, surface) + 0.05) / (Math.min(foreground, surface) + 0.05)
      },
      { selector, backgroundSelector },
    )
  expect(await contrast("[data-kit-brand]", "[data-kit-sidebar]")).toBeGreaterThanOrEqual(4.5)
  expect(await contrast("[data-kit-home-intro] h1", "[data-kit-home]")).toBeGreaterThanOrEqual(4.5)
  expect(await contrast("[data-kit-primary-action]", "[data-kit-primary-action]")).toBeGreaterThanOrEqual(4.5)

  await page.screenshot({ path: "/tmp/primekit-shell-redesign.png" })

  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" })
  await expect(shell).toHaveCSS("color-scheme", "dark")
  const reducedTransition = await primary.evaluate((element) => getComputedStyle(element).transitionDuration)
  expect(reducedTransition).toMatch(/1e-05s|0\.00001s|0s/)
  await page.screenshot({ path: "/tmp/primekit-shell-redesign-dark.png" })

  await page.getByRole("tab", { name: /^Джарвис/ }).focus()
  await page.keyboard.press("ArrowLeft")
  await expect(page.getByRole("tab", { name: /^Облако/ })).toHaveAttribute("aria-selected", "true")

  const surfaces = await page
    .locator("[data-kit-sidebar], [data-kit-main], [data-kit-mode-switch]")
    .evaluateAll((items) => items.map((item) => getComputedStyle(item).backgroundImage))
  expect(surfaces.every((value) => value === "none")).toBe(true)
})
