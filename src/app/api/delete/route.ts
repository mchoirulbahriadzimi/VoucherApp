/**
 * /api/delete — pengganti delete.php
 *
 * Menghapus voucher dari MikroTik dan menandai sebagai removed di database.
 * - Hapus user dari MikroTik (cari by name, gunakan .id runtime untuk API call)
 * - Tandai sebagai removed=1 di database (TIDAK hapus permanen — keep history)
 * - Jika tidak ada row di DB, INSERT baru dengan removed=1
 */
import { NextRequest, NextResponse } from 'next/server'
import { konekMikrotik, mikrotikComm, putusMikrotik } from '@/lib/mikrotik-helpers'
import { findVoucherByCode, insertVoucher, updateVoucherByCode } from '@/lib/store'

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

    const name = String(data.name ?? '').trim()

    if (!name) {
      return NextResponse.json({ error: 'Nama kosong' })
    }

    // Hapus dari MikroTik jika tersambung
    const api = await konekMikrotik()

    if (api) {
      // Cari user di MikroTik berdasarkan name
      const user = await mikrotikComm(api, '/ip/hotspot/user/print', { '?name': name })

      if (Array.isArray(user) && user.length > 0) {
        // Ambil .id runtime untuk API call (TIDAK disimpan ke DB)
        const id = user[0]['.id'] ?? ''

        if (id) {
          await mikrotikComm(api, '/ip/hotspot/user/remove', { '.id': id })
        }
      }

      putusMikrotik(api)
    }

    // Update database: tandai sebagai removed=1
    const existing = await findVoucherByCode(name)

    if (existing) {
      await updateVoucherByCode(name, { removed: 1 })
    } else {
      // Tidak ada row yang diupdate — mungkin belum ada di DB
      // INSERT baru dengan removed=1 untuk keep history
      await insertVoucher({
        code: name,
        password: '',
        profile: 'default',
        uptime: '0s',
        disabled: 'true',
        limit_uptime: '',
        comment: '',
        removed: 1,
        expired: 'false',
      })
    }

    return NextResponse.json({ status: 'deleted' })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message })
  }
}
