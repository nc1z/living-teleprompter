import type { DemoFixture } from './types'

export const phaseZeroFixture: DemoFixture = {
  presentationBrief:
    'I am demoing a living teleprompter that turns improvised speech into stable presentation text and speech-reactive glyph scenes.',
  typedInput: [
    {
      id: 'typed-1',
      text: 'Today I am demoing a living teleprompter for unplanned product demos.',
      timestamp: '2026-05-09T02:00:00.000Z',
      source: 'typed',
      status: 'final',
    },
    {
      id: 'typed-2',
      text: 'The audience sees stable slide-like words while I keep speaking naturally.',
      timestamp: '2026-05-09T02:00:08.000Z',
      source: 'typed',
      status: 'final',
    },
    {
      id: 'typed-3',
      text: 'Behind the scenes the model prepares my next line and a matching glyph scene.',
      timestamp: '2026-05-09T02:00:16.000Z',
      source: 'typed',
      status: 'final',
    },
  ],
  generatedParagraphs: [
    {
      id: 'generated-1',
      sourceContextIds: ['typed-1', 'typed-2'],
      text: 'This is the core idea: I can keep talking naturally, and the screen turns that speech into a polished visual rhythm instead of a raw transcript.',
      createdAt: '2026-05-09T02:00:21.000Z',
      visualCues: [
        {
          id: 'cue-1',
          phrase: 'polished visual rhythm',
          prompt:
            'A clean wave of glyph particles forming a rhythmic presentation surface.',
          targetTiming: {
            paragraphIndex: 0,
            phraseMatch: 'polished visual rhythm',
            wordIndex: 17,
          },
          sceneType: 'glyph-scene',
          status: 'pending',
        },
      ],
    },
    {
      id: 'generated-2',
      sourceContextIds: ['typed-1', 'typed-2', 'typed-3', 'generated-1'],
      text: 'Next, the visuals become alive: forests, storms, product reveals, and tiny creatures can emerge from glyphs while the presentation keeps moving.',
      createdAt: '2026-05-09T02:00:28.000Z',
      visualCues: [
        {
          id: 'cue-2',
          phrase: 'forests, storms, product reveals',
          prompt:
            'A glyph forest grows into a storm and opens into a product reveal.',
          targetTiming: {
            paragraphIndex: 1,
            phraseMatch: 'forests, storms, product reveals',
            wordIndex: 5,
          },
          sceneType: 'force-field',
          status: 'pending',
        },
      ],
    },
  ],
}
