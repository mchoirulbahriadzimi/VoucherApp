import Script from "next/script";
import { APP_HTML } from "@/lib/appHtml";

/**
 * VoucherApp — halaman SPA tunggal.
 *
 * Seluruh tampilan (HTML + CSS + JS) diambil verbatim dari index.php asli
 * sehingga sistem, tampilan, modul, dan perilaku 100% sama.
 * Perbedaan hanya pada backend:
 *  - Endpoint PHP (*.php) digantikan route API Next.js (/api/*)
 *  - Database MySQL digantikan Supabase (PostgreSQL) dengan fallback SQLite lokal
 *  - RouterOS API PHP di-port ke TypeScript (src/lib/mikrotik.ts)
 */
export default function Home() {
  return (
    <>
      {/* Markup asli VoucherApp (verbatim dari index.php) */}
      <div dangerouslySetInnerHTML={{ __html: APP_HTML }} />

      {/* Logika SPA asli (verbatim dari index.php, hanya path fetch yang diarahkan ke /api/*) */}
      <Script src="/voucher-app.js" strategy="afterInteractive" />
    </>
  );
}
