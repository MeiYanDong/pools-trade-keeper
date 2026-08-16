# Race thesis

## Reward source

Pools Instant v4 池交易者支付的 LP fee。FeeSplitter 将复投份额归属到 `CompoundingClaimRecipient` 的具体 `tokenId`。

## Allocation and winner

- Allocation：`EXCLUSIVE_STATE_CLAIM`
- Public action：`claim(tokenId, minCurrency0Amount, minCurrency1Amount)`
- Completion invariant：callback 结束后，同一个 position 的 liquidity 至少增加 `1e20`
- Winner：当前状态下第一个成功完成 claim 与 invariant 的 executor
- Expiry：首个成功 claim、仓位状态改变、报价超出固定 block 或 validity envelope

链上排序最终由 Robinhood Chain 的包含顺序决定；更细的 sequencer 排序规则仍为 `UNKNOWN`。历史样本证明至少六套 EOA→executor 在持续竞争，不能把单笔正收益外推成我们的胜率。

## Signal ladder

1. PoolManager swap / fee growth：交易已经让某个 FeeSplitter 仓位积累手续费，是比 `AmountsReceived` 更早的公开因果信号。
2. PositionManager Transfer inventory：维护两个 FeeSplitter 拥有的完整 tokenId 集合。
3. PositionManager + StateView 同区块快照：计算尚未归集手续费、当前已归属金额、range、spot 和增加 `1e20` 的资产需求。
4. `AmountsReceived`：只是 collect 已发生的结果信号，可用于校准预测，不能当作唯一触发器。
5. 部署 V4Quoter 的 exact-output rebalance quote：把 spot 候选缩成报价候选；当前已实现 native→token 补足最小加仓缺口的方向。
6. 可执行 `collectFees → claim → callback → exit` fork 与真实 executor gas：证明报价候选能原子完成且不是纸面利润。
7. 本地门禁：只有授权、预算、时效、EV 下界和竞争样本同时通过，才可能产生 shot。

当前实现了 gap-free 仓位事件库存、固定区块 fee-growth 投影和 V4Quoter rebalance quote；原子 callback、完整退出、真实 gas 分布与条件胜率仍为 `UNKNOWN`，所以 shot policy 是 `NO_SHOT`。
