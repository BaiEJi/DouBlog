"""Atomic optimistic writes and editor-independent tree operations."""
import hashlib
import json

from sqlalchemy import text, update
from sqlalchemy.exc import IntegrityError, OperationalError
from lizysdk.errors import ConflictError, NotFoundError

from app.blog.models import Post, Workspace
from app.db import db
from app.mindmap.models import MindMap, MindMapMutation, MindMapVersion
from app.mindmap.validation import (
    FORMAT, SCHEMA_VERSION, default_document, invalid, json_bytes, mutation_value,
    name_value, positive_int, validate_document, validate_envelope,
)
from app.shared.modules import mod_logger
from app.shared.timestamps import _utcnow

logger = mod_logger('mindmap')


def clone(value):
    return json.loads(json_bytes(value))


def require_map(map_id):
    positive_int(map_id, 'map_id')
    row = db.session.get(MindMap, map_id)
    if row is None or row.deleted:
        raise NotFoundError(message='思维导图不存在')
    return row


def lock_resource_links():
    """Reserve SQLite's writer before checking cross-module resource links.

    Existing global SQLite connections do not enable foreign_keys; reserving the
    write transaction closes the check/delete race without changing old modules.
    PostgreSQL enforces the declared foreign keys itself.
    """
    if db.engine.dialect.name == 'sqlite':
        connection = db.session.connection().connection.driver_connection
        if not connection.in_transaction:
            db.session.execute(text('BEGIN IMMEDIATE'))


def lock_resource_deletion(model, resource_ids):
    lock_resource_links()
    if db.engine.dialect.name == 'postgresql':
        # Wait for pending FK inserts, then the following map query sees them.
        db.session.query(model.id).filter(model.id.in_(resource_ids)).with_for_update().all()


def associations(workspace_id=None, post_id=None, lock=False):
    if lock:
        lock_resource_links()
    if workspace_id is None:
        workspace = Workspace.query.order_by(Workspace.id).first()
    else:
        positive_int(workspace_id, 'workspace_id')
        workspace = db.session.get(Workspace, workspace_id)
    if workspace is None:
        invalid('知识库不存在', field='workspace_id')
    if post_id is not None:
        positive_int(post_id, 'post_id')
        post = db.session.get(Post, post_id)
        if post is None or post.id == 0:
            invalid('关联文章不存在', field='post_id')
        if post.workspace_id != workspace.id:
            invalid('关联文章不属于指定知识库', field='post_id')
    return workspace.id, post_id


def export_envelope(row):
    return {
        'format': FORMAT, 'schema_version': SCHEMA_VERSION, 'id': row.id,
        'name': row.name, 'workspace_id': row.workspace_id, 'post_id': row.post_id,
        'revision': row.revision, 'document': row.document,
    }


def snapshot(row, action, actor, ip):
    db.session.add(MindMapVersion(
        map_id=row.id, revision=row.revision, snapshot=row.to_dict(),
        action=action, actor=actor, ip_address=ip,
    ))


def check_revision(row, revision):
    positive_int(revision)
    if row.revision != revision:
        raise ConflictError(message='导图已被其他操作修改，请先载入最新版本', details={
            'reason': 'revision_conflict', 'map_id': row.id, 'current_revision': row.revision,
        })


def commit_update(row, changes, revision, action, actor, ip):
    """The compare-and-swap is in SQL, protecting simultaneous HTTP requests."""
    check_revision(row, revision)
    changes = dict(changes, revision=revision + 1, updated_by=actor, updated_at=_utcnow())
    result = db.session.execute(
        update(MindMap).where(MindMap.id == row.id, MindMap.revision == revision,
                             MindMap.deleted.is_(False)).values(**changes)
        .execution_options(synchronize_session=False)
    )
    if result.rowcount != 1:
        map_id = row.id
        db.session.rollback()
        db.session.expire_all()
        current = db.session.get(MindMap, map_id)
        raise ConflictError(message='导图版本冲突，修改未覆盖服务器数据', details={
            'reason': 'revision_conflict', 'map_id': map_id,
            'current_revision': current.revision if current else None,
        })
    db.session.expire(row)
    db.session.refresh(row)
    snapshot(row, action, actor, ip)
    return row


