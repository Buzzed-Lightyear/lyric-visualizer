# Preset tagging rubric

You are tagging MilkDrop/butterchurn visualizer presets for a music
visualizer. For each preset you get a 4-frame strip image (left to
right: QUIET part, LOUD part, ON A BEAT, LATER) and its measured
numbers. **Judge from the pixels.** The preset name is an ID only —
never infer anything from it.

## Output, per preset

```json
{
  "<preset name exactly as given>": {
    "description": "One plain sentence saying what it looks like.",
    "axes": { "arousal": 0.0, "valence": 0.0, "tension": 0.0, "warmth": 0.0 },
    "imagery": ["tag", "..."],
    "quality": 3
  }
}
```

## Axes (each 0..1)

- **arousal** — calm (0) to intense (1). Slow drifting shapes ≈ 0.2;
  explosive strobing motion ≈ 0.9. The measured `motion` and
  `beatResponse` numbers help.
- **valence** — dark and heavy (0) to bright and uplifting (1). Murky
  reds and blacks ≈ 0.2; luminous airy pastels ≈ 0.8.
- **tension** — smooth (0) to harsh or chaotic (1). Soft gradients and
  flowing curves ≈ 0.2; jagged, noisy, glitchy ≈ 0.8.
- **warmth** — cool (0) to warm (1). Blues and cyans ≈ 0.2; reds,
  oranges, ambers ≈ 0.8. Mixed or neutral ≈ 0.5.

## Imagery tags (1-4, from this list ONLY)

fire, plasma, water, ocean, rain, liquid, smoke, fog, space, stars,
nebula, tunnel, city, grid, geometric, crystal, glass, organic, flower,
light-rays, glow, lightning, storm, spiral, waveform, particles, ribbons

Pick what it *evokes*, most dominant first. A kaleidoscope of sharp
shards is `geometric, crystal`; drifting dots on black are
`particles, stars` or `particles, space`.

## Quality (1-5)

How striking it is as a music-visual: 5 = gorgeous, would use anywhere;
3 = fine; 1 = broken-looking, ugly, or near-featureless. Judge the
whole strip; a preset that only looks good in one frame is a 2-3.
