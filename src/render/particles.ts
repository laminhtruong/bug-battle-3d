import * as THREE from 'three'
import {
  ApplyForce,
  BatchedRenderer,
  CircleEmitter,
  ColorOverLife,
  ConeEmitter,
  ConstantColor,
  ConstantValue,
  type Behavior,
  type FunctionJSON,
  type FunctionValueGenerator,
  type GeneratorMemory,
  Gradient,
  IntervalValue,
  type Particle,
  ParticleSystem,
  RenderMode,
  SizeOverLife,
  SphereEmitter,
  Vector3 as QuarksVector3,
  Vector4 as QuarksVector4,
} from 'three.quarks'

/**
 * Particle presets copied from the Unity project at
 * D:/Unity/Projects/battle-bug. The game renders parts four times their
 * original world size, so speeds, sizes and offsets are scaled by the same
 * factor while lifetimes and emission rates stay in seconds.
 */

function texture(name: string): THREE.Texture {
  const loaded = new THREE.TextureLoader().load(`/assets/textures/fx/${name}.png`)
  loaded.colorSpace = THREE.SRGBColorSpace
  return loaded
}

const materials = new Map<string, THREE.MeshBasicMaterial>()

function material(name: string, additive: boolean): THREE.MeshBasicMaterial {
  const key = `${name}:${additive}`
  const cached = materials.get(key)
  if (cached) {
    return cached
  }
  const created = new THREE.MeshBasicMaterial({
    map: texture(name),
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  })
  materials.set(key, created)
  return created
}

/** Linear copy of a Unity animation curve, sampled on 0..1. */
class Curve implements FunctionValueGenerator {
  readonly type = 'function' as const

  constructor(private readonly points: readonly (readonly [number, number])[]) {}

  startGen(): void {}

  genValue(_memory: GeneratorMemory, t = 0): number {
    const points = this.points
    if (points.length === 0) {
      return 0
    }
    const first = points[0]!
    if (t <= first[0]) {
      return first[1]
    }
    for (let index = 1; index < points.length; index += 1) {
      const a = points[index - 1]!
      const b = points[index]!
      if (t <= b[0]) {
        const span = b[0] - a[0]
        return span <= 0 ? b[1] : a[1] + ((b[1] - a[1]) * (t - a[0])) / span
      }
    }
    return points[points.length - 1]![1]
  }

  toJSON(): FunctionJSON {
    return { type: 'UnityCurve' }
  }

  clone(): Curve {
    return new Curve(this.points)
  }
}

/**
 * Lays a ground billboard along its own velocity and stretches it, standing in
 * for Unity's stretched billboard while staying flat on the floor.
 */
class GroundBolt implements Behavior {
  readonly type = 'GroundBolt'

  constructor(
    private readonly min: number,
    private readonly max: number,
  ) {}

  initialize(particle: Particle): void {
    if (typeof particle.rotation !== 'number') {
      return
    }
    const length = this.min + Math.random() * (this.max - this.min)
    // startSize is what size-over-life rebuilds from, so stretch both.
    particle.startSize.x *= length
    particle.size.x *= length
    particle.rotation = Math.atan2(-particle.velocity.z, particle.velocity.x)
  }

  update(): void {}

  frameUpdate(): void {}

  toJSON(): unknown {
    return { type: this.type }
  }

  clone(): Behavior {
    return new GroundBolt(this.min, this.max)
  }

  reset(): void {}
}

/** Unity texture-sheet animation: whole sheet or one row, over particle life. */
class TileOverLife implements Behavior {
  readonly type = 'TileOverLife'

  constructor(
    private readonly start: number,
    private readonly frames: number,
    private readonly cycles: number,
  ) {}

  initialize(particle: Particle): void {
    particle.uvTile = this.start
  }

  update(particle: Particle): void {
    const progress = particle.life > 0 ? particle.age / particle.life : 1
    const frame = Math.floor(progress * this.frames * this.cycles)
    particle.uvTile = (this.start + frame) % this.frames
  }

  frameUpdate(): void {}

  toJSON(): unknown {
    return { type: this.type }
  }

  clone(): Behavior {
    return new TileOverLife(this.start, this.frames, this.cycles)
  }

  reset(): void {}
}

