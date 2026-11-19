/**
 * All installed butterchurn preset packs (base + Extra + Extra2 + MD1),
 * loaded lazily and deduplicated by name (~395 distinct presets). The
 * committed catalog (src/presetCatalog.json) is the sync source of
 * truth for names and metadata; this module only fetches the actual
 * preset data when one needs to play.
 */

type Pack = { getPresets?: () => Record<string, object>; default?: Pack } & Record<string, unknown>

function unwrapPack(mod: unknown): Record<string, object> {
  const m = mod as Pack
  if (typeof m.getPresets === 'function') return m.getPresets()
  if (m.default) return unwrapPack(m.default)
  return m as Record<string, object>
}

let cache: Promise<Record<string, object>> | null = null

export function loadAllPresets(): Promise<Record<string, object>> {
  cache ??= Promise.all([
    import('butterchurn-presets'),
    import('butterchurn-presets/lib/butterchurnPresetsExtra.min.js'),
    import('butterchurn-presets/lib/butterchurnPresetsExtra2.min.js'),
    import('butterchurn-presets/lib/butterchurnPresetsMD1.min.js'),
  ]).then((packs) => {
    const all: Record<string, object> = {}
    for (const pack of packs) {
      for (const [name, preset] of Object.entries(unwrapPack(pack))) {
        all[name] ??= preset
      }
    }
    return all
  })
  return cache
}

export async function getPreset(name: string): Promise<object | null> {
  const all = await loadAllPresets()
  return all[name] ?? null
}
