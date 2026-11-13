import * as THREE from 'three'
import type { RenderState } from '@/render/state'
import { isPlayerControl } from '@/sim/types'

/**
 * Name labels that follow the players and the boss.
 * Wandering bugs stay unnamed so the arena does not get noisy.
 */
export interface NameTags {
  sync(state: RenderState, camera: THREE.Camera, playerId: string): void
  clear(): void
}

export function createNameTags(): NameTags {
  const layer = document.createElement('div')
  layer.className = 'name-tags'
  document.body.append(layer)

  const tags = new Map<string, HTMLElement>()
  const projected = new THREE.Vector3()

  return {
    sync(state: RenderState, camera: THREE.Camera, playerId: string): void {
      const shown = new Set<string>()
      camera.updateMatrixWorld()

      for (const snake of state.snakes) {
        if (state.ended || (!isPlayerControl(snake.control) && snake.control !== 'boss')) {
          continue
        }
        const head = snake.segments[0]
        if (!snake.alive || !head) {
          continue
        }
        shown.add(snake.id)

        let tag = tags.get(snake.id)
        if (!tag) {
          tag = document.createElement('span')
          tag.className = 'name-tag'
          tag.textContent = snake.name
          if (snake.id === playerId) {
            tag.classList.add('name-tag-self')
          }
          layer.append(tag)
          tags.set(snake.id, tag)
        }

        projected.set(head.x, 3.8, head.z).project(camera)
        if (projected.z > 1) {
          tag.style.display = 'none'
          continue
        }
        tag.style.display = ''
        const x = (projected.x * 0.5 + 0.5) * window.innerWidth
        const y = (-projected.y * 0.5 + 0.5) * window.innerHeight
        tag.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`
      }

      for (const [id, tag] of tags) {
        if (!shown.has(id)) {
          tag.remove()
          tags.delete(id)
        }
      }
    },
    clear(): void {
      for (const tag of tags.values()) {
        tag.remove()
      }
      tags.clear()
    },
  }
}