type Shape =
  | { kind: 'cone'; angle: number; radius: number; arc?: number }
  | { kind: 'sphere'; radius: number }
  | { kind: 'circle'; radius: number; thickness?: number }
  | { kind: 'point' }

interface SystemSpec {
  duration: number
  loop?: boolean
  life: [number, number]
  speed: [number, number]
  size: [number, number]
  rotation?: [number, number]
  /** Positive pulls down, negative pulls up, in world units per second. */
  gravity?: number
  rate?: number
  bursts?: readonly { time: number; count: number }[]
  shape: Shape
  startColor?: readonly [number, number, number, number]
  colorOverLife?: {
    colors: readonly (readonly [number, number, number, number])[]
    alphas: readonly (readonly [number, number])[]
  }
  sizeOverLife?: readonly (readonly [number, number])[]
  /** Horizontal sprites only: stretch along the velocity, min..max times the size. */
  stretch?: [number, number]
  uv?: { x: number; y: number; frames: number; start: number; cycles: number }
  material: string
  additive: boolean
  mode: 'billboard' | 'stretched' | 'horizontal'
  lengthFactor?: number
  speedFactor?: number
  /** False only for effects that must follow their emitter, like a projectile. */
  worldSpace?: boolean
}

function shapeOf(shape: Shape): ConeEmitter | SphereEmitter | CircleEmitter {
  if (shape.kind === 'cone') {
    return new ConeEmitter({
      angle: (shape.angle * Math.PI) / 180,
      radius: shape.radius,
      arc: ((shape.arc ?? 360) * Math.PI) / 180,
    })
  }
  if (shape.kind === 'circle') {
    return new CircleEmitter({ radius: shape.radius, thickness: shape.thickness ?? 1 })
  }
  return new SphereEmitter({ radius: shape.kind === 'sphere' ? shape.radius : 0.001 })
}

function makesystem(spec: SystemSpec): ParticleSystem {
  const behaviors: Behavior[] = []
  if (spec.colorOverLife) {
    behaviors.push(
      new ColorOverLife(
        new Gradient(
          spec.colorOverLife.colors.map(
            ([time, r, g, b]) => [new QuarksVector3(r, g, b), time] as [QuarksVector3, number],
          ),
          spec.colorOverLife.alphas.map(([time, alpha]) => [alpha, time] as [number, number]),
        ),
      ),
    )
  }
  if (spec.sizeOverLife) {
    behaviors.push(new SizeOverLife(new Curve(spec.sizeOverLife)))
  }
  if (spec.stretch) {
    behaviors.push(new GroundBolt(spec.stretch[0], spec.stretch[1]))
  }
  if (spec.uv) {
    behaviors.push(new TileOverLife(spec.uv.start, spec.uv.frames, spec.uv.cycles))
  }
  if (spec.gravity) {
    const up = spec.gravity < 0
    behaviors.push(
      new ApplyForce(
        new QuarksVector3(0, up ? 1 : -1, 0),
        new ConstantValue(Math.abs(spec.gravity)),
      ),
    )
  }
  const start = spec.startColor ?? [1, 1, 1, 1]
  return new ParticleSystem({
    duration: spec.duration,
    looping: spec.loop ?? false,
    autoDestroy: true,
    startLife: new IntervalValue(spec.life[0], spec.life[1]),
    startSpeed: new IntervalValue(spec.speed[0], spec.speed[1]),
    startSize: new IntervalValue(spec.size[0], spec.size[1]),
    ...(spec.rotation
      ? { startRotation: new IntervalValue(spec.rotation[0], spec.rotation[1]) }
      : {}),
    startColor: new ConstantColor(new QuarksVector4(...start)),
    emissionOverTime: new ConstantValue(spec.rate ?? 0),
    ...(spec.bursts
      ? {
          emissionBursts: spec.bursts.map((burst) => ({
            time: burst.time,
            count: new ConstantValue(burst.count),
            cycle: 1,
            interval: 0,
            probability: 1,
          })),
        }
      : {}),
    shape: shapeOf(spec.shape),
    material: material(spec.material, spec.additive),
    renderMode:
      spec.mode === 'stretched'
        ? RenderMode.StretchedBillBoard
        : spec.mode === 'horizontal'
          ? RenderMode.HorizontalBillBoard
          : RenderMode.BillBoard,
    // three.quarks only reads the stretch settings from rendererEmitterSettings.
    ...(spec.mode === 'stretched'
      ? {
          rendererEmitterSettings: {
            speedFactor: spec.speedFactor ?? 0,
            lengthFactor: spec.lengthFactor ?? 1,
          },
        }
      : {}),
    uTileCount: spec.uv?.x ?? 1,
    vTileCount: spec.uv?.y ?? 1,
    startTileIndex: new ConstantValue(spec.uv?.start ?? 0),
    blendTiles: false,
    worldSpace: spec.worldSpace ?? true,
    behaviors,
  })
}

