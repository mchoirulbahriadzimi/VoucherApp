/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * scripts/postbuild.js — pengganti `cp -r .next/static .next/standalone/.next/ && cp -r public .next/standalone/`
 *
 * Perintah `cp` hanya ada di Linux/macOS, sehingga `npm run build` gagal di
 * Windows. Script ini melakukan penyalinan yang sama memakai Node.js API
 * (fs.cpSync) sehingga kompatibel Windows/macOS/Linux. Tahap ini diperlukan
 * untuk menjalankan mode standalone (`npm start`) secara mandiri; di Vercel
 * tahap ini tidak berpengaruh karena Vercel menangani output build sendiri.
 */
const fs = require('fs')
const path = require('path')

const root = process.cwd()
const standaloneDir = path.join(root, '.next', 'standalone')

if (!fs.existsSync(standaloneDir)) {
  console.log('Standalone output tidak ditemukan — melewati langkah penyalinan.')
  process.exit(0)
}

fs.cpSync(path.join(root, '.next', 'static'), path.join(standaloneDir, '.next', 'static'), {
  recursive: true,
})
fs.cpSync(path.join(root, 'public'), path.join(standaloneDir, 'public'), { recursive: true })

console.log('Standalone output siap: .next/standalone/server.js')
