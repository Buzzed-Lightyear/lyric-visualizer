import { describe, expect, it } from 'vitest'
import { generateSemantics, extractionInput } from '../scripts/generateSemantics'
import {
  buildLookOnlyPrompt,
  buildPresetPrompt,
  choosePresets,
  libraryLook,
  scorerPresets,
  sectionsByLabel,
  withLook,
  writeLookOnly,
  type PresetChoiceInput,
} from './lookGen'
import type { LyricLine } from './lrc'
import { pickForSections, presetSetProblems, type CatalogEntry, type Feedback } from './presetPick'
import { parseSemantics, type SemanticSection } from './semantics'
import {
  extractSemantics,
  MAX_ATTEMPTS,
  SemanticsOutputSchema,
  stripNulls,
  type Ask,
} from './semanticsGen'

// Everything here is made up: the song, its lyrics, the presets, the model.

const entry = (over: Partial<CatalogEntry> = {}): CatalogEntry => ({
  slug: 'x',
  colors: [[120, 40, 40]],
  brightness: 0.3,
  saturation: 0.5,
  motion: 0.05,
  detail: 0.05,
  beatResponse: 0.4,
  flicker: 0.05,
  readability: 0.6,
  costMs: 2,
  flags: [],
  description: 'a fake preset',
  axes: { arousal: 0.5, valence: 0.5, tension: 0.5, warmth: 0.5 },
  imagery: ['fire'],
  quality: 3,
  ...over,
})

const CATALOG: Record<string, CatalogEntry> = {
  'amber drift': entry({ description: 'Slow amber dust drifting.', quality: 5, colors: [[224, 160, 64]] }),
  'blue grid': entry({ description: 'A cold blue grid.', quality: 4 }),
  'red bloom': entry({ description: 'Red petals blooming.', quality: 3 }),
  'grey fog': entry({ description: 'Grey fog rolling.', quality: 2 }),
  'white flash': entry({ description: 'Hard white flashes.', flags: ['strobe'] }),
  'dead screen': entry({ description: 'Nothing.', flags: ['blank'] }),
  'owner hates this': entry({ description: 'Banned by the owner.' }),
}

const FEEDBACK: Feedback = { chosen: {}, banned: ['owner hates this'] }

const section = (label: string, start: number, over: Partial<SemanticSection> = {}): SemanticSection => ({
  start,
  end: start + 10,
  label,
  energy: 0.5,
  mood: 'weightless, patient',
  axes: { arousal: 0.3, valence: 0.6, tension: 0.2, warmth: 0.4 },
  palette: ['#0a0c12', '#5a6b8f', '#9aa7bf'],
  imagery: ['folded paper'],
  scene: 'Paper shapes hang in the dark.',
  voice: 'main',
  ...over,
})

const SECTIONS = [section('verse', 0), section('chorus', 10, { energy: 0.8 }), section('verse', 20)]

const input = (over: Partial<PresetChoiceInput> = {}): PresetChoiceInput => ({
  title: 'Paper Planets',
  artist: 'The Invented Band',
  look: {
    description: 'Paper craft drifting through a cold blue room.',
    palette: ['#0a0c12', '#5a6b8f', '#9aa7bf', '#e8eef8'],
    voices: { main: 'air', accent: 'slab' },
  },
  sections: SECTIONS,
  feedback: FEEDBACK,
  library: [],
  ...over,
})

/** A scripted model: hands out the given answers in order and records the prompts. */
function fakeModel(answers: unknown[]): { ask: Ask; prompts: string[] } {
  const prompts: string[] = []
  const ask: Ask = async (prompt) => {
    prompts.push(prompt)
    const answer = answers[Math.min(prompts.length - 1, answers.length - 1)]
    if (answer instanceof Error) throw answer
    if (typeof answer === 'object' && answer !== null && 'errors' in answer) {
      return { errors: (answer as { errors: string[] }).errors }
    }
    return { raw: answer }
  }
  return { ask, prompts }
}

const choice = (presets: Record<string, string>) => ({
  presets: Object.entries(presets).map(([label, preset]) => ({ label, preset })),
})

