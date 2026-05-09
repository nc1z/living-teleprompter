import http from 'node:http'
import { existsSync, readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = fileURLToPath(new URL('.', import.meta.url))
const distDir = join(rootDir, 'dist')
const envPath = join(rootDir, '.env')

if (existsSync(envPath)) {
  const lines = readFileSync(envPath, 'utf8').split(/\r?\n/)

  for (const line of lines) {
    const trimmed = line.trim()

    if (!trimmed || trimmed.startsWith('#')) {
      continue
    }

    const separator = trimmed.indexOf('=')

    if (separator === -1) {
      continue
    }

    const key = trimmed.slice(0, separator).trim()
    const value = trimmed.slice(separator + 1).trim().replace(/^["']|["']$/g, '')

    if (key && process.env[key] === undefined) {
      process.env[key] = value
    }
  }
}

const PORT = Number(process.env.PORT || 4173)
const OPENAI_API_KEY = process.env.OPENAI_API_KEY
const REALTIME_MODEL = process.env.OPENAI_REALTIME_MODEL || 'gpt-realtime-2'
const TRANSCRIPTION_MODEL =
  process.env.OPENAI_TRANSCRIPTION_MODEL || 'gpt-realtime-whisper'

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.png': 'image/png',
}

function send(res, status, body, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(status, {
    'Content-Type': contentType,
    'Cache-Control': 'no-store',
  })
  res.end(body)
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = ''
    req.setEncoding('utf8')
    req.on('data', (chunk) => {
      body += chunk
    })
    req.on('end', () => resolve(body))
    req.on('error', reject)
  })
}

async function createRealtimeSession(req, res) {
  if (!OPENAI_API_KEY) {
    send(
      res,
      500,
      JSON.stringify({
        error:
          'Missing OPENAI_API_KEY. Set it in your shell before starting the MVP server.',
      }),
      'application/json; charset=utf-8',
    )
    return
  }

  const sdp = await readRequestBody(req)
  const fd = new FormData()

  const sessionConfig = {
    type: 'realtime',
    model: REALTIME_MODEL,
    instructions:
      'You are a silent live presentation planner. Do not speak out loud unless explicitly asked. When asked for a planning response, generate concise presenter script text quickly.',
    audio: {
      input: {
        transcription: {
          model: TRANSCRIPTION_MODEL,
          language: 'en',
        },
        turn_detection: {
          type: 'server_vad',
          threshold: 0.5,
          prefix_padding_ms: 300,
          silence_duration_ms: 500,
          create_response: false,
          interrupt_response: false,
        },
      },
      output: {
        voice: 'marin',
      },
    },
  }

  fd.set('sdp', sdp)
  fd.set('session', JSON.stringify(sessionConfig))

  const startedAt = Date.now()
  const upstream = await fetch('https://api.openai.com/v1/realtime/calls', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'OpenAI-Safety-Identifier': 'living-teleprompter-mvp',
    },
    body: fd,
  })

  const answer = await upstream.text()
  const elapsedMs = Date.now() - startedAt

  if (!upstream.ok) {
    console.error('Realtime session creation failed', {
      status: upstream.status,
      elapsedMs,
      answer,
    })
    send(
      res,
      upstream.status,
      JSON.stringify({
        error: 'OpenAI Realtime session creation failed',
        status: upstream.status,
        details: answer,
      }),
      'application/json; charset=utf-8',
    )
    return
  }

  console.log(
    `Realtime session created in ${elapsedMs}ms (${REALTIME_MODEL}, ${TRANSCRIPTION_MODEL})`,
  )
  send(res, 200, answer, 'application/sdp')
}

async function serveStatic(req, res) {
  const url = new URL(req.url || '/', `http://${req.headers.host}`)
  const pathname = url.pathname === '/' ? '/index.html' : url.pathname
  const filePath = join(distDir, pathname)

  if (!filePath.startsWith(distDir)) {
    send(res, 403, 'Forbidden')
    return
  }

  try {
    const file = await readFile(filePath)
    send(
      res,
      200,
      file,
      contentTypes[extname(filePath)] || 'application/octet-stream',
    )
  } catch {
    send(res, 404, 'Not found. Run npm run build before npm run server.')
  }
}

const server = http.createServer(async (req, res) => {
  try {
    if (
      req.method === 'POST' &&
      (req.url === '/session' || req.url === '/api/realtime/session')
    ) {
      await createRealtimeSession(req, res)
      return
    }

    if (req.method === 'GET' && req.url === '/api/config') {
      send(
        res,
        200,
        JSON.stringify({
          realtimeModel: REALTIME_MODEL,
          transcriptionModel: TRANSCRIPTION_MODEL,
          visualRuntime: 'canvas-glyph-particles',
        }),
        'application/json; charset=utf-8',
      )
      return
    }

    if (req.method === 'GET') {
      await serveStatic(req, res)
      return
    }

    send(res, 405, 'Method not allowed')
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected error'
    send(res, 500, JSON.stringify({ error: message }), 'application/json')
  }
})

server.listen(PORT, () => {
  console.log(`Living Teleprompter MVP server: http://localhost:${PORT}`)
  console.log(`Realtime model: ${REALTIME_MODEL}`)
  console.log(`Transcription model: ${TRANSCRIPTION_MODEL}`)
})
