import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HudHandlers } from '@/ui/hud'
import type { HostOptions } from '@/net/host'
import type { ClientOptions } from '@/net/client'

const mocks = vi.hoisted(() => ({
  createHud: vi.fn(),
  startHost: vi.fn(),
  joinRoom: vi.fn(),
  playSound: vi.fn(),
}))
vi.mock('@/ui/hud', () => ({ createHud: mocks.createHud }))
vi.mock('@/net/host', () => ({ startHost: mocks.startHost }))
vi.mock('@/net/client', () => ({ joinRoom: mocks.joinRoom }))
vi.mock('@/audio/sfx', () => ({ playSound: mocks.playSound }))
vi.mock('@/core/loop', () => ({ startLoop: vi.fn() }))
vi.mock('@/render/models', () => ({ preloadPartModels: vi.fn() }))
vi.mock('@/render/scene', () => ({ createView: () => ({ scene: {} }) }))
vi.mock('@/render/snake-view', () => ({ createSnakeViewer: () => ({ reset: vi.fn() }) }))
vi.mock('@/render/prop-view', () => ({ createPropViewer: vi.fn() }))
vi.mock('@/ui/input', () => ({ createInput: () => ({ dispose: vi.fn() }) }))
vi.mock('@/ui/name-tags', () => ({ createNameTags: () => ({ clear: vi.fn() }) }))

const hud = {
  showMenu: vi.fn(),
  showLobby: vi.fn(),
  showGame: vi.fn(),
  showResults: vi.fn(),
  getPlayerName: () => 'You',
  flash: vi.fn(),
}
let handlers: HudHandlers

beforeEach(async () => {
  vi.resetModules()
  vi.clearAllMocks()
  vi.stubGlobal('document', { querySelector: () => ({}) })
  vi.stubGlobal('window', { addEventListener: vi.fn() })
  mocks.createHud.mockImplementation((value: HudHandlers) => {
    handlers = value
    return hud
  })
  await import('@/main')
})
afterEach(() => vi.unstubAllGlobals())

describe('session lifecycle', () => {
  it.each(['host', 'guest'])(
    'disposes a late %s session after starting local play',
    async (mode) => {
      const session = { code: 'abcde', playerId: 'guest', dispose: vi.fn() }
      let resolve!: (value: typeof session) => void
      const pending = new Promise<typeof session>((done) => {
        resolve = done
      })
      const mock = mode === 'host' ? mocks.startHost : mocks.joinRoom
      mock.mockReturnValue(pending)
      if (mode === 'host') handlers.onCreate('You')
      else handlers.onJoin('abcde', 'You')
      const options = mock.mock.calls[0]![0] as HostOptions | ClientOptions
      handlers.onLocal()
      options.handlers.onError('stale error')
      options.handlers.onStart()
      options.handlers.onResults([{ name: 'Old', score: 999 }])
      resolve(session)
      await pending
      await Promise.resolve()
      expect(session.dispose).toHaveBeenCalledOnce()
      expect(hud.showLobby).not.toHaveBeenCalled()
      expect(hud.flash).not.toHaveBeenCalled()
      expect(hud.showResults).not.toHaveBeenCalled()
      expect(hud.showGame).toHaveBeenCalledOnce()
    },
  )

  it('ignores a failed join after the player has already left', async () => {
    let reject!: (error: Error) => void
    const pending = new Promise((_, fail) => {
      reject = fail
    })
    mocks.joinRoom.mockReturnValue(pending)
    handlers.onJoin('abcde', 'You')
    handlers.onLocal()
    reject(new Error('late failure'))
    await pending.catch(() => {})
    expect(hud.flash).not.toHaveBeenCalled()
    expect(hud.showMenu).toHaveBeenCalledOnce()
  })

  it('plays the result sound for the highest score, not slot order', async () => {
    mocks.startHost.mockResolvedValue({ code: 'abcde', dispose: vi.fn() })
    handlers.onCreate('You')
    await Promise.resolve()
    const options = mocks.startHost.mock.calls[0]![0] as HostOptions
    options.handlers.onResults([
      { name: 'You', score: 1 },
      { name: 'Guest', score: 10 },
    ])
    expect(mocks.playSound).toHaveBeenLastCalledWith('lose')
    expect(hud.showResults).toHaveBeenCalledWith(
      [
        { name: 'Guest', score: 10 },
        { name: 'You', score: 1 },
      ],
      true,
    )
  })
})
