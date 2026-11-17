/**
 * store.ts
 *
 * Data layer utama VoucherApp.
 *
 * MODE 1 — SUPABASE (production / Vercel):
 *   Aktif bila env NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY terisi.
 *   Semua data (vouchers, admins, router_config) tersimpan di Supabase PostgreSQL,
 *   avatar tersimpan di Supabase Storage bucket "avatars".
 *
 * MODE 2 — FALLBACK LOKAL (preview/dev tanpa Supabase):
 *   Bila env Supabase belum diisi, memakai SQLite via Prisma dengan schema identik,
 *   sehingga seluruh alur sistem tetap berfungsi persis seperti versi PHP asli.
 *
 * Bentuk data & semantik query dibuat 1:1 dengan schema MySQL voucher_db asli.
 */
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { db as prisma } from '@/lib/db'

export interface VoucherRow {
  id: number
  code: string
  password: string
  profile: string
  uptime: string
  disabled: string
  limit_uptime: string
  comment: string
  removed: number
  expired: string
  created_at: string
}

export interface AdminRow {
  id: number
  username: string
  password?: string
  fullname: string
  avatar: string
  email: string
  phone: string
  bio: string
  created_at: string
}

export interface RouterConf {
  ip: string
  port: string
  username: string
  password: string
  connected: boolean
}

export interface VoucherPatch {
  password?: string
  profile?: string
  uptime?: string
  disabled?: string
  limit_uptime?: string
  comment?: string
  removed?: number
  expired?: string
}

// ==========================================
//  SUPABASE CLIENT
// ==========================================

const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || ''
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || ''

export const usingSupabase = Boolean(SUPA_URL && SUPA_KEY)

let supaInstance: SupabaseClient | null = null

