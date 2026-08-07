# GitHub Actions 多账号登录

## 功能

工作流手动启动或到达每日调度时间后，从仓库 Secret `ACCOUNTS_JSON` 读取账号，并按数组顺序依次登录 Agent Router。每个账号使用独立 Chromium 浏览器上下文，可选择自己的 SOCKS5 代理，单个账号失败不会阻断后续账号。

全部账号处理完成后，GitHub Actions 页面会显示成功和失败汇总；只要存在一个失败账号，任务最终状态就是失败。

## 配置账号

在 GitHub 仓库中打开 `Settings` -> `Secrets and variables` -> `Actions`，创建 Repository secret：

- Name：`ACCOUNTS_JSON`
- Secret：使用以下 JSON 数组格式

```json
[
  {
    "name": "账号1",
    "username": "account1@example.com",
    "password": "password1",
    "socks5": "socks5://208.102.51.6:58208"
  },
  {
    "name": "账号2",
    "username": "account2@example.com",
    "password": "password2"
  }
]
```

`name` 只用于结果汇总，应使用不包含真实邮箱的别名。不要将真实凭据写入仓库文件或工作流 YAML。

`socks5` 是可选字段。未配置、配置为 `null` 或留空时，该账号使用 GitHub Actions 网络直接登录。配置代理时只接受无认证的 `socks5://host:port`；不要把用户名密码写进 SOCKS5 URL。

如果 SOCKS5 无法创建浏览器连接、无法打开登录页或登录页返回错误状态，脚本会关闭代理连接，并使用 GitHub Actions 网络直连重试一次。登录页成功打开后发生的账号密码错误、验证码或页面操作错误不会触发直连重试。

## 运行

1. 将本目录内容提交到 GitHub 仓库。
2. 打开仓库的 `Actions` 页面。
3. 选择 `Agent Router 多账号登录`。
4. 点击 `Run workflow`。
5. 执行结束后，在 Job Summary 查看逐账号结果。

## 登录规则

- 登录页面：`https://agentrouter.org/login`
- 登录入口：`使用 邮箱或用户名 登录`
- 账号字段：`#username`
- 密码字段：`#password`
- 提交按钮：`继续`
- 提交后先等待页面离开 `/login`，再访问受保护页面 `/console/topup`。
- 只有受保护页面返回成功状态且最终地址仍位于 `/console` 下，才判定该账号登录成功；被送回 `/login` 时判定失败。

## 每日调度

- 工作流使用标准 UTC cron `7 0 * * *`，在 UTC 每天 00:07 触发，对应北京时间每天 08:07。
- 手动 `workflow_dispatch` 会立即执行，不受自动调度时间限制。
- GitHub 定时任务可能延迟或被丢弃，因此不能保证绝对准时或绝不漏跑。

## 最新运行记录

- 每次任务结束后，工作流会覆盖根目录 `latest-run.md`，只展示最近一次运行的北京时间和成功/失败状态。
- 登录步骤成功时记录“成功”；登录失败或因前序步骤失败而未执行时记录“失败”。
- 工作流使用 `github-actions[bot]` 将记录提交到本次运行所在分支，并使用并发组避免本工作流同时推送。
- `latest-run.md` 正文只保留最新一条记录，但 Git 提交历史仍会保存以前的文件版本。
- 使用仓库 `GITHUB_TOKEN` 创建的提交不会再次触发普通工作流运行，因此不会形成递归执行。
- 自动提交需要 `contents: write`。如果默认分支保护、仓库规则或组织策略禁止 GitHub Actions 推送，记录步骤会失败。
- 公开仓库连续 60 天没有仓库活动时，GitHub 可能自动停用定时工作流。每日记录提交可以形成仓库活动并降低该风险，但不能保证工作流绝不会因平台、权限或仓库状态而停止。
- 如果检出仓库失败、任务被强制取消或提交推送失败，本次记录可能无法更新。

## 限制

- 当前流程不处理验证码、两步验证或额外人工确认。
- 真实账号登录需要在 GitHub Actions 中运行后才能最终验证。
- 日志只输出账号别名。脚本会在 GitHub Actions 中额外屏蔽解析出的账号、密码和已配置的 SOCKS5 地址。

## 回滚

删除 `.github/workflows/login.yml`、`latest-run.md`、`login.mjs`、`package.json`、`package-lock.json`、`test/` 和本说明文件即可移除该自动登录功能。