const DEG = Math.PI / 180

function headFire(): SystemSpec[] {
  const f = 4
  return [
    {
      duration: 0.35,
      life: [0.1, 0.2],
      speed: [15 * f, 20 * f],
      size: [0.6 * f, 0.9 * f],
      rotation: [-15 * DEG, 15 * DEG],
      gravity: -9.81 * f,
      rate: 80,
      shape: { kind: 'cone', angle: 4, radius: 0.01 * f },
      startColor: [1, 1, 1, 1],
      colorOverLife: {
        colors: [
          [0, 1, 1, 1],
          [0.4723, 1, 0.6, 0],
          [1, 1, 0, 0],
        ],
        alphas: [
          [0, 0],
          [0.1149, 1],
          [0.577, 1],
          [0.9971, 0],
        ],
      },
      sizeOverLife: [
        [0, 0.4639],
        [1, 1],
      ],
      uv: { x: 2, y: 2, frames: 4, start: 0, cycles: 4 },
      material: 'fire-soft-blank',
      additive: true,
      mode: 'horizontal',
      worldSpace: false,
    },
    {
      duration: 0.35,
      life: [0.1, 0.2],
      speed: [18 * f, 22 * f],
      size: [1 * f, 1.25 * f],
      rotation: [0, Math.PI * 2],
      gravity: -9.81 * f,
      rate: 25,
      shape: { kind: 'cone', angle: 4, radius: 0.01 * f },
      startColor: [1, 1, 1, 1],
      colorOverLife: {
        colors: [
          [0, 1, 0.8078, 0],
          [0.3255, 0.8962, 0.4239, 0.1649],
          [1, 0.1922, 0.1922, 0.1922],
        ],
        alphas: [
          [0, 1],
          [0.5174, 1],
          [1, 0],
        ],
      },
      sizeOverLife: [
        [0, 0],
        [0.4008, 0.8393],
        [1, 0.3742],
      ],
      uv: { x: 2, y: 2, frames: 4, start: 0, cycles: 1 },
      material: 'cloud-2x2-soft',
      additive: false,
      mode: 'billboard',
      worldSpace: false,
    },
    {
      duration: 0.35,
      life: [0.1, 0.15],
      speed: [15 * f, 20 * f],
      size: [0.2 * f, 0.4 * f],
      rotation: [-15 * DEG, 15 * DEG],
      rate: 125,
      shape: { kind: 'cone', angle: 4, radius: 0.01 * f },
      startColor: [1, 1, 1, 1],
      colorOverLife: {
        colors: [
          [0, 1, 1, 1],
          [1, 1, 0.5176, 0],
        ],
        alphas: [
          [0, 0],
          [0.1149, 1],
          [0.577, 1],
          [0.9971, 0],
        ],
      },
      sizeOverLife: [
        [0, 0.4639],
        [1, 1],
      ],
      uv: { x: 2, y: 2, frames: 4, start: 0, cycles: 4 },
      material: 'fire-soft-blank',
      additive: true,
      mode: 'stretched',
      lengthFactor: 3,
      speedFactor: 0,
      worldSpace: false,
    },
  ]
}

function bodyFire(): SystemSpec[] {
  // Body.prefab scales both side jets by 0.75; gravity is not hierarchy-scaled.
  const scale = 0.75
  return headFire().map((spec) => ({
    ...spec,
    speed: [spec.speed[0] * scale, spec.speed[1] * scale] as [number, number],
    size: [spec.size[0] * scale, spec.size[1] * scale] as [number, number],
    shape:
      spec.shape.kind === 'cone'
        ? { ...spec.shape, radius: spec.shape.radius * scale }
        : spec.shape,
  }))
}

