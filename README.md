# Living Teleprompter

An unplanned demo machine. The presenter speaks, the audience sees a living page.

Speech streams into a focused teleprompter display. The system generates the next paragraph of script in real time. Animated glyph visuals react to speech. The audience sees a page that stays alive throughout the talk.

See `BACKGROUND.md` for how the POC was built, how GPT Realtime-2 works in this context, and the feasibility findings.

## Requirements

- Node.js 20+
- OpenAI API key with Realtime API access
- A small backend endpoint for ephemeral token minting (the browser must not hold the raw API key)

## Running Locally

```bash
npm install
npm run dev
```

Set `OPENAI_API_KEY` in your environment before starting the backend.

## Project Docs

| File | Purpose |
|---|---|
| `BACKGROUND.md` | POC findings, how Realtime works, feasibility verdict |
| `PRD.md` | Product requirements and phase definitions |
| `PLAN.md` | Implementation plan and build order |
| `LEARNINGS.md` | Technical learnings from the POC |
| `ANIMATE-HOW-TO.md` | Glyph animation engine design guide |

## Status

POC complete. Full implementation in progress per `PLAN.md`.
