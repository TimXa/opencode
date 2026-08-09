import { describe, expect, test } from "bun:test"
import { assignPrimeKitChatFiles } from "./primekit-chat-files"

describe("PrimeKit cloud resources", () => {
  test("shows files created by Kit once on the latest assistant response", () => {
    const messages = [
      {
        id: 1,
        role: "user" as const,
        attached_files_json: [{ file_id: "user-1", filename: "данные.pdf" }],
      },
      { id: 2, role: "assistant" as const },
    ]
    const files = assignPrimeKitChatFiles(messages, [
      { file_id: "user-1", filename: "данные.pdf", source: "user" },
      { file_id: "kit-1", filename: "отчёт.docx", source: "ai" },
      { file_id: "kit-2", filename: "расчёты.xlsx", source: "ai" },
    ])

    expect(files.has(1)).toBe(false)
    expect(files.get(2)?.map((file) => file.filename)).toEqual(["отчёт.docx", "расчёты.xlsx"])
  })

  test("keeps an explicitly associated resource on its message", () => {
    const files = assignPrimeKitChatFiles(
      [
        { id: 10, role: "assistant" },
        { id: 11, role: "assistant" },
      ],
      [{ file_id: "kit-1", filename: "первый.txt", source: "ai", message_id: 10 }],
    )

    expect(files.get(10)?.[0]?.filename).toBe("первый.txt")
    expect(files.has(11)).toBe(false)
  })
})
