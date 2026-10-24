"""Position batches preserve graph content and reject stale multi-board edits."""
import uuid


def seed(client):
    game = client.post('/api/gamemap/games', json={'name': 'batch-fixture'}).json()['data']['id']
    chapters = [client.post(f'/api/gamemap/games/{game}/chapters', json={'title': f'chapter-{i}'})
                .json()['data']['id'] for i in range(2)]
    character = client.post(f'/api/gamemap/games/{game}/characters', json={'name': 'node'})
    character = character.json()['data']['id']
    root = f'/api/gamemap/games/{game}/boards'
    for chapter in chapters:
        assert client.post(f'{root}/chapters/{chapter}/nodes/{character}').status_code == 200
    return root, chapters, character


def board(client, root, chapter):
    return client.get(f'{root}/chapters/{chapter}').json()['data']


def test_positions_batch_is_atomic_and_idempotent(client):
    root, chapters, character = seed(client)
    originals = [board(client, root, chapter) for chapter in chapters]
    body = {'mutation_id': uuid.uuid4().hex, 'boards': [
        {'chapter_id': chapter, 'revision': original['version'],
         'positions': [{'character_id': character, 'x': 123 + i, 'y': -456}]}
        for i, (chapter, original) in enumerate(zip(chapters, originals))]}
    response = client.post(f'{root}/positions/batch', json=body)
    assert response.status_code == 200, response.text
    assert client.post(f'{root}/positions/batch', json=body).json() == response.json()
    for i, chapter in enumerate(chapters):
        saved = board(client, root, chapter)
        assert saved['version'] == originals[i]['version'] + 1
        assert saved['nodes'][0]['x'] == 123 + i
    body['boards'][0]['positions'][0]['x'] = 999
    assert client.post(f'{root}/positions/batch', json=body).status_code == 409


def test_stale_second_board_rolls_back_first(client):
    root, chapters, character = seed(client)
    originals = [board(client, root, chapter) for chapter in chapters]
    body = {'mutation_id': 'stale-multi-board', 'boards': [
        {'chapter_id': chapter, 'revision': original['version'] - i,
         'positions': [{'character_id': character, 'x': 999, 'y': 999}]}
        for i, (chapter, original) in enumerate(zip(chapters, originals))]}
    assert client.post(f'{root}/positions/batch', json=body).status_code == 409
    assert [board(client, root, chapter) for chapter in chapters] == originals


def test_position_validation_and_cross_game_ownership(client):
    root, chapters, character = seed(client)
    original = board(client, root, chapters[0])
    url = f'{root}/chapters/{chapters[0]}/positions'
    body = {'revision': original['version'], 'mutation_id': 'single',
            'positions': [{'character_id': character, 'x': 12, 'y': -34}]}
    for invalid in (True, None, '3', 10000001):
        bad = {**body, 'positions': [{'character_id': character, 'x': invalid, 'y': 0}]}
        assert client.put(url, json=bad).status_code == 400
    assert client.put(url, json={**body, 'positions': body['positions'] * 2}).status_code == 400
    assert client.put(url, json={**body, 'positions': [{'character_id': 999999, 'x': 0, 'y': 0}]}).status_code == 404
    other_game = client.post('/api/gamemap/games', json={'name': 'other'}).json()['data']['id']
    other_url = url.replace(root, f'/api/gamemap/games/{other_game}/boards')
    assert client.put(other_url, json=body).status_code == 404
    response = client.put(url, json=body)
    assert response.status_code == 200
    assert response.json()['data']['revision'] == original['version'] + 1
    assert client.put(url, json=body).json() == response.json()
