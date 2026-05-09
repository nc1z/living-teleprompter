import http from 'node:http'
import { spawn } from 'node:child_process'
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
const GLYPH_SCENE_GENERATOR = process.env.GLYPH_SCENE_GENERATOR || 'off'
const GLYPH_SCENE_TIMEOUT_MS = Number(process.env.GLYPH_SCENE_TIMEOUT_MS || 25000)
const ASCII_ART_BASE_URL = 'https://www.asciiart.eu'

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

function execGenerator(command, args, prompt) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    const timeout = setTimeout(() => {
      child.kill('SIGTERM')
    }, GLYPH_SCENE_TIMEOUT_MS)

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.on('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })
    child.on('close', (code, signal) => {
      clearTimeout(timeout)

      if (code !== 0) {
        reject(new Error(`Generator exited ${code ?? signal}${stderr ? `\n${stderr}` : ''}`))
        return
      }

      resolve(stdout)
    })
    child.stdin.end(prompt)
  })
}

function isGlyphSceneGeneratorEnabled() {
  return !['', 'off', 'none', 'disabled', 'false', '0'].includes(
    GLYPH_SCENE_GENERATOR.toLowerCase(),
  )
}

function parseFirstJsonObject(value) {
  const start = value.indexOf('{')
  const end = value.lastIndexOf('}')

  if (start === -1 || end === -1 || end <= start) {
    throw new Error('Generator did not return a JSON object.')
  }

  return JSON.parse(value.slice(start, end + 1))
}

function decodeHtml(value) {
  return String(value || '')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
}

function stripTags(value) {
  return decodeHtml(String(value || '').replace(/<[^>]*>/g, ' '))
}

function normalizeReferenceQuery(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter((word) => word.length > 1)
    .slice(0, 5)
    .join(' ')
}

function compactAsciiArt(value) {
  const lines = decodeHtml(value)
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.replace(/\s+$/g, ''))
  const first = lines.findIndex((line) => line.trim())
  const last = lines.findLastIndex((line) => line.trim())

  if (first === -1 || last === -1) return ''

  return lines.slice(first, last + 1).slice(0, 24).join('\n')
}

async function fetchAsciiArtReference(query) {
  const normalizedQuery = normalizeReferenceQuery(query)

  if (!normalizedQuery) {
    return {
      provider: 'asciiart.eu',
      status: 'missing',
      message: 'No visual query.',
    }
  }

  const url = `${ASCII_ART_BASE_URL}/search?q=${encodeURIComponent(normalizedQuery)}`
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'living-teleprompter/0.1 visual reference comparison',
    },
  })

  if (!response.ok) {
    return {
      provider: 'asciiart.eu',
      status: 'failed',
      query: normalizedQuery,
      url,
      message: `asciiart.eu returned ${response.status}`,
    }
  }

  const html = await response.text()
  const cardPattern =
    /<div class="card art-card[\s\S]*?data-title="([^"]*)"[\s\S]*?data-artist="([^"]*)"[\s\S]*?data-height="([^"]*)"[\s\S]*?data-width="([^"]*)"[\s\S]*?<div class="art-card__ascii">([\s\S]*?)<\/div>/g
  const cards = [...html.matchAll(cardPattern)]
    .map((match) => {
      const art = compactAsciiArt(match[5])

      return {
        title: decodeHtml(match[1] || 'ASCII art'),
        artist: decodeHtml(match[2] || 'unknown'),
        height: Number(match[3] || 0),
        width: Number(match[4] || 0),
        art,
      }
    })
    .filter((card) => card.art)
    .sort((a, b) => {
      const aArea = a.width * a.height
      const bArea = b.width * b.height

      return bArea - aArea
    })

  const selected = cards[0]

  if (!selected) {
    return {
      provider: 'asciiart.eu',
      status: 'missing',
      query: normalizedQuery,
      url,
      message: 'No ASCII reference found.',
    }
  }

  return {
    provider: 'asciiart.eu',
    status: 'ready',
    query: normalizedQuery,
    title: selected.title,
    artist: selected.artist,
    art: selected.art,
    width: selected.width,
    height: selected.height,
    url,
    credit: `${selected.title} by ${selected.artist} via ASCII Art Archive`,
  }
}

