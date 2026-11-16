import { createParticleEditor } from 'quarks-particle-editor'
import './particles.css'

const root = document.querySelector<HTMLElement>('#particle-editor')
if (!root) throw new Error('missing #particle-editor')

const editor = createParticleEditor(root)
void editor.ready.catch(console.error)
window.addEventListener('pagehide', (event) => {
  if (!event.persisted) editor.destroy()
})
