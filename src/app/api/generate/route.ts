/**
 * /api/generate — pengganti generate.php
 *
 * Membuat voucher baru di MikroTik dan menyimpan ke database (Supabase/SQLite).
 * Juga menyimpan limit_uptime, disabled, expired ke database.
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

    const code = String(data.code ?? '').trim()
    const profile = String(data.profile ?? '').trim()
    const uptime = String(data.uptime ?? '').trim()
    const comment = String(data.comment ?? '').trim()

    if (!code || !profile) {
      return NextResponse.json({ error: 'Code dan Profile harus diisi' })
    }

    const api = await konekMikrotik()

    if (!api) {
      return NextResponse.json({ error: 'Tidak bisa konek ke MikroTik' })
    }

    // Cek apakah user sudah ada di MikroTik
    const cek = await mikrotikComm(api, '/ip/hotspot/user/print', { '?name': code })

    if (Array.isArray(cek) && cek.length > 0) {
      putusMikrotik(api)
      return NextResponse.json({ error: 'User sudah ada di MikroTik' })
    }

    // Buat user di MikroTik
    // Comment: gunakan input user jika diisi, jika kosong maka kosong (tidak otomatis)
    const params: Record<string, string> = {
      name: code,
      password: code,
      profile,
      disabled: 'no',
    }

    if (comment) params['comment'] = comment
    if (uptime) params['limit-uptime'] = uptime

    const res = await mikrotikComm(api, '/ip/hotspot/user/add', params)
    putusMikrotik(api)

    if (!Array.isArray(res) && typeof res !== 'string' && (res as { error?: string }).error) {
      return NextResponse.json({ error: 'Gagal tambah user' })
    }

    // Simpan ke database
    const disabled = 'false'
    const limit_uptime = uptime || ''
    const expired = 'false' // Baru dibuat, belum expired

    // Cek apakah voucher sudah ada di DB (sebelumnya removed=1)
    const existing = await findVoucherByCode(code)

    if (existing) {
      // Voucher sudah ada di DB (mungkin sebelumnya removed), update dan set removed=0
      await updateVoucherByCode(code, {
        password: code,
        profile,
        uptime: '0s',
        disabled,
        limit_uptime,
        comment,
        removed: 0,
        expired,
      })
    } else {
      // Insert baru
      await insertVoucher({
        code,
        password: code,
        profile,
        uptime: '0s',
        disabled,
        limit_uptime,
        comment,
        removed: 0,
        expired,
      })
    }

    return NextResponse.json({
      status: 'ok',
      user: code,
      profile,
      uptime,
    })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message })
  }
}
