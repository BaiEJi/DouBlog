"""API Hub 核心单元测试：加密/令牌/模板/鉴权适配/限流器/key选择/探活状态机。"""

import pytest

from app.apihub.core import (CryptoBox, FixedWindow, HealthMonitor, Injection, KeyCfg,
                             KeySelector, LevelSpec, RateLimiter, TemplateError, TokenBucket,
                             apply_providers, generate_token, hash_token, mask_secret, render,
                             render_obj, strictest, token_hint, validate_auth_config)


class TestCrypto:
    def test_roundtrip(self):
        c = CryptoBox('k1')
        assert c.decrypt(c.encrypt({'a': 1, '中文': 'x'})) == {'a': 1, '中文': 'x'}

    def test_wrong_key(self):
        enc = CryptoBox('k1').encrypt({'a': 1})
        with pytest.raises(Exception):
            CryptoBox('k2').decrypt(enc)

    def test_tampered(self):
        enc = bytearray(CryptoBox('k1').encrypt({'a': 1}))
        enc[-1] ^= 0xFF
        with pytest.raises(Exception):
            CryptoBox('k1').decrypt(bytes(enc))

    def test_mask(self):
        assert mask_secret('abcdefgh') == 'abc***gh'
        assert mask_secret('') == ''


class TestToken:
    def test_format_and_hash(self):
        t = generate_token()
        assert t.startswith('sk-') and len(t) > 30
        assert len(hash_token(t)) == 64
        assert '...' in token_hint(t)


class TestRender:
    def test_nested(self):
        assert render('/bot{cred.key}/x', {'cred': {'key': 'K'}}) == '/botK/x'

    def test_missing_raises(self):
        with pytest.raises(TemplateError):
            render('{cred.no}', {'cred': {}})

    def test_render_obj(self):
        assert render_obj({'h': '{cred.a}', 'l': ['{cred.b}', 1]}, {'cred': {'a': 1, 'b': 2}}) \
            == {'h': '1', 'l': ['2', 1]}


class TestAdapters:
    def test_bearer(self):
        inj = apply_providers([{'type': 'bearer', 'value': '{cred.token}'}], {'token': 'abc'})
        assert inj.headers['Authorization'] == 'Bearer abc'

    def test_api_key_header(self):
        inj = apply_providers([{'type': 'api_key_header', 'header': 'X-Shopify-Access-Token',
                                'value': '{cred.t}'}], {'t': 's1'})
        assert inj.headers['X-Shopify-Access-Token'] == 's1'

    def test_query_and_basic_and_cookie(self):
        inj = apply_providers([
            {'type': 'query_key', 'param': 'key', 'value': '{cred.k}'},
            {'type': 'basic', 'user': '{cred.u}', 'password': '{cred.p}'},
            {'type': 'static_cookie', 'cookie': 'JID', 'value': '{cred.s}'},
        ], {'k': 'G', 'u': 'u1', 'p': 'p1', 's': 'x'})
        import base64
        assert inj.query == {'key': 'G'}
        assert inj.headers['Authorization'] == 'Basic ' + base64.b64encode(b'u1:p1').decode()
        assert inj.cookies == {'JID': 'x'}

    def test_template_and_path_token(self):
        inj = apply_providers([
            {'type': 'template', 'template': {'headers': {'X-A': '{cred.a}'}, 'query': {'v': '2'}}},
            {'type': 'path_token'},
        ], {'a': 'A'})
        assert inj.headers == {'X-A': 'A'} and inj.query == {'v': '2'}

    def test_validate(self):
        assert validate_auth_config({'providers': [{'type': 'bearer'}],
                                     'credential_fields': ['token']}) == []
        assert validate_auth_config({'providers': [{'type': 'nope'}],
                                     'credential_fields': ['x']})
        assert validate_auth_config({'providers': [], 'credential_fields': []})


def lv(scope='api', key='rl:a:1', algorithm='token_bucket', rate=10.0, burst=3):
    return LevelSpec(scope=scope, key=key, algorithm=algorithm,
                     rate_per_sec=rate, burst=burst)


class TestRateLimiter:
    def test_burst_then_deny(self):
        rl = RateLimiter()
        for _ in range(3):
            assert rl.check([lv()]).allowed
        r = rl.check([lv()])
        assert not r.allowed and r.scope == 'api' and r.retry_after > 0

    def test_multi_level_short_circuit(self):
        rl = RateLimiter()
        l1, l2 = lv('token_api', 'rl:ta:1:1', burst=1), lv('api', 'rl:a:1', burst=99)
        assert rl.check([l1, l2]).allowed
        r = rl.check([l1, l2])
        assert not r.allowed and r.scope == 'token_api'
        assert rl.snapshot(l2)['remaining'] == 98   # L1 拒绝时 L2 不再消耗

    def test_fixed_window(self):
        rl = RateLimiter()
        f = LevelSpec(scope='global', key='rl:g', algorithm='fixed_window',
                      window_s=60, max_count=1)
        assert rl.check([f]).allowed
        assert not rl.check([f]).allowed

    def test_strictest(self):
        best = strictest([
            {'algorithm': 'token_bucket', 'rate_per_sec': 10, 'burst': 5},
            {'algorithm': 'fixed_window', 'window_s': 60, 'max_count': 100},   # ≈1.67/s 更严
        ])
        assert best['algorithm'] == 'fixed_window'


class TestSelector:
    def test_round_robin_and_weight(self):
        sel = KeySelector()
        k1, k2 = KeyCfg(1, {}, 1, 1), KeyCfg(2, {}, 1, 1)
        picks = [sel.next_key(1, [k1, k2]).id for _ in range(4)]
        assert picks == [1, 2, 1, 2]

    def test_failure_cooldown_threshold(self):
        sel = KeySelector()
        assert not sel.note_failure(9)
        assert not sel.note_failure(9)
        assert sel.note_failure(9)          # 第 3 次才冷却
        assert not sel.note_failure(8)      # 成功前另一 key 的失败独立计数

    def test_success_resets(self):
        sel = KeySelector()
        sel.note_failure(1)
        sel.note_failure(1)
        sel.note_success(1)
        assert not sel.note_failure(1)      # 清零后重新累计

    def test_skips_disabled(self):
        sel = KeySelector()
        k = KeyCfg(1, {}, 1, 2)   # status=2 禁用
        assert sel.next_key(1, [k]) is None


class TestHealthMonitor:
    def test_transitions(self):
        m = HealthMonitor()
        cfg = {'failure_threshold': 3, 'success_threshold': 2}
        assert m.apply_result(1, cfg, True) == 'healthy'      # unknown 一次成功即健康
        assert m.apply_result(1, cfg, False) == 'suspect'
        m.apply_result(1, cfg, False)
        assert m.apply_result(1, cfg, False) == 'down'
        m.apply_result(1, cfg, True)
        assert m.state_of(1)['status'] == 'down'              # 未达 2 次不恢复
        assert m.apply_result(1, cfg, True) == 'healthy'
