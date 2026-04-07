"""
pytest fixtures for DouBlog backend tests
"""
import os
import tempfile
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
import app.database as db_module
from app.database import Base


@pytest.fixture
def app():
    """Create application with test database"""
    db_fd, db_path = tempfile.mkstemp(suffix='.db')
    
    test_engine = create_engine(
        f'sqlite:///{db_path}',
        connect_args={'check_same_thread': False}
    )
    
    TestSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=test_engine)
    
    original_engine = db_module.engine
    original_session_local = db_module.SessionLocal
    
    db_module.engine = test_engine
    db_module.SessionLocal = TestSessionLocal
    
    Base.metadata.create_all(bind=test_engine)
    
    from app.main import create_app
    app = create_app()
    app.config['TESTING'] = True
    app.config['SECRET_KEY'] = 'test-secret-key'
    
    yield app
    
    db_module.engine = original_engine
    db_module.SessionLocal = original_session_local
    
    os.close(db_fd)
    os.unlink(db_path)


@pytest.fixture
def client(app):
    """Create test client"""
    return app.test_client()


@pytest.fixture
def auth_headers():
    """Return authentication headers for admin user"""
    import base64
    credentials = base64.b64encode(b"admin:lizy111A").decode('utf-8')
    return {'Authorization': f'Basic {credentials}'}


@pytest.fixture
def db_session():
    """Create database session for tests"""
    import app.database as db_module
    from sqlalchemy.orm import sessionmaker

    Session = sessionmaker(bind=db_module.engine)
    session = Session()

    yield session

    session.close()
    session.rollback()