function lightningOrb(): SystemSpec[] {
  return [
    {
      duration: 0.25,
      loop: true,
      life: [0.25, 0.25],
      speed: [0, 0],
      size: [2.1, 2.1],
      rotation: [0, Math.PI * 2],
      rate: 0,
      bursts: [{ time: 0, count: 1 }],
      shape: { kind: 'point' },
      startColor: [1, 1, 1, 1],
      colorOverLife: {
        colors: [
          [0, 1, 1, 1],
          [1, 1, 1, 1],
        ],
        alphas: [
          [0, 0.4902],
          [0.5321, 1],
          [1, 0.4902],
        ],
      },
      sizeOverLife: [
        [0, 0.7609],
        [0.4982, 0.9891],
        [1, 0.7609],
      ],
      material: 'glow1',
      additive: true,
      mode: 'horizontal',
      worldSpace: false,
    },
    {
      duration: 0.25,
      loop: true,
      life: [0.15, 0.2],
      speed: [8, 16],
      size: [1, 1.2],
      rotation: [0, Math.PI * 2],
      rate: 70,
      shape: { kind: 'sphere', radius: 2 },
      startColor: [1, 1, 1, 1],
      uv: { x: 3, y: 3, frames: 9, start: 0, cycles: 2 },
      material: 'lightning-3x3',
      additive: true,
      mode: 'stretched',
      lengthFactor: 2.6,
      speedFactor: 0,
      worldSpace: false,
    },
  ]
}

function poisonOrb(): SystemSpec[] {
  return [
    {
      duration: 0.25,
      loop: true,
      life: [0.25, 0.25],
      speed: [0, 0],
      size: [0.84, 0.84],
      rotation: [0, Math.PI * 2],
      rate: 0,
      bursts: [{ time: 0, count: 1 }],
      shape: { kind: 'point' },
      startColor: [1, 1, 1, 1],
      colorOverLife: {
        colors: [
          [0, 1, 1, 1],
          [1, 1, 1, 1],
        ],
        alphas: [
          [0, 0.4902],
          [0.5321, 1],
          [1, 0.4902],
        ],
      },
      sizeOverLife: [
        [0, 0.7609],
        [0.4982, 0.9891],
        [1, 0.7609],
      ],
      material: 'glow1',
      additive: true,
      mode: 'billboard',
      worldSpace: false,
    },
  ]
}

function lightningImpact(): SystemSpec[] {
  return [
    {
      duration: 0.5,
      life: [0.35, 0.45],
      speed: [7, 30.8],
      size: [0.112, 0.112],
      rate: 0,
      bursts: [{ time: 0, count: 65 }],
      shape: { kind: 'circle', radius: 2.8, thickness: 0 },
      startColor: [1, 1, 1, 1],
      colorOverLife: {
        colors: [
          [0, 1, 1, 1],
          [1, 1, 1, 1],
        ],
        alphas: [
          [0, 0],
          [0.2235, 1],
          [0.8349, 1],
          [1, 0],
        ],
      },
      sizeOverLife: [
        [0, 0.475],
        [0.3352, 0.9885],
        [1, 0],
      ],
      material: 'circlestretchy',
      additive: false,
      // Sparks are stretched billboards in Unity; flat here so the whole nova
      // stays in the floor plane instead of standing up at the camera.
      mode: 'horizontal',
      stretch: [4, 8],
    },
    {
      duration: 0.5,
      life: [0.5, 0.5],
      speed: [0, 0],
      size: [9.8, 9.8],
      rotation: [0, Math.PI * 2],
      rate: 0,
      bursts: [{ time: 0, count: 1 }],
      shape: { kind: 'point' },
      startColor: [1, 1, 1, 1],
      colorOverLife: {
        colors: [
          [0, 1, 1, 1],
          [1, 1, 1, 0],
        ],
        alphas: [
          [0, 1],
          [1, 0],
        ],
      },
      sizeOverLife: [
        [0, 0.3211],
        [1, 1],
      ],
      material: 'ring',
      additive: true,
      mode: 'horizontal',
    },
    {
      duration: 0.25,
      life: [0.15, 0.45],
      speed: [2.8, 5.6],
      size: [0.91, 1.19],
      rate: 20,
      bursts: [{ time: 0, count: 11 }],
      shape: { kind: 'circle', radius: 0.406, thickness: 1 },
      startColor: [1, 1, 1, 1],
      colorOverLife: {
        colors: [
          [0, 1, 1, 1],
          [0.9985, 1, 0, 1],
        ],
        alphas: [
          [0, 1],
          [0.5773, 1],
        ],
      },
      uv: { x: 3, y: 3, frames: 9, start: 0, cycles: 1 },
      material: 'lightning-3x3',
      additive: true,
      // Unity stretches these along the velocity; a camera-facing stretch would
      // stand the bolts up, so they are stretched flat along the ground instead.
      mode: 'horizontal',
      stretch: [8, 13],
    },
    {
      duration: 0.5,
      life: [0.4, 0.4],
      speed: [0, 0],
      size: [11.2, 11.2],
      rotation: [0, Math.PI * 2],
      rate: 0,
      bursts: [{ time: 0, count: 1 }],
      shape: { kind: 'point' },
      startColor: [1, 1, 1, 1],
      colorOverLife: {
        colors: [
          [0, 1, 1, 1],
          [1, 1, 1, 1],
        ],
        alphas: [
          [0, 1],
          [1, 0],
        ],
      },
      sizeOverLife: [
        [0, 1],
        [1, 0.6923],
      ],
      material: 'glow1',
      additive: true,
      mode: 'horizontal',
    },
  ]
}

