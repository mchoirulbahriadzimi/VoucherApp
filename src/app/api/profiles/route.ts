/**
 * /api/profiles — pengganti get_profiles.php
 * Ambil profile hotspot dari MikroTik.
 */
import { NextResponse } from 'next/server'
import { konekMikrotik, mikrotikComm, putusMikrotik } from '@/lib/mikrotik-helpers'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function GET() {
  try {
    const api = await konekMikrotik()

    if (!api) {
      return NextResponse.json({ error: 'Tidak bisa konek ke MikroTik' })
    }

    const profiles = await mikrotikComm(api, '/ip/hotspot/user/profile/print')
    putusMikrotik(api)

    if (!Array.isArray(profiles)) {
      const err = (profiles as { error?: string }).error || 'Gagal ambil profile'
      return NextResponse.json({ error: 'Gagal ambil profile: ' + err })
    }

    /* =========================
       FORMAT OUTPUT
    ========================= */
    const result: Record<string, string>[] = []

    for (const p of profiles) {
      result.push({
        name: p['name'] ?? '',
        'shared-users': p['shared-users'] ?? '1',
        'rate-limit': p['rate-limit'] ?? '',
        'session-timeout': p['session-timeout'] ?? '',
        'idle-timeout': p['idle-timeout'] ?? '',
      })
    }

    return NextResponse.json(result)
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message })
  }
}
