# Particle editor package

The UI now lives in the independent `quarks-particle-editor` npm package.
It ships no game presets, textures, hard-coded API routes, or project scanning.

This game's integration is in `src/editor/particle-project.ts`:

- Supplies native defaults from `src/content/particles/*.json`.
- Loads and saves overrides through the existing dev-only `/editor/api` routes.
- Supplies texture ids and URLs from the project's FX directory.
- Removes only overrides when resetting a project default.

`src/editor/particles-main.ts` mounts the editor; `particles.css` only sizes the
host page. Editor styles are isolated in Shadow DOM. Document validation is
re-exported from `quarks-particle-editor/document`, which has no engine or DOM
dependency, so server-side validation and game runtime use the same schema.

## Dependency snapshot

Until the package is published, `package.json` installs the checked-in npm tarball
at `vendor/quarks-particle-editor-0.1.0.tgz`. This is a normal distributable npm
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
npm install ./vendor/quarks-particle-editor-0.1.0.tgz
npm run check
npm run build
```

Bump the package version for published releases. Once published, replace the
tarball dependency with the registry version and remove the unused tarball.
Publishing and GitHub repository creation require the owner's credentials.
