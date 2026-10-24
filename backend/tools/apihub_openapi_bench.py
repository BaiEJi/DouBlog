"""apihub 本机 OpenAPI 串行 A/B 性能对照工具（协作方案 §10，zcode 实现）。

对同一数据/同一环境/同一设备的运行中实例顺序压测，报告吞吐与 p50/p95/p99/错误数；
每次响应校验业务内容（防"快而无果"）。**禁止真实配置写压测**——仅只读 GET/invoke。

用法（服务已按 apihub_local.py serve 启动，候选=当前分支，基线=git archive 快照）::

    python tools/apihub_openapi_bench.py --registry <登记表> \
        --target http://127.0.0.1:20061 --token <SK_TOKEN> \
        [--cases invoke-ns,invoke-key,get-ns,get-key] [--rounds 3] \
        [--concurrency 1,8,32] [--requests 300] --out ../.ui-qa/apihub/ab/result.json

- invoke-ns / invoke-key：POST /gw/apis/{slug}（候选与基线共有的对照路径）；
- get-ns / get-key：原生 GET（新功能，单列容量数据，不与不存在的基线 GET 比较）；
- 每轮每并发顺序执行（同一时刻只跑一个压测实例），轮内统计：
  吞吐(req/s)、p50/p95/p99(ms)、成功/失败数、内容校验失败数；
- token 只从参数/环境 APIHUB_BENCH_TOKEN 读取，不写入输出（输出仅 key_hint）。
"""

import argparse
import concurrent.futures
import json
import os
import statistics
import sys
import time
import urllib.error
import urllib.request

GW = '/api/apihub/gw'


def _http_json(url, payload, token, timeout):
    """同步 JSON POST/GET（urllib 零依赖）；返回 (ok, status, latency_ms, body)。"""
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(url, data=data, method='POST' if data is not None else 'GET')
    if data is not None:
        req.add_header('Content-Type', 'application/json')
    req.add_header('Authorization', f'Bearer {token}')
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = json.loads(resp.read().decode('utf-8'))
            return resp.status == 200, resp.status, (time.perf_counter() - t0) * 1000, body
    except urllib.error.HTTPError as e:
        try:
            body = json.loads(e.read().decode('utf-8'))
        except Exception:  # noqa: BLE001
            body = None
        return False, e.code, (time.perf_counter() - t0) * 1000, body
    except Exception:  # noqa: BLE001 - 连接类失败
        return False, 0, (time.perf_counter() - t0) * 1000, None


def make_case(name, target):
    """(label, url, payload, 校验函数)。校验只看只读响应内容。"""
    ns_url = f'{target}{GW}/apis/doublog-confcenter-namespaces'
    key_url = f'{target}{GW}/apis/doublog-confcenter-get-key'
    get_ns_url = f'{target}/api/apihub/openapi/doublog/confcenter_namespaces'
    get_key_url = (f'{target}/api/apihub/openapi/doublog/confcenter_get_key'
                   '?namespace=apihub_demo&key=example')
    key_payload = {'path': {'namespace': 'apihub_demo', 'key': 'example'}}
    if name == 'invoke-ns':
        return ns_url, {}, lambda b: isinstance(b, dict) and b.get('success') is True \
            and isinstance(b.get('data'), list)
    if name == 'invoke-key':
        return key_url, key_payload, lambda b: isinstance(b, dict) and b.get('success') is True \
            and isinstance(b.get('data'), dict) and b['data'].get('key') == 'example'
    if name == 'get-ns':
        return get_ns_url, None, lambda b: isinstance(b, dict) and b.get('success') is True \
            and isinstance(b.get('data'), list)
    if name == 'get-key':
        return get_key_url, None, lambda b: isinstance(b, dict) and b.get('success') is True \
            and b['data'].get('key') == 'example'
    raise SystemExit(f'未知 case: {name}')


