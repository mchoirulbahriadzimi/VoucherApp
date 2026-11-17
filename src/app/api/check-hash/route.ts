/**
 * /api/check-hash — pengganti check_hash.php
 *
 * Lightweight endpoint untuk change detection (auto-refresh).
 * Komputasi MD5 hash dari data voucher saat ini.
 * Hanya hash: name, disabled, limit-uptime, profile (TIDAK uptime — berubah setiap detik)
 * Jika MikroTik offline, hash dari DB where removed=0
 *
 * Return: {"hash":"a1b2c3","total":5}
 */
import { NextResponse } from 'next/server'
import crypto from 'crypto'
import { konekMikrotik, mikrotikComm, putusMikrotik } from '@/lib/mikrotik-helpers'
import { listActiveVouchers } from '@/lib/store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function GET() {
  try {
    let hashData = ''
    let total = 0

    // Coba koneksi ke MikroTik
    const api = await konekMikrotik()

    if (api) {
      // MikroTik online — hash dari data MikroTik
      const mtUsers = await mikrotikComm(api, '/ip/hotspot/user/print')
      putusMikrotik(api)

      if (Array.isArray(mtUsers)) {
        const items: string[] = []
        for (const u of mtUsers) {
          const name = u['name'] ?? ''
          if (!name) continue

          // Hanya hash field yang relevan untuk change detection
          items.push(
            name +
              '|' +
              (u['disabled'] ?? 'false') +
              '|' +
              (u['limit-uptime'] ?? '') +
              '|' +
              (u['profile'] ?? 'default')
          )
        }
        items.sort() // Consistent order
        hashData = items.join('\n')
        total = items.length
      }
    } else {
      // MikroTik offline — hash dari DB where removed=0
      const rows = await listActiveVouchers()
      const sorted = [...rows].sort((a, b) => a.code.localeCompare(b.code))

      const items: string[] = []
      for (const row of sorted) {
        items.push(
          row.code +
            '|' +
            (row.disabled ?? 'false') +
            '|' +
            (row.limit_uptime ?? '') +
            '|' +
            (row.profile ?? 'default')
        )
      }
      hashData = items.join('\n')
      total = items.length
    }

    const hash = crypto.createHash('md5').update(hashData).digest('hex')

    return NextResponse.json({ hash, total })
  } catch (e) {
    return NextResponse.json({ hash: '', total: 0, error: (e as Error).message })
  }
}
