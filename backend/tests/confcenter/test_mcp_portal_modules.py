import hashlib
import json

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session


ADMIN = '/api/confcenter/mcp'
SECRET = 'fixture-sensitive-value'
TOOLS = {
    'blog': {'search_knowledge', 'read_knowledge'},
    'mindmap': {'search_maps', 'read_map_outline'},
    'practice': {'search_problems', 'read_problem'},
    'gamemap': {'search_games', 'list_chapters', 'get_chapter_brief'},
    'confcenter': {'search_config_catalog'},
    'system': {'get_runtime_status', 'get_portal_layout'},
    'vault': {'get_vault_status', 'list_vault_audit'},
    'sdklogs': {'get_log_activity', 'list_log_alerts'},
    'pwsvc': {'list_password_projects', 'get_project_health'},
    'apihub': {'list_api_catalog', 'get_gateway_health'},
    'steamidler': {'list_idle_profiles'},
    'clash': {'get_proxy_status'},
    'devtoolbox': {'compute_text_hash', 'convert_text_encoding'},
}


def _seed(app):
    from app.apihub.models import ApihubApi, ApihubSystem
    from app.blog.assets.models import AssetItem
    from app.blog.bookmarks.models import BookmarkItem
    from app.blog.diary.models import Diary
    from app.blog.models import Post
    from app.confcenter.models import ConfEntry, ConfNamespace
    from app.gamemap.models import Chapter, ChapterCharacter, Character, Game, StoryEvent
    from app.mindmap.models import MindMap
    from app.mindmap.validation import default_document
    from app.practice.models import PracticeProblem
    from app.pwsvc.models import PwsvcProject, PwsvcValidateLog
    from app.sdklogs.models import SdkAlert, SdkLog
    from app.steamidler.models import SteamidlerAccount
    from app.vault.models import VaultAuditLog, VaultItem
    from app.shared.timestamps import _utcnow

    with Session(app.state.engine, expire_on_commit=False) as session:
        post = Post(title='测试资料与项目', name='mcp-fixture', content='甲' * 8001)
        diary = Diary(entry_date='2026-11-28', content='日记目标 内容')
        bookmark = BookmarkItem(id='018f1531-0000-7000-8000-000000000001',
                                url='https://example.test/note', normalized_url='https://example.test/note',
                                title='示例书签', snapshot_md='保存后的正文', created_at=_utcnow(), updated_at=_utcnow())
        asset = AssetItem(kind='prompt', title='示例资产', content='资产内容')
        game = Game(name='图谱验证游戏')
        doc = default_document('提纲入口')
        root_id = doc['root']['data']['uid']
        doc['root']['children'].append({'data': {'uid': 'child-fixture', 'text': '子节点'}, 'children': []})
        map_row = MindMap(name='提纲样例', document=doc, node_count=2, created_by='QA', updated_by='QA')
        problem = PracticeProblem(id='mcp-qa-problem', title='检查算法', created_at=_utcnow(), updated_at=_utcnow())
        project = PwsvcProject(name='演示项目', api_key_hash=SECRET, api_key_prefix='fixture')
        upstream = ApihubSystem(name='本机示例服务', slug='mcp-fixture', base_url='https://example.test')
        item = VaultItem(blob='{"ct":"' + SECRET + '"}', favorite=True)
        session.add_all([post, diary, bookmark, asset, game, map_row, problem, project, upstream, item])
        session.flush()
        chapter = Chapter(game_id=game.id, title='第一章', order_index=1)
        character = Character(game_id=game.id, name='旅人')
        session.add_all([chapter, character])
        session.flush()
        namespace = 'mcp-testing'
        session.add(ConfNamespace(namespace=namespace))
        session.flush()
        session.add_all([
            ConfEntry(namespace=namespace, key='setting', type='str', data=SECRET),
            ChapterCharacter(chapter_id=chapter.id, character_id=character.id, role='主角'),
            StoryEvent(chapter_id=chapter.id, title='返回村落', order_index=1),
            PwsvcValidateLog(project_id=project.id, username='QA', valid=True, ip=SECRET),
            ApihubApi(system_id=upstream.id, name='示例目录接口', slug='mcp-fixture-catalog',
                      auth_config={'credential': SECRET}),
            SdkLog(ts=_utcnow(), level=40, level_text='ERROR', sys_name='scope.qa', message=SECRET, fields={'key': SECRET}),
            SdkAlert(level_text='ERROR', count=6, window_minutes=10, sample=SECRET, sys_name='scope.qa'),
            SteamidlerAccount(steamid='76561198000000000', account_name='测试账号', refresh_token=SECRET,
                              shared_secret=SECRET, idle_appids='[570]', farmed_seconds=1200),
            VaultAuditLog(action='create', item_id=item.id),
        ])
        session.commit()
        return {'post': post.id, 'diary': diary.id, 'bookmark': bookmark.id, 'asset': asset.id,
                'game': game.id, 'chapter': chapter.id,
                'map': map_row.id, 'root': root_id, 'problem': problem.id, 'project': project.id,
                'upstream': upstream.id, 'namespace': namespace}