def run_block(url, payload, verify, token, n, workers, timeout):
    """一轮 (case, concurrency) 的压测块：内容校验 + 延迟分布。"""
    latencies, ok_cnt, bad_status, bad_content = [], 0, 0, 0

    def one(_):
        ok, _status, ms, body = _http_json(url, payload, token, timeout)
        nonlocal ok_cnt, bad_status, bad_content
        latencies.append(ms)
        if not ok:
            bad_status += 1
        elif not verify(body):
            bad_content += 1
        else:
            ok_cnt += 1

    t0 = time.perf_counter()
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as ex:
        list(ex.map(one, range(n)))
    wall = time.perf_counter() - t0
    lat_sorted = sorted(latencies)
    pct = lambda q: lat_sorted[min(len(lat_sorted) - 1, int(q * len(lat_sorted)))]  # noqa: E731
    return {
        'requests': n, 'workers': workers, 'wall_s': round(wall, 3),
        'throughput_rps': round(n / wall, 2),
        'p50_ms': round(statistics.median(lat_sorted), 2),
        'p95_ms': round(pct(0.95), 2),
        'p99_ms': round(pct(0.99), 2),
        'ok': ok_cnt, 'bad_status': bad_status, 'bad_content': bad_content,
    }


def main():
    parser = argparse.ArgumentParser(description='apihub 本机 OpenAPI 串行 A/B 对照')
    parser.add_argument('--registry', default=None, help='协作登记表（仅用于路径围栏自检）')
    parser.add_argument('--target', required=True, help='被测服务 origin，如 http://127.0.0.1:20061')
    parser.add_argument('--token', default=os.environ.get('APIHUB_BENCH_TOKEN'),
                        help='平台令牌 sk-（或环境 APIHUB_BENCH_TOKEN）')
    parser.add_argument('--cases', default='invoke-ns,invoke-key,get-ns,get-key')
    parser.add_argument('--rounds', type=int, default=3)
    parser.add_argument('--concurrency', default='1,8,32')
    parser.add_argument('--requests', type=int, default=300, help='每个 (case,并发,轮) 的请求数')
    parser.add_argument('--timeout', type=float, default=30.0)
    parser.add_argument('--out', required=True, help='结果 JSON 输出路径')
    args = parser.parse_args()
    if not args.token:
        raise SystemExit('缺少 --token / APIHUB_BENCH_TOKEN')

    cases = [c.strip() for c in args.cases.split(',') if c.strip()]
    concurrencies = [int(c) for c in args.concurrency.split(',') if c.strip()]
    # 预检：目标可达 + 内容校验通过（坏配置直接失败，不出无效数据）
    for name in cases:
        url, payload, verify = make_case(name, args.target)
        ok, status, _ms, body = _http_json(url, payload, args.token, args.timeout)
        if not ok or not verify(body):
            raise SystemExit(f'预检失败 case={name} status={status} body={str(body)[:200]}')

    result = {
        'target': args.target, 'token_hint': args.token[:6] + '...' + args.token[-4:],
        'rounds': args.rounds, 'concurrency': concurrencies, 'requests_per_block': args.requests,
        'cases': {}, 'meta': {'argv': sys.argv[1:], 'pid': os.getpid()},
    }
    for name in cases:
        url, payload, verify = make_case(name, args.target)
        blocks = []
        for rnd in range(1, args.rounds + 1):
            for workers in concurrencies:
                block = run_block(url, payload, verify, args.token,
                                  args.requests, workers, args.timeout)
                block['round'] = rnd
                blocks.append(block)
                print(f"[bench] {name} round={rnd} c={workers}: "
                      f"{block['throughput_rps']} rps p95={block['p95_ms']}ms "
                      f"ok={block['ok']} bad={block['bad_status']}/{block['bad_content']}")
        result['cases'][name] = blocks
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with open(args.out, 'w', encoding='utf-8') as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    print(f"[bench] 结果已写入 {args.out}")


if __name__ == '__main__':
    main()
