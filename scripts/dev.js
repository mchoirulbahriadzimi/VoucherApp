/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * scripts/dev.js — pengganti `next dev -p 3000 2>&1 | tee dev.log`
 *
 * Perintah `tee` hanya ada di Linux/macOS, sehingga di Windows CMD muncul
 * error "'tee' is not recognized". Script ini menjalankan `next dev -p 3000`
 * secara langsung (kompatibel Windows/macOS/Linux) sekaligus tetap mencatat
 * seluruh output ke dev.log, sama seperti sebelumnya.
 */
const { spawn } = require('child_process')
const fs = require('fs')
const path = require('path')

const nextBin = require.resolve('next/dist/bin/next')
const logFile = path.join(process.cwd(), 'dev.log')
const logStream = fs.createWriteStream(logFile, { flags: 'w' })

const child = spawn(process.execPath, [nextBin, 'dev', '-p', '3000'], {
  stdio: ['inherit', 'pipe', 'pipe'],
  env: process.env,
})

function pipe(stream, out) {
  stream.on('data', (chunk) => {
    out.write(chunk)
    logStream.write(chunk)
  })
}
pipe(child.stdout, process.stdout)
pipe(child.stderr, process.stderr)

child.on('exit', (code) => {
  logStream.end()
  process.exit(code ?? 0)
})

process.on('SIGINT', () => child.kill('SIGINT'))
process.on('SIGTERM', () => child.kill('SIGTERM'))
