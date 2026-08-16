# ADR 0001: Shadow-only capability and release gates

- Status: accepted
- Date: 2026-08-16

## Context

The permissionless compounding callback can leave a native residual for the winning executor, and historical receipts prove that this has happened. That does not prove a currently claimable, executable opportunity for us. Per-position inventory, same-block state, swap cost, gas, stale state, race outcome, and failed-transaction cost can each reverse the decision.

The current codebase implements observation and evidence only. It does not implement the exact callback, a signer, transaction broadcast, or final token exit.

## Decision

1. `READ_ONLY_SHADOW` is the only effective runtime state.
2. Every candidate ends with `shotDecision: NO_SHOT`.
3. RPC uncertainty is `UNKNOWN` and can withhold a batch; it is never treated as negative economic evidence.
4. A multi-contract snapshot uses one fixed block.
5. Mark-to-market evidence and realized native residual receipts are labeled separately.
6. Merge readiness requires the local `npm run verify` gate and, once the repository is published, the same clean-checkout gate in GitHub Actions.
7. Deployment readiness requires an immutable build manifest. Runtime readiness additionally requires the read-only post-deploy check.

## Canary promotion gate

Canary work requires a separate ADR and explicit user authorization. Before that proposal can be accepted, the project must prove an exact executor callback simulation or fork replay, executable entry and exit quotes, our gas/failure distribution, conditional win probability, bounded loss budgets, reconciliation, and an independently reviewed signing boundary.

## Consequences

Historical positive receipts remain mechanism evidence, not permission to trade. A live Shadow service can be healthy while the strategy remains `CURRENT_UNCLAIMED_POSITIVE_EV_NOT_PROVEN`. Production disk pressure, stale evidence, artifact drift, a Node mismatch, any Shadow error, or any nonzero shot makes the post-deploy gate fail closed.