describe('the preset prompt', () => {
  const prompt = buildPresetPrompt(
    input({
      library: [
        {
          title: 'Static Garden',
          artist: 'Fixture Ensemble',
          description: 'Plastic flowers under television snow.',
          presets: { verse: 'grey fog', chorus: 'red bloom' },
        },
        { title: 'Older Song', artist: 'Someone', description: null, presets: { intro: 'blue grid' } },
      ],
    }),
    CATALOG,
  )

  it('shows the model every preset that may play, and none that may not', () => {
    for (const name of ['amber drift', 'blue grid', 'red bloom', 'grey fog']) {
      expect(prompt).toContain(`{"name":"${name}"`)
    }
    for (const name of ['white flash', 'dead screen', 'owner hates this']) {
      expect(prompt).not.toContain(`"name":"${name}"`)
    }
  })

  it('gives name, description, axes, imagery and colors — and no scores', () => {
    expect(prompt).toContain(
      '{"name":"amber drift","description":"Slow amber dust drifting.","axes":[0.5,0.5,0.5,0.5],"imagery":["fire"],"colors":["#e0a040"]}',
    )
    for (const field of ['quality', 'readability', 'brightness', 'flicker', 'costMs']) {
      expect(prompt).not.toContain(field)
    }
  })

  it('carries the song: its look, its section order and one entry per label', () => {
    expect(prompt).toContain('Paper craft drifting through a cold blue room.')
    expect(prompt).toContain('main air, accent slab')
    expect(prompt).toContain('verse -> chorus -> verse')
    expect(prompt.match(/^- "verse":/gm)).toHaveLength(1)
    expect(prompt).toContain('scene: Paper shapes hang in the dark.')
    expect(sectionsByLabel(SECTIONS).map((s) => s.label)).toEqual(['verse', 'chorus'])
  })

  it('shows the library and asks for an identity of its own', () => {
    expect(prompt).toContain('"Static Garden" by Fixture Ensemble')
    expect(prompt).toContain('Plastic flowers under television snow.')
    expect(prompt).toContain('presets: "grey fog", "red bloom"')
    expect(prompt).toContain('(none written yet)')
    expect(prompt).toMatch(/its\s+own identity/)
  })

  it("tells the model about the owner's saved choices", () => {
    const withSaved = buildPresetPrompt(
      input({ feedback: { chosen: { chorus: 'red bloom', 'not in song': 'grey fog' }, banned: [] } }),
      CATALOG,
    )
    expect(withSaved).toContain('- "chorus": red bloom')
    expect(withSaved).not.toContain('not in song')
    expect(prompt).not.toContain('fixed these by hand')
  })
})