def _rpc(client, module, headers, method, **params):
    return client.post('/mcp/' + module, headers=headers,
                       json={'jsonrpc': '2.0', 'id': 1, 'method': method, 'params': params})


def _issue(client, module, auth):
    response = client.post(f'{ADMIN}/{module}/tokens', headers=auth, json={'name': 'Portal MCP QA'})
    assert response.status_code == 201, response.text
    issued = response.json()['data']
    return issued['id'], {'Authorization': 'Bearer ' + issued['token'], 'Accept': 'application/json, text/event-stream'}


def _call(client, module, headers, name, **arguments):
    response = _rpc(client, module, headers, 'tools/call', name=name, arguments=arguments)
    assert response.status_code == 200, response.text
    data = response.json()['result']
    assert not data.get('isError'), data
    return data['structuredContent']


def test_all_portal_modules_discover_and_execute_on_scoped_tokens(app, auth_headers, monkeypatch):
    from app.clash import service
    monkeypatch.setattr(service, 'is_available', lambda: True)
    monkeypatch.setattr(service, 'kernel_status', lambda: {'running': True, 'output': SECRET})
    monkeypatch.setattr(service, 'system_proxy_get', lambda: {'enabled': False, 'output': SECRET})
    ids = _seed(app)
    with TestClient(app, base_url='http://192.0.2.10:60100', client=('192.0.2.25', 12000)) as client:
        modules = client.get(ADMIN, headers=auth_headers).json()['data']
        catalog = {module['key']: module for module in modules}
        assert set(catalog) == set(TOOLS) | {'todo', 'subs'}
        entries = {}
        for module, names in TOOLS.items():
            assert catalog[module]['endpoint'] == f'http://192.0.2.10:60100/mcp/{module}'
            admin_tools = catalog[module]['tools']
            assert {tool['name'] for tool in admin_tools} == names
            assert all(tool['read_only'] and not tool['enabled'] for tool in admin_tools)
            for tool in admin_tools:
                for field in tool['input_schema'].get('properties', {}).values():
                    assert field.get('description') and field.get('examples')
            token_id, token = _issue(client, module, auth_headers)
            entries[module] = (token_id, token)
            assert _rpc(client, module, {}, 'tools/list').status_code == 401
            assert _rpc(client, module, token, 'tools/list').json()['result']['tools'] == []
            disabled = _rpc(client, module, token, 'tools/call', name=sorted(names)[0], arguments={})
            assert disabled.json()['error']['code'] == -32602
            for name in names:
                result = client.put(f'{ADMIN}/{module}/tools/{name}', headers=auth_headers, json={'enabled': True})
                assert result.status_code == 200
            initialized = _rpc(client, module, token, 'initialize', protocolVersion='2025-11-25',
                               capabilities={}, clientInfo={'name': 'portal-test', 'version': '1'})
            assert initialized.json()['result']['serverInfo']['name'] == module
            listed = _rpc(client, module, token, 'tools/list').json()['result']['tools']
            assert {tool['name'] for tool in listed} == names

        cases = [
            ('blog', 'search_knowledge', {'keyword': '测试资料'}, 'items'),
            ('blog', 'search_knowledge', {'kind': 'diary', 'keyword': '日记目标'}, 'items'),
            ('blog', 'read_knowledge', {'kind': 'post', 'id': ids['post']}, 'content'),
            ('mindmap', 'search_maps', {'keyword': '提纲'}, 'items'),
            ('mindmap', 'read_map_outline', {'map_id': ids['map'], 'page': 2, 'page_size': 1}, 'items'),
            ('practice', 'search_problems', {'keyword': '检查'}, 'items'),
            ('practice', 'read_problem', {'problem_id': ids['problem']}, 'id'),
            ('gamemap', 'search_games', {'keyword': '验证游戏'}, 'items'),
            ('gamemap', 'list_chapters', {'game_id': ids['game']}, 'items'),
            ('gamemap', 'get_chapter_brief', {'chapter_id': ids['chapter']}, 'events'),
            ('confcenter', 'search_config_catalog', {'namespace': ids['namespace']}, 'items'),
            ('system', 'get_runtime_status', {}, 'database'),
            ('system', 'get_portal_layout', {}, 'revision'),
            ('vault', 'get_vault_status', {}, 'items'),
            ('vault', 'list_vault_audit', {}, 'items'),
            ('sdklogs', 'get_log_activity', {'sys_name': 'scope.qa'}, 'items'),
            ('sdklogs', 'list_log_alerts', {}, 'items'),
            ('pwsvc', 'list_password_projects', {'keyword': '演示'}, 'items'),
            ('pwsvc', 'get_project_health', {'project_id': ids['project']}, 'success'),
            ('apihub', 'list_api_catalog', {'system_id': ids['upstream']}, 'items'),
            ('apihub', 'get_gateway_health', {}, 'api_health'),
            ('steamidler', 'list_idle_profiles', {}, 'items'),
            ('clash', 'get_proxy_status', {}, 'running'),
            ('devtoolbox', 'compute_text_hash', {'text': ' hello\n'}, 'hex'),
            ('devtoolbox', 'convert_text_encoding', {'text': 'cafÃ©', 'from_charset': 'latin-1', 'to_charset': 'utf-8'}, 'result'),
        ]
        data = {}
        for module, name, args, expected in cases:
            token = entries[module][1]
            out = _call(client, module, token, name, **args)
            assert expected in out and SECRET not in json.dumps(out)
            if expected == 'items':
                assert out['items'], (module, name, args)
            data[name] = out
        assert len(data) == sum(map(len, TOOLS.values()))
        assert data['read_knowledge']['next_offset'] == 8000
        assert data['read_map_outline']['items'][0]['parent_id'] == ids['root']
        assert data['get_vault_status']['favorites'] == 1
        assert data['list_idle_profiles']['items'][0]['idle_appids'] == [570]
        assert data['get_project_health']['success'] == 1
        assert data['compute_text_hash']['hex'] == hashlib.sha256(b' hello\n').hexdigest()
        assert data['convert_text_encoding']['result'] == 'café'
        assert data['get_chapter_brief']['characters']['items'][0]['name'] == '旅人'

        token_id, blog = entries['blog']
        chunks = {'diary': '日记目标 内容', 'bookmark': '保存后的正文', 'asset': '资产内容'}
        for kind, expected in chunks.items():
            assert _call(client, 'blog', blog, 'read_knowledge', kind=kind, id=ids[kind])['content'] == expected
        tail = _call(client, 'blog', blog, 'read_knowledge', kind='post', id=ids['post'], offset=8000)
        assert tail['content'] == '甲' and tail['next_offset'] is None
        config = _call(client, 'confcenter', entries['confcenter'][1], 'search_config_catalog', keyword=ids['namespace'])
        assert config['kind'] == 'namespaces' and config['items'][0]['key_count'] == 1
        monkeypatch.setattr(service, 'is_available', lambda: False)
        unavailable = _call(client, 'clash', entries['clash'][1], 'get_proxy_status')
        assert unavailable == {'available': False, 'running': None, 'system_proxy_enabled': None}
        assert _rpc(client, 'system', blog, 'tools/list').status_code == 401
        missing = _rpc(client, 'blog', blog, 'tools/call', name='read_knowledge',
                       arguments={'kind': 'post', 'id': 2147483647}).json()['result']
        assert missing['isError'] and '404' in missing['content'][0]['text']
        assert client.delete(f'{ADMIN}/blog/tokens/{token_id}', headers=auth_headers).is_success
        assert _rpc(client, 'blog', blog, 'tools/list').status_code == 401
