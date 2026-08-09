export type PrimeKitSpeechStreamConfig = {
  primaryURL: string
  fallbackURL: string
  primaryReady: boolean
}

type Provider = "primary" | "fallback"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function text(value: unknown) {
  return typeof value === "string" ? value : ""
}

/** Website-compatible live dictation transport used by both Cloud and Jarvis. */
export class PrimeKitSpeechStream {
  private socket?: WebSocket
  private context?: AudioContext
  private source?: MediaStreamAudioSourceNode
  private processor?: ScriptProcessorNode
  private provider: Provider = "primary"
  private ready = false
  private ending = false
  private closed = false
  private sampleBuffer = new Float32Array(0)
  private preRoll = new Float32Array(0)
  private partial = ""
  private closeTimer?: number

  constructor(
    private handlers: {
      onPartial: (text: string) => void
      onFinal: (text: string) => void
      onError: (message: string) => void
      onDone: () => void
    },
  ) {}

  async connect(media: MediaStream, config: PrimeKitSpeechStreamConfig) {
    this.context = new AudioContext()
    if (this.context.state === "suspended") await this.context.resume()
    this.source = this.context.createMediaStreamSource(media)
    this.processor = this.context.createScriptProcessor(4096, 1, 1)
    this.source.connect(this.processor)
    this.processor.connect(this.context.destination)
    this.processor.onaudioprocess = (event) => this.audio(event)

    if (config.primaryReady) {
      try {
        await this.open(config.primaryURL, "primary", 2_000)
        return
      } catch {}
    }
    await this.open(config.fallbackURL, "fallback", 5_000)
  }

  end() {
    this.ending = true
    this.stopCapture()
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(this.provider === "primary" ? new ArrayBuffer(0) : "END")
      this.closeTimer = window.setTimeout(() => this.close(), 30_000)
      return
    }
    this.close()
  }

  close() {
    if (this.closed) return
    this.closed = true
    if (this.closeTimer) window.clearTimeout(this.closeTimer)
    this.stopCapture()
    this.socket?.close()
    this.socket = undefined
    this.handlers.onDone()
  }

  private open(url: string, provider: Provider, timeoutMs: number) {
    this.socket?.close()
    this.provider = provider
    this.ready = false
    const socket = new WebSocket(url)
    socket.binaryType = "arraybuffer"
    this.socket = socket
    this.wire(socket)
    return new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        if (!this.ready) socket.close()
        reject(new Error("Сервис диктовки не ответил"))
      }, timeoutMs)
      const ready = () => {
        window.clearTimeout(timeout)
        this.ready = true
        this.flushPreRoll()
        resolve()
      }
      if (provider === "fallback") socket.addEventListener("open", ready, { once: true })
      else socket.addEventListener("message", ready, { once: true })
      socket.addEventListener("error", () => {
        if (this.ready) return
        window.clearTimeout(timeout)
        reject(new Error("Не удалось подключить диктовку"))
      }, { once: true })
      socket.addEventListener("close", () => {
        if (this.ready) return
        window.clearTimeout(timeout)
        reject(new Error("Соединение диктовки закрыто"))
      }, { once: true })
    })
  }

  private wire(socket: WebSocket) {
    socket.onmessage = (event) => {
      if (this.socket !== socket || this.closed || typeof event.data !== "string") return
      try {
        const parsed: unknown = JSON.parse(event.data)
        if (!isRecord(parsed)) return
        const data = parsed
        if (data.error || data.type === "error") {
          this.handlers.onError(text(data.error) || text(data.text) || text(data.message) || "Ошибка диктовки")
          return
        }
        if (this.provider === "primary") {
          if (Array.isArray(data.tokens)) {
            for (const token of data.tokens) {
              if (isRecord(token)) this.partial += text(token.text)
            }
            this.handlers.onPartial(this.partial)
          }
          if (data.done) {
            const final = typeof data.final_text === "string" ? data.final_text.trim() : this.partial
            this.handlers.onFinal(final)
            this.close()
          }
          return
        }
        const partial = text(data.partial) || (data.type === "partial" ? text(data.text) : "")
        const final = text(data.final) || (data.type === "final" ? text(data.text) : "")
        if (partial && partial.length >= this.partial.length) {
          this.partial = partial
          this.handlers.onPartial(partial)
        }
        if (final || data.eou || data.type === "final") {
          const chosen = final.length >= this.partial.length ? final : this.partial
          this.handlers.onFinal(chosen)
          this.close()
        }
      } catch {}
    }
    socket.onerror = () => {
      if (this.ready && !this.closed) this.handlers.onError("Соединение диктовки прервано")
    }
    socket.onclose = () => {
      if (!this.closed && this.ready && !this.ending) this.handlers.onError("Соединение диктовки прервано")
    }
  }

  private audio(event: AudioProcessingEvent) {
    const raw = event.inputBuffer.getChannelData(0)
    const samples = this.downsample(raw, this.context?.sampleRate || 48_000, 16_000)
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN || !this.ready) {
      const merged = new Float32Array(this.preRoll.length + samples.length)
      merged.set(this.preRoll)
      merged.set(samples, this.preRoll.length)
      this.preRoll = merged.length > 128_000 ? merged.slice(merged.length - 128_000) : merged
      return
    }
    this.send(samples)
  }

  private send(samples: Float32Array) {
    const socket = this.socket
    if (!socket || socket.readyState !== WebSocket.OPEN) return
    if (this.provider === "primary") {
      const merged = new Float32Array(this.sampleBuffer.length + samples.length)
      merged.set(this.sampleBuffer)
      merged.set(samples, this.sampleBuffer.length)
      let offset = 0
      while (merged.length - offset >= 1_280) {
        socket.send(merged.subarray(offset, offset + 1_280).slice().buffer)
        offset += 1_280
      }
      this.sampleBuffer = merged.slice(offset)
      return
    }
    const pcm = new Int16Array(samples.length)
    for (let index = 0; index < samples.length; index++) {
      const sample = Math.max(-1, Math.min(1, samples[index]))
      pcm[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff
    }
    socket.send(pcm.buffer)
  }

  private flushPreRoll() {
    if (!this.preRoll.length) return
    const samples = this.preRoll
    this.preRoll = new Float32Array(0)
    this.send(samples)
  }

  private stopCapture() {
    this.processor?.disconnect()
    this.source?.disconnect()
    this.processor = undefined
    this.source = undefined
    const context = this.context
    this.context = undefined
    if (context && context.state !== "closed") void context.close()
  }

  private downsample(buffer: Float32Array, from: number, to: number) {
    if (from === to) return buffer
    const ratio = from / to
    const result = new Float32Array(Math.round(buffer.length / ratio))
    for (let index = 0; index < result.length; index++) {
      result[index] = buffer[Math.min(Math.round(index * ratio), buffer.length - 1)]
    }
    return result
  }
}
