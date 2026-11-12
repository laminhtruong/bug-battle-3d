# Contributing

Thanks for helping. Small, focused pull requests are the easiest to review.

## Setup

```bash
npm install
npm run dev
```

Before opening a pull request run:

```bash
npm run check
npm run build
```

## Code style

- TypeScript strict mode is on, including `noUncheckedIndexedAccess`.
- Prettier and ESLint own formatting. Do not reformat unrelated files.
- All identifiers, comments, commit messages, docs and UI strings are English.
- Comments explain _why_, not _what_.
- Keep `src/sim`, `src/content` and `src/data` free of three.js, DOM APIs and
  `Math.random`. The lint rules enforce this; the simulation must stay testable
  and deterministic.

## Commits

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add poison body
fix: keep guests in bounds after respawn
docs: explain room codes
```

## Adding a head or body

See [docs/adding-parts.md](docs/adding-parts.md). In short:

1. Add one file to `src/content/heads` or `src/content/bodies`.
2. Give it a unique kebab-case id per slot.
3. Add the model to `public/assets` or let the renderer use its placeholder.
4. Run `npm run check`.

Never edit the registry to register a part.

## Network changes

- Bump `PROTOCOL_VERSION` in `src/net/protocol.ts` when a message shape changes.
- Validate every field received from a peer with zod.
- Treat all guest input as hostile: range check, rate limit, ignore unknown peers.
- Snapshots should stay small. Send part ids, not functions or definitions.

## Reporting bugs

Use the issue templates. Include the browser, whether you were host or guest, and
the steps to reproduce.

## License

By contributing you agree that your contribution is licensed under the MIT
license of this repository.
