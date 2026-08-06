import assert from 'node:assert/strict';
import test from 'node:test';

import { openLoginSession, parseAccounts, runAccounts } from '../login.mjs';

test('parseAccounts parses account fields with SOCKS5', () => {
  const accounts = parseAccounts(JSON.stringify([
    {
      name: ' 账号 1 ',
      username: 'user@example.com',
      password: 'secret',
      socks5: 'socks5://208.102.51.6:58208',
    },
  ]));

  assert.deepEqual(accounts, [
    {
      name: '账号 1',
      username: 'user@example.com',
      password: 'secret',
      socks5: 'socks5://208.102.51.6:58208',
    },
  ]);
});

test('parseAccounts accepts missing or empty SOCKS5', () => {
  const accounts = parseAccounts(JSON.stringify([
    {
      name: '账号 1',
      username: 'one@example.com',
      password: 'secret-1',
    },
    {
      name: '账号 2',
      username: 'two@example.com',
      password: 'secret-2',
      socks5: '  ',
    },
  ]));

  assert.equal(accounts[0].socks5, null);
  assert.equal(accounts[1].socks5, null);
});

test('parseAccounts rejects missing credentials', () => {
  assert.throws(
    () => parseAccounts(JSON.stringify([
      {
        name: '账号 1',
        username: '',
        password: 'secret',
        socks5: 'socks5://208.102.51.6:58208',
      },
    ])),
    /username/,
  );
});

test('parseAccounts rejects authenticated or non-SOCKS5 proxies', () => {
  const base = { name: '账号 1', username: 'user', password: 'secret' };

  assert.throws(
    () => parseAccounts(JSON.stringify([{ ...base, socks5: 'socks5://user:pass@host:1080' }])),
    /不支持用户名密码认证/,
  );
  assert.throws(
    () => parseAccounts(JSON.stringify([{ ...base, socks5: 'http://host:8080' }])),
    /无认证 socks5/,
  );
});

function createFakeBrowser({ failProxy = false } = {}) {
  const options = [];
  const contexts = [];
  const browser = {
    async newContext(contextOptions) {
      options.push(contextOptions);
      const context = {
        closed: false,
        async newPage() {
          return {
            setDefaultTimeout() {},
            setDefaultNavigationTimeout() {},
            async goto() {
              if (failProxy && contextOptions.proxy) {
                throw new Error('proxy unavailable');
              }

              return { ok: () => true, status: () => 200 };
            },
          };
        },
        async close() {
          context.closed = true;
        },
      };
      contexts.push(context);
      return context;
    },
  };

  return { browser, options, contexts };
}

test('openLoginSession uses direct network when SOCKS5 is missing', async () => {
  const fake = createFakeBrowser();
  const session = await openLoginSession(fake.browser, { name: '账号 1', socks5: null }, () => {});

  assert.deepEqual(fake.options, [{ locale: 'zh-CN' }]);
  await session.context.close();
});

test('openLoginSession keeps using SOCKS5 when it can connect', async () => {
  const fake = createFakeBrowser();
  const logs = [];
  const session = await openLoginSession(
    fake.browser,
    { name: '账号 1', socks5: 'socks5://proxy.example:1080' },
    (message) => logs.push(message),
  );

  assert.deepEqual(fake.options, [
    { locale: 'zh-CN', proxy: { server: 'socks5://proxy.example:1080' } },
  ]);
  assert.deepEqual(logs, []);
  await session.context.close();
});

test('openLoginSession falls back to direct network when SOCKS5 cannot connect', async () => {
  const fake = createFakeBrowser({ failProxy: true });
  const logs = [];
  const session = await openLoginSession(
    fake.browser,
    { name: '账号 1', socks5: 'socks5://proxy.example:1080' },
    (message) => logs.push(message),
  );

  assert.deepEqual(fake.options, [
    { locale: 'zh-CN', proxy: { server: 'socks5://proxy.example:1080' } },
    { locale: 'zh-CN' },
  ]);
  assert.equal(fake.contexts[0].closed, true);
  assert.deepEqual(logs, ['账号 1：SOCKS5 无法连接登录页，改用 GitHub Actions 网络直连']);
  await session.context.close();
});

test('runAccounts stays sequential and continues after a failure', async () => {
  const accounts = [
    { name: '账号 1', username: 'one', password: 'one-secret', socks5: 'socks5://host1:1001' },
    { name: '账号 2', username: 'two', password: 'two-secret', socks5: 'socks5://host2:1002' },
    { name: '账号 3', username: 'three', password: 'three-secret', socks5: 'socks5://host3:1003' },
  ];
  const order = [];
  let active = 0;
  let maxActive = 0;

  const results = await runAccounts(
    accounts,
    async (account) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      order.push(account.name);

      try {
        await new Promise((resolve) => setTimeout(resolve, 5));
        if (account.name === '账号 2') {
          throw new Error(`login failed for ${account.username}`);
        }
      } finally {
        active -= 1;
      }
    },
    () => {},
  );

  assert.equal(maxActive, 1);
  assert.deepEqual(order, ['账号 1', '账号 2', '账号 3']);
  assert.deepEqual(results, [
    { name: '账号 1', success: true },
    { name: '账号 2', success: false, message: 'login failed for ***' },
    { name: '账号 3', success: true },
  ]);
});
