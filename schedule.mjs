import { createHash } from 'node:crypto';
import { appendFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const TIME_ZONE = 'Asia/Shanghai';
const FIRST_HOUR = 8;
const LAST_HOUR = 18;

export function getBeijingParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    calendar: 'gregory',
    numberingSystem: 'latn',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );

  return {
    date: `${values.year}-${values.month}-${values.day}`,
    hour: Number(values.hour),
    minute: Number(values.minute),
  };
}

export function getTargetHour(dateKey, seed = 'agent-router-login') {
  const digest = createHash('sha256').update(`${seed}:${dateKey}`).digest();
  return FIRST_HOUR + (digest.readUInt32BE(0) % (LAST_HOUR - FIRST_HOUR + 1));
}

export function shouldRunAtHour(currentHour, targetHour) {
  return currentHour === targetHour;
}

async function writeOutput(name, value) {
  if (process.env.GITHUB_OUTPUT) {
    await appendFile(process.env.GITHUB_OUTPUT, `${name}=${value}\n`, 'utf8');
  }
}

async function main() {
  if (process.env.GITHUB_EVENT_NAME !== 'schedule') {
    console.log('手动运行：跳过每日小时门控。');
    await writeOutput('should_run', 'true');
    return;
  }

  const current = getBeijingParts();
  const targetHour = getTargetHour(current.date, process.env.GITHUB_REPOSITORY);
  const shouldRun = shouldRunAtHour(current.hour, targetHour);

  console.log(
    `北京时间 ${current.date} ${String(current.hour).padStart(2, '0')}:${String(current.minute).padStart(2, '0')}，今日目标小时为 ${targetHour}:00，${shouldRun ? '执行登录' : '跳过'}。`,
  );
  await writeOutput('should_run', String(shouldRun));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`调度检查失败：${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