def _receipt_result(receipt):
    out = clone(receipt.response)
    if receipt.includes_document:
        version = MindMapVersion.query.filter_by(
            map_id=receipt.result_map_id, revision=receipt.result_revision).one()
        out['document'] = version.snapshot['document']
    return receipt.status_code, out


def mutation(scope, data, fn):
    """Receipts share the data transaction; lost HTTP responses are safe to retry.

    The receipt stores only response metadata and references its immutable version,
    avoiding a second full document copy for every autosave.
    """
    mutation_id = mutation_value(data.get('mutation_id'))
    fingerprint = hashlib.sha256(json.dumps(
        {'scope': scope, 'payload': data}, ensure_ascii=False, allow_nan=False,
        sort_keys=True, separators=(',', ':')).encode()).hexdigest()

    def existing():
        receipt = MindMapMutation.query.filter_by(mutation_id=mutation_id).first()
        if receipt:
            if receipt.fingerprint != fingerprint:
                raise ConflictError(message='mutation_id 已用于其他请求，请生成新的请求标识',
                                    details={'reason': 'mutation_reused'})
            return _receipt_result(receipt)
        return None

    for attempt in range(3):
        replay = existing()
        if replay is not None:
            return replay
        try:
            status, result = fn()
            stored = dict(result)
            includes_document = 'document' in stored
            stored.pop('document', None)
            db.session.add(MindMapMutation(
                mutation_id=mutation_id, fingerprint=fingerprint, response=stored,
                result_map_id=result.get('id'), result_revision=result.get('revision'),
                includes_document=includes_document, status_code=status,
            ))
            db.session.commit()
            logger.info('mindmap mutation %s -> map=%s revision=%s',
                        scope, result.get('id'), result.get('revision'))
            return status, result
        except IntegrityError:
            db.session.rollback()
            replay = existing()
            if replay is not None:
                return replay
            raise ConflictError(message='并发操作冲突，请使用原请求标识重试',
                                details={'reason': 'concurrent_write', 'retryable': True})
        except OperationalError as exc:
            db.session.rollback()
            if 'locked' not in str(exc).lower():
                raise
            if attempt == 2:
                raise ConflictError(message='数据库正在写入，请使用原请求标识重试',
                                    details={'reason': 'concurrent_write', 'retryable': True})
        except ConflictError:
            # An identical request may have committed between the initial receipt
            # lookup and our compare-and-swap. Return its original result as well.
            db.session.rollback()
            replay = existing()
            if replay is not None:
                return replay
            raise


def create_map(data, actor, ip, action='create'):
    name = name_value(data.get('name'))
    workspace_id, post_id = associations(data.get('workspace_id'), data.get('post_id'), lock=True)
    document, count = validate_document(data.get('document', default_document(name)))
    row = MindMap(name=name, workspace_id=workspace_id, post_id=post_id,
                  document=clone(document), node_count=count, revision=1,
                  created_by=actor, updated_by=actor)
    db.session.add(row)
    db.session.flush()
    snapshot(row, action, actor, ip)
    return 201, row.to_dict()


def patch_map(map_id, data, actor, ip):
    row = require_map(map_id)
    changes = {}
    if 'name' in data:
        changes['name'] = name_value(data['name'])
    if 'workspace_id' in data or 'post_id' in data:
        ws, post = associations(data.get('workspace_id', row.workspace_id),
                                data.get('post_id', row.post_id), lock=True)
        changes.update(workspace_id=ws, post_id=post)
    if not changes:
        invalid('至少提供 name、workspace_id、post_id 中的一项')
    row = commit_update(row, changes, data.get('revision'), 'metadata', actor, ip)
    return 200, row.to_dict()


def save_document(map_id, data, actor, ip):
    row = require_map(map_id)
    document, count = validate_document(data.get('document'))
    row = commit_update(row, {'document': clone(document), 'node_count': count},
                        data.get('revision'), 'document', actor, ip)
    return 200, row.to_dict()


