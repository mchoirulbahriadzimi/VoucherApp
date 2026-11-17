import { PrismaClient } from '@prisma/client'
import path from 'path'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

/**
 * Prisma mengubah path relatif SQLite terhadap lokasi schema (folder prisma/)
 * saat runtime, bukan terhadap folder project. Akibatnya .env portabel seperti
 * `DATABASE_URL=file:./db/custom.db` gagal dibuka bila project dijalankan dari
 * folder lain. Agar .env tetap portabel (dan fallback SQLite lokal berfungsi
 * di komputer mana pun), path relatif diubah ke absolut berdasarkan CWD.
 * Mode Supabase (production/Vercel) tidak terpengaruh — URL postgres diteruskan apa adanya.
 */
function resolveSqliteUrl(url: string | undefined): string | undefined {
  if (!url) return url
  if (/^file:(\.\/|\.\.\/)/.test(url)) {
    // .replace(/\\/g, '/') agar aman di Windows (path memakai backslash)
    return 'file:' + path.resolve(process.cwd(), url.slice(5)).replace(/\\/g, '/')
  }
  return url
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ['query'],
    datasources: {
      db: { url: resolveSqliteUrl(process.env.DATABASE_URL || 'file:./db/custom.db') },
    },
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
