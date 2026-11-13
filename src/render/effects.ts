import * as THREE from 'three'

/** Draws flat 2D particle sprites for the effects. */
function sprite(draw: (context: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 64
  const context = canvas.getContext('2d')
  if (context) {
    draw(context)
  }
  return new THREE.CanvasTexture(canvas)
}

const sparkTexture = sprite((context) => {
  context.translate(32, 32)
  context.beginPath()
  context.moveTo(0, -28)
  context.lineTo(26, 26)
  context.lineTo(-26, 26)
  context.closePath()
  context.shadowColor = '#ffffff'
  context.shadowBlur = 10
  context.fillStyle = '#ffffff'
  context.fill()
})

interface BurstParticle {
  velocity: THREE.Vector3
  age: number
  life: number
}

interface Burst {
  points: THREE.Points
  positions: Float32Array
  colors: Float32Array
  particles: BurstParticle[]
}

/** Explosion effect: 12 stretched sparks. */
const SPARKS = 12
const SPARK_LIFE_MIN = 0.3
const SPARK_LIFE_MAX = 0.5
const SPARK_SPEED_MIN = 2
const SPARK_SPEED_MAX = 6
const SPARK_RADIUS = 1.6
const SPARK_SIZE = 0.24
const FLASH_END = 0.32

function randomDirection(): THREE.Vector3 {
  const z = Math.random() * 2 - 1
  const angle = Math.random() * Math.PI * 2
  const radius = Math.sqrt(1 - z * z)
  return new THREE.Vector3(Math.cos(angle) * radius, z, Math.sin(angle) * radius)
}

export function createEffects(scene: THREE.Scene) {
  const bursts: Burst[] = []

  return {
    explode(x: number, z: number): void {
      const positions = new Float32Array(SPARKS * 3)
      const colors = new Float32Array(SPARKS * 4)
      const particles: BurstParticle[] = []
      for (let index = 0; index < SPARKS; index += 1) {
        const offset = randomDirection().multiplyScalar(Math.random() * SPARK_RADIUS)
        positions[index * 3] = x + offset.x
        positions[index * 3 + 1] = 0.5 + offset.y
        positions[index * 3 + 2] = z + offset.z
        colors[index * 4] = 1
        colors[index * 4 + 1] = 0.965
        colors[index * 4 + 2] = 0.953
        colors[index * 4 + 3] = 1
        particles.push({
          velocity: randomDirection().multiplyScalar(
            SPARK_SPEED_MIN + Math.random() * (SPARK_SPEED_MAX - SPARK_SPEED_MIN),
          ),
          age: 0,
          life: SPARK_LIFE_MIN + Math.random() * (SPARK_LIFE_MAX - SPARK_LIFE_MIN),
        })
      }

      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 4))
      const points = new THREE.Points(
        geometry,
        new THREE.PointsMaterial({
          map: sparkTexture,
          size: SPARK_SIZE,
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          vertexColors: true,
        }),
      )
      scene.add(points)
      bursts.push({ points, positions, colors, particles })
    },

    update(dt: number): void {
      for (let index = bursts.length - 1; index >= 0; index -= 1) {
        const burst = bursts[index]!
        let alive = false
        for (let spark = 0; spark < burst.particles.length; spark += 1) {
          const particle = burst.particles[spark]!
          particle.age += dt
          if (particle.age >= particle.life) {
            burst.colors[spark * 4 + 3] = 0
            continue
          }
          alive = true
          const position = spark * 3
          burst.positions[position] = (burst.positions[position] ?? 0) + particle.velocity.x * dt
          burst.positions[position + 1] =
            (burst.positions[position + 1] ?? 0) + particle.velocity.y * dt
          burst.positions[position + 2] =
            (burst.positions[position + 2] ?? 0) + particle.velocity.z * dt
          // Full alpha until 32% of the lifetime, then fade out.
          burst.colors[spark * 4 + 3] =
            particle.age < particle.life * FLASH_END
              ? 1
              : (1 - particle.age / particle.life) / (1 - FLASH_END)
        }
        const geometry = burst.points.geometry
        const attributes = geometry.attributes
        if (attributes.position && attributes.color) {
          attributes.position.needsUpdate = true
          attributes.color.needsUpdate = true
        }
        if (!alive) {
          scene.remove(burst.points)
          burst.points.geometry.dispose()
          ;(burst.points.material as THREE.Material).dispose()
          bursts.splice(index, 1)
        }
      }
    },
  }
}
