-- ============================================================
-- VoucherApp — Supabase Setup SQL
-- ============================================================
-- Jalankan SELURUH file ini di Supabase Dashboard:
--   https://supabase.com/dashboard  → pilih project → SQL Editor → New query
--   → paste seluruh isi file ini → Run
--
-- Schema ini identik dengan database MySQL voucher_db asli:
-- - vouchers      : data voucher hotspot (sinkron dengan MikroTik)
-- - admins        : akun admin web
-- - router_config : konfigurasi koneksi router (pengganti data/router.json)
-- ============================================================

-- =========================
-- TABEL VOUCHERS
-- =========================
create table if not exists public.vouchers (
    id           bigserial primary key,
    code         varchar(100) not null unique,
    password     varchar(100) not null default '',
    profile      varchar(100) not null default 'default',
    uptime       varchar(50)  not null default '0s',
    disabled     varchar(10)  not null default 'false',
    limit_uptime varchar(50)  not null default '',
    comment      varchar(500) default '',
    removed      smallint     not null default 0,
    expired      varchar(10)  not null default 'false',
    created_at   timestamptz  default now()
);

create index if not exists idx_vouchers_code     on public.vouchers (code);
create index if not exists idx_vouchers_profile  on public.vouchers (profile);
create index if not exists idx_vouchers_disabled on public.vouchers (disabled);
create index if not exists idx_vouchers_removed  on public.vouchers (removed);

-- =========================
-- TABEL ADMINS
-- =========================
create table if not exists public.admins (
    id         bigserial primary key,
    username   varchar(50)  not null unique,
    password   varchar(255) not null,
    fullname   varchar(100) default '',
    avatar     varchar(500) default '',
    email      varchar(100) default '',
    phone      varchar(30)  default '',
    bio        varchar(500) default '',
    created_at timestamptz  default now()
);

create index if not exists idx_admins_username on public.admins (username);

-- =========================
-- TABEL ROUTER_CONFIG
-- =========================
create table if not exists public.router_config (
    id        smallint primary key default 1,
    ip        varchar(100) default '',
    port      varchar(10)  default '8728',
    username  varchar(100) default '',
    password  varchar(100) default '',
    connected boolean      default false
);

-- Seed konfig awal (sama dengan data/router.json dari project asli).
-- Silakan ubah lewat halaman Setting di web app.
insert into public.router_config (id, ip, port, username, password, connected)
values (1, '192.168.100.235', '8728', 'admin', '123', true)
on conflict (id) do nothing;

-- ============================================================
-- ROW LEVEL SECURITY
-- Aplikasi berkomunikasi memakai SUPABASE_SERVICE_ROLE_KEY dari
-- server (API routes), sehingga tidak terpengaruh RLS.
-- RLS diaktifkan TANPA policy publik agar tabel terkunci dari
-- akses anon/key publik — hanya service role yang bisa akses.
-- ============================================================
alter table public.vouchers      enable row level security;
alter table public.admins        enable row level security;
alter table public.router_config enable row level security;

-- ============================================================
-- SELESAI — langkah berikutnya:
-- 1. Buat bucket Storage publik bernama "avatars" (bisa juga dibuat
--    otomatis oleh aplikasi saat upload pertama).
--    Supabase Dashboard → Storage → New bucket → name: avatars → Public: ON
-- 2. Ambil kredensial:
--    Settings → API → Project URL        → NEXT_PUBLIC_SUPABASE_URL
--    Settings → API → service_role secret→ SUPABASE_SERVICE_ROLE_KEY
-- 3. Set kedua variable tersebut di Vercel (Project → Settings →
--    Environment Variables), lalu redeploy.
-- ============================================================
