import type { WorldEvent } from '@/sim/types'
import type { SoundEvent, SoundName } from '@/data/sounds'

const FILES: Record<SoundName, string> = {
  'eat-apple': 'eat-apple.mp3',
  pop: 'pop.mp3',
  bite: 'bite.mp3',
  'power-up': 'power-up.mp3',
  win: 'win.mp3',
  lose: 'lose.mp3',
  click: 'click.mp3',
}

const templates = new Map<SoundName, HTMLAudioElement>()
const lastPlayed = new Map<SoundName, number>()

/** Same effect played again within this window is dropped. */
const MIN_GAP_MS = 150

function template(name: SoundName): HTMLAudioElement {
  const cached = templates.get(name)
  if (cached) {
    return cached
  }
  const audio = new Audio(`/assets/audio/sfx/${FILES[name]}`)
  audio.preload = 'auto'
  templates.set(name, audio)
  return audio
}

/** Plays a short effect. Audio is optional, so failures stay silent. */
export function playSound(name: SoundName, volume = 0.5): void {
  try {
    const now = performance.now()
    const last = lastPlayed.get(name) ?? Number.NEGATIVE_INFINITY
    if (now - last < MIN_GAP_MS) {
      return
    }
    lastPlayed.set(name, now)
    const audio = template(name).cloneNode() as HTMLAudioElement
    audio.volume = volume
    void audio.play().catch(() => {})
  } catch {
    // A blocked or missing sound must never break the match.
  }
}

/**
 * Maps a simulation event to the effects it makes. Each effect is tagged with
 * the snake it belongs to, so a player only hears what happens to them.
 */
export function soundsForEvent(event: WorldEvent): SoundEvent[] {
  const sounds: SoundEvent[] = []
  switch (event.type) {
    case 'pickup':
      sounds.push({
        by: event.snakeId,
        name: event.kind === 'apple' ? 'eat-apple' : 'power-up',
      })
      break
    case 'hit':
      sounds.push({ by: event.targetId, name: 'bite' })
      if (event.attackerId) {
        sounds.push({ by: event.attackerId, name: 'bite' })
      }
      break
    case 'destroyed':
      sounds.push({ by: event.targetId, name: 'pop' })
      if (event.attackerId) {
        sounds.push({ by: event.attackerId, name: 'pop' })
      }
      break
    case 'death':
      sounds.push({ by: event.snakeId, name: 'bite' })
      break
    default:
      break
  }
  return sounds
}