describe('choosePresets (mocked model)', () => {
  it("takes the model's set when it passes the guardrails", async () => {
    const model = fakeModel([choice({ verse: 'grey fog', chorus: 'red bloom' })])
    const result = await choosePresets(input(), model.ask, () => {}, CATALOG)
    expect(result).toEqual({
      presets: { verse: 'grey fog', chorus: 'red bloom' },
      from: 'model',
      problems: [],
    })
    expect(model.prompts).toHaveLength(1)
  })

  it('retries an invalid set, quoting the problems back', async () => {
    const model = fakeModel([
      choice({ verse: 'Grey Fog', chorus: 'white flash' }), // wrong name; strobing
      choice({ verse: 'grey fog', chorus: 'grey fog' }), // one preset, two labels
      choice({ verse: 'grey fog', chorus: 'amber drift' }),
    ])
    const result = await choosePresets(input(), model.ask, () => {}, CATALOG)
    expect(result.from).toBe('model')
    expect(result.presets).toEqual({ verse: 'grey fog', chorus: 'amber drift' })
    expect(model.prompts).toHaveLength(3)
    expect(model.prompts[1]).toContain('"Grey Fog" (for "verse") is not a preset in the list')
    expect(model.prompts[1]).toContain('"white flash" (for "chorus") is flagged strobe')
    expect(model.prompts[2]).toContain('"grey fog" is chosen for both "verse" and "chorus"')
    // Each retry restarts from the base prompt: old problems do not pile up.
    expect(model.prompts[2]).not.toContain('Grey Fog')
  })

  it('refuses banned presets, missing labels and labels listed twice', async () => {
    const model = fakeModel([
      choice({ verse: 'owner hates this', chorus: 'red bloom' }),
      choice({ verse: 'grey fog' }),
      { presets: [{ label: 'verse', preset: 'grey fog' }, { label: 'verse', preset: 'blue grid' }, { label: 'chorus', preset: 'red bloom' }] },
    ])
    const result = await choosePresets(input(), model.ask, () => {}, CATALOG)
    expect(model.prompts[1]).toContain('is banned by the owner')
    expect(model.prompts[2]).toContain('no preset chosen for "chorus"')
    expect(result.from).toBe('scorer')
    expect(result.problems.join(' ')).toContain('"verse" is listed twice')
  })

  it('falls back to the scorer after the last invalid answer, and says so', async () => {
    const model = fakeModel([choice({ verse: 'nope', chorus: 'nope too' })])
    const logged: string[] = []
    const result = await choosePresets(input(), model.ask, (m) => logged.push(m), CATALOG)
    expect(model.prompts).toHaveLength(MAX_ATTEMPTS)
    expect(result.from).toBe('scorer')
    expect(result.problems[0]).toMatch(/"nope" \(for "verse"\) is not a preset/)
    expect(logged.join('\n')).toContain('falling back to the scorer')
    // The fallback is exactly the scorer's own automatic picks...
    const automatic = pickForSections(SECTIONS, { chosen: {}, banned: FEEDBACK.banned }, CATALOG)
    expect(result.presets).toEqual({
      verse: automatic.get('verse')!.chosen,
      chorus: automatic.get('chorus')!.chosen,
    })
    expect(result.presets).toEqual(scorerPresets(SECTIONS, FEEDBACK, CATALOG))
    // ...which are always playable.
    for (const name of Object.values(result.presets)) {
      expect(CATALOG[name].flags).toEqual([])
      expect(FEEDBACK.banned).not.toContain(name)
    }
  })

  it('falls back to the scorer when the model refuses or the call fails', async () => {
    const refused = await choosePresets(
      input(),
      fakeModel([{ errors: ['the model declined this request (stop: refusal)'] }]).ask,
      () => {},
      CATALOG,
    )
    expect(refused.from).toBe('scorer')
    expect(refused.problems).toEqual(['the model declined this request (stop: refusal)'])

    const failed = await choosePresets(input(), fakeModel([new Error('network down')]).ask, () => {}, CATALOG)
    expect(failed.from).toBe('scorer')
    expect(failed.problems).toEqual(['the model call failed: network down'])
    expect(Object.keys(failed.presets)).toEqual(['verse', 'chorus'])
  })

  it('refuses an answer of the wrong shape', async () => {
    const model = fakeModel([{ verse: 'grey fog' }, choice({ verse: 'grey fog', chorus: 'red bloom' })])
    const result = await choosePresets(input(), model.ask, () => {}, CATALOG)
    expect(result.from).toBe('model')
    expect(model.prompts[1]).toMatch(/presets: /)
  })
})

describe('libraryLook', () => {
  it('reports the presets a song actually plays: saved choice, then look, then scorer', () => {
    const look = {
      description: 'made-up look',
      palette: ['#000000', '#111111', '#222222'],
      voices: { main: 'serif' as const, accent: 'slab' as const },
      presets: { verse: 'grey fog', chorus: 'red bloom' },
    }
    const feedback: Feedback = { chosen: { chorus: 'blue grid' }, banned: [] }
    expect(libraryLook({ title: 'T', artist: 'A' }, SECTIONS, look, feedback, CATALOG)).toEqual({
      title: 'T',
      artist: 'A',
      description: 'made-up look',
      presets: { verse: 'grey fog', chorus: 'blue grid' },
    })
    expect(libraryLook({ title: 'T', artist: 'A' }, SECTIONS, null, FEEDBACK, CATALOG).description).toBeNull()
  })
})

