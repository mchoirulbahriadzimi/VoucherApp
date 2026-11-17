/**
 * mikrotik.ts
 *
 * Port 1:1 dari routeros_api.class.php (RouterOS PHP API class v1.6)
 * dan helper mikrotik.php ke TypeScript (Node.js net socket).
 *
 * Mendukung dua metode login RouterOS:
 * - post-v6.43 (plaintext)  : reply '!done' saja
 * - pre-v6.43  (MD5 chall.) : reply '!done' + '=ret=<32 hex challenge>'
 *
 * Dipakai oleh route API untuk semua operasi hotspot (voucher & profile).
 * Kompatibel dengan Vercel Serverless Functions (Node.js runtime, outbound TCP).
 */
import net from 'net'
import crypto from 'crypto'

export interface RouterosOptions {
  port?: number
  timeout?: number // detik
  attempts?: number
  delay?: number // detik
  ssl?: boolean
}

interface ReadWaiter {
  bytes: number
  resolve: (buf: Buffer) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export class RouterosAPI {
  debug = false
  connected = false
  port = 8728
  ssl = false
  timeout = 3
  attempts = 5
  delay = 3

  errorNo: number | null = null
  errorStr = ''

  private socket: net.Socket | null = null
  private buffer: Buffer = Buffer.alloc(0)
  private waiters: ReadWaiter[] = []
  private closed = false

  constructor(opts: RouterosOptions = {}) {
    if (opts.port !== undefined) this.port = opts.port
    if (opts.timeout !== undefined) this.timeout = opts.timeout
    if (opts.attempts !== undefined) this.attempts = opts.attempts
    if (opts.delay !== undefined) this.delay = opts.delay
    if (opts.ssl !== undefined) this.ssl = opts.ssl
  }

  private debugLog(text: string) {
    if (this.debug) console.log(text)
  }

  // ==========================================
  //  SOCKET & LOW-LEVEL READ
  // ==========================================

  private onData(chunk: Buffer) {
    this.buffer = Buffer.concat([this.buffer, chunk])
    this.pumpWaiters()
  }

  private failAllWaiters(err: Error) {
    const w = this.waiters.splice(0, this.waiters.length)
    for (const item of w) {
      clearTimeout(item.timer)
      item.reject(err)
    }
  }

  private pumpWaiters() {
    while (this.waiters.length > 0) {
      const w = this.waiters[0]
      if (this.buffer.length < w.bytes) break
      const out = Buffer.from(this.buffer.subarray(0, w.bytes))
      this.buffer = this.buffer.subarray(w.bytes)
      this.waiters.shift()
      clearTimeout(w.timer)
      w.resolve(out)
    }
  }

  private readBytes(n: number): Promise<Buffer> {
    if (this.buffer.length >= n) {
      const out = Buffer.from(this.buffer.subarray(0, n))
      this.buffer = this.buffer.subarray(n)
      return Promise.resolve(out)
    }
    if (this.closed || !this.socket) {
      return Promise.reject(new Error('Connection closed'))
    }
    return new Promise<Buffer>((resolve, reject) => {
      const waiter: ReadWaiter = {
        bytes: n,
        resolve,
        reject,
        timer: setTimeout(() => {
          const idx = this.waiters.indexOf(waiter)
          if (idx >= 0) this.waiters.splice(idx, 1)
          const err = new Error('Timed out')
          ;(err as Error & { timedOut?: boolean }).timedOut = true
          reject(err)
          // Socket tidak reliable lagi setelah timeout baca — tutup
          this.destroySocket()
        }, this.timeout * 1000),
      }
      this.waiters.push(waiter)
    })
  }

  private openSocket(ip: string, port: number): Promise<boolean> {
    return new Promise((resolve) => {
      let settled = false
      this.closed = false
      this.buffer = Buffer.alloc(0)
      this.waiters = []

      const socket = new net.Socket()
      this.socket = socket

      const settle = (ok: boolean, err?: Error) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (!ok) {
          this.errorStr = err ? err.message : 'Connection failed'
          socket.destroy()
          this.socket = null
          resolve(false)
        } else {
          resolve(true)
        }
      }

      const timer = setTimeout(() => {
        const err = new Error('Connection timed out')
        ;(err as Error & { timedOut?: boolean }).timedOut = true
        settle(false, err)
      }, this.timeout * 1000)

      socket.once('connect', () => settle(true))
      socket.once('error', (e: Error) => {
        this.errorNo = (e as NodeJS.ErrnoException).code ? 1 : 1
        settle(false, e)
      })
      socket.on('data', (c: Buffer) => this.onData(c))
      socket.on('end', () => {
        this.closed = true
        this.failAllWaiters(new Error('Connection closed'))
      })
      socket.on('close', () => {
        this.closed = true
        this.failAllWaiters(new Error('Connection closed'))
      })

      socket.connect(port, ip)
    })
  }