def delete_map(map_id, data, actor, ip):
    row = require_map(map_id)
    row = commit_update(row, {'deleted': True}, data.get('revision'), 'delete', actor, ip)
    return 200, {'id': row.id, 'revision': row.revision, 'deleted': True}


def duplicate_map(map_id, data, actor, ip):
    row = require_map(map_id)
    check_revision(row, data.get('revision'))
    return create_map({
        'name': data.get('name', row.name[:195] + '（副本）'),
        'workspace_id': row.workspace_id, 'post_id': row.post_id, 'document': row.document,
    }, actor, ip, 'duplicate')


def import_map(data, actor, ip):
    payload = validate_envelope(data.get('payload', data.get('envelope')))
    target_id = data.get('target_id')
    if target_id is not None:
        positive_int(target_id, 'target_id')
        row = require_map(target_id)
        ws, post = associations(data.get('workspace_id', row.workspace_id),
                                data.get('post_id', row.post_id), lock=True)
        document, count = validate_document(payload['document'])
        row = commit_update(row, {
            'name': name_value(payload['name']), 'workspace_id': ws, 'post_id': post,
            'document': clone(document), 'node_count': count,
        }, data.get('revision'), 'import', actor, ip)
        return 200, row.to_dict()
    # A foreign export never replaces an existing server map by its embedded ID.
    ws_id = data.get('workspace_id')
    if ws_id is None and db.session.get(Workspace, payload['workspace_id']):
        ws_id = payload['workspace_id']
    ws_id, _ = associations(ws_id, None)
    if 'post_id' in data:
        post_id = data['post_id']
    else:
        post = db.session.get(Post, payload['post_id']) if payload['post_id'] else None
        post_id = post.id if post and post.workspace_id == ws_id else None
    return create_map({'name': payload['name'], 'workspace_id': ws_id,
                       'post_id': post_id, 'document': payload['document']}, actor, ip, 'import')


def restore_map(map_id, data, actor, ip):
    lock_resource_links()
    row = require_map(map_id)
    version_number = positive_int(data.get('version'), 'version')
    version = MindMapVersion.query.filter_by(map_id=map_id, revision=version_number).first()
    if version is None:
        raise NotFoundError(message='导图历史版本不存在')
    saved = version.snapshot
    # Deleted linked posts stay unlinked; history is never permitted to create a dangling FK.
    saved_workspace = db.session.get(Workspace, saved['workspace_id']) if saved['workspace_id'] else None
    workspace_id = saved_workspace.id if saved_workspace else row.workspace_id
    post = db.session.get(Post, saved['post_id']) if saved['post_id'] else None
    post_id = post.id if post and post.workspace_id == workspace_id else None
    document, count = validate_document(saved['document'])
    row = commit_update(row, {
        'name': saved['name'], 'document': clone(document), 'node_count': count,
        'workspace_id': workspace_id, 'post_id': post_id,
    }, data.get('revision'), f'restore:{version_number}', actor, ip)
    return 200, row.to_dict()


def tree_index(root):
    out, stack = {}, [(root, None, 1)]
    while stack:
        node, parent, depth = stack.pop()
        if not isinstance(node, dict) or not isinstance(node.get('data'), dict):
            invalid('每个节点必须包含 data 对象')
        uid = node['data'].get('uid')
        if not isinstance(uid, str) or not uid.strip() or uid in out:
            invalid('节点 uid 缺失或重复')
        if depth > 128:
            invalid('节点深度不能超过 128')
        if len(out) >= 10000:
            invalid('节点总数不能超过 10000')
        children = node.get('children', [])
        if not isinstance(children, list):
            invalid('节点 children 必须是数组')
        out[uid] = (node, parent)
        stack.extend((child, node, depth + 1) for child in children)
    return out