async function createVisualReferences(req, res) {
  const body = JSON.parse(await readRequestBody(req))
  const query = body.visualQuery || body.topic || body.paragraph || ''
  let reference

  try {
    reference = await fetchAsciiArtReference(query)
  } catch (error) {
    reference = {
      provider: 'asciiart.eu',
      status: 'failed',
      message: error instanceof Error ? error.message : String(error),
    }
  }

  send(
    res,
    200,
    JSON.stringify({
      query: normalizeReferenceQuery(query),
      references: [reference],
    }),
    'application/json; charset=utf-8',
  )
}

function validateGeneratedScene(candidate, fallback) {
  if (!candidate || typeof candidate !== 'object') return fallback
  const hasClusters = Array.isArray(candidate.clusters) && candidate.clusters.length > 0
  const hasGlyphMap =
    Array.isArray(candidate.glyphMap?.rows) && candidate.glyphMap.rows.length > 0

  if (!hasClusters && !hasGlyphMap) return fallback

  return {
    ...fallback,
    ...candidate,
    status: 'ready',
    palette: {
      ...fallback.palette,
      ...(candidate.palette || {}),
      glyphs: Array.isArray(candidate.palette?.glyphs)
        ? candidate.palette.glyphs.slice(0, 12).map(String)
        : fallback.palette.glyphs,
    },
    glyphMap: hasGlyphMap
      ? {
          rows: candidate.glyphMap.rows
            .slice(0, 32)
            .map((row) => String(row).slice(0, 80)),
          color: String(candidate.glyphMap.color || candidate.palette?.primary || fallback.palette.primary),
          accent: String(candidate.glyphMap.accent || candidate.palette?.accent || fallback.palette.accent),
          scale: Number.isFinite(Number(candidate.glyphMap.scale))
            ? Math.max(0.4, Math.min(2.2, Number(candidate.glyphMap.scale)))
            : 1,
        }
      : fallback.glyphMap,
    clusters: (hasClusters ? candidate.clusters : fallback.clusters).slice(0, 8).map((cluster, index) => ({
      id: String(cluster.id || `cluster-${index + 1}`),
      glyphs: Array.isArray(cluster.glyphs)
        ? cluster.glyphs.slice(0, 12).map(String)
        : fallback.palette.glyphs,
      color: String(cluster.color || fallback.palette.primary),
      opacity: Number.isFinite(Number(cluster.opacity))
        ? Math.max(0.08, Math.min(0.9, Number(cluster.opacity)))
        : 0.45,
      scale: Number.isFinite(Number(cluster.scale))
        ? Math.max(0.4, Math.min(2.2, Number(cluster.scale)))
        : 1,
      weight: Number.isFinite(Number(cluster.weight))
        ? Math.max(0.02, Math.min(1, Number(cluster.weight)))
        : 0.2,
      shape: {
        type: ['ellipse', 'line', 'rect', 'spiral', 'scatter', 'rain'].includes(
          cluster.shape?.type,
        )
          ? cluster.shape.type
          : 'ellipse',
        center: {
          x: Number.isFinite(Number(cluster.shape?.center?.x))
            ? Math.max(0, Math.min(1, Number(cluster.shape.center.x)))
            : 0.5,
          y: Number.isFinite(Number(cluster.shape?.center?.y))
            ? Math.max(0, Math.min(1, Number(cluster.shape.center.y)))
            : 0.55,
        },
        radius: {
          x: Number.isFinite(Number(cluster.shape?.radius?.x))
            ? Math.max(0.02, Math.min(0.8, Number(cluster.shape.radius.x)))
            : 0.2,
          y: Number.isFinite(Number(cluster.shape?.radius?.y))
            ? Math.max(0.02, Math.min(0.8, Number(cluster.shape.radius.y)))
            : 0.16,
        },
        rotation: Number.isFinite(Number(cluster.shape?.rotation))
          ? Number(cluster.shape.rotation)
          : 0,
        turns: Number.isFinite(Number(cluster.shape?.turns))
          ? Number(cluster.shape.turns)
          : 2,
      },
    })),
    updatedAt: new Date().toISOString(),
  }
}

