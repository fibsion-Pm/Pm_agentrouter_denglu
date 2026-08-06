# GitHub Actions 多账号登录

## 功能

工作流手动启动或到达每日调度时间后，从仓库 Secret `ACCOUNTS_JSON` 读取账号，并按数组顺序依次登录 Agent Router。每个账号使用独立 Chromium 浏览器上下文和自己的 SOCKS5 代理，单个账号失败不会阻断后续账号。

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
    "password": "password2",
    "socks5": "socks5://208.102.51.6:58208"
  }
]
```

`name` 只用于结果汇总，应使用不包含真实邮箱的别名。不要将真实凭据写入仓库文件或工作流 YAML。

当前只接受无认证的 `socks5://host:port`。不要把用户名密码写进 SOCKS5 URL；Playwright 官方接口没有在 SOCKS5 场景承诺该认证方式。

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
- 页面离开 `/login` 后判定该账号登录成功。

## 每日调度

- GitHub Actions 按 `Asia/Shanghai` 时区在北京时间 08、09、……18 点各触发一次，实际触发时刻为该小时的第 7 分钟。
- `schedule.mjs` 根据北京时间日期和仓库名计算当天 08-18 之间的一个稳定伪随机小时；只有该小时执行登录，其余小时快速跳过。
- 手动 `workflow_dispatch` 不经过时间门控，会立即执行。
- GitHub 定时任务可能延迟或被丢弃，因此这是近似调度，不是硬实时保证。

## 限制

- 当前流程不处理验证码、两步验证或额外人工确认。
- 真实账号登录需要在 GitHub Actions 中运行后才能最终验证。
- 日志只输出账号别名。脚本会在 GitHub Actions 中额外屏蔽解析出的账号、密码和 SOCKS5 地址。

## 回滚

删除 `.github/workflows/login.yml`、`login.mjs`、`package.json`、`package-lock.json`、`test/` 和本说明文件即可移除该自动登录功能。
