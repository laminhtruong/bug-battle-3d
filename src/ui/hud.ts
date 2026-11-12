import { EN } from '@/i18n/en'
import type { World } from '@/sim/types'
import { playerSnakes } from '@/sim/world'

export interface HudRow {
  name: string
  score: number
}

export interface Hud {
  showMenu(): void
  showGame(): void
  showResults(rows: readonly HudRow[]): void
  update(world: World, playerId: string): void
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

export function createHud(handlers: { onPlay(): void; onPlayAgain(): void }): Hud {
  const root = document.createElement('div')
  root.className = 'hud'
  root.innerHTML = `
    <div class="hud-top" hidden>
      <div class="hud-timer">
        <span class="hud-timer-label">${EN.time}</span>
        <span class="hud-timer-value">90</span>
      </div>
      <ol class="hud-board"></ol>
    </div>
    <section class="screen" data-screen="menu">
      <h1>${EN.title}</h1>
      <p class="tagline">${EN.tagline}</p>
      <button class="button" data-action="play" type="button">${EN.play}</button>
      <p class="hint">${EN.hint}</p>
    </section>
    <section class="screen" data-screen="results" hidden>
      <h2>${EN.roundOver}</h2>
      <ol class="results"></ol>
      <button class="button" data-action="again" type="button">${EN.playAgain}</button>
    </section>
  `
  document.body.append(root)

  const top = root.querySelector<HTMLElement>('.hud-top')
  const timer = root.querySelector<HTMLElement>('.hud-timer-value')
  const board = root.querySelector<HTMLOListElement>('.hud-board')
  const menu = root.querySelector<HTMLElement>('[data-screen="menu"]')
  const results = root.querySelector<HTMLElement>('[data-screen="results"]')
  const resultList = root.querySelector<HTMLOListElement>('.results')
  if (!top || !timer || !board || !menu || !results || !resultList) {
    throw new Error('hud markup is incomplete')
  }

  root.querySelector('[data-action="play"]')?.addEventListener('click', handlers.onPlay)
  root.querySelector('[data-action="again"]')?.addEventListener('click', handlers.onPlayAgain)

  let signature = ''

  const showScreen = (screen: 'menu' | 'results' | 'none'): void => {
    menu.hidden = screen !== 'menu'
    results.hidden = screen !== 'results'
    top.hidden = screen !== 'none'
  }

  return {
    showMenu: () => {
      showScreen('menu')
      signature = ''
    },
    showGame: () => {
      showScreen('none')
      signature = ''
    },
    showResults: (rows) => {
      const sorted = [...rows].sort((a, b) => b.score - a.score)
      const winner = sorted[0]
      resultList.innerHTML = sorted
        .map((row, index) => {
          const label = index === 0 ? `${row.name} - ${EN.winner}` : row.name
          return `<li><span>${escapeHtml(label)}</span><span>${row.score}</span></li>`
        })
        .join('')
      const heading = results.querySelector('h2')
      if (heading) {
        heading.textContent = winner ? `${EN.roundOver}: ${winner.name}` : EN.roundOver
      }
      showScreen('results')
    },
    update: (world, playerId) => {
      timer.textContent = String(Math.ceil(world.duration - world.time))
      const rows = playerSnakes(world)
        .slice()
        .sort((a, b) => b.score - a.score)
      const nextSignature = rows
        .map((snake) => `${snake.id}:${snake.name}:${snake.score}`)
        .join('|')
      if (nextSignature === signature) {
        return
      }
      signature = nextSignature
      board.innerHTML = rows
        .map(
          (snake) =>
            `<li class="${snake.id === playerId ? 'me' : ''}"><span>${escapeHtml(
              snake.name,
            )}</span><span>${snake.score}</span></li>`,
        )
        .join('')
    },
  }
}
