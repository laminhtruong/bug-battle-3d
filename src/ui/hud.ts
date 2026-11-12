import { EN } from '@/i18n/en'
import type { RenderState } from '@/render/state'
import type { LobbyPlayer, ResultRow } from '@/net/protocol'

export interface HudHandlers {
  onLocal(): void
  onCreate(name: string): void
  onJoin(code: string, name: string): void
  onStart(): void
  onCancel(): void
  onAgain(): void
}

export interface Hud {
  getPlayerName(): string
  showMenu(): void
  showLobby(code: string, players: readonly LobbyPlayer[], isHost: boolean): void
  showGame(): void
  showResults(rows: readonly ResultRow[], canRestart: boolean): void
  update(state: RenderState, playerId: string): void
  flash(message: string): void
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

export function createHud(handlers: HudHandlers): Hud {
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
      <label class="field">
        <span>${EN.name}</span>
        <input class="name-input" maxlength="16" value="${EN.you}" />
      </label>
      <button class="button" data-action="local" type="button">${EN.play}</button>
      <div class="menu-row">
        <button class="button secondary" data-action="create" type="button">${EN.createRoom}</button>
        <input class="code-input" maxlength="6" placeholder="${EN.roomCode}" />
        <button class="button secondary" data-action="join" type="button">${EN.joinRoom}</button>
      </div>
      <p class="hint">${EN.hint}</p>
    </section>
    <section class="screen" data-screen="lobby" hidden>
      <p class="lobby-label">${EN.roomCode}</p>
      <p class="lobby-code">-----</p>
      <ul class="lobby-players"></ul>
      <p class="lobby-status">${EN.waiting}</p>
      <button class="button" data-action="start" type="button">${EN.startMatch}</button>
      <button class="button secondary" data-action="cancel" type="button">${EN.cancel}</button>
    </section>
    <section class="screen" data-screen="results" hidden>
      <h2>${EN.roundOver}</h2>
      <ol class="results"></ol>
      <button class="button" data-action="again" type="button">${EN.playAgain}</button>
      <button class="button secondary" data-action="menu" type="button">${EN.backToMenu}</button>
    </section>
    <div class="toast" hidden></div>
  `
  document.body.append(root)

  const top = root.querySelector<HTMLElement>('.hud-top')
  const timer = root.querySelector<HTMLElement>('.hud-timer-value')
  const board = root.querySelector<HTMLOListElement>('.hud-board')
  const menu = root.querySelector<HTMLElement>('[data-screen="menu"]')
  const lobby = root.querySelector<HTMLElement>('[data-screen="lobby"]')
  const results = root.querySelector<HTMLElement>('[data-screen="results"]')
  const resultList = root.querySelector<HTMLOListElement>('.results')
  const nameInput = root.querySelector<HTMLInputElement>('.name-input')
  const codeInput = root.querySelector<HTMLInputElement>('.code-input')
  const lobbyCode = root.querySelector<HTMLElement>('.lobby-code')
  const lobbyPlayers = root.querySelector<HTMLUListElement>('.lobby-players')
  const lobbyStatus = root.querySelector<HTMLElement>('.lobby-status')
  const startButton = root.querySelector<HTMLElement>('[data-action="start"]')
  const againButton = root.querySelector<HTMLElement>('[data-action="again"]')
  const toast = root.querySelector<HTMLElement>('.toast')

  if (
    !top ||
    !timer ||
    !board ||
    !menu ||
    !lobby ||
    !results ||
    !resultList ||
    !nameInput ||
    !codeInput ||
    !lobbyCode ||
    !lobbyPlayers ||
    !lobbyStatus ||
    !startButton ||
    !againButton ||
    !toast
  ) {
    throw new Error('hud markup is incomplete')
  }

  let signature = ''
  let toastTimer: number | undefined

  const getPlayerName = (): string => nameInput.value.trim().slice(0, 16) || EN.you

  root.querySelector('[data-action="local"]')?.addEventListener('click', handlers.onLocal)
  root.querySelector('[data-action="create"]')?.addEventListener('click', () => {
    handlers.onCreate(getPlayerName())
  })
  root.querySelector('[data-action="join"]')?.addEventListener('click', () => {
    handlers.onJoin(codeInput.value.trim(), getPlayerName())
  })
  startButton.addEventListener('click', handlers.onStart)
  root.querySelector('[data-action="cancel"]')?.addEventListener('click', handlers.onCancel)
  againButton.addEventListener('click', handlers.onAgain)
  root.querySelector('[data-action="menu"]')?.addEventListener('click', () => {
    handlers.onCancel()
  })

  const showScreen = (screen: 'menu' | 'lobby' | 'results' | 'none'): void => {
    menu.hidden = screen !== 'menu'
    lobby.hidden = screen !== 'lobby'
    results.hidden = screen !== 'results'
    top.hidden = screen !== 'none'
    signature = ''
  }

  return {
    getPlayerName,
    showMenu: () => showScreen('menu'),
    showLobby: (code, players, isHost) => {
      lobbyCode.textContent = code.toUpperCase()
      lobbyPlayers.innerHTML = players
        .map((player) => `<li>${escapeHtml(player.name)}</li>`)
        .join('')
      lobbyStatus.textContent = isHost ? EN.waitingForPlayers : EN.waitingForHost
      startButton.hidden = !isHost
      showScreen('lobby')
    },
    showGame: () => showScreen('none'),
    showResults: (rows, canRestart) => {
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
      againButton.hidden = !canRestart
      showScreen('results')
    },
    update: (state, playerId) => {
      timer.textContent = String(Math.ceil(state.duration - state.time))
      const rows = state.snakes
        .filter((snake) => snake.control !== 'enemy')
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
    flash: (message) => {
      toast.textContent = message
      toast.hidden = false
      window.clearTimeout(toastTimer)
      toastTimer = window.setTimeout(() => {
        toast.hidden = true
      }, 3200)
    },
  }
}
