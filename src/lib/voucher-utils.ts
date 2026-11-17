/**
 * voucher-utils.ts
 *
 * Utilitas bersama — port 1:1 dari fungsi get_vouchers.php:
 * - mikrotikTimeToSeconds : konversi "1d2h30m15s" → detik
 * - calculateExpired      : hitung status expired dari uptime vs limit_uptime
 */

export function mikrotikTimeToSeconds(time: string | null | undefined): number {
  if (!time || time === '0s' || time === '0') return 0
  let seconds = 0
  const d = time.match(/(\d+)d/)
  if (d) seconds += parseInt(d[1], 10) * 86400
  const h = time.match(/(\d+)h/)
  if (h) seconds += parseInt(h[1], 10) * 3600
  const m = time.match(/(\d+)m/)
  if (m) seconds += parseInt(m[1], 10) * 60
  const s = time.match(/(\d+)s/)
  if (s) seconds += parseInt(s[1], 10)
  return seconds
}

export function calculateExpired(uptime: string | null | undefined, limitUptime: string | null | undefined): 'true' | 'false' {
  if (!limitUptime || limitUptime === '') return 'false'
  const uptimeSeconds = mikrotikTimeToSeconds(uptime)
  const limitSeconds = mikrotikTimeToSeconds(limitUptime)
  if (limitSeconds > 0 && uptimeSeconds >= limitSeconds) return 'true'
  return 'false'
}

/** Format tanggal gaya PHP date('Y-m-d H:i:s') */
export function fmtPhpDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
    ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds())
  )
}
