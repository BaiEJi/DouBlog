// bench 客户端：读场景 JSON，顺序 autocannon，输出汇总 JSON 到 stdout。
// 用法: node bench_client.mjs <scenarios.json> <duration_s> <warmup_s>
// autocannon 8 兼容：track() 返回值不可靠——改用 promisify(autocannon) 直接拿结果实例；
// latency 单位已是 ms（旧版 µs），不再除以 1000；p99 键名用 p99。
import { promisify } from 'node:util';
import autocannon from 'autocannon';
import { readFileSync } from 'node:fs';

const fire = promisify(autocannon);

const [file, durArg, warmArg] = process.argv.slice(2);
const scenarios = JSON.parse(readFileSync(file, 'utf8'));
const duration = +durArg || 15;
const warmup = +warmArg || 3;

async function run(s, dur) {
  return fire({
    url: s.url,
    connections: 20,
    duration: dur,
    method: s.method,
    headers: s.headers,
    body: s.body ?? undefined,
    timeout: 30,
  });
}

const out = {};
for (const s of scenarios) {
  await run(s, warmup);                      // 预热（丢弃）
  process.stderr.write(`  ${s.name} ... `);
  const j = await run(s, duration);          // 计分
  out[s.name] = {
    rps: +j.requests.average.toFixed(1),
    p50_ms: +(j.latency.average || 0).toFixed(2),
    p99_ms: +(j.latency.p99 ?? j.latency.p99_0 ?? 0).toFixed(2),
    errors: j.errors,
    non2xx: j.non2xx,
  };
  process.stderr.write(`${out[s.name].rps} rps  p99=${out[s.name].p99_ms}ms non2xx=${j.non2xx}\n`);
}
console.log(JSON.stringify(out));
