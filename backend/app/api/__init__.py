"""
API Package
"""
from app.api.auth import bp as auth_bp
from app.api.posts import bp as posts_bp
from app.api.images import bp as images_bp

__all__ = ['auth_bp', 'posts_bp', 'images_bp']