import { appendFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const LOGIN_URL = 'https://agentrouter.org/login';
const LOGIN_TIMEOUT_MS = 30_000;

export function parseAccounts(rawAccounts) {
  if (typeof rawAccounts !== 'string' || rawAccounts.trim() === '') {
    throw new Error('未配置 GitHub Secret：ACCOUNTS_JSON');
  }

  let parsed;
  try {
    parsed = JSON.parse(rawAccounts);
  } catch {
    throw new Error('ACCOUNTS_JSON 不是有效的 JSON');
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('ACCOUNTS_JSON 必须是非空数组');
  }

  return parsed.map((account, index) => {
    const position = index + 1;
    if (!account || typeof account !== 'object' || Array.isArray(account)) {
      throw new Error(`第 ${position} 个账号必须是对象`);
    }

    for (const field of ['name', 'username', 'password', 'socks5']) {
      if (typeof account[field] !== 'string' || account[field].trim() === '') {
        throw new Error(`第 ${position} 个账号缺少有效的 ${field}`);
      }
    }

    let proxyUrl;
    try {
      proxyUrl = new URL(account.socks5.trim());
    } catch {
      throw new Error(`第 ${position} 个账号的 socks5 不是有效 URL`);
    }

    const proxyPort = Number(proxyUrl.port);
    if (
      proxyUrl.protocol !== 'socks5:' ||
      proxyUrl.hostname === '' ||
      !Number.isInteger(proxyPort) ||
      proxyPort < 1 ||
      proxyPort > 65535
    ) {
      throw new Error(`第 ${position} 个账号的 socks5 必须是无认证 socks5://host:port`);
    }

    if (proxyUrl.username || proxyUrl.password) {
      throw new Error(`第 ${position} 个账号的 socks5 不支持用户名密码认证`);
    }

    return {
      name: account.name.trim().replace(/\s+/g, ' '),
      username: account.username,
      password: account.password,
      socks5: account.socks5.trim(),
    };
  });
}

function escapeWorkflowCommand(value) {
  return value
    .replaceAll('%', '%25')
    .replaceAll('\r', '%0D')
    .replaceAll('\n', '%0A');
}

function maskCredentials(accounts) {
  if (process.env.GITHUB_ACTIONS !== 'true') {
    return;
  }

  for (const account of accounts) {
    console.log(`::add-mask::${escapeWorkflowCommand(account.username)}`);
    console.log(`::add-mask::${escapeWorkflowCommand(account.password)}`);
    console.log(`::add-mask::${escapeWorkflowCommand(account.socks5)}`);
  }
}

function sanitizeError(error, account) {
  let message = error instanceof Error ? error.message : String(error);

  for (const secret of [account.username, account.password, account.socks5]) {
    if (secret) {
      message = message.replaceAll(secret, '***');
    }
  }

  return message.split('\n')[0].slice(0, 300);
}

export async function runAccounts(accounts, loginAccount, log = console.log) {
  const results = [];

  for (const [index, account] of accounts.entries()) {
    log(`[${index + 1}/${accounts.length}] ${account.name}：开始登录`);

    try {
      await loginAccount(account);
      results.push({ name: account.name, success: true });
      log(`[${index + 1}/${accounts.length}] ${account.name}：登录成功`);
    } catch (error) {
      const message = sanitizeError(error, account);
      results.push({ name: account.name, success: false, message });
      log(`[${index + 1}/${accounts.length}] ${account.name}：登录失败 - ${message}`);
    }
  }

  return results;
}

async function loginWithBrowser(browser, account) {
  const context = await browser.newContext({
    locale: 'zh-CN',
    proxy: { server: account.socks5 },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(LOGIN_TIMEOUT_MS);
  page.setDefaultNavigationTimeout(LOGIN_TIMEOUT_MS);

  try {
    await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded' });

    const usernameInput = page.locator('#username');
    if (!(await usernameInput.isVisible())) {
      await page
        .getByRole('button', { name: /使用 邮箱或用户名 登录/ })
        .click();
    }

    await usernameInput.fill(account.username);
    await page.locator('#password').fill(account.password);

    await Promise.all([
      page.waitForURL(
        (url) => url.origin === 'https://agentrouter.org' && url.pathname !== '/login',
        { waitUntil: 'domcontentloaded' },
      ),
      page.getByRole('button', { name: '继续', exact: true }).click(),
    ]);
  } finally {
    await context.close();
  }
}

function escapeMarkdown(value) {
  return value.replaceAll('|', '\\|').replaceAll('\n', ' ');
}

async function writeSummary(results) {
  const succeeded = results.filter((result) => result.success).length;
  const failed = results.length - succeeded;

  console.log(`\n执行完成：成功 ${succeeded} 个，失败 ${failed} 个。`);

  if (!process.env.GITHUB_STEP_SUMMARY) {
    return;
  }

  const rows = results.map((result) => {
    const status = result.success ? '成功' : '失败';
    const note = result.success ? '-' : escapeMarkdown(result.message);
    return `| ${escapeMarkdown(result.name)} | ${status} | ${note} |`;
  });

  const summary = [
    '# Agent Router 登录结果',
    '',
    `成功：${succeeded}，失败：${failed}`,
    '',
    '| 账号别名 | 结果 | 说明 |',
    '| --- | --- | --- |',
    ...rows,
    '',
  ].join('\n');

  await appendFile(process.env.GITHUB_STEP_SUMMARY, summary, 'utf8');
}

async function main() {
  const accounts = parseAccounts(process.env.ACCOUNTS_JSON);
  maskCredentials(accounts);

  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });

  let results;
  try {
    results = await runAccounts(accounts, (account) => loginWithBrowser(browser, account));
  } finally {
    await browser.close();
  }

  await writeSummary(results);

  if (results.some((result) => !result.success)) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`执行失败：${message.split('\n')[0]}`);
    process.exitCode = 1;
  });
}
