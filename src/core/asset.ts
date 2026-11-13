/**
 * Asset URLs must stay relative to the page: the game is also served from a
 * subfolder (GitHub Pages `/bug-battle/`), where `/assets/...` hits the root.
 */
export function asset(path: string): string {
  return `${import.meta.env.BASE_URL}assets/${path}`
}