  private destroySocket() {
    if (this.socket) {
      try {
        this.socket.destroy()
      } catch {
        /* ignore */
      }
      this.socket = null
    }
    this.closed = true
    this.failAllWaiters(new Error('Connection closed'))
  }

  // ==========================================
  //  PROTOCOL ENCODING
  // ==========================================

  // encodeLength dari PHP class (protokol API RouterOS)
  private encodeLength(len: number): Buffer {
    if (len < 0x80) {
      return Buffer.from([len])
    }
    if (len < 0x4000) {
      const v = len | 0x8000
      return Buffer.from([(v >> 8) & 0xff, v & 0xff])
    }
    if (len < 0x200000) {
      const v = len | 0xc00000
      return Buffer.from([(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff])
    }
    if (len < 0x10000000) {
      const v = (len | 0xe0000000) >>> 0
      return Buffer.from([(v >>> 24) & 0xff, (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff])
    }
    return Buffer.from([
      0xf0,
      (len >>> 24) & 0xff,
      (len >>> 16) & 0xff,
      (len >>> 8) & 0xff,
      len & 0xff,
    ])
  }

  private async sendSentence(words: string[]): Promise<void> {
    const socket = this.socket
    if (!socket) throw new Error('Tidak ada koneksi socket')
    const chunks: Buffer[] = []
    for (const w of words) {
      const lenBuf = this.encodeLength(Buffer.byteLength(w, 'utf8'))
      const wordBuf = Buffer.from(w, 'utf8')
      this.debugLog('<<< [' + wordBuf.length + '] ' + w)
      chunks.push(lenBuf, wordBuf)
    }
    chunks.push(Buffer.from([0])) // terminator kalimat
    await new Promise<void>((resolve, reject) => {
      socket.write(Buffer.concat(chunks), (err) => (err ? reject(err) : resolve()))
    })
  }

  // ==========================================
  //  PROTOCOL DECODING
  // ==========================================

  // Baca satu kata — '' berarti terminator kalimat (length 0)
  private async readWord(): Promise<string> {
    const b0 = (await this.readBytes(1))[0]
    let len = 0
    if (b0 & 0x80) {
      if ((b0 & 0xc0) === 0x80) {
        const b1 = (await this.readBytes(1))[0]
        len = ((b0 & 0x3f) << 8) | b1
      } else if ((b0 & 0xe0) === 0xc0) {
        const b1 = (await this.readBytes(1))[0]
        const b2 = (await this.readBytes(1))[0]
        len = (((b0 & 0x1f) << 8) | b1) << 8 | b2
      } else if ((b0 & 0xf0) === 0xe0) {
        const b1 = (await this.readBytes(1))[0]
        const b2 = (await this.readBytes(1))[0]
        const b3 = (await this.readBytes(1))[0]
        len = (((((b0 & 0x0f) << 8) | b1) << 8 | b2) << 8) | b3
      } else {
        const b1 = (await this.readBytes(1))[0]
        const b2 = (await this.readBytes(1))[0]
        const b3 = (await this.readBytes(1))[0]
        const b4 = (await this.readBytes(1))[0]
        len = ((((((b1 << 8) | b2) << 8) | b3) << 8) | b4) >>> 0
      }
    } else {
      len = b0
    }
    if (len === 0) return ''
    const data = await this.readBytes(len)
    this.debugLog('>>> [' + len + '] ' + data.toString('utf8'))
    return data.toString('utf8')
  }

  // Baca satu kalimat (sampai terminator 0)
  private async readSentence(): Promise<string[]> {
    const words: string[] = []
    while (true) {
      const w = await this.readWord()
      if (w === '') break
      words.push(w)
    }
    return words
  }

  // read() versi PHP: kumpulkan kata-kata balasan sampai '!done' (atau '!fatal')
  private async readRaw(): Promise<string[]> {
    const words: string[] = []
    let receivedDone = false
    while (true) {
      const sentence = await this.readSentence()
      for (const w of sentence) words.push(w)
      if (sentence.includes('!done') || sentence.includes('!fatal')) {
        receivedDone = true
      }
      if (receivedDone) break
      if (!this.connected) break // fase login: satu kalimat saja
    }
    return words
  }

  // parseResponse versi PHP
  // Hasil: { rows: any[], traps: any[], single: string | null }
  private parseResponse(words: string[]): { rows: Record<string, string>[]; traps: Record<string, string>[]; single: string | null } {
    const rows: Record<string, string>[] = []
    const traps: Record<string, string>[] = []
    let current: Record<string, string> | null = null
    let single: string | null = null

    for (const x of words) {
      if (x === '!re') {
        current = {}
        rows.push(current)
      } else if (x === '!trap' || x === '!fatal') {
        current = {}
        traps.push(current)
      } else if (x !== '!done') {
        const parts = x.split('=').filter((s) => s !== '')
        const key = parts[0] ?? ''
        if (!key || !current) continue
        const value = parts[1] ?? ''
        if (key === 'ret') single = parts[1] ?? null
        current[key] = value
      }
    }

    return { rows, traps, single }
  }

  // ==========================================
  //  CONNECT / DISCONNECT
  // ==========================================

  async connect(ip: string, login: string, password: string): Promise<boolean> {
    for (let attempt = 1; attempt <= this.attempts; attempt++) {
      this.connected = false
      this.debugLog('Connection attempt #' + attempt + ' to ' + ip + ':' + this.port + '...')
      const opened = await this.openSocket(ip, this.port)

      if (opened) {
        try {
          // Login post-v6.43 (plaintext)
          await this.sendSentence(['/login', '=name=' + login, '=password=' + password])
          const response = await this.readRaw()

          if (response[0] === '!done') {
            if (response.length === 1) {
              // Login method post-v6.43
              this.connected = true
              break
            } else {
              // Login method pre-v6.43 (MD5 challenge)
              const parts = response[1].split('=').filter((s) => s !== '')
              if (parts[0] === 'ret' && parts[1] && parts[1].length === 32) {
                const challenge = Buffer.from(parts[1], 'hex')
                const md5 = crypto
                  .createHash('md5')
                  .update(Buffer.concat([Buffer.from([0]), Buffer.from(password, 'utf8'), challenge]))
                  .digest('hex')
                await this.sendSentence(['/login', '=name=' + login, '=response=00' + md5])
                const response2 = await this.readRaw()
                if (response2[0] === '!done') {
                  this.connected = true
                  break
                }
              }
            }
          }
        } catch {
          // koneksi bermasalah — coba attempt berikutnya
        }
        this.destroySocket()
      }
      if (attempt < this.attempts && this.delay > 0) await sleep(this.delay * 1000)
    }

    this.debugLog(this.connected ? 'Connected...' : 'Error...')
    return this.connected
  }

  disconnect() {
    this.destroySocket()
    this.connected = false
    this.debugLog('Disconnected...')
  }

  // ==========================================
  //  COMM
  // ==========================================

  /**
   * Kirim perintah ke MikroTik.
   * Return mengikuti perilaku PHP:
   * - string  : bila hanya ada satu nilai 'ret' (mis. hasil /add)
   * - array   : daftar baris '!re'
   * - '!trap' : dikonversi oleh mikrotikComm() menjadi { error }
   */
  async comm(com: string, arr: Record<string, string> = {}): Promise<string | Record<string, string>[]> {
    const keys = Object.keys(arr)
    const words: string[] = [com]
    for (const k of keys) {
      const v = arr[k]
      if (k[0] === '?') words.push(k + '=' + v)
      else if (k[0] === '~') words.push(k + '~' + v)
      else words.push('=' + k + '=' + v)
    }

    await this.sendSentence(words)
    const raw = await this.readRaw()
    const parsed = this.parseResponse(raw)

    if (parsed.traps.length > 0) {
      // Rekonstruksi struktur PHP: object dengan key '!trap'
      const trapLike = parsed.traps as unknown as Record<string, string>[]
      throw Object.assign(new Error('!trap'), { trapPayload: trapLike })
    }

    if (parsed.rows.length === 0 && parsed.single !== null) {
      return parsed.single // string — sama seperti PHP
    }

    return parsed.rows
  }
}

// ==========================================
//  HELPER — padanan mikrotik.php
// ==========================================

export interface RouterConf {
  ip: string
  port: string
  username: string
  password: string
  connected: boolean
}

/** comm() bisa return string (untuk add => .id), array, atau null — dibungkus seperti mikrotikComm() PHP */
export async function mikrotikComm(
  api: RouterosAPI | null,
  command: string,
  params: Record<string, string> = {}
): Promise<Record<string, string>[] | string | { error: string; detail?: unknown } | { status: string; ret: string }> {
  if (!api) return { error: 'API tidak terhubung' }

  let res: string | Record<string, string>[]
  try {
    res = await api.comm(command, params)
  } catch (e) {
    const err = e as Error & { trapPayload?: Record<string, string>[] }
    if (err.message === '!trap' && err.trapPayload) {
      let msg = ''
      for (const trap of err.trapPayload) {
        if (trap.message) msg += trap.message + ' '
      }
      return { error: msg.trim() || 'MikroTik error', detail: err.trapPayload }
    }
    return { error: 'Response tidak valid' }
  }

  if (res === null || res === undefined) return { error: 'Response tidak valid' }

  // String (mis. ret dari /add) → wrap sebagai success
  if (typeof res === 'string') return { status: 'ok', ret: res }

  if (!Array.isArray(res)) return { error: 'Response tidak valid' }

  return res
}

export function putusMikrotik(api: RouterosAPI | null | undefined) {
  if (api instanceof RouterosAPI) api.disconnect()
}
