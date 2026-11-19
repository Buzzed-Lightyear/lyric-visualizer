/** Minimal typings; butterchurn ships none. */
declare module 'butterchurn' {
  export interface ButterchurnAudioLevels {
    timeByteArray: Uint8Array
    timeByteArrayL: Uint8Array
    timeByteArrayR: Uint8Array
  }
  export interface ButterchurnVisualizer {
    connectAudio(node: AudioNode): void
    loadPreset(preset: object, blendTimeSec: number): void
    setRendererSize(width: number, height: number): void
    /** With audioLevels + elapsedTime, rendering is fully offline. */
    render(opts?: { elapsedTime?: number; audioLevels?: ButterchurnAudioLevels }): void
  }
  const butterchurn: {
    createVisualizer(
      context: AudioContext,
      canvas: HTMLCanvasElement,
      options: { width: number; height: number; pixelRatio?: number },
    ): ButterchurnVisualizer
  }
  export default butterchurn
}

declare module 'butterchurn-presets' {
  const presets: { getPresets(): Record<string, object> }
  export default presets
}

declare module 'butterchurn-presets/lib/butterchurnPresetsExtra.min.js' {
  const presets: { getPresets(): Record<string, object> }
  export default presets
}

declare module 'butterchurn-presets/lib/butterchurnPresetsExtra2.min.js' {
  const presets: { getPresets(): Record<string, object> }
  export default presets
}

declare module 'butterchurn-presets/lib/butterchurnPresetsMD1.min.js' {
  const presets: { getPresets(): Record<string, object> }
  export default presets
}
