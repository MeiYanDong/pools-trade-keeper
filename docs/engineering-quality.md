# Engineering quality baseline

As of 2026-08-16, this file records the minimum improvement slice selected after the repository audit. It is deliberately narrower than a repository-wide refactor.

## Story A: reproducible repository gate

**Outcome:** a clean checkout can reproduce the same quality decision without borrowing another project's dependencies.

Acceptance criteria:

- standalone Git repository with an explicit ignore boundary;
- Node.js pinned in `.node-version`, with a compatible package engine;
- project-local dependencies installed only from `package-lock.json` in CI;
- formatter, lint, typecheck, tests, build, high-confidence secret scanning, sniper-spec validation, deploy-script syntax, and artifact verification available through `npm run verify`;
- a clean-checkout GitHub Actions workflow runs the same command.

Evidence status: the public GitHub repository is active. Push runs `31940805043` and `31940902541` completed successfully on GitHub-hosted Ubuntu, and their uploaded artifact contained the same 110-file manifest SHA-256 as local and production. `main` now requires strict `verify` from GitHub Actions App `15368`; administrator enforcement is enabled, while force-push and branch deletion are disabled.

## Story B: critical decision tests

**Outcome:** failures in the paths most likely to create a false opportunity fail the build.

Acceptance criteria:

- adaptive event-range splitting, resume continuity, persisted-schema validation, and sorted token inventory;
- all snapshot and bulk reads pinned to one block;
- positive, negative, stale, and excessive-unknown bulk outcomes;
- the shared deployed minimum-liquidity constant used by both snapshot and bulk paths;
- exact-output Quoter parameters, post-gas classification, and unconditional `NO_SHOT`;
- append-only evidence and round-robin cursor persistence;
- realized native residual receipts distinguished from spot mark-to-market evidence.

Evidence status: implemented in the automated test suite.

## Story C: auditable release and runtime readback

**Outcome:** a compiled artifact can be identified exactly, and a deployment fails closed when runtime evidence does not match the Shadow contract.

Acceptance criteria:

- deterministic SHA-256 manifest covers compiled runtime and deployment inputs;
- CI uploads only after the full gate passes;
- post-deploy verification checks artifact hashes, pinned Node, systemd active/enabled/restarts, doctor, replay, latest evidence age/block/errors/shots, secret-file permissions, and disk pressure;
- rollback and evidence-preservation steps are documented;
- Shadow-only/Canary boundaries are recorded in an ADR.

Evidence status: implemented locally and exercised on the production Shadow host on 2026-08-16. The service now uses the pinned application-owned Node `22.23.2`; disk pressure was reduced; the versioned artifact passed staged doctor/replay checks and the machine-readable post-deploy gate. Two subsequent batches advanced the cursor with zero errors and zero shots. Runtime deployment remains manual; repository CI and its required `verify` merge gate are active.
