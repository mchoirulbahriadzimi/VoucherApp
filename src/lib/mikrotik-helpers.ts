/**
 * mikrotik-helpers.ts
 *
 * Port 1:1 dari mikrotik.php:
 * - konekMikrotik()        : koneksi dengan kredensial tersimpan (dari DB, pengganti data/router.json)
 * - konekMikrotikCustom()  : koneksi dengan kredensial custom (test koneksi)
 * - putusMikrotik()
 * - mikrotikComm()         : kirim perintah (terdefinisi di mikrotik.ts)
 */
import { RouterosAPI, mikrotikComm, putusMikrotik } from '@/lib/mikrotik'
import { getRouterConfig } from '@/lib/store'

export { mikrotikComm, putusMikrotik }
export type { RouterosAPI }

/** Koneksi ke Mikrotik menggunakan config tersimpan */
export async function konekMikrotik(): Promise<RouterosAPI | null> {
  const config = await getRouterConfig()

  if (!config.ip || !config.username) return null

  const API = new RouterosAPI({
    debug: false,
    timeout: 3,
    attempts: 1,
    delay: 0,
    port: parseInt(config.port || '8728', 10) || 8728,
  })

  const ok = await API.connect(config.ip, config.username, config.password ?? '')
  return ok ? API : null
}

/** Koneksi ke Mikrotik dengan kredensial custom (untuk test koneksi) */
export async function konekMikrotikCustom(
  ip: string,
  username: string,
  password: string,
  port = 8728
): Promise<RouterosAPI | null> {
  const API = new RouterosAPI({
    debug: false,
    timeout: 3,
    attempts: 1,
    delay: 0,
    port: parseInt(String(port), 10) || 8728,
  })

  const ok = await API.connect(ip, username, password)
  return ok ? API : null
}

/** Ambil identity router (helper gabungan untuk check/test connection) */
export async function getRouterName(api: RouterosAPI | null): Promise<string> {
  if (!api) return ''
  const identity = await mikrotikComm(api, '/system/identity/print')
  putusMikrotik(api)
  if (Array.isArray(identity) && identity.length > 0 && identity[0]['name']) {
    return identity[0]['name']
  }
  return ''
}
