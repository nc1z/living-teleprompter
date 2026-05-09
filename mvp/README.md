# Living Teleprompter MVP

React + Vite + TypeScript foundation for the productionized MVP.

## Run The App Shell

```bash
npm install
npm run dev
```

Open:

```text
http://127.0.0.1:5173
```

The app currently loads deterministic Phase 0 fixtures from `src/teleprompter/fixtures.ts`.

## Realtime Session Endpoint

The browser must never receive `OPENAI_API_KEY`. The MVP includes a small Node server with:

```text
POST /session
GET /api/config
```

To run the built app with the backend endpoint:

```bash
cp .env.example .env
# edit .env in your shell or export the variables before running
npm run build
OPENAI_API_KEY=sk-... npm run server
```

Open:

```text
http://localhost:4173
```

Click **Start mic**, allow microphone access, and speak one short sentence. The Phase 0.5 spike should show:

- partial transcript text while you are speaking
- finalized speech in the context list
- a generated next-script paragraph from the real Realtime response
- timing logs for speech partials, finalization, request start, first generated text, usable paragraph, and visual cue receipt

Use `npm run dev` for fixture-only UI work. Use `npm run server` after `npm run build` when testing the Realtime backend path.

## Environment

```bash
OPENAI_API_KEY=sk-...
OPENAI_REALTIME_MODEL=gpt-realtime-2
OPENAI_TRANSCRIPTION_MODEL=gpt-realtime-whisper
PORT=4173
VITE_APP_CONFIG_PATH=/api/config
```

`.env` and `.env.*` are ignored. Keep real credentials out of git.

## Phase 0 Foundation

- React + Vite + TypeScript app shell.
- Baseline `dev`, `build`, `preview`, `lint`, and `server` scripts.
- Typed stream, generated paragraph, and visual cue models.
- Deterministic fixtures with typed input, generated paragraphs, and glyph scene cues.
- Browser-safe backend path for OpenAI Realtime session creation.