function poisonImpact(): SystemSpec[] {
  return [
    {
      duration: 3,
      life: [3, 3],
      speed: [0, 0],
      size: [8, 8],
      rotation: [0, Math.PI * 2],
      rate: 0,
      bursts: [{ time: 0, count: 1 }],
      shape: { kind: 'point' },
      startColor: [0.508, 1, 0.316, 1],
      colorOverLife: {
        colors: [
          [0, 0.3889, 0.8679, 0.4476],
          [0.9954, 0.4748, 0.8774, 0.1945],
        ],
        alphas: [
          [0, 1],
          [0.9, 1],
          [0.9971, 0],
        ],
      },
      material: 'decal-poison',
      additive: false,
      mode: 'billboard',
    },
    {
      duration: 2.5,
      life: [0.3, 0.6],
      speed: [16, 32],
      size: [0.4, 0.4],
      gravity: 9.81 * 1.7 * 4,
      rate: 40,
      shape: { kind: 'cone', angle: 5, radius: 0.5 * 4 },
      startColor: [1, 1, 1, 1],
      colorOverLife: {
        colors: [
          [0, 0.7804, 1, 0.6314],
          [0.5222, 0, 1, 0.1725],
        ],
        alphas: [
          [0, 0],
          [0.2235, 1],
          [0.7, 1],
          [1, 0],
        ],
      },
      sizeOverLife: [
        [0, 0],
        [0.476, 1],
        [1, 0],
      ],
      material: 'circle',
      additive: false,
      mode: 'stretched',
      lengthFactor: 1,
      speedFactor: 0.02,
    },
    {
      duration: 1,
      life: [0.4, 1],
      speed: [18, 23],
      size: [2.4, 4],
      rotation: [0, Math.PI * 2],
      gravity: -9.81 * 0.4 * 4,
      rate: 0,
      bursts: [{ time: 0, count: 12 }],
      shape: { kind: 'sphere', radius: 0.2 * 4 },
      startColor: [1, 1, 1, 1],
      colorOverLife: {
        colors: [
          [0, 1, 1, 1],
          [1, 1, 1, 1],
        ],
        alphas: [
          [0, 1],
          [0.9, 1],
          [1, 0],
        ],
      },
      sizeOverLife: [
        [0, 1],
        [1, 0],
      ],
      uv: { x: 2, y: 2, frames: 4, start: 0, cycles: 1 },
      material: 'cloud-2x2-hard',
      additive: false,
      mode: 'billboard',
    },
    {
      duration: 2,
      life: [1.3, 1.3],
      speed: [0.4, 0.4],
      size: [4, 4],
      gravity: -9.81 * 0.125 * 4,
      rate: 0,
      // The prefab bursts 12 identical copies on one spot; one sprite reads the same.
      bursts: [{ time: 0, count: 1 }],
      shape: { kind: 'point' },
      startColor: [1, 1, 1, 1],
      colorOverLife: {
        colors: [
          [0, 0.7412, 0.9333, 0.7647],
          [0.9985, 0.2275, 0.4471, 0.0745],
        ],
        alphas: [
          [0, 1],
          [0.7953, 1],
          [1, 0],
        ],
      },
      sizeOverLife: [
        [0, 0.3865],
        [0.2561, 0.9234],
        [0.4359, 0.7628],
        [0.6887, 0.7956],
        [1, 0.2875],
      ],
      material: 'skull2',
      additive: false,
      mode: 'billboard',
    },
  ]
}