describe('look only (no lyrics)', () => {
  const v2Sections: SemanticSection[] = [
    { start: 0, end: 10, label: 'verse', energy: 0.4, mood: 'calm', palette: ['#0a0c14', '#5aa7c7', '#cfe4f0'], imagery: ['stars'] },
    { start: 10, end: 20, label: 'lift', energy: 0.7, mood: 'suspended', palette: ['#0c1020', '#d9a441', '#f0e3c0'], imagery: ['night-sky'] },
  ]
  const lookInput = { title: 'Paper Planets', artist: 'The Invented Band', durationSec: 20, sections: v2Sections }
  const draft = {
    description: 'Paper craft drifting through a cold blue room.',
    palette: ['#0a0c14', '#5aa7c7', '#cfe4f0', '#d9a441'],
    voices: { main: 'air', accent: 'slab' },
  }

  it('builds a prompt from title, artist and sections alone', () => {
    const prompt = buildLookOnlyPrompt(lookInput)
    expect(prompt).toContain('"Paper Planets" by The Invented Band, 20 seconds')
    expect(prompt).toContain('- 0.0-10.0s "verse": energy 0.4; mood "calm"; palette #0a0c14 #5aa7c7 #cfe4f0; imagery stars')
    expect(prompt).toContain('The lyrics are not available here.')
    expect(prompt).toContain('  whisper: ')
  })

  it('retries a look the parser refuses', async () => {
    const model = fakeModel([
      { ...draft, voices: { main: 'air', accent: 'air' } },
      { ...draft, palette: ['#0a0c14', 'blue'] },
      draft,
    ])
    const result = await writeLookOnly(lookInput, model.ask)
    expect(result.look).toEqual(draft)
    expect(model.prompts[1]).toContain('two different voices')
    expect(model.prompts[2]).toContain('"palette" must be 3-6 hex colors')
  })

  it('gives up without a look after the last invalid answer', async () => {
    const result = await writeLookOnly(lookInput, fakeModel([{ ...draft, description: '' }]).ask)
    expect(result.look).toBeNull()
    expect(result.errors.join(' ')).toContain('"description" must be 1-3 sentences')
  })

  it('puts a look on a version 2 file without touching its sections or lines', () => {
    const v2 = { version: 2, sections: v2Sections, lines: [{ time: 1, emphasis: 0.6, focus: [0] }] }
    const next = withLook(v2, { ...draft, voices: { main: 'air', accent: 'slab' }, presets: { verse: 'grey fog', lift: 'red bloom' }, presetsFrom: 'model', source: 'agent', partial: true })
    const { semantics, errors } = parseSemantics(next)
    expect(errors).toEqual([])
    expect(semantics!.sections).toEqual(parseSemantics(v2).semantics!.sections)
    expect(semantics!.lines).toEqual(parseSemantics(v2).semantics!.lines)
    expect(semantics!.look!.partial).toBe(true)
    expect(presetSetProblems(semantics!.look!.presets, ['verse', 'lift'], FEEDBACK, CATALOG)).toEqual([])
  })
})

// --- the whole add-song generation, model mocked ---------------------------------

const LYRICS: LyricLine[] = [
  { time: 2, text: 'fold the paper planes tonight' },
  { time: 6, text: 'send them out across the wire' },
  { time: 12, text: 'every window burns a little brighter' },
  { time: 16, text: 'nobody is counting anymore' },
  { time: 22, text: 'fold the paper planes tonight' },
  { time: 26, text: 'watch the little giants fall' },
]

const modelSemantics = (over: { scene?: string; mood?: string } = {}) => ({
  version: 3,
  look: {
    description: 'Paper craft drifting through a cold blue room.',
    palette: ['#0a0c12', '#5a6b8f', '#9aa7bf', '#e8eef8'],
    voices: { main: 'air', accent: 'slab' },
  },
  sections: [
    { start: 0, end: 10, label: 'verse', energy: 0.4, mood: over.mood ?? 'weightless, patient', axes: { arousal: 0.3, valence: 0.6, tension: 0.2, warmth: 0.4 }, palette: ['#0a0c12', '#5a6b8f', '#9aa7bf'], imagery: ['folded paper'], scene: over.scene ?? 'Paper shapes hang in the dark.', voice: 'main' },
    { start: 10, end: 20, label: 'chorus', energy: 0.8, mood: 'lit from inside', axes: { arousal: 0.7, valence: 0.7, tension: 0.4, warmth: 0.7 }, palette: ['#12100a', '#e0a040', '#f4e2b8'], imagery: ['lit windows'], scene: 'A whole street of windows comes on at once.', voice: 'accent' },
    { start: 20, end: 30, label: 'verse', energy: 0.4, mood: over.mood ?? 'weightless, patient', axes: { arousal: 0.3, valence: 0.6, tension: 0.2, warmth: 0.4 }, palette: ['#0a0c12', '#5a6b8f', '#9aa7bf'], imagery: ['folded paper'], scene: over.scene ?? 'Paper shapes hang in the dark.', voice: 'main' },
  ],
  lines: [
    { time: 2, emphasis: 0.5, focus: [2], gesture: 'drift', direction: null },
    { time: 6, emphasis: 0.5, focus: [5], gesture: null, direction: null },
    { time: 12, emphasis: 0.9, focus: [2], gesture: 'swell', direction: null },
    { time: 16, emphasis: 0.6, focus: [0], gesture: null, direction: null },
    { time: 22, emphasis: 0.5, focus: null, gesture: null, direction: null },
    { time: 26, emphasis: 0.7, focus: [4], gesture: null, direction: null },
  ],
})

