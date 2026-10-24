"""Golden response bytes and database filtering for the ciphertext list."""

import json
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import insert

from app.vault.models import VaultItem
from app.vault.routes import _items_response


_PREFIX = '{"success":true,"code":200,"message":"操作成功","data":{"items":['
_ESCAPED_BOX = r'{"n":"abcdefghijklmnop","ct":"quote\" slash\\ newline\n雪"}'
_STAMP = datetime(2026, 10, 21, 9, 8, 7, 123456)
_ZONED = _STAMP.replace(tzinfo=timezone(timedelta(hours=8)))


@pytest.mark.parametrize(('rows', 'expected'), [
    ([], _PREFIX + '],"total":0}}'),
    ([(7, None, False, None, None, None, None, None)],
     _PREFIX + '{"id":7,"blob":{},"favorite":false,"last_used_at":null,'
     '"password_updated_at":null,"deleted_at":null,"created_at":null,"updated_at":null}'
     '],"total":1}}'),
    ([(42, _ESCAPED_BOX, True, _STAMP, None, None, _ZONED, _STAMP),
      (8, ' {"n":"abcdefghijklmnop","ct":"abcdef12"} ', False,
       None, _ZONED, _STAMP, _STAMP, _ZONED)],
     _PREFIX + '{"id":42,"blob":' + _ESCAPED_BOX + ',"favorite":true,'
     '"last_used_at":"2026-10-21T09:08:07.123456","password_updated_at":null,'
     '"deleted_at":null,"created_at":"2026-10-21T09:08:07.123456",'
     '"updated_at":"2026-10-21T09:08:07.123456"},'
     '{"id":8,"blob":{"n": "abcdefghijklmnop", "ct": "abcdef12"},"favorite":false,'
     '"last_used_at":null,"password_updated_at":"2026-10-21T09:08:07.123456",'
     '"deleted_at":"2026-10-21T09:08:07.123456","created_at":"2026-10-21T09:08:07.123456",'
     '"updated_at":"2026-10-21T09:08:07.123456"}],"total":2}}'),
], ids=['empty', 'single-null-metadata', 'multiple-escaped-fallback-and-times'])
def test_items_response_golden_bytes(rows, expected):
    response = _items_response(rows)
    assert response.status_code == 200
    assert response.media_type == 'application/json'
    assert response.body == expected.encode('utf-8')
    assert json.loads(response.body)['data']['total'] == len(rows)


def test_items_response_preserves_invalid_blob_fallback_error():
    with pytest.raises(json.JSONDecodeError):
        _items_response([(1, 'not-json', False, None, None, None, None, None)])


@pytest.mark.parametrize(('query', 'expected_ids'), [
    ('', [20, 10]), ('?trash=1', [30]), ('?trash=true', [20, 10]),
], ids=['live', 'trash', 'non-one-means-live'])
def test_items_listing_preserves_order_metadata_and_trash_filter(
        client, app, auth_headers, query, expected_ids):
    with app.state.engine.begin() as connection:
        connection.execute(insert(VaultItem.__table__), [
            {'id': iid, 'blob': _ESCAPED_BOX, 'favorite': iid == 20,
             'last_used_at': _STAMP if iid == 10 else None,
             'password_updated_at': _STAMP if iid == 20 else None,
             'deleted_at': _STAMP if iid == 30 else None,
             'created_at': _STAMP, 'updated_at': _STAMP + timedelta(minutes=iid)}
            for iid in (10, 30, 20)
        ])

    response = client.get('/api/vault/items' + query, headers=auth_headers)
    assert response.status_code == 200
    assert response.headers['content-type'].startswith('application/json')
    payload = response.json()
    assert list(payload) == ['success', 'code', 'message', 'data']
    assert payload['success'] is True and payload['code'] == 200
    assert payload['data']['total'] == len(expected_ids)
    assert payload['data']['items'] == [
        {'id': iid, 'blob': json.loads(_ESCAPED_BOX), 'favorite': iid == 20,
         'last_used_at': '2026-10-21T09:08:07.123456' if iid == 10 else None,
         'password_updated_at': '2026-10-21T09:08:07.123456' if iid == 20 else None,
         'deleted_at': '2026-10-21T09:08:07.123456' if iid == 30 else None,
         'created_at': '2026-10-21T09:08:07.123456',
         'updated_at': (_STAMP + timedelta(minutes=iid)).isoformat()}
        for iid in expected_ids
    ]
    assert all(list(row) == ['id', 'blob', 'favorite', 'last_used_at', 'password_updated_at',
                             'deleted_at', 'created_at', 'updated_at']
               for row in payload['data']['items'])
