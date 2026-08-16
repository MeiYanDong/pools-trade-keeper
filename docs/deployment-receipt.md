# Deployment receipt — 2026-08-15

## Control plane

- Provider/type: Alibaba Cloud SWAS
- Region: `us-west-1`
- Instance: `061a4d28fb5a43bbabf92da7583e0cbe`
- Public IP: `47.251.28.201`
- Instance state: `Running`, business status `Normal`
- OS: Ubuntu 24.04
- Capacity: 2 vCPU, 2 GiB RAM, 40 GiB disk
- Cloud Assistant: active
- SSH path used for deployment: TCP 2222
- Disk at deployment readback: 91% used, about 3.7 GiB free

## Installed artifact

- Application: `/opt/pools-trade-keeper`
- Runtime data: `/var/lib/pools-trade-keeper`
- Secret/config directory: `/etc/pools-trade-keeper`
- Runtime user: `pools-keeper`
- Unit: `/etc/systemd/system/pools-trade-shadow.service`
- Local/remote `dist/src` manifest SHA-256: `bef0829d19202da89774d8e9e7259beb3b40a9f2bac712fe52aa1daa99c0e1bc`
- Compiled CLI SHA-256: `b057ff00c6fe6c52c250c7132f79a21ec47e63b512c26d78a840832dabfb1c61`
- Production dependencies: `viem@2.55.10`, `zod@4.4.3`

## Remote verification

- Historical economic fixture replay: `PASS`
- Read-only chain doctor: `PASS` at block `37183761`
- Chain ID: 4663
- Recipient/FeeSplitters/PositionManager/StateView bytecode: present
- Recipient `minLiquidityIncrease`: `1e20`
- Recipient PositionManager binding: matched

Remote range smoke test:

```text
blocks: 37084000..37184212
AmountsReceived: 213
Claimed: 30
PositionManager transfers to configured FeeSplitters: 183
unique tokenIds: 254
shadow fixed block: 37186715
positions evaluated: 20
positive spot candidates: 0
shots: 0
errors: 0
```

The public-RPC smoke briefly returned malformed JSON-RPC batch errors. Client-side batching was disabled and retry count raised to three; the final 20-position rerun completed with 20 decisions, zero errors and zero candidates. This is a transport robustness fix, not evidence that the strategy is profitable.

The watch scheduler persists a round-robin cursor, so successive batches advance through the inventory instead of rescanning the same sorted prefix.

Final artifact readback at block `37188368`: 3/3 `NEGATIVE_AT_SPOT`, 0 errors, cursor advanced from absent to index 3; local and remote runtime manifests matched. The unit remained disabled/inactive.

Production-RPC full fixed-block validation at block `37226981`:

```text
gap-free relevant-event inventory: 38,641 tokenIds
evaluated: 38,639
negative at spot: 38,629
positive at spot: 10
unknown: 2
V4Quoter + modeled historical gas negative: 10/10
quote candidates: 0
shots: 0
```

The service was then enabled and started. Two consecutive readbacks used the same PID with zero restarts, 100/100 `NEGATIVE_AT_SPOT` per batch, zero errors and a cursor advance from 3 to 203. The deployed candidate path also reproduced `tokenId 499858` as one spot candidate but zero quote candidates.

Later live readback: the same service PID remained active with zero restarts, inventory advanced to block `37239507` with `38,679` tokenIds, and the round-robin cursor reached `4,503`. One organic 100-position batch contained one spot candidate; the integrated V4Quoter reduced it to zero quote candidates, with zero errors and zero shots. Credentialed WSS also passed an `eth_chainId=4663` handshake; event-subscription latency is not yet measured.

## State boundary

`shadow_running_read_only`

- systemd unit is `enabled` and `active`; its write surface is local evidence/inventory only.
- Credentialed HTTP/WSS endpoints are stored only in root-owned mode-`0600` `/etc/pools-trade-keeper/keeper.env`; the token is not in the repository.
- No wallet or private key exists on the server.
- The relevant-event inventory is gap-free from block `28519117`, 1,000 blocks before the earliest observed relevant PositionManager transfer, through its recorded watermark.
- Executor, exact callback simulation, executable exit, signing and broadcast remain unsupported.
- Sending a transaction is not authorized by this receipt.

## Read-only runtime audit — 2026-08-16 09:32:59Z

This is a current-state audit, not a deployment receipt for the engineering changes dated 2026-08-16. No production file, process, service, firewall rule, environment variable, or evidence record was changed.

- SWAS control plane: instance `061a4d28fb5a43bbabf92da7583e0cbe` remained `Running` with business status `Normal` in `us-west-1`.
- Service: `active` and `enabled`; main PID `839`; `NRestarts=0`; active since `2026-08-16 15:51:31 CST`; zero warning-priority journal entries in the preceding 24 hours.
- Secret boundary: `/etc/pools-trade-keeper/keeper.env` remained `0600 root:root`.
- Read-only doctor: `PASS` at block `37870915`; chain ID and all deployed bindings matched; effective mode `shadow`; `liveAuthorized=false`.
- Latest persisted batch: observed `2026-08-16T09:32:37.801Z`, fixed block `37870672`, 100 positions, 0 spot candidates, 0 quote candidates, 0 errors, 0 shots.
- Gap-free inventory: `28519117..37870671`, `39,372` tokenIds.
- Runtime replay: `PASS`, but the deployed artifact still contains only the previous single historical fixture.
- Release blockers at this audit point: the service uses server Node.js `18.19.1`, while the repository baseline is `22.23.2`; root disk usage remains `91%` with about `3.6 GiB` available, above the new 89% fail-closed limit.

