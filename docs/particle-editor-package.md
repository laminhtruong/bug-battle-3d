# Particle editor package

The UI now lives in the independent
[`quarks-particle-editor`](https://github.com/laminhtruong/quarks-particle-editor)
npm package.
It ships no game presets, textures, hard-coded API routes, or project scanning.

This game's integration is in `src/editor/particle-project.ts`:

- Supplies native defaults from `src/content/particles/*.json`.
- Loads and saves overrides through the existing dev-only `/editor/api` routes.
- Supplies texture ids and URLs from the project's FX directory.
- Removes only overrides when resetting a project default.

Users can also open JSON and import raster textures directly using the editor's
file pickers or drag and drop. Local textures are embedded in downloaded JSON.
The standalone editor needs no game adapter or backend; in this game, **Save to
Project** uses the adapter while **Export JSON** downloads a copy.

`src/editor/particles-main.ts` mounts the editor; `particles.css` only sizes the
host page. Editor styles are isolated in Shadow DOM. Document validation is
re-exported from `quarks-particle-editor/document`, which has no engine or DOM
dependency, so server-side validation and game runtime use the same schema.

## Dependency snapshot

Until the package is published, `package.json` installs the checked-in npm tarball
at `vendor/quarks-particle-editor-0.3.0.tgz`. This is a normal distributable npm
package, not copied editor source or a dependency on a sibling directory. A clean
clone can use `npm ci` without the editor repository or GitHub credentials.

The independent source checkout is `../quarks-particle-editor` during development.
To update the snapshot after changing that repository:

```sh
# In the editor repository:
npm ci
npm run check
npm pack --pack-destination ../bug-battle-3d/vendor

# In this repository:
npm install ./vendor/quarks-particle-editor-0.3.0.tgz
npm run check
npm run build
```

Bump the package version for published releases. Once published, replace the
tarball dependency with the registry version and remove the unused tarball.
Publishing to npm requires the owner's registry credentials and is a separate release step.

Version 0.3 adds registry-based editing for all stock JSON behaviors, generators,
shapes, renderer settings, materials, and textures. No Quarks runtime changes or
dependency upgrade are required. See the editor repository's
[support matrix](https://github.com/laminhtruong/quarks-particle-editor/blob/main/docs/quarks-support.md)
for upstream/runtime-only limitations and disabled-module metadata.
