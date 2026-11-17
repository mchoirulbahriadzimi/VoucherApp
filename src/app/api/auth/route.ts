/**
 * /api/auth — pengganti auth_api.php
 *
 * Action:
 * - check           : cek apakah sudah ada akun admin (GET/POST)
 * - register        : daftar akun admin baru
 * - login           : login admin (verifikasi dari database — Supabase/SQLite)
 * - get_profile     : ambil data profil admin
 * - update_profile  : update profil admin (fullname, avatar, email, phone, bio)
 * - change_password : ubah password admin
 *
 * Password di-hash menggunakan bcrypt (kompatibel dengan password_hash PHP).
 */
import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import crypto from 'crypto'
import {
  countAdmins,
  getAdminByUsername,
  insertAdmin,
  updateAdminProfile,
  updateAdminPassword,
} from '@/lib/store'
import { fmtPhpDate } from '@/lib/voucher-utils'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

function ok(data: Record<string, unknown>, status = 200) {
  return NextResponse.json(data, { status })
}

async function safeBody(req: NextRequest): Promise<Record<string, unknown>> {
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
    if (action === 'check') {
      const total = await countAdmins()
      return ok({ success: true, has_admin: total > 0, total_admins: total })
    }
    return ok({ success: false, error: 'Action tidak valid' })
  } catch (e) {
    return ok({ success: false, error: (e as Error).message })
  }
}

export async function POST(req: NextRequest) {
  const url = new URL(req.url)
  const body = await safeBody(req)
  const action = url.searchParams.get('action') || (body.action as string) || ''

  try {
    switch (action) {
      /* ========================= */
      /* CEK APAKAH ADA AKUN ADMIN */
      /* ========================= */
      case 'check': {
        const total = await countAdmins()
        return ok({ success: true, has_admin: total > 0, total_admins: total })
      }

      /* ========================= */
      /* REGISTER ADMIN BARU       */
      /* ========================= */
      case 'register': {
        const username = String(body.username ?? '').trim()
        const password = String(body.password ?? '').trim()
        const fullname = String(body.fullname ?? '').trim()
        const confirm = String(body.confirm ?? '').trim()

        if (!username) return ok({ success: false, error: 'Username harus diisi' })
        if (username.length < 3) return ok({ success: false, error: 'Username minimal 3 karakter' })
        if (!/^[a-zA-Z0-9_]+$/.test(username)) {
          return ok({ success: false, error: 'Username hanya boleh huruf, angka, dan underscore' })
        }
        if (!password) return ok({ success: false, error: 'Password harus diisi' })
        if (password.length < 5) return ok({ success: false, error: 'Password minimal 5 karakter' })
        if (password !== confirm) return ok({ success: false, error: 'Konfirmasi password tidak cocok' })

        // Cek apakah username sudah digunakan
        const existing = await getAdminByUsername(username, false)
        if (existing) return ok({ success: false, error: 'Username sudah digunakan' })

        // Hash password (bcrypt) dan simpan
        const hashedPassword = bcrypt.hashSync(password, 10)
        await insertAdmin(username, hashedPassword, fullname)

        return ok({
          success: true,
          message: 'Akun admin berhasil dibuat! Silakan login.',
          admin: { username, fullname },
        })
      }

      /* ========================= */
      /* LOGIN ADMIN               */
      /* ========================= */
      case 'login': {
        const username = String(body.username ?? '').trim()
        const password = String(body.password ?? '').trim()

        if (!username || !password) {
          return ok({ success: false, error: 'Username dan password harus diisi' })
        }

        const admin = await getAdminByUsername(username, true)
        if (!admin) return ok({ success: false, error: 'Username atau password salah' })

        // Verifikasi password (bcrypt)
        if (admin.password && bcrypt.compareSync(password, admin.password)) {
          const token = crypto.randomBytes(32).toString('hex')
          const loginTime = fmtPhpDate(new Date())

          return ok({
            success: true,
            message: 'Login berhasil',
            admin: {
              id: admin.id,
              username: admin.username,
              fullname: admin.fullname || admin.username,
              avatar: admin.avatar || '',
              email: admin.email || '',
              phone: admin.phone || '',
              bio: admin.bio || '',
              created_at: admin.created_at,
              login_at: loginTime,
              token,
            },
          })
        }
        return ok({ success: false, error: 'Username atau password salah' })
      }

      /* ========================= */
      /* AMBIL DATA PROFIL ADMIN   */
      /* ========================= */
      case 'get_profile': {
        const username = String(body.username ?? '').trim()
        if (!username) return ok({ success: false, error: 'Username diperlukan' })

        const admin = await getAdminByUsername(username, false)
        if (!admin) return ok({ success: false, error: 'Admin tidak ditemukan' })

        return ok({ success: true, admin })
      }

      /* ========================= */
      /* UPDATE PROFIL ADMIN       */
      /* ========================= */
      case 'update_profile': {
        const username = String(body.username ?? '').trim()
        const fullname = String(body.fullname ?? '').trim()
        const email = String(body.email ?? '').trim()
        const phone = String(body.phone ?? '').trim()
        const bio = String(body.bio ?? '').trim()
        const avatar = String(body.avatar ?? '')

        if (!username) return ok({ success: false, error: 'Username diperlukan' })

        // Validasi email jika diisi
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          return ok({ success: false, error: 'Format email tidak valid' })
        }

        await updateAdminProfile(username, {
          fullname,
          email,
          phone,
          bio,
          avatar,
        })

        const admin = await getAdminByUsername(username, false)
        return ok({ success: true, message: 'Profil berhasil diperbarui!', admin })
      }

      /* ========================= */
      /* UBAH PASSWORD ADMIN       */
      /* ========================= */
      case 'change_password': {
        const username = String(body.username ?? '').trim()
        const oldPassword = String(body.old_password ?? '').trim()
        const newPassword = String(body.new_password ?? '').trim()
        const confirmPass = String(body.confirm_password ?? '').trim()

        if (!username || !oldPassword || !newPassword) {
          return ok({ success: false, error: 'Semua field harus diisi' })
        }
        if (newPassword.length < 5) {
          return ok({ success: false, error: 'Password baru minimal 5 karakter' })
        }
        if (newPassword !== confirmPass) {
          return ok({ success: false, error: 'Konfirmasi password tidak cocok' })
        }

        const admin = await getAdminByUsername(username, true)
        if (!admin) return ok({ success: false, error: 'Admin tidak ditemukan' })

        if (!admin.password || !bcrypt.compareSync(oldPassword, admin.password)) {
          return ok({ success: false, error: 'Password lama salah' })
        }

        const hashedPassword = bcrypt.hashSync(newPassword, 10)
        await updateAdminPassword(username, hashedPassword)

        return ok({ success: true, message: 'Password berhasil diubah!' })
      }

      default:
        return ok({ success: false, error: 'Action tidak valid' })
    }
  } catch (e) {
    return ok({ success: false, error: (e as Error).message })
  }
}
