/**
 * /api/manage-profiles — pengganti manage_profiles.php
 *
 * Action (POST JSON):
 * - list   : ambil semua profile
 * - add    : tambah profile baru
 * - edit   : edit profile
 * - delete : hapus profile
 */
import { NextRequest, NextResponse } from 'next/server'
import { konekMikrotik, mikrotikComm, putusMikrotik } from '@/lib/mikrotik-helpers'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function POST(req: NextRequest) {
  try {
    let data: Record<string, unknown> = {}
    try {
      data = await req.json()
    } catch {
      /* ignore */
    }
    const action = String(data.action ?? '') || new URL(req.url).searchParams.get('action') || ''

    const api = await konekMikrotik()
    if (!api) {
      return NextResponse.json({ error: 'Tidak bisa konek ke MikroTik' })
    }

    switch (action) {
      // Ambil semua profile
      case 'list': {
        const profiles = await mikrotikComm(api, '/ip/hotspot/user/profile/print')
        putusMikrotik(api)

        if (!Array.isArray(profiles)) {
          const err = (profiles as { error?: string }).error || 'MikroTik error'
          return NextResponse.json({ error: err })
        }

        const result: Record<string, string>[] = []
        for (const p of profiles) {
          result.push({
            id: p['.id'] ?? '',
            name: p['name'] ?? '',
            'shared-users': p['shared-users'] ?? '1',
            'rate-limit': p['rate-limit'] ?? '',
            'session-timeout': p['session-timeout'] ?? '',
            'idle-timeout': p['idle-timeout'] ?? '',
            'keepalive-timeout': p['keepalive-timeout'] ?? '',
          })
        }
        return NextResponse.json(result)
      }

      // Tambah profile baru
      case 'add': {
        const name = String(data.name ?? '').trim()
        if (!name) {
          putusMikrotik(api)
          return NextResponse.json({ error: 'Nama profile harus diisi' })
        }

        const params: Record<string, string> = { name }
        if (data['shared-users']) params['shared-users'] = String(data['shared-users'])
        if (data['rate-limit']) params['rate-limit'] = String(data['rate-limit'])
        if (data['session-timeout']) params['session-timeout'] = String(data['session-timeout'])
        if (data['idle-timeout']) params['idle-timeout'] = String(data['idle-timeout'])

        const res = await mikrotikComm(api, '/ip/hotspot/user/profile/add', params)
        putusMikrotik(api)

        if (!Array.isArray(res) && typeof res !== 'string' && (res as { error?: string }).error) {
          return NextResponse.json({ error: 'Gagal tambah profile: ' + (res as { error?: string }).error })
        }
        return NextResponse.json({ status: 'ok', name })
      }

      // Edit profile
      case 'edit': {
        const id = String(data.id ?? '').trim()
        if (!id) {
          putusMikrotik(api)
          return NextResponse.json({ error: 'ID profile tidak ada' })
        }

        const params: Record<string, string> = { '.id': id }
        if (data['shared-users'] !== undefined) params['shared-users'] = String(data['shared-users'])
        if (data['rate-limit'] !== undefined) params['rate-limit'] = String(data['rate-limit'])
        if (data['session-timeout'] !== undefined) params['session-timeout'] = String(data['session-timeout'])
        if (data['idle-timeout'] !== undefined) params['idle-timeout'] = String(data['idle-timeout'])

        const res = await mikrotikComm(api, '/ip/hotspot/user/profile/set', params)
        putusMikrotik(api)

        if (!Array.isArray(res) && typeof res !== 'string' && (res as { error?: string }).error) {
          return NextResponse.json({ error: 'Gagal edit profile: ' + (res as { error?: string }).error })
        }
        return NextResponse.json({ status: 'ok' })
      }

      // Hapus profile
      case 'delete': {
        const id = String(data.id ?? '').trim()
        if (!id) {
          putusMikrotik(api)
          return NextResponse.json({ error: 'ID profile tidak ada' })
        }

        const res = await mikrotikComm(api, '/ip/hotspot/user/profile/remove', { '.id': id })
        putusMikrotik(api)

        if (!Array.isArray(res) && typeof res !== 'string' && (res as { error?: string }).error) {
          return NextResponse.json({ error: 'Gagal hapus profile: ' + (res as { error?: string }).error })
        }
        return NextResponse.json({ status: 'ok' })
      }

      default:
        putusMikrotik(api)
        return NextResponse.json({ error: 'Action tidak valid' })
    }
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message })
  }
}
