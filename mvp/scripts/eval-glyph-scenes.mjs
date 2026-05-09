import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const outDir = process.env.GLYPH_EVAL_OUT_DIR || '/private/tmp/living-teleprompter-glyph-eval'
const generator = process.env.GLYPH_SCENE_GENERATOR
const timeoutMs = Number(process.env.GLYPH_SCENE_TIMEOUT_MS || 120000)
const topics = [
  {
    id: 'horse',
    speech: 'I want to talk about horses running across a stage.',
    expected: 'A horse silhouette with head, body, four legs, and tail.',
  },
  {
    id: 'canned-drink',
    speech: 'Now I am showing a cold energy drink in a can.',
    expected: 'A canned drink silhouette with tall can body, rim, bottom, and shine.',
  },
  {
    id: 'plants',
    speech: 'Now I want to talk about small green plants growing from the soil.',
    expected: 'Plant silhouettes with stems, leaves, and soil or roots.',
  },
]

function fallbackScene(topic) {
  const now = new Date().toISOString()

  return {
    id: `fallback-${topic.id}`,
    cueId: `eval-${topic.id}`,
    status: 'ready',
    sourcePhrase: topic.speech,
    targetTiming: {
      paragraphIndex: 0,
      phraseMatch: topic.speech,
    },
    sceneType: 'glyph-scene',
    palette: {
      background: 'transparent',
      primary: '#111827',
      accent: '#2563eb',
      muted: '#bfdbfe',
      glyphs: ['•', '·', '✦', '◇'],
    },
    glyphMap: {
      rows: [
        '        ◇◇◇◇        ',
        '     ◇◇◇◇◇◇◇◇     ',
        '   ◇◇◇◇◇◇◇◇◇◇◇   ',
        '     ◇◇◇◇◇◇◇◇     ',
        '        ◇◇◇◇        ',
      ],
      color: '#111827',
      accent: '#2563eb',
      scale: 1,
    },
    clusters: [],
    mood: 'abstract',
    creatures: ['fallback-generated-shape'],
    forceFields: [],
    speechMappings: {
      volume: 'particle energy',
      pace: 'flow speed',
      emphasis: 'speech pulse radius',
      topicShift: 'scene retarget vortex',
    },
    reducedMotion: false,
    createdAt: now,
    updatedAt: now,
  }
}

function scenePrompt(topic, fallback) {
  return [
    'Generate one dynamic glyph scene config for a live speech-driven teleprompter.',
    'Return JSON only. Do not wrap it in markdown. Do not include commentary.',
    'Do not create an image. Do not use fixed assets. Infer the visual form from the topic.',
    'The result will be rendered as animated glyph particles, so the object silhouette must be clear from glyphMap.rows.',
    'Use only this JSON schema:',
    '{"id":"string","cueId":"string","status":"ready","sourcePhrase":"string","targetTiming":{"paragraphIndex":0,"phraseMatch":"string"},"sceneType":"glyph-scene","palette":{"background":"transparent","primary":"#hex","accent":"#hex","muted":"#hex","glyphs":["string"]},"glyphMap":{"rows":["string"],"color":"#hex","accent":"#hex","scale":1},"clusters":[],"mood":"abstract","creatures":["semantic-name"],"forceFields":[],"speechMappings":{"volume":"particle energy","pace":"flow speed","emphasis":"speech pulse radius","topicShift":"scene retarget vortex"},"reducedMotion":false,"createdAt":"iso","updatedAt":"iso"}',
    'Requirements for glyphMap.rows:',
    '- 18 to 28 rows.',
    '- 36 to 68 columns.',
    '- Spaces are transparent.',
    '- Use glyph density to make a readable silhouette.',
    '- Include distinctive object parts, not just an abstract blob.',
    '- It must pass visual QA by screenshot.',
    '',
    `Speech/topic: ${topic.speech}`,
    `Expected readable result: ${topic.expected}`,
    `Fallback base config: ${JSON.stringify(fallback)}`,
  ].join('\n')
}

