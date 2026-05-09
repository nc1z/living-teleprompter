import './App.css'
import { clientConfig } from './teleprompter/config'
import { phaseZeroFixture } from './teleprompter/fixtures'

function App() {
  const nextScript = phaseZeroFixture.generatedParagraphs[0]
  const cue = nextScript.visualCues[0]

  return (
    <main className="app-shell">
      <section className="stage" aria-labelledby="stage-title">
        <p className="stage-label">Phase 0 foundation</p>
        <h1 id="stage-title">Living teleprompter</h1>
        <p className="stage-phrase">
          <span>stable</span> presentation text
        </p>
        <p className="live-transcript">
          listening footer / partial transcript will render here
        </p>
      </section>

      <aside className="presenter-panel" aria-label="Presenter foundation">
        <section>
          <h2>Presentation brief</h2>
          <p>{phaseZeroFixture.presentationBrief}</p>
        </section>

        <section>
          <h2>Fixture input</h2>
          <ol className="chunk-list">
            {phaseZeroFixture.typedInput.map((chunk) => (
              <li key={chunk.id}>{chunk.text}</li>
            ))}
          </ol>
        </section>

        <section className="next-script">
          <h2>Generated next script</h2>
          <p>{nextScript.text}</p>
        </section>

        <section className="system-grid">
          <div>
            <h2>Realtime endpoint</h2>
            <code>{clientConfig.realtimeSessionPath}</code>
          </div>
          <div>
            <h2>Visual cue</h2>
            <code>{cue.sceneType}</code>
            <p>{cue.phrase}</p>
          </div>
        </section>
      </aside>
    </main>
  )
}

export default App
