/**
 * Sound effect names. Pure data so the network layer can validate them without
 * pulling in the browser-only audio player.
 */
export const SOUND_NAMES = ['eat-apple', 'pop', 'bite', 'power-up', 'win', 'lose', 'click'] as const

export type SoundName = (typeof SOUND_NAMES)[number]

/**
 * A sound effect that belongs to one snake. Players only hear the effects
 * that involve their own snake, so the arena stays quiet.
 */
export interface SoundEvent {
  /** Id of the snake the effect belongs to. */
  by: string
  name: SoundName
}
