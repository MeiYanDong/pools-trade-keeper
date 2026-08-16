# Pools.trade Fee-Compounding Keeper

[![quality](https://github.com/MeiYanDong/pools-trade-keeper/actions/workflows/quality.yml/badge.svg?branch=main)](https://github.com/MeiYanDong/pools-trade-keeper/actions/workflows/quality.yml)

这是一个面向 Robinhood Chain 的 Pools.trade 复投 Keeper。第一版是**生产链只读 Shadow**：它读取真实合约、按 `tokenId` 固定同一区块状态、计算增加 `1e20` 流动性所需的双边资产，并留下可回放的证据。

## 大白话机制

每个 Pools Instant 池都会产生手续费。任何人都可以先调用 FeeSplitter 归集仓位尚未领取的手续费，它会把复投份额记到 `CompoundingClaimRecipient` 的具体 `tokenId`。随后任何人都能发起领取，但领取者必须在同一笔交易里给这个仓位至少增加 `1e20` 流动性。完成后，多出来的 ETH 和 token 可以归执行者。

只等 `AmountsReceived` 事件会落后：更早的公开信息是交易造成的 fee growth。扫描器因此同时追踪 PositionManager 转给两个 FeeSplitter 的仓位，并在固定区块计算“如果现在先 collect、再 claim”会得到多少。

所以真正的问题不是“合约里有多少钱”，而是：

```text
这个 tokenId 能领到的钱
- 当前价格和区间下，完成最小加仓所需的钱
- 交换、滑点、成功 gas、失败 gas、竞争和退出成本
= 我们真正可能留下的钱
```

第一个成功的人拿到当前这份机会；别人再发同一份机会，要么拿不到，要么交易回滚。因此这是 `EXCLUSIVE_STATE_CLAIM` 竞速。

## 当前安全边界

- `sign` 与 `broadcast` 能力是 `UNSUPPORTED`，代码中没有发送交易的路径。
- 当前退出报价、条件胜率和未领取库存的正净 EV 尚未证明。
- `OPERATION_MODE=shadow` 是唯一可运行模式。
- 钱包命令只会在用户自己的终端交互式生成并加密保存私钥，只显示地址；没有导出私钥命令。
- RPC 凭证只能放在本机或服务器环境文件中，不能提交进仓库。

## 2026-08-15 主网回执

- gap-free 相关事件库存：区块 `28519117..37226981`，共 `38,641` 个 tokenId。
- 同块全量估值：`38,639` 个可评估，`38,629` 个 spot 为负，`10` 个 spot 为正，`2` 个 unknown，`0` shot。
- 10 个 spot 候选全部经过部署的 V4Quoter exact-output `eth_call`；按已验证历史成功交易的 `549,493` gas units 与当时 gas price 建模后，10/10 为负，最终 candidate 为 0。
- SWAS 上的主网 Shadow 服务已 `enabled/active`；它会自动同步库存、round-robin 扫描，并对 spot 候选做 Quoter 二次过滤。

这只证明该固定区块没有通过当前保守模型的候选，不证明未来永远没有机会；callback fork、我方真实 gas 分布和条件胜率仍未知。

## 本地使用

工程基线固定为 [`.node-version`](./.node-version) 中的 Node.js 版本。第一次检出或依赖变化后使用锁文件安装；不要复用其他项目的 `node_modules`：

```bash
npm ci
npm run verify
```

`verify` 是本仓库唯一的合并前门禁：它依次验证 sniper spec、凭据扫描、格式、lint、类型、31 项业务测试、部署脚本语法、干净编译产物和 SHA-256 发布清单。GitHub Actions 在干净检出的托管 runner 上执行同一命令；公开仓库的 `main` 已将 GitHub Actions App 提供的 `verify` 配置为严格 required check，管理员也不能绕过。

先在你自己的交互式终端安全写入生产 RPC。输入内容不会显示，也不会进入 shell 历史；文件保存在被 Git 忽略的 `secrets/keeper.env`，权限为 `0600`：

```bash
npm run rpc:init
```

此后 CLI 会自动加载该文件，无需在命令行再次粘贴令牌。

```bash
npm run doctor
npm run snapshot -- --token-id 624742
npm run quote-candidate -- --token-id 499858
```

完整历史扫描必须先确认部署块：

```bash
npm run deployment-block
# 如果 RPC 不是 archive，可从最早相关链上事件确定安全回填起点：
npm run inventory-start -- --probe-blocks 1000000
export BACKFILL_FROM_BLOCK='<已验证部署块>'
npm run backfill
npm run bulk-shadow
npm run shadow -- --sync
```

创建本机加密钱包（需要真实 TTY，Codex 不代为执行）：

```bash
npm run wallet:init
npm run wallet:address
```

## 从 Shadow 升级到 Canary 的必要条件

1. 全量库存可复现，且没有漏块。
2. exact callback fork/模拟通过，真实退出报价已接入。
3. 有足够的正样本、负样本、过期样本和竞速失败样本。
4. 保守 EV 下界为正，并证明我们自己的条件胜率。
5. 用户明确给出单次 gas、失败 gas、每日最大亏损和授权有效期。
6. 独立审计 executor 合约后，才允许增加签名与广播能力。

Shadow watch 使用持久化 round-robin 游标，不会永远重复扫描 tokenId 排序后的同一小段；这只保证逐步覆盖，不代表已经具备按 EV 排序的低延迟调度器。

持续运行时，负样本只写一条批次摘要（区块、tokenId、分类计数），候选与错误才保留完整快照，避免 2 GiB 服务器被高频全量 JSONL 很快写满。

部署源码绑定与机制证据固定在 Uniswap `liquidity-launcher` 的提交 `dd8769cd45c0e9450e928513ee129b0af74f7f32`，不要直接跟随仓库 `main` 的破坏性变更。

工程验收卡见 [`docs/engineering-quality.md`](./docs/engineering-quality.md)，Shadow/Canary 决策见 [`docs/adr/0001-shadow-only-release-gates.md`](./docs/adr/0001-shadow-only-release-gates.md)，贡献与提交约定见 [`CONTRIBUTING.md`](./CONTRIBUTING.md)。
