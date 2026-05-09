import { spawn } from 'node:child_process'
import { mkdir, readFile, stat, unlink } from 'node:fs/promises'
import { join } from 'node:path'

const outDir = process.env.GLYPH_EVAL_OUT_DIR || '/private/tmp/living-teleprompter-glyph-eval'
const chrome =
  process.env.CHROME_PATH ||
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const manifest = JSON.parse(await readFile(join(outDir, 'manifest.json'), 'utf8'))
const screenshotDir = process.env.GLYPH_SCREENSHOT_DIR || join(outDir, 'screenshots')
const baseUrl = process.env.GLYPH_EVAL_BASE_URL

async function freshScreenshotStat(screenshotPath, startedAt) {
  const file = await stat(screenshotPath)

  if (file.mtimeMs < startedAt) {
    throw new Error(`Chrome did not refresh screenshot: ${screenshotPath}`)
  }

  return file
}

async function runChrome(url, screenshotPath) {
  const startedAt = Date.now()

  await unlink(screenshotPath).catch(() => {})

  return new Promise((resolve, reject) => {
    const child = spawn(chrome, [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-background-networking',
      '--hide-scrollbars',
      '--run-all-compositor-stages-before-draw',
      '--virtual-time-budget=10000',
      '--window-size=1280,900',
      `--user-data-dir=${join(outDir, `chrome-${Date.now()}-${Math.random()}`)}`,
      `--screenshot=${screenshotPath}`,
      url,
    ])
    let stderr = ''
    const timeout = setTimeout(async () => {
      try {
        await freshScreenshotStat(screenshotPath, startedAt)
        child.kill('SIGTERM')
        resolve()
      } catch {
        child.kill('SIGTERM')
        reject(new Error(`Chrome screenshot timed out${stderr ? `\n${stderr}` : ''}`))
      }
    }, 30000)

    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.on('error', reject)
    child.on('close', (code, signal) => {
      clearTimeout(timeout)
      if (code !== 0) {
        freshScreenshotStat(screenshotPath, startedAt)
          .then(() => resolve())
          .catch(() => reject(new Error(`Chrome exited ${code ?? signal}${stderr ? `\n${stderr}` : ''}`)))
        return
      }

      resolve()
    })
  })
}

await mkdir(screenshotDir, { recursive: true })

for (const result of manifest.results) {
  const screenshotPath = join(screenshotDir, `${result.id}.png`)
  const url = baseUrl ? `${baseUrl}${new URL(result.url).search}` : result.url

  console.log(`Capturing ${result.id} -> ${screenshotPath}`)
  await runChrome(url, screenshotPath)
}

console.log(`Screenshots: ${screenshotDir}`)