describe('extractSemantics (mocked model, made-up lyrics)', () => {
  const extraction = extractionInput('Paper Planets', 'The Invented Band', 30, LYRICS)

  it('returns a valid version 3 document whose presets are still to choose', async () => {
    const model = fakeModel([modelSemantics()])
    const { doc, errors } = await extractSemantics(extraction, LYRICS, model.ask)
    expect(errors).toEqual([])
    expect(doc!.version).toBe(3)
    expect(doc!.look.presets).toEqual({})
    const { semantics } = parseSemantics(doc)
    expect(semantics!.sections[1].voice).toBe('accent')
    expect(semantics!.sections[0].mood).toBe('weightless, patient')
    expect(semantics!.lines[4]).toEqual({ time: 22, emphasis: 0.5 })
  })

  it('sends free text that quotes the lyrics back for another try', async () => {
    const model = fakeModel([
      modelSemantics({ scene: 'We fold the paper planes tonight and wait.' }),
      modelSemantics(),
    ])
    const { doc } = await extractSemantics(extraction, LYRICS, model.ask)
    expect(doc).not.toBeNull()
    expect(model.prompts).toHaveLength(2)
    expect(model.prompts[1]).toContain('repeats 4+ words in a row from the lyric line at 2s')
  })

  it('writes nothing after the last invalid answer', async () => {
    const model = fakeModel([modelSemantics({ mood: 'm'.repeat(60) })])
    const { doc, errors } = await extractSemantics(extraction, LYRICS, model.ask)
    expect(doc).toBeNull()
    expect(model.prompts).toHaveLength(MAX_ATTEMPTS)
    expect(errors.join(' ')).toContain('"mood" must be at most 48 characters')
  })
})

describe('generateSemantics: the look first, then the scenes', () => {
  const extraction = extractionInput('Paper Planets', 'The Invented Band', 30, LYRICS)
  const context = { feedback: { chosen: {}, banned: [] }, library: [] }
  // The real catalog is in play here, so the mocked model picks real names.
  const real = scorerPresets(
    parseSemantics(stripNulls(SemanticsOutputSchema.parse(modelSemantics()))).semantics!.sections,
    context.feedback,
  )

  it('asks for the scenes with the written look in hand', async () => {
    const picked = { verse: real.chorus, chorus: real.verse } // any two distinct usable names
    const model = fakeModel([modelSemantics(), choice(picked)])
    const result = await generateSemantics(extraction, LYRICS, context, () => {}, model.ask)
    expect(model.prompts).toHaveLength(2)
    expect(model.prompts[0]).toContain('0:fold 1:the 2:paper')
    // The second call carries the look and no lyrics.
    expect(model.prompts[1]).toContain('Paper craft drifting through a cold blue room.')
    expect(model.prompts[1]).not.toContain('paper planes tonight')
    expect(result.doc!.look.presets).toEqual(picked)
    expect(result.doc!.look.presetsFrom).toBe('model')
    expect(parseSemantics(result.doc).errors).toEqual([])
  })

  it('records the scorer fallback in the file', async () => {
    const model = fakeModel([modelSemantics(), choice({ verse: 'no such preset', chorus: 'nor this' })])
    const result = await generateSemantics(extraction, LYRICS, context, () => {}, model.ask)
    expect(model.prompts).toHaveLength(1 + MAX_ATTEMPTS)
    expect(result.doc!.look.presetsFrom).toBe('scorer')
    expect(result.doc!.look.presets).toEqual(real)
    expect(result.presets!.problems[0]).toContain('is not a preset in the list')
    const { semantics, errors } = parseSemantics(result.doc)
    expect(errors).toEqual([])
    expect(semantics!.look!.presetsFrom).toBe('scorer')
  })

  it('stops before the scenes when the semantics never validate', async () => {
    const model = fakeModel([{ errors: ['the output was cut off at max_tokens'] }])
    const result = await generateSemantics(extraction, LYRICS, context, () => {}, model.ask)
    expect(result.doc).toBeNull()
    expect(result.presets).toBeNull()
    expect(model.prompts).toHaveLength(MAX_ATTEMPTS)
  })
})
