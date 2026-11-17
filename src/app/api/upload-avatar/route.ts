/**
 * /api/upload-avatar — pengganti upload_avatar.php
 *
 * Upload foto profil admin:
 * - MODE SUPABASE  : gambar di-resize lalu diupload ke Supabase Storage bucket "avatars"
 *                    (bucket dibuat otomatis bila belum ada). URL publik disimpan di DB.
 * - MODE LOKAL     : gambar disimpan ke public/uploads/avatars (untuk preview/dev).
 *
 * Format request: POST FormData (multipart/form-data)
 * - file    : file gambar (JPG, PNG, GIF, WebP, BMP) max 10MB
 * - username: username admin
 */
import { NextRequest, NextResponse } from 'next/server'
import sharp from 'sharp'
import crypto from 'crypto'
import { mkdir, writeFile } from 'fs/promises'
import path from 'path'
import { isSupabaseStorage, getSupabaseForStorage } from '@/lib/store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp']

export async function POST(req: NextRequest) {
  try {
    let file: File | null = null
    let username = ''

    const contentType = req.headers.get('content-type') || ''
    if (contentType.includes('multipart/form-data')) {
      const fd = await req.formData()
      const f = fd.get('file')
      if (f instanceof File) file = f
      username = String(fd.get('username') ?? '').trim()
    } else {
      return NextResponse.json({ success: false, error: 'Format request tidak valid' })
    }

    if (!file || file.size === 0) {
      return NextResponse.json({ success: false, error: 'Tidak ada file yang dikirim' })
    }

    if (!username) {
      return NextResponse.json({ success: false, error: 'Username diperlukan' })
    }

    // Validasi tipe file
    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json({
        success: false,
        error: 'Format file tidak didukung. Gunakan JPG, PNG, GIF, atau WebP.',
      })
    }

    // Validasi ukuran max 10MB
    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json({ success: false, error: 'Ukuran file terlalu besar. Maksimal 10MB.' })
    }

    const inputBuffer = Buffer.from(await file.arrayBuffer())

    // Validasi bahwa file benar-benar gambar + kompress & resize (port dari GD PHP)
    // Resize ke max 256px, background putih untuk area transparan, JPEG quality 75
    let outputBuffer: Buffer
    try {
      const metadata = await sharp(inputBuffer).metadata()
      if (!metadata.width || !metadata.height) {
        return NextResponse.json({ success: false, error: 'File bukan gambar yang valid' })
      }
      outputBuffer = await sharp(inputBuffer)
        .flatten({ background: '#ffffff' })
        .resize({
          width: metadata.width >= metadata.height ? 256 : undefined,
          height: metadata.height > metadata.width ? 256 : undefined,
          fit: 'inside',
          withoutEnlargement: false,
        })
        .jpeg({ quality: 75 })
        .toBuffer()
    } catch {
      return NextResponse.json({ success: false, error: 'File bukan gambar yang valid' })
    }

    // Generate nama file unik (format sama dengan PHP)
    const safeUser = username.replace(/[^a-zA-Z0-9_\-]/g, '')
    const fileName = safeUser + '_' + Math.floor(Date.now() / 1000) + '_' + crypto.randomBytes(4).toString('hex') + '.jpg'

    // ============ MODE SUPABASE — upload ke Supabase Storage ============
    if (isSupabaseStorage()) {
      const supa = getSupabaseForStorage()
      if (!supa) {
        return NextResponse.json({ success: false, error: 'Storage tidak tersedia' })
      }

      // Pastikan bucket "avatars" ada (auto-create bila belum)
      const ensureBucket = async () => {
        try {
          const { data: buckets } = await supa.storage.listBuckets()
          const exists = (buckets || []).some((b) => b.name === 'avatars')
          if (!exists) {
            await supa.storage.createBucket('avatars', { public: true })
          }
        } catch {
          /* jika listBuckets tidak diizinkan, coba langsung upload */
        }
      }
      await ensureBucket()

      const storagePath = 'profile/' + fileName
      let uploadErr: { message: string } | null = null
      const { error } = await supa.storage
        .from('avatars')
        .upload(storagePath, outputBuffer, { contentType: 'image/jpeg', upsert: false })
      uploadErr = error

      if (uploadErr && /bucket/i.test(uploadErr.message || '')) {
        // Coba buat bucket sekali lagi lalu retry
        try {
          await supa.storage.createBucket('avatars', { public: true })
        } catch {
          /* mungkin sudah dibuat */
        }
        const { error: retryErr } = await supa.storage
          .from('avatars')
          .upload(storagePath, outputBuffer, { contentType: 'image/jpeg', upsert: false })
        uploadErr = retryErr
      }

      if (uploadErr) {
        return NextResponse.json({ success: false, error: 'Gagal upload file: ' + uploadErr.message })
      }

      const { data: urlData } = supa.storage.from('avatars').getPublicUrl(storagePath)
      const avatarUrl = urlData.publicUrl

      // Hapus avatar lama untuk user ini (cleanup) — sama seperti PHP glob+unlink
      try {
        const { data: admins } = await supa.from('admins').select('avatar').eq('username', username).limit(1)
        const oldUrl = (admins?.[0] as { avatar?: string } | undefined)?.avatar || ''
        const marker = '/storage/v1/object/public/avatars/'
        if (oldUrl.includes(marker)) {
          const oldPath = decodeURIComponent(oldUrl.substring(oldUrl.indexOf(marker) + marker.length).split('?')[0])
          if (oldPath && oldPath !== storagePath) {
            await supa.storage.from('avatars').remove([oldPath])
          }
        }
      } catch {
        /* cleanup best-effort */
      }

      return NextResponse.json({
        success: true,
        message: 'Foto profil berhasil diupload!',
        avatar_url: avatarUrl,
      })
    }

    // ============ MODE LOKAL — simpan ke public/uploads/avatars ============
    const uploadDir = path.join(process.cwd(), 'public', 'uploads', 'avatars')
    await mkdir(uploadDir, { recursive: true })
    await writeFile(path.join(uploadDir, fileName), outputBuffer)

    const avatarUrl = 'uploads/avatars/' + fileName

    return NextResponse.json({
      success: true,
      message: 'Foto profil berhasil diupload!',
      avatar_url: avatarUrl,
    })
  } catch (e) {
    return NextResponse.json({ success: false, error: (e as Error).message })
  }
}
