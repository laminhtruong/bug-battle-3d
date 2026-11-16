# Particle project

The editor UI is the independent
[`quarks-particle-editor`](https://github.com/laminhtruong/quarks-particle-editor)
package. The game stores native Quarks JSON files and their project assets in
`public/particles/`:

```text
public/particles/
  flame-head.json
  assets/textures/fx/
  assets/meshes/
```

Run `npm run editor:particles`, choose **Open project**, and select
`public/particles`. **Save project** writes JSON, textures, and external mesh data
to that folder. No game-specific particle API or override layer is used. The
runtime loads each effect with `quarks-particle-editor/loader`'s
`loadProjectEffect()`, resolving project-relative textures, meshes, and
sub-emitter links.

The small `/editor/api/particle-ids` route only lists effect ids for the bug editor's
projectile-visual dropdown. It does not read, write, or validate particle files.
Schema validation is provided directly by `quarks-particle-editor/document`.

## Dependency snapshot

Until the package is published, `package.json` installs the checked-in npm tarball
at `vendor/quarks-particle-editor-0.3.0.tgz`. To refresh it after changing the
independent editor repository:

```sh
# In quarks-particle-editor:
npm ci
npm run check
npm pack --pack-destination ../bug-battle-3d/vendor

# In bug-battle-3d:
npm install ./vendor/quarks-particle-editor-0.3.0.tgz
npm run check
npm run build
```

See the editor's [Quarks support matrix](https://github.com/laminhtruong/quarks-particle-editor/blob/main/docs/quarks-support.md)
for runtime limitations.
