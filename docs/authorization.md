# Authorization state

用户已经表达“开始实盘”的方向性意图，但这还不是一份可执行的风险授权。

当前缺少：

- 单次最大 gas（native wei）
- 单次失败 gas 上限
- 最低净利润
- 每日最大亏损
- 授权截止时间
- 经审计的 executor 合约地址
- 钱包地址与资金用途确认

因此当前授权记录为：

```text
requested_mode: live
effective_mode: shadow
sign: unsupported
broadcast: unsupported
max_live_loss: 0
```

任何缺口都不能通过环境变量的默认值自动绕过。即使误把 `LIVE_BROADCAST_ENABLED=true`，当前版本也没有签名或发送实现。
