import type { WorldEvent } from '@/sim/types'
import type { SoundName } from '@/data/sounds'

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
    const audio = template(name).cloneNode() as HTMLAudioElement
    audio.volume = volume
    void audio.play().catch(() => {})
  } catch {
    // A blocked or missing sound must never break the match.
  }
}

/** Maps a simulation event to the effect it should make. */
export function soundForEvent(event: WorldEvent): SoundName | undefined {
  switch (event.type) {
    case 'pickup':
      return event.kind === 'apple' ? 'eat-apple' : 'power-up'
    case 'destroyed':
      return 'pop'
    case 'hit':
    case 'death':
      return 'bite'
    default:
      return undefined
  }
}
