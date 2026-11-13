export interface LoopOptions {
  /** Fixed simulation step in seconds. */
  step: number
  update(): void
  /** `alpha` is how far the accumulator has moved toward the next step. */
  render(dt: number, alpha: number): void
  maxSteps?: number
}

/**
 * Fixed timestep loop. The simulation never sees a variable dt, so a slow
 * frame cannot change the outcome of a match.
 */
export function startLoop({ step, update, render, maxSteps = 5 }: LoopOptions): () => void {
  let last = performance.now()
  let accumulator = 0
  let running = true

  const frame = (now: number): void => {
    if (!running) {
      return
    }
    const elapsed = Math.min((now - last) / 1000, 0.25)
    last = now
    accumulator += elapsed

    let steps = 0
    while (accumulator >= step && steps < maxSteps) {
      update()
      accumulator -= step
      steps += 1
    }

    render(elapsed, accumulator / step)
    requestAnimationFrame(frame)
  }

  requestAnimationFrame(frame)
  return () => {
    running = false
  }
}
