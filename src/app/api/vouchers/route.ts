/**
 * /api/vouchers — pengganti get_vouchers.php
 *
 * Alur (identik dengan versi PHP):
 * 1. Coba koneksi ke MikroTik
 * 2. Jika berhasil, ambil semua user hotspot dari MikroTik
 * 3. Sync data MikroTik ke database (INSERT baru, UPDATE yang ada, SET removed=0)
 * 4. Mark users NOT in MikroTik as removed=1 (keep history, don't delete)
 * 5. Calculate expired status: if limit_uptime set AND uptime >= limit_uptime → expired='true'
 * 6. Return ONLY removed=0 records
 * 7. If MikroTik online, override DB data with real-time MikroTik data
 * 8. If MikroTik offline, return DB data (removed=0) as fallback
 */
import { NextRequest, NextResponse } from 'next/server'
import { konekMikrotik, mikrotikComm, putusMikrotik } from '@/lib/mikrotik-helpers'
import {
  listActiveVouchers,
  listActiveCodes,
  findVoucherByCode,
  insertVoucher,
  updateVoucherByCode,
  markCodesRemoved,
} from '@/lib/store'
import { calculateExpired } from '@/lib/voucher-utils'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

interface MtUser {
  name: string
  password: string
  profile: string
  uptime: string
  disabled: string
  'limit-uptime': string
  comment: string
  'bytes-in': string
  'bytes-out': string
  dynamic: string
  'caller-id': string
  'mac-address': string
}

export async function GET(_req: NextRequest) {
  try {
    let mikrotikData: Record<string, MtUser> | null = null

    /* =========================
       CEK & AMBIL DATA MIKROTIK
    ========================= */
    const api = await konekMikrotik()

    if (api) {
      const mtUsers = await mikrotikComm(api, '/ip/hotspot/user/print')
      putusMikrotik(api)

      if (Array.isArray(mtUsers)) {
        mikrotikData = {}

        for (const u of mtUsers) {
          const name = u['name'] ?? ''
          if (!name) continue

          mikrotikData[name] = {
            name,
            password: u['password'] ?? name,
            profile: u['profile'] ?? 'default',
            uptime: u['uptime'] ?? '0s',
            disabled: u['disabled'] ?? 'false',
            'limit-uptime': u['limit-uptime'] ?? '',
            comment: u['comment'] ?? '',
            'bytes-in': u['bytes-in'] ?? '0',
            'bytes-out': u['bytes-out'] ?? '0',
            dynamic: u['dynamic'] ?? 'false',
            'caller-id': u['caller-id'] ?? '',
            'mac-address': u['mac-address'] ?? '',
          }
        }
      }
    }

    /* =========================
       SIMPAN DATA MIKROTIK KE DATABASE
    ========================= */
    if (mikrotikData !== null) {
      // Update/Insert user dari MikroTik ke database
      for (const name of Object.keys(mikrotikData)) {
        const mt = mikrotikData[name]

        // Hitung expired
        const expired = calculateExpired(mt.uptime, mt['limit-uptime'])

        const existing = await findVoucherByCode(name)

        if (existing) {
          // Update data MikroTik ke database, set removed=0 (karena ada di MikroTik)
          await updateVoucherByCode(name, {
            disabled: mt.disabled,
            uptime: mt.uptime,
            limit_uptime: mt['limit-uptime'],
            profile: mt.profile,
            password: mt.password,
            comment: mt.comment,
            removed: 0,
            expired,
          })
        } else {
          // User ada di MikroTik tapi belum di database → tambahkan
          await insertVoucher({
            code: name,
            password: mt.password,
            profile: mt.profile,
            uptime: mt.uptime,
            disabled: mt.disabled,
            limit_uptime: mt['limit-uptime'],
            comment: mt.comment,
            removed: 0,
            expired,
          })
        }
      }

      // Tandai user di database yang TIDAK ada di MikroTik sebagai "removed=1"
      const dbCodes = await listActiveCodes()
      const missing = dbCodes.filter((code) => !mikrotikData![code])
      await markCodesRemoved(missing)
    }

    /* =========================
       AMBIL DATA DARI DATABASE (hanya removed=0)
    ========================= */
    const rows = await listActiveVouchers()

    const data: Record<string, unknown>[] = []

    for (const row of rows) {
      const item: Record<string, unknown> = {
        id: row.id,
        name: row.code,
        password: row.password ?? row.code,
        profile: row.profile ?? 'default',
        uptime: row.uptime ?? '0s',
        disabled: row.disabled ?? 'false',
        'limit-uptime': row.limit_uptime ?? '',
        comment: row.comment ?? '',
        expired: row.expired ?? 'false',
        created_at: row.created_at ?? '',
      }

      // Jika data MikroTik tersedia, override dengan data real-time
      if (mikrotikData !== null && mikrotikData[row.code]) {
        const mt = mikrotikData[row.code]
        item['uptime'] = mt.uptime
        item['disabled'] = mt.disabled
        item['limit-uptime'] = mt['limit-uptime']
        item['profile'] = mt.profile
        item['password'] = mt.password
        item['bytes-in'] = mt['bytes-in']
        item['bytes-out'] = mt['bytes-out']
        item['caller-id'] = mt['caller-id']
        item['mac-address'] = mt['mac-address']

        // Override expired with real-time calculation
        item['expired'] = calculateExpired(mt.uptime, mt['limit-uptime'])
      }

      data.push(item)
    }

    return NextResponse.json(data)
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message })
  }
}
