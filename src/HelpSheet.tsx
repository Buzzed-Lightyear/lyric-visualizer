interface HelpSheetProps {
  onClose: () => void
}

const GROUPS: { title: string; keys: [string, string][] }[] = [
  {
    title: 'Playback',
    keys: [
      ['Space', 'Play / pause'],
      ['← →', 'Seek 5 seconds'],
      ['?', 'This sheet'],
      ['Esc', 'Close this sheet'],
    ],
  },
  {
    title: 'What you see',
    keys: [
      ['L', 'Show / hide lyrics'],
      ['T', 'Physics text / plain line'],
      ['B', 'Background: butterchurn / scene / black'],
      ['G', 'Gestures and focus words on / off'],
      ['S', 'Semantics on / off (neutral look)'],
    ],
  },
  {
    title: 'Background presets',
    keys: [
      ['[ ]', 'Preview previous / next candidate for this section (not saved)'],
      ['P', 'Keep the preset on screen for this section in this song'],
      ['{ }', 'Browse the whole catalog (not saved)'],
      ['N', 'Ban the current preset everywhere'],
    ],
  },
  {
    title: 'Dev tools',
    keys: [
      ['D', 'Debug overlay'],
      ['K', 'Tuning knobs'],
      ['E H X', 'Force entrance / hold / exit'],
      ['F', 'Force type voice'],
      ['Y', 'Force layout'],
      ['1–5', 'Part combos'],
      ['0', 'Clear forced parts'],
    ],
  },
]

export function HelpSheet({ onClose }: HelpSheetProps) {
  return (
    <div className="help" data-testid="help" onClick={onClose}>
      <section
        className="help-card"
        role="dialog"
        aria-label="Keyboard shortcuts"
        onClick={(event) => event.stopPropagation()}
      >
        <h2>Keys</h2>
        <div className="help-groups">
          {GROUPS.map((group) => (
            <div key={group.title} className="help-group">
              <h3>{group.title}</h3>
              <dl>
                {group.keys.map(([key, what]) => (
                  <div key={key} className="help-row">
                    <dt>{key}</dt>
                    <dd>{what}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
