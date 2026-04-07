"""
Posts API tests
"""


def test_create_post_success(client, auth_headers):
    """Test creating a new post with authentication"""
    post_data = {
        'title': 'Test Post',
        'slug': 'test-post',
        'content': 'This is test content',
        'summary': 'Test summary',
        'status': 'published',
        'is_top': False,
        'order': 0
    }
    
    response = client.post('/api/posts', json=post_data, headers=auth_headers)
    
    assert response.status_code == 201
    data = response.get_json()
    assert data['success'] is True
    assert data['code'] == 201
    assert data['data']['title'] == 'Test Post'
    assert data['data']['slug'] == '/test-post'


def test_create_post_unauthorized(client):
    """Test creating post without authentication fails"""
    post_data = {
        'title': 'Test Post',
        'slug': 'test-post',
        'content': 'This is test content'
    }
    
    response = client.post('/api/posts', json=post_data)
    
    assert response.status_code == 401


def test_create_post_missing_title(client, auth_headers):
    """Test creating post without title fails"""
    post_data = {
        'slug': 'test-post',
        'content': 'This is test content'
    }
    
    response = client.post('/api/posts', json=post_data, headers=auth_headers)
    
    assert response.status_code == 400
    data = response.get_json()
    assert '标题不能为空' in data['message']


def test_create_post_missing_slug(client, auth_headers):
    """Test creating post without slug fails"""
    post_data = {
        'title': 'Test Post',
        'content': 'This is test content'
    }
    
    response = client.post('/api/posts', json=post_data, headers=auth_headers)
    
    assert response.status_code == 400
    data = response.get_json()
    assert 'slug不能为空' in data['message']


def test_get_posts_list_success(client, auth_headers):
    """Test getting posts list with authentication"""
    client.post('/api/posts', json={
        'title': 'Post 1',
        'slug': 'post-1',
        'content': 'Content 1'
    }, headers=auth_headers)
    
    client.post('/api/posts', json={
        'title': 'Post 2',
        'slug': 'post-2',
        'content': 'Content 2'
    }, headers=auth_headers)
    
    response = client.get('/api/posts', headers=auth_headers)
    
    assert response.status_code == 200
    data = response.get_json()
    assert data['success'] is True
    assert 'items' in data['data']
    assert 'total' in data['data']
    assert data['data']['total'] >= 2


def test_get_posts_list_unauthorized(client):
    """Test getting posts list without authentication fails"""
    response = client.get('/api/posts')
    
    assert response.status_code == 401


def test_get_posts_list_with_pagination(client, auth_headers):
    """Test getting posts list with pagination parameters"""
    for i in range(5):
        client.post('/api/posts', json={
            'title': f'Post {i}',
            'slug': f'post-{i}',
            'content': f'Content {i}'
        }, headers=auth_headers)
    
    response = client.get('/api/posts?page=1&page_size=2', headers=auth_headers)
    
    assert response.status_code == 200
    data = response.get_json()
    assert data['data']['page'] == 1
    assert data['data']['page_size'] == 2
    assert len(data['data']['items']) <= 2


def test_get_post_detail_success(client, auth_headers):
    """Test getting post detail by slug"""
    client.post('/api/posts', json={
        'title': 'Detail Test Post',
        'slug': 'detail-test',
        'content': 'Detail content'
    }, headers=auth_headers)
    
    response = client.get('/api/posts/detail-test', headers=auth_headers)
    
    assert response.status_code == 200
    data = response.get_json()
    assert data['success'] is True
    assert data['data']['title'] == 'Detail Test Post'
    assert data['data']['slug'] == '/detail-test'


def test_get_post_detail_unauthorized(client):
    """Test getting post detail without authentication fails"""
    response = client.get('/api/posts/test-slug')
    
    assert response.status_code == 401


def test_get_post_detail_not_found(client, auth_headers):
    """Test getting non-existent post returns 404"""
    response = client.get('/api/posts/non-existent', headers=auth_headers)
    
    assert response.status_code == 404
    data = response.get_json()
    assert data['success'] is False


