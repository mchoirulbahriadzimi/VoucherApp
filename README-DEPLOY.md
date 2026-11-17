# VoucherApp — Panduan Supabase + Vercel

Aplikasi ini adalah hasil konversi **1:1** dari project PHP asli (`voucher_db`) ke **Next.js 16**.
Seluruh tampilan, modul, dan perilaku sistem **tetap sama persis** — yang berubah hanya sisi backend:

| Komponen PHP asli                | Pengganti di project ini                          |
| -------------------------------- | ------------------------------------------------- |
| MySQL (`koneksi.php`)            | **Supabase (PostgreSQL)** + fallback SQLite lokal |
| `routeros_api.class.php`         | `src/lib/mikrotik.ts` (RouterOS API, TCP 8728)    |
| `data/router.json`               | Tabel `router_config` di database                 |
| `auth_api.php`                   | `src/app/api/auth/route.ts`                       |
| `api.php`                        | `src/app/api/router/route.ts`                     |
| `get_vouchers.php`               | `src/app/api/vouchers/route.ts`                   |
| `generate.php`                   | `src/app/api/generate/route.ts`                   |
| `delete.php`                     | `src/app/api/delete/route.ts`                     |
| `get_profiles.php`               | `src/app/api/profiles/route.ts`                   |
| `manage_profiles.php`            | `src/app/api/manage-profiles/route.ts`            |
| `check_hash.php`                 | `src/app/api/check-hash/route.ts`                 |
| `upload_avatar.php`              | `src/app/api/upload-avatar/route.ts`              |
| Tampilan (`index.php`)           | `src/app/page.tsx` + `src/app/voucher-app.css` + `public/voucher-app.js` (verbatim) |

---

## A. Setup Supabase (sekali saja)

1. Buat project di [https://supabase.com](https://supabase.com) (gratis).
2. Buka **Supabase Dashboard → SQL Editor → New query**.
3. Copy-paste **seluruh isi file `supabase-setup.sql`** dari project ini → klik **Run**.
   Ini akan membuat tabel `vouchers`, `admins`, `router_config` beserta index dan seed konfigurasi router.
4. Buka **Storage → New bucket**:
   - Name: `avatars`
   - **Public: ON**
   - (Bucket ini juga dibuat otomatis oleh aplikasi saat upload pertama.)
5. Ambil kredensial di **Project Settings → API**:
   - **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
   - **service_role secret** → `SUPABASE_SERVICE_ROLE_KEY`

## B. Hosting di Vercel

1. Push seluruh project ini ke GitHub / GitLab / Bitbucket.
2. Buka [https://vercel.com](https://vercel.com) → **Add New → Project** → pilih repository.
   Vercel otomatis mendeteksi Next.js (tidak perlu konfigurasi build tambahan).
3. Sebelum klik Deploy, buka **Environment Variables** dan tambahkan:

   | Variable                     | Nilai                               |
   | ---------------------------- | ----------------------------------- |
   | `NEXT_PUBLIC_SUPABASE_URL`   | URL project Supabase Anda           |
   | `SUPABASE_SERVICE_ROLE_KEY`  | service_role secret dari Supabase   |

4. Klik **Deploy**. Selesai — aplikasi live di Vercel dan semua data tersimpan di Supabase.

> Penting: `SUPABASE_SERVICE_ROLE_KEY` hanya dipakai di sisi server (API routes) dan tidak pernah dikirim ke browser.

## C. Koneksi MikroTik dari Vercel

Sama seperti versi PHP yang di-host di internet, aplikasi di Vercel harus bisa menjangkau router MikroTik lewat **API port 8728**:

- Gunakan **IP publik / DDNS** router Anda (mis. `wanip.ddns.net`), bukan IP LAN.
- Aktifkan service **API** (`/ip service enable api`) dan buka/forward port **8728** ke router.
- Amankan dengan user khusus + firewall (izinkan hanya IP Vercel bila perlu).
- Isi IP, port, username, dan password di halaman **Setting** pada aplikasi.

Jika router tidak terjangkau, aplikasi tetap berjalan normal seperti versi PHP asli:
badge **Offline/Cached**, data voucher ditampilkan dari database (fallback).

## D. Menjalankan di Lokal (development)

```bash
# 1. Tanpa Supabase (mode fallback lokal — data di SQLite):
npm install
npm run dev          # (alternatif: bun install / bun run dev)

# 2. Dengan Supabase (persis seperti production):
#    isi NEXT_PUBLIC_SUPABASE_URL & SUPABASE_SERVICE_ROLE_KEY di file .env
npm run dev
```

Pertama kali dibuka, sistem akan menampilkan halaman **pendaftaran admin** (sama seperti versi PHP saat database masih kosong).

> **Kompatibel Windows / macOS / Linux**: seluruh script (`npm run dev`, `npm run build`,
> `npm start`) memakai Node.js murni tanpa perintah Unix (`tee`/`cp`), sehingga aman
> dijalankan di Windows CMD maupun PowerShell. Cukup `npm install` lalu `npm run dev`.

## E. Data Lama (MySQL → Supabase)

Registrasi admin baru dilakukan di halaman aplikasi (password di-hash bcrypt, sama dengan PHP).
Untuk memindahkan voucher lama dari MySQL, jalankan INSERT/EXPORT-IMPORT SQL biasa —
nama kolom tabel `vouchers` di Supabase **sama persis** dengan MySQL asli.

## F. Struktur Penting

```
src/app/page.tsx                 → SPA (HTML verbatim dari index.php)
src/app/voucher-app.css          → CSS verbatim dari index.php
public/voucher-app.js            → JS verbatim dari index.php (fetch .php → /api/*)
src/lib/appHtml.ts               → HTML body (auto-generated, verbatim)
src/lib/mikrotik.ts              → RouterOS API client (port dari routeros_api.class.php)
src/lib/mikrotik-helpers.ts      → konekMikrotik / mikrotikComm (port dari mikrotik.php)
src/lib/store.ts                 → Data layer Supabase + fallback SQLite
src/lib/voucher-utils.ts         → hitung expired / konversi uptime (port get_vouchers.php)
src/app/api/*                    → Semua endpoint API (pengganti file *.php)
supabase-setup.sql               → Script pembuatan schema Supabase
```