The new local artifact, three-fixture replay, CI workflow, and `deploy/verify-shadow.sh` were **not deployed**. Therefore CI/CD remains manual and the new post-deploy gate has not been executed on the host.

## Versioned Shadow release — 2026-08-16 10:00Z

This section supersedes the release blockers in the preceding read-only audit. It records an actual production deployment of the read-only Shadow service; it does not authorize signing or broadcasting.

### Host prerequisites repaired

- Installed an application-owned Node.js `22.23.2` runtime at `/opt/pools-trade-runtime/node-v22.23.2`, after matching the official Linux x64 archive to SHA-256 `d60acfe00a2932254bb0ad20e01b0d74397a0875595de719654b214f4b03f307`.
- Installed `/etc/systemd/journald.conf.d/90-pools-trade-disk-budget.conf` with `SystemMaxUse=1G` and `SystemKeepFree=4G`.
- Persistent journal usage fell from `1.9G` to `918.1M`; the removed older journal history is not recoverable.
- `apt-get clean` reduced the reproducible apt archive cache from `227,391,810` bytes to `0`.
- Root filesystem usage fell from `91%` (`3,749,732 KiB` available) to `87%` before staging and settled at `89%` (`4,652,524 KiB` available) after retaining the runtime and rollback releases.
- No Pools evidence, inventory, secret file, or unrelated application release was deleted.

### Artifact and cutover

- Active release: `/opt/pools-trade-keeper-releases/20260816T095806Z`.
- Stable application path: `/opt/pools-trade-keeper` is a symlink to that release.
- Release archive SHA-256: `c300edb2d68a998feb3fc207aeab0f5959e776e1f337ef60059c109e26d2254b`.
- Release manifest: `110` files; SHA-256 `cad8a7a9897893c87095f6d22a1e0a246662441290f6c0af3b9f8e37d2fe1f93` locally and on the active host.
- Production install used `npm ci --omit=dev --ignore-scripts`; 16 packages were installed from the lockfile.
- The staged artifact passed the high-confidence secret scan, manifest verification, read-only doctor at block `37886266`, and all three historical receipt replays before cutover.
- systemd drop-in `/etc/systemd/system/pools-trade-shadow.service.d/10-runtime.conf` binds the service to the application-owned Node binary. Final main PID: `9950`; `NRestarts=0`; state `active/running` and `enabled`.
- Retained rollback directories: `20260816T095615Z` and `pre-20260816T095615Z`.
- Removed only two never-active staging directories after success: `20260816T095300Z` (`75,684,552` bytes) and `20260816T095518Z` (`75,657,038` bytes), plus their temporary `/tmp` archives.

The first staged archive was correctly rejected because macOS had inserted 103 AppleDouble `._*` files. `deploy/package-release.sh` now suppresses AppleDouble/xattr metadata and rejects any remaining `._*` entry. A second presentation-only failure exposed mixed text plus JSON from the post-deploy verifier; the final verifier suppresses the manifest status line and emits one machine-readable JSON document.

### Runtime proof after cutover

Two batches produced by the final PID after its `2026-08-16 17:59:01 CST` start:

```text
fixed block 37886793: 100 evaluated, cursor 7460, 100 NEGATIVE_AT_SPOT, 0 errors, 0 shots
fixed block 37887112: 100 evaluated, cursor 7560, 100 NEGATIVE_AT_SPOT, 0 errors, 0 shots
```

Inventory readback: gap-free scan `28519117..37887110`, `39,379` tokenIds, `32,130` AmountsReceived events, `7,155` Claimed events, and `39,379` relevant PositionManager transfers.

Final command:

```bash
NODE_BIN=/opt/pools-trade-runtime/node-v22.23.2/bin/node \
  bash /opt/pools-trade-keeper/deploy/verify-shadow.sh
```

Final result: `PASS`, mode `READ_ONLY_SHADOW`, Node `22.23.2`, restarts `0`, evidence age `8s`, evidence block `37887112`, doctor block `37887207`, disk used `89%`, shots `0`.

Follow-up single-position read at block `37889419`: `tokenId 499858` remained one `QUOTE_CANDIDATE`, but its residual after the exact-output V4Quoter amount and modeled historical successful gas was only `1,968,079,841,114 wei` (`0.000001968079841114 ETH`). The evidence still returned `NO_SHOT` because exact callback simulation, FeeSplitter standing balance, conditional win probability, failed-transaction gas, signing, and broadcast are unresolved. This is a thin research signal, not executable or realized profit.

### Remaining boundary

- Deployment remains manual; the GitHub Actions workflow is defined locally but has no remote run or required-check evidence.
- The current unclaimed inventory has not been proven positive EV. These batches are negative-at-spot observations, not a profitability promise.
- Executor callback simulation, signing, broadcast, transaction reconciliation, and executable exit remain unsupported. No wallet or private key was added to production.
