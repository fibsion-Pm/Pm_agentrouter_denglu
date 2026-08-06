import assert from 'node:assert/strict';
import test from 'node:test';

import { parseAccounts, runAccounts } from '../login.mjs';
import { getBeijingParts, getTargetHour, shouldRunAtHour } from '../schedule.mjs';

test('parseAccounts parses the required account fields', () => {
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

test('daily target hour stays within Beijing 08:00-18:00', () => {
  const current = getBeijingParts(new Date('2026-08-06T00:07:00.000Z'));
  const first = getTargetHour(current.date, 'test-repository');
  const second = getTargetHour(current.date, 'test-repository');

  assert.deepEqual(current, { date: '2026-08-06', hour: 8, minute: 7 });
  assert.equal(first, second);
  assert.ok(first >= 8 && first <= 18);
  assert.equal(shouldRunAtHour(first, first), true);
  assert.equal(shouldRunAtHour(first === 8 ? 9 : 8, first), false);
});
