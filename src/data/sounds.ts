/**
 * Sound effect names. Pure data so the network layer can validate them without
 * pulling in the browser-only audio player.
 */
export const SOUND_NAMES = [
  'eat-apple',
  'pop',
  'bite',
  'power-up',
  'win',
  'lose',
  'click',
] as const

export type SoundName = (typeof SOUND_NAMES)[number]
