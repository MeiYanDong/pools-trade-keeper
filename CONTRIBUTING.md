# Contributing

This repository is a money-sensitive, read-only Shadow system. A green build must prove the decision boundary, not only that TypeScript compiles.

## Local baseline

1. Use the exact Node.js version in `.node-version`.
2. Install only from the lockfile with `npm ci`.
3. Run `npm run verify` before requesting review.
4. Never commit `.env`, RPC credentials, keystores, runtime `data/`, or generated `dist/`.

`npm run verify` validates the sniper specification, formatting, lint, types, tests, deployment-script syntax, compiled output, and release manifest. Use `npm run format` to apply the repository style.

## Change shape

Keep changes small enough to verify independently. Each change must state:

- the user-visible or decision-visible outcome;
- its failure boundary and whether `UNKNOWN` is preserved;
- the test or readback that proves it;
- whether it changes read, prepare, sign, broadcast, reconcile, or exit capability.

Use concise commit subjects such as `feat:`, `fix:`, `test:`, `docs:`, `ci:`, or `chore:`. Do not claim deployment, CI enforcement, profit, or live authorization without the corresponding external receipt.

## Review gates

- Any RPC failure that could change an economic decision must remain `UNKNOWN`; it must not silently become negative or zero.
- Every multi-read economic snapshot must be pinned to one block.
- Mark-to-market calculations and realized receipt transfers must use different evidence kinds.
- `shotDecision` remains `NO_SHOT`; this repository has no signing or broadcasting implementation.
- A release is not deployable until its generated `dist/release-manifest.json` verifies.
- Production is not healthy until the read-only post-deploy check passes. CI success alone is insufficient.