def test_update_post_success(client, auth_headers):
    """Test updating existing post"""
    client.post('/api/posts', json={
        'title': 'Original Title',
        'slug': 'update-test',
        'content': 'Original content'
    }, headers=auth_headers)
    
    update_data = {
        'title': 'Updated Title',
        'content': 'Updated content'
    }
    
    response = client.put('/api/posts/update-test', json=update_data, headers=auth_headers)
    
    assert response.status_code == 200
    data = response.get_json()
    assert data['success'] is True
    assert data['data']['title'] == 'Updated Title'


def test_update_post_unauthorized(client):
    """Test updating post without authentication fails"""
    update_data = {'title': 'Updated Title'}
    
    response = client.put('/api/posts/test-slug', json=update_data)
    
    assert response.status_code == 401


def test_update_post_not_found(client, auth_headers):
    """Test updating non-existent post returns 404"""
    update_data = {'title': 'Updated Title'}
    
    response = client.put('/api/posts/non-existent', json=update_data, headers=auth_headers)
    
    assert response.status_code == 404


def test_delete_post_success(client, auth_headers):
    """Test deleting existing post"""
    client.post('/api/posts', json={
        'title': 'To Be Deleted',
        'slug': 'delete-test',
        'content': 'Delete content'
    }, headers=auth_headers)
    
    response = client.delete('/api/posts/delete-test', headers=auth_headers)
    
    assert response.status_code == 200
    data = response.get_json()
    assert data['success'] is True
    
    get_response = client.get('/api/posts/delete-test', headers=auth_headers)
    assert get_response.status_code == 404


def test_delete_post_unauthorized(client):
    """Test deleting post without authentication fails"""
    response = client.delete('/api/posts/test-slug')
    
    assert response.status_code == 401


def test_delete_post_not_found(client, auth_headers):
    """Test deleting non-existent post returns 404"""
    response = client.delete('/api/posts/non-existent', headers=auth_headers)
    
    assert response.status_code == 404


def test_get_post_tree_success(client, auth_headers):
    """Test getting post tree structure"""
    client.post('/api/posts', json={
        'title': 'Parent Post',
        'slug': 'parent',
        'content': 'Parent content'
    }, headers=auth_headers)
    
    response = client.get('/api/posts/tree', headers=auth_headers)
    
    assert response.status_code == 200
    data = response.get_json()
    assert data['success'] is True
    assert isinstance(data['data'], list)


def test_get_post_tree_unauthorized(client):
    """Test getting post tree without authentication fails"""
    response = client.get('/api/posts/tree')
    
    assert response.status_code == 401


def test_create_post_with_parent(client, auth_headers):
    """Test creating post with parent_id"""
    parent_response = client.post('/api/posts', json={
        'title': 'Parent Post',
        'slug': 'parent-post',
        'content': 'Parent content'
    }, headers=auth_headers)
    
    parent_id = parent_response.get_json()['data']['id']
    
    child_response = client.post('/api/posts', json={
        'title': 'Child Post',
        'slug': 'child-post',
        'content': 'Child content',
        'parent_id': parent_id
    }, headers=auth_headers)
    
    assert child_response.status_code == 201
    child_data = child_response.get_json()
    assert child_data['data']['slug'] == '/parent-post/child-post'
    assert child_data['data']['level'] == 1


def test_create_duplicate_slug(client, auth_headers):
    """Test creating post with duplicate slug fails"""
    client.post('/api/posts', json={
        'title': 'First Post',
        'slug': 'duplicate-test',
        'content': 'Content'
    }, headers=auth_headers)
    
    response = client.post('/api/posts', json={
        'title': 'Second Post',
        'slug': 'duplicate-test',
        'content': 'Content'
    }, headers=auth_headers)
    
    assert response.status_code == 409
    data = response.get_json()
    assert 'slug已存在' in data['message']