interface Trail {
  group: THREE.Group
  systems: ParticleSystem[]
}

export function createParticles(scene: THREE.Scene) {
  const batch = new BatchedRenderer()
  scene.add(batch)
  const trails = new Map<string, Trail>()

  function add(
    spec: SystemSpec,
    parent: THREE.Object3D,
    x: number,
    y: number,
    z: number,
    angle?: number,
  ): ParticleSystem {
    const system = makesystem(spec)
    system.emitter.position.set(x, y, z)
    if (angle !== undefined) {
      system.emitter.rotation.y = angle
    }
    parent.add(system.emitter)
    batch.addSystem(system)
    return system
  }

  /**
   * The three fire systems, at their offsets inside the prefab. Unity units are
   * scaled by four to match the art.
   */
  const FIRE_OFFSETS: [number, number, number][] = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0.104 * 4],
  ]

  /**
   * Adds one fire prefab at a local point of the part. The systems stay in
   * local space, so they ride along when the part moves, like the Unity
   * children they copy.
   */
  function spawnFire(
    specs: SystemSpec[],
    parent: THREE.Object3D,
    x: number,
    y: number,
    z: number,
    angle: number,
  ): void {
    const muzzle = new THREE.Group()
    muzzle.position.set(x, y, z)
    muzzle.rotation.y = angle
    parent.add(muzzle)
    for (let index = 0; index < specs.length; index += 1) {
      const [ox, oy, oz] = FIRE_OFFSETS[index]!
      add(specs[index]!, muzzle, ox, oy, oz)
    }
  }
  function spawnImpact(specs: SystemSpec[], x: number, y: number, z: number): void {
    for (const spec of specs) {
      const system = add(spec, scene, x, y, z)
      // The Unity hit prefabs are laid flat with a -90 degree X rotation.
      system.emitter.rotation.x = -Math.PI / 2
    }
  }

  function createTrail(visual: string, x: number, y: number, z: number): Trail {
    const group = new THREE.Group()
    group.position.set(x, y, z)
    scene.add(group)
    const systems = (visual === 'lightning' ? lightningOrb() : poisonOrb()).map((spec) => {
      const system = makesystem(spec)
      group.add(system.emitter)
      batch.addSystem(system)
      return system
    })
    return { group, systems }
  }

  return {
    flameHead(parent: THREE.Object3D): void {
      // Head.prefab hides BulletFire under the pivot at (0, 0.1, 0); it fires
      // straight out of the part's own +Z.
      spawnFire(headFire(), parent, 0, 0.1 * 4, 0, 0)
    },

    flameBody(parent: THREE.Object3D): void {
      // Body.prefab mounts two jets at (+-0.25, 0.19, -0.018), each turned 90
      // degrees outward, so the body sprays sideways instead of forward. The
      // jets are scaled to 0.75, which shrinks their particles, not their
      // parent-local mounts.
      const specs = bodyFire()
      for (const side of [-1, 1]) {
        spawnFire(specs, parent, side * 0.25 * 4, 0.19 * 4, -0.018 * 4, (side * Math.PI) / 2)
      }
    },

    shot(id: string, visual: string, x: number, y: number, z: number): void {
      if (visual !== 'lightning' && visual !== 'poison') {
        return
      }
      let trail = trails.get(id)
      if (!trail) {
        trail = createTrail(visual, x, y, z)
        trails.set(id, trail)
      }
      trail.group.position.set(x, y, z)
    },

    impact(kind: 'lightning' | 'poison', x: number, y: number, z: number): void {
      spawnImpact(kind === 'lightning' ? lightningImpact() : poisonImpact(), x, y, z)
    },

    dropShot(id: string): void {
      const trail = trails.get(id)
      if (!trail) {
        return
      }
      for (const system of trail.systems) {
        system.dispose()
      }
      scene.remove(trail.group)
      trails.delete(id)
    },

    update(dt: number): void {
      batch.update(dt)
    },
  }
}