def _clean_references(root, removed):
    for node, _ in tree_index(root).values():
        data = node['data']
        targets = data.get('associativeLineTargets', [])
        keep = [i for i, uid in enumerate(targets) if uid not in removed]
        if len(keep) == len(targets):
            continue
        data['associativeLineTargets'] = [targets[i] for i in keep]
        for field in ('associativeLinePoint', 'associativeLineTargetControlOffsets'):
            if isinstance(data.get(field), list):
                data[field] = [data[field][i] for i in keep if i < len(data[field])]
        for field in ('associativeLineText', 'associativeLineStyle'):
            if isinstance(data.get(field), dict):
                data[field] = {key: val for key, val in data[field].items() if key not in removed}


def _insert(parent, node, position):
    children = parent.setdefault('children', [])
    if position is None:
        position = len(children)
    if isinstance(position, bool) or not isinstance(position, int) or position < 0 or position > len(children):
        invalid('index 必须处于目标父节点的子节点范围内')
    children.insert(position, node)


def apply_operations(document, operations):
    if not isinstance(operations, list) or not operations or len(operations) > 500:
        invalid('operations 必须包含 1–500 个操作')
    document = clone(document)
    for number, operation in enumerate(operations):
        if not isinstance(operation, dict):
            invalid('批操作必须是对象', operation_index=number)
        index = tree_index(document['root'])
        kind = operation.get('op')
        uid = operation.get('uid')
        if kind in ('update', 'delete', 'move'):
            if not isinstance(uid, str) or uid not in index:
                invalid('目标节点不存在', uid=uid, operation_index=number)
            node, parent = index[uid]
        if kind == 'add':
            parent_id = operation.get('parent_id')
            if not isinstance(parent_id, str) or parent_id not in index:
                invalid('新增节点的父节点不存在', operation_index=number)
            new_node = operation.get('node')
            # Validate standalone subtree, before inserting it into the mutable document.
            if not isinstance(new_node, dict) or not isinstance(new_node.get('data'), dict):
                invalid('node 必须包含 data 对象', operation_index=number)
            if not isinstance(new_node['data'].get('uid'), str):
                invalid('新节点必须提供 uid', operation_index=number)
            _insert(index[parent_id][0], clone(new_node), operation.get('index'))
        elif kind == 'update':
            patch = operation.get('data')
            if not isinstance(patch, dict) or 'uid' in patch:
                invalid('节点 data 更新必须是对象且不能修改 uid', operation_index=number)
            node['data'].update(clone(patch))
        elif kind == 'delete':
            if parent is None:
                invalid('不能删除根节点，请编辑根节点内容', operation_index=number)
            removed = set(tree_index(node))
            parent['children'].remove(node)
            _clean_references(document['root'], removed)
        elif kind == 'move':
            if parent is None:
                invalid('不能移动根节点', operation_index=number)
            parent_id = operation.get('parent_id')
            if not isinstance(parent_id, str) or parent_id not in index:
                invalid('移动目标父节点不存在', operation_index=number)
            if parent_id in tree_index(node):
                invalid('不能把节点移动到自身或后代节点内', operation_index=number)
            parent['children'].remove(node)
            _insert(index[parent_id][0], node, operation.get('index'))
        else:
            invalid('不支持的节点操作，仅支持 add/update/delete/move', operation_index=number)
        # Structure and UID uniqueness checked per step; references are validated at
        # the final boundary to allow a batch to create both ends of a relation.
        tree_index(document['root'])
    return validate_document(document)


def batch_nodes(map_id, data, actor, ip):
    row = require_map(map_id)
    check_revision(row, data.get('revision'))
    document, count = apply_operations(row.document, data.get('operations'))
    row = commit_update(row, {'document': document, 'node_count': count},
                        data.get('revision'), 'nodes', actor, ip)
    return 200, row.to_dict()


def unlink_post_maps(post_ids, actor, ip=None):
    """Called inside blog's deletion transaction, including recursive descendants."""
    rows = MindMap.query.filter(MindMap.post_id.in_(post_ids), MindMap.deleted.is_(False)).all()
    for row in rows:
        commit_update(row, {'post_id': None}, row.revision, 'post_unlinked', actor, ip)
    # Tombstones still contain a real FK, so detach those as well.
    db.session.execute(update(MindMap).where(MindMap.post_id.in_(post_ids),
                                            MindMap.deleted.is_(True)).values(post_id=None))