function getSupa(): SupabaseClient {
  if (!supaInstance) {
    supaInstance = createClient(SUPA_URL, SUPA_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  }
  return supaInstance
}

/** Normalisasi error Supabase → pesan Indonesia yang jelas */
function dbError(e: unknown): Error {
  const err = e as { message?: string; code?: string; details?: string; hint?: string }
  const code = err?.code || ''
  const msg = err?.message || 'Kesalahan database tidak diketahui'
  if (code === 'PGRST205' || code === '42P01' || /does not exist/i.test(msg) || /Could not find the table/i.test(msg)) {
    return new Error(
      'Tabel database belum dibuat di Supabase. Jalankan file supabase-setup.sql di Supabase SQL Editor terlebih dahulu.'
    )
  }
  return new Error('Kesalahan database: ' + msg)
}

// ==========================================
//  VOUCHERS
// ==========================================

function mapSqliteVoucher(r: {
  id: number
  code: string
  password: string
  profile: string
  uptime: string
  disabled: string
  limitUptime: string
  comment: string
  removed: number
  expired: string
  createdAt: Date
}): VoucherRow {
  return {
    id: r.id,
    code: r.code,
    password: r.password,
    profile: r.profile,
    uptime: r.uptime,
    disabled: r.disabled,
    limit_uptime: r.limitUptime,
    comment: r.comment,
    removed: r.removed,
    expired: r.expired,
    created_at: r.createdAt.toISOString(),
  }
}

export async function listActiveVouchers(): Promise<VoucherRow[]> {
  if (usingSupabase) {
    const { data, error } = await getSupa()
      .from('vouchers')
      .select('*')
      .eq('removed', 0)
      .order('id', { ascending: false })
    if (error) throw dbError(error)
    return (data || []) as VoucherRow[]
  }
  const rows = await prisma.voucher.findMany({
    where: { removed: 0 },
    orderBy: { id: 'desc' },
  })
  return rows.map(mapSqliteVoucher)
}

export async function findVoucherByCode(code: string): Promise<VoucherRow | null> {
  if (usingSupabase) {
    const { data, error } = await getSupa()
      .from('vouchers')
      .select('*')
      .eq('code', code)
      .limit(1)
    if (error) throw dbError(error)
    const row = (data || [])[0]
    return row ? (row as VoucherRow) : null
  }
  const row = await prisma.voucher.findUnique({ where: { code } })
  return row ? mapSqliteVoucher(row) : null
}

export async function insertVoucher(fields: VoucherPatch & { code: string }): Promise<void> {
  if (usingSupabase) {
    const { error } = await getSupa().from('vouchers').insert({
      code: fields.code,
      password: fields.password ?? fields.code,
      profile: fields.profile ?? 'default',
      uptime: fields.uptime ?? '0s',
      disabled: fields.disabled ?? 'false',
      limit_uptime: fields.limit_uptime ?? '',
      comment: fields.comment ?? '',
      removed: fields.removed ?? 0,
      expired: fields.expired ?? 'false',
    })
    if (error) throw dbError(error)
    return
  }
  await prisma.voucher.create({
    data: {
      code: fields.code,
      password: fields.password ?? fields.code,
      profile: fields.profile ?? 'default',
      uptime: fields.uptime ?? '0s',
      disabled: fields.disabled ?? 'false',
      limitUptime: fields.limit_uptime ?? '',
      comment: fields.comment ?? '',
      removed: fields.removed ?? 0,
      expired: fields.expired ?? 'false',
    },
  })
}

export async function updateVoucherByCode(code: string, patch: VoucherPatch): Promise<void> {
  if (usingSupabase) {
    const upd: Record<string, unknown> = {}
    if (patch.password !== undefined) upd.password = patch.password
    if (patch.profile !== undefined) upd.profile = patch.profile
    if (patch.uptime !== undefined) upd.uptime = patch.uptime
    if (patch.disabled !== undefined) upd.disabled = patch.disabled
    if (patch.limit_uptime !== undefined) upd.limit_uptime = patch.limit_uptime
    if (patch.comment !== undefined) upd.comment = patch.comment
    if (patch.removed !== undefined) upd.removed = patch.removed
    if (patch.expired !== undefined) upd.expired = patch.expired
    const { error } = await getSupa().from('vouchers').update(upd).eq('code', code)
    if (error) throw dbError(error)
    return
  }
  await prisma.voucher.updateMany({
    where: { code },
    data: {
      ...(patch.password !== undefined ? { password: patch.password } : {}),
      ...(patch.profile !== undefined ? { profile: patch.profile } : {}),
      ...(patch.uptime !== undefined ? { uptime: patch.uptime } : {}),
      ...(patch.disabled !== undefined ? { disabled: patch.disabled } : {}),
      ...(patch.limit_uptime !== undefined ? { limitUptime: patch.limit_uptime } : {}),
      ...(patch.comment !== undefined ? { comment: patch.comment } : {}),
      ...(patch.removed !== undefined ? { removed: patch.removed } : {}),
      ...(patch.expired !== undefined ? { expired: patch.expired } : {}),
    },
  })
}

export async function listActiveCodes(): Promise<string[]> {
  if (usingSupabase) {
    const { data, error } = await getSupa()
      .from('vouchers')
      .select('code')
      .eq('removed', 0)
    if (error) throw dbError(error)
    return (data || []).map((r: { code: string }) => r.code)
  }
  const rows = await prisma.voucher.findMany({ where: { removed: 0 }, select: { code: true } })
  return rows.map((r) => r.code)
}

export async function markCodesRemoved(codes: string[]): Promise<void> {
  if (codes.length === 0) return
  if (usingSupabase) {
    const { error } = await getSupa().from('vouchers').update({ removed: 1 }).in('code', codes)
    if (error) throw dbError(error)
    return
  }
  await prisma.voucher.updateMany({ where: { code: { in: codes } }, data: { removed: 1 } })
}

// ==========================================
//  ADMINS
// ==========================================

function mapSqliteAdmin(r: {
  id: number
  username: string
  password: string
  fullname: string
  avatar: string
  email: string
  phone: string
  bio: string
  createdAt: Date
}, includePassword: boolean): AdminRow {
  const row: AdminRow = {
    id: r.id,
    username: r.username,
    fullname: r.fullname,
    avatar: r.avatar,
    email: r.email,
    phone: r.phone,
    bio: r.bio,
    created_at: r.createdAt.toISOString(),
  }
  if (includePassword) row.password = r.password
  return row
}

export async function countAdmins(): Promise<number> {
  if (usingSupabase) {
    const { count, error } = await getSupa()
      .from('admins')
      .select('*', { count: 'exact', head: true })
    if (error) throw dbError(error)
    return count || 0
  }
  return await prisma.admin.count()
}

export async function getAdminByUsername(username: string, includePassword: boolean): Promise<AdminRow | null> {
  if (usingSupabase) {
    let q = getSupa().from('admins').select('*').eq('username', username).limit(1)
    if (!includePassword) {
      q = getSupa()
        .from('admins')
        .select('id, username, fullname, avatar, email, phone, bio, created_at')
        .eq('username', username)
        .limit(1)
    }
    const { data, error } = await q
    if (error) throw dbError(error)
    const row = (data || [])[0]
    return row ? (row as unknown as AdminRow) : null
  }
  const row = await prisma.admin.findUnique({ where: { username } })
  return row ? mapSqliteAdmin(row, includePassword) : null
}

export async function insertAdmin(username: string, hashedPassword: string, fullname: string): Promise<void> {
  if (usingSupabase) {
    const { error } = await getSupa().from('admins').insert({
      username,
      password: hashedPassword,
      fullname,
    })
    if (error) throw dbError(error)
    return
  }
  await prisma.admin.create({
    data: { username, password: hashedPassword, fullname },
  })
}

export async function updateAdminProfile(
  username: string,
  patch: { fullname?: string; email?: string; phone?: string; bio?: string; avatar?: string }
): Promise<void> {
  if (usingSupabase) {
    const { error } = await getSupa().from('admins').update(patch).eq('username', username)
    if (error) throw dbError(error)
    return
  }
  await prisma.admin.update({
    where: { username },
    data: {
      ...(patch.fullname !== undefined ? { fullname: patch.fullname } : {}),
      ...(patch.email !== undefined ? { email: patch.email } : {}),
      ...(patch.phone !== undefined ? { phone: patch.phone } : {}),
      ...(patch.bio !== undefined ? { bio: patch.bio } : {}),
      ...(patch.avatar !== undefined ? { avatar: patch.avatar } : {}),
    },
  })
}

export async function updateAdminPassword(username: string, hashedPassword: string): Promise<void> {
  if (usingSupabase) {
    const { error } = await getSupa().from('admins').update({ password: hashedPassword }).eq('username', username)
    if (error) throw dbError(error)
    return
  }
  await prisma.admin.update({ where: { username }, data: { password: hashedPassword } })
}

// ==========================================
//  ROUTER CONFIG (pengganti data/router.json)
// ==========================================

const DEFAULT_ROUTER_CONF: RouterConf = {
  ip: '',
  port: '8728',
  username: '',
  password: '',
  connected: false,
}

// Konfig awal sama dengan data/router.json dari project asli
const SEED_ROUTER_CONF: RouterConf = {
  ip: '192.168.100.235',
  port: '8728',
  username: 'admin',
  password: '123',
  connected: true,
}

export async function getRouterConfig(): Promise<RouterConf> {
  if (usingSupabase) {
    const { data, error } = await getSupa().from('router_config').select('*').eq('id', 1).limit(1)
    if (error) throw dbError(error)
    const row = (data || [])[0] as Partial<RouterConf> | undefined
    if (!row) return { ...DEFAULT_ROUTER_CONF }
    return {
      ip: row.ip ?? '',
      port: row.port ?? '8728',
      username: row.username ?? '',
      password: row.password ?? '',
      connected: Boolean(row.connected),
    }
  }
  // SQLite fallback — seed sekali agar perilaku awal sama dengan repo asli
  let row = await prisma.routerConfig.findUnique({ where: { id: 1 } })
  if (!row) {
    try {
      row = await prisma.routerConfig.create({
        data: {
          id: 1,
          ip: SEED_ROUTER_CONF.ip,
          port: SEED_ROUTER_CONF.port,
          username: SEED_ROUTER_CONF.username,
          password: SEED_ROUTER_CONF.password,
          connected: SEED_ROUTER_CONF.connected,
        },
      })
    } catch {
      // Request bersamaan bisa saling seed — ambil ulang
      row = await prisma.routerConfig.findUnique({ where: { id: 1 } })
      if (!row) throw new Error('Gagal menyiapkan konfigurasi router')
    }
  }
  return {
    ip: row.ip,
    port: row.port,
    username: row.username,
    password: row.password,
    connected: row.connected,
  }
}

export async function saveRouterConfig(conf: RouterConf): Promise<void> {
  if (usingSupabase) {
    const { error } = await getSupa().from('router_config').upsert(
      {
        id: 1,
        ip: conf.ip,
        port: conf.port,
        username: conf.username,
        password: conf.password,
        connected: conf.connected,
      },
      { onConflict: 'id' }
    )
    if (error) throw dbError(error)
    return
  }
  await prisma.routerConfig.upsert({
    where: { id: 1 },
    create: {
      id: 1,
      ip: conf.ip,
      port: conf.port,
      username: conf.username,
      password: conf.password,
      connected: conf.connected,
    },
    update: {
      ip: conf.ip,
      port: conf.port,
      username: conf.username,
      password: conf.password,
      connected: conf.connected,
    },
  })
}

// ==========================================
//  STORAGE — avatar (Supabase Storage / filesystem lokal)
// ==========================================

export function isSupabaseStorage(): boolean {
  return usingSupabase
}

export function getSupabaseForStorage(): SupabaseClient | null {
  return usingSupabase ? getSupa() : null
}