function execGenerator(command, args, prompt, outputPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    const timeout = setTimeout(() => {
      child.kill('SIGTERM')
    }, timeoutMs)

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
    child.on('close', async (code, signal) => {
      clearTimeout(timeout)

      if (code !== 0) {
        reject(new Error(`Generator exited ${code ?? signal}${stderr ? `\n${stderr}` : ''}`))
        return
      }

      if (outputPath) {
        try {
          resolve(await readFile(outputPath, 'utf8'))
          return
        } catch {
          // Fall through to stdout parsing.
        }
      }

      resolve(stdout)
    })
    child.stdin.end(prompt)
  })
}

function parseFirstJsonObject(value) {
  const start = value.indexOf('{')
  const end = value.lastIndexOf('}')

  if (start === -1 || end === -1 || end <= start) {
    throw new Error('Generator did not return a JSON object.')
  }

  return JSON.parse(value.slice(start, end + 1))
}

function validRows(rows) {
  return (
    Array.isArray(rows) &&
    rows.length >= 12 &&
    rows.some((row) => String(row).replace(/\s/g, '').length >= 10)
  )
}

function normalizeScene(candidate, fallback) {
  if (!candidate || typeof candidate !== 'object') return fallback

  const rows = candidate.glyphMap?.rows

  if (!validRows(rows)) return fallback

  return {
    ...fallback,
    ...candidate,
    status: 'ready',
    palette: {
      ...fallback.palette,
      ...(candidate.palette || {}),
      glyphs: Array.isArray(candidate.palette?.glyphs)
        ? candidate.palette.glyphs.slice(0, 16).map(String)
        : fallback.palette.glyphs,
    },
    glyphMap: {
      rows: rows.slice(0, 32).map((row) => String(row).slice(0, 80)),
      color: String(candidate.glyphMap.color || candidate.palette?.primary || fallback.palette.primary),
      accent: String(candidate.glyphMap.accent || candidate.palette?.accent || fallback.palette.accent),
      scale: Number.isFinite(Number(candidate.glyphMap.scale))
        ? Number(candidate.glyphMap.scale)
        : 1,
    },
    clusters: Array.isArray(candidate.clusters) ? candidate.clusters : [],
    updatedAt: new Date().toISOString(),
  }
}

function encodeScene(scene) {
  return Buffer.from(JSON.stringify(scene), 'utf8').toString('base64url')
}

async function generateTopic(topic) {
  const fallback = fallbackScene(topic)
  const prompt = scenePrompt(topic, fallback)
  const outputPath = join(outDir, `${topic.id}.raw.txt`)
  const args =
    generator === 'claude'
      ? ['-p']
      : ['exec', '--output-last-message', outputPath, '-']

  const raw = await execGenerator(
    generator === 'claude' ? 'claude' : generator,
    args,
    prompt,
    outputPath,
  )
  const parsed = parseFirstJsonObject(String(raw))
  const scene = normalizeScene(parsed, fallback)
  const scenePath = join(outDir, `${topic.id}.scene.json`)

  await writeFile(scenePath, `${JSON.stringify(scene, null, 2)}\n`)

  return {
    ...topic,
    scenePath,
    rawPath: outputPath,
    url: `http://127.0.0.1:5173/?evalScene=${encodeScene(scene)}`,
  }
}

await mkdir(outDir, { recursive: true })

if (!generator || ['off', 'none', 'disabled', 'false', '0'].includes(generator.toLowerCase())) {
  console.error(
    'Set GLYPH_SCENE_GENERATOR=codex or GLYPH_SCENE_GENERATOR=claude to run this paid eval.',
  )
  process.exit(1)
}

const results = []

for (const topic of topics) {
  console.log(`Generating ${topic.id} with ${generator}...`)
  results.push(await generateTopic(topic))
}

const manifestPath = join(outDir, 'manifest.json')

await writeFile(manifestPath, `${JSON.stringify({ outDir, generator, results }, null, 2)}\n`)
console.log(`Wrote ${manifestPath}`)
for (const result of results) {
  console.log(`${result.id}: ${result.url}`)
}