function buildGlyphScenePrompt({ cue, paragraph, fallback }) {
  return [
    'Generate one dynamic glyph scene config for a live speech-driven teleprompter.',
    'Return JSON only. Do not wrap it in markdown.',
    'Do not create an image. Do not include readable labels or captions.',
    'The scene must represent the actual topic semantically. Infer the visual form from the topic instead of choosing from a fixed list.',
    'Use only this schema:',
    '{"id":"string","cueId":"string","sourcePhrase":"string","sceneType":"glyph-scene","palette":{"background":"transparent","primary":"#hex","accent":"#hex","muted":"#hex","glyphs":["string"]},"glyphMap":{"rows":["string"],"color":"#hex","accent":"#hex","scale":1},"clusters":[{"id":"string","glyphs":["string"],"color":"#hex","opacity":0.45,"scale":1,"weight":0.4,"shape":{"type":"ellipse|line|rect|spiral|scatter|rain","center":{"x":0.5,"y":0.55},"radius":{"x":0.2,"y":0.16},"rotation":0,"turns":2}}],"mood":"abstract","creatures":["semantic-name"],"forceFields":[]}',
    'Most important: create glyphMap.rows as an ASCII/glyph silhouette that clearly reads as the object. Use 16-28 rows and 28-64 columns. Spaces are transparent.',
    'Use clusters only for glow, motion, shadow, or secondary details. The recognizable object should come from glyphMap.rows.',
    'Use glyphs that fit the object or scene. Prefer visual symbols and simple ASCII-like marks.',
    '',
    `Cue: ${JSON.stringify(cue || null)}`,
    `Paragraph or speech: ${JSON.stringify(paragraph || null)}`,
    `Fallback base config: ${JSON.stringify(fallback || null)}`,
  ].join('\n')
}

async function createGlyphScene(req, res) {
  const body = JSON.parse(await readRequestBody(req))
  const fallback = body.fallback

  if (!isGlyphSceneGeneratorEnabled()) {
    send(res, 200, JSON.stringify(fallback), 'application/json; charset=utf-8')
    return
  }

  const prompt = buildGlyphScenePrompt(body)
  const command =
    GLYPH_SCENE_GENERATOR === 'claude' ? 'claude' : GLYPH_SCENE_GENERATOR
  const args =
    GLYPH_SCENE_GENERATOR === 'claude' ? ['-p'] : ['exec', '-']

  try {
    const stdout = await execGenerator(command, args, prompt)
    const parsed = parseFirstJsonObject(String(stdout))
    const scene = validateGeneratedScene(parsed, fallback)

    send(res, 200, JSON.stringify(scene), 'application/json; charset=utf-8')
  } catch (error) {
    console.error('Glyph scene generation failed', {
      generator: GLYPH_SCENE_GENERATOR,
      error: error instanceof Error ? error.message : String(error),
    })
    send(res, 200, JSON.stringify(fallback), 'application/json; charset=utf-8')
  }
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
          glyphSceneGenerator: GLYPH_SCENE_GENERATOR,
        }),
        'application/json; charset=utf-8',
      )
      return
    }

    if (req.method === 'POST' && req.url === '/api/glyph-scene') {
      await createGlyphScene(req, res)
      return
    }

    if (req.method === 'POST' && req.url === '/api/visual-references') {
      await createVisualReferences(req, res)
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
  console.log(`Glyph scene generator: ${GLYPH_SCENE_GENERATOR}`)
})
