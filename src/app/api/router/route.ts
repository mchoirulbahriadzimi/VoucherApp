/**
 * /api/router — pengganti api.php
 *
 * - test_connection  : test koneksi ke MikroTik dengan kredensial custom (FormData)
 * - save_router      : simpan konfigurasi router ke database (Supabase/SQLite)
 * - get_config       : ambil konfigurasi router (tanpa password) (GET)
 * - check_connection : cek status koneksi MikroTik (GET)
 * - disable_voucher  : nonaktifkan voucher di MikroTik & DB
 * - enable_voucher   : aktifkan voucher di MikroTik & DB
 */
import { NextRequest, NextResponse } from 'next/server'
import { konekMikrotik, konekMikrotikCustom, mikrotikComm, putusMikrotik, getRouterName } from '@/lib/mikrotik-helpers'
import { getRouterConfig, saveRouterConfig, updateVoucherByCode } from '@/lib/store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

function ok(data: Record<string, unknown>, status = 200) {
  return NextResponse.json(data, { status })
}

async function safeJson(req: NextRequest): Promise<Record<string, unknown>> {
  try {
    return await req.json()
  } catch {
    return {}
  }
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const action = url.searchParams.get('action') || ''

  try {
    /* ========================= */
    /* AMBIL KONFIGURASI         */
    /* ========================= */
    if (action === 'get_config') {
      const config = await getRouterConfig()
      // Jangan kirim password ke frontend
      return ok({
        ip: config.ip || '',
        port: config.port || '8728',
        username: config.username || '',
        has_password: !!(config.password && config.password.length > 0),
        connected: config.connected ?? false,
      })
    }

    /* ========================= */
    /* CEK STATUS KONEKSI        */
    /* ========================= */
    if (action === 'check_connection') {
      const config = await getRouterConfig()

      if (!config.ip) {
        return ok({ connected: false, configured: false })
      }

      const api = await konekMikrotik()
      if (api) {
        const routerName = await getRouterName(api)
        return ok({ connected: true, configured: true, router_name: routerName })
      }
      return ok({ connected: false, configured: true })
    }

    return ok({ error: 'Action tidak valid' })
  } catch (e) {
    return ok({ error: (e as Error).message })
  }
}

export async function POST(req: NextRequest) {
  const url = new URL(req.url)
  let action = url.searchParams.get('action') || ''
  let form: Record<string, string> = {}
  let jsonBody: Record<string, unknown> = {}

  const contentType = req.headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    jsonBody = await safeJson(req)
    action = (jsonBody.action as string) || action
  } else if (contentType.includes('multipart/form-data') || contentType.includes('application/x-www-form-urlencoded')) {
    try {
      const fd = await req.formData()
      for (const [k, v] of fd.entries()) {
        if (typeof v === 'string') form[k] = v
      }
      action = form.action || action
    } catch {
      form = {}
    }
  }

  try {
    switch (action) {
      /* ========================= */
      /* TEST KONEKSI              */
      /* ========================= */
      case 'test_connection': {
        const ip = form.ip ?? ''
        const port = form.port ?? '8728'
        const user = form.username ?? ''
        let pass = form.password ?? ''

        // Jika password kosong, gunakan password tersimpan
        if (!pass) {
          const saved = await getRouterConfig()
          pass = saved.password ?? ''
        }

        if (!ip || !user) {
          return ok({ success: false, error: 'IP dan Username harus diisi' })
        }

        const api = await konekMikrotikCustom(ip, user, pass, parseInt(port, 10))

        if (api) {
          const routerName = await getRouterName(api)
          return ok({
            success: true,
            router_name: routerName,
            message: 'Koneksi berhasil' + (routerName ? ' — Router: ' + routerName : ''),
          })
        }
        return ok({
          success: false,
          error: 'Gagal koneksi ke MikroTik. Periksa IP, port, username, dan password.',
        })
      }

      /* ========================= */
      /* SIMPAN KONFIGURASI        */
      /* ========================= */
      case 'save_router': {
        const ip = form.ip ?? ''
        const port = form.port ?? '8728'
        const user = form.username ?? ''
        let pass = form.password ?? ''

        if (!ip || !user) {
          return ok({ success: false, error: 'IP dan Username harus diisi' })
        }

        // Jika password kosong, gunakan password tersimpan
        if (!pass) {
          const saved = await getRouterConfig()
          pass = saved.password ?? ''
        }

        // Test koneksi dulu
        const api = await konekMikrotikCustom(ip, user, pass, parseInt(port, 10))
        let connected = false

        if (api) {
          connected = true
          putusMikrotik(api)
        }

        // Simpan config ke database
        await saveRouterConfig({
          ip,
          port,
          username: user,
          password: pass,
          connected,
        })

        return ok({
          success: true,
          connected,
          message: connected
            ? 'Konfigurasi disimpan dan koneksi berhasil'
            : 'Konfigurasi disimpan tapi koneksi gagal. Periksa kembali pengaturan.',
        })
      }

      /* ========================= */
      /* DISABLE VOUCHER           */
      /* ========================= */
      case 'disable_voucher': {
        const name = (jsonBody.name as string) || ''
        if (!name) return ok({ success: false, error: 'Nama voucher kosong' })

        const api = await konekMikrotik()
        if (!api) return ok({ success: false, error: 'Tidak bisa konek ke MikroTik' })

        // Cari user di MikroTik berdasarkan name
        const user = await mikrotikComm(api, '/ip/hotspot/user/print', { '?name': name })
        if (
          !Array.isArray(user) ||
          user.length === 0 ||
          !user[0]['.id']
        ) {
          putusMikrotik(api)
          return ok({ success: false, error: 'User tidak ditemukan di MikroTik' })
        }

        // Disable user menggunakan .id runtime (TIDAK disimpan ke DB)
        await mikrotikComm(api, '/ip/hotspot/user/set', {
          '.id': user[0]['.id'],
          disabled: 'yes',
        })
        putusMikrotik(api)

        // Update database
        await updateVoucherByCode(name, { disabled: 'true' })

        return ok({ success: true, message: 'Voucher ' + name + ' dinonaktifkan' })
      }

      /* ========================= */
      /* ENABLE VOUCHER            */
      /* ========================= */
      case 'enable_voucher': {
        const name = (jsonBody.name as string) || ''
        if (!name) return ok({ success: false, error: 'Nama voucher kosong' })

        const api = await konekMikrotik()
        if (!api) return ok({ success: false, error: 'Tidak bisa konek ke MikroTik' })

        // Cari user di MikroTik berdasarkan name
        const user = await mikrotikComm(api, '/ip/hotspot/user/print', { '?name': name })
        if (
          !Array.isArray(user) ||
          user.length === 0 ||
          !user[0]['.id']
        ) {
          putusMikrotik(api)
          return ok({ success: false, error: 'User tidak ditemukan di MikroTik' })
        }

        // Enable user menggunakan .id runtime (TIDAK disimpan ke DB)
        await mikrotikComm(api, '/ip/hotspot/user/set', {
          '.id': user[0]['.id'],
          disabled: 'no',
        })
        putusMikrotik(api)

        // Update database
        await updateVoucherByCode(name, { disabled: 'false' })

        return ok({ success: true, message: 'Voucher ' + name + ' diaktifkan' })
      }

      default:
        return ok({ error: 'Action tidak valid' })
    }
  } catch (e) {
    return ok({ success: false, error: (e as Error).message })
  }
}
