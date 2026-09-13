"""
API Package
"""
from app.api.auth import bp as auth_bp
from app.api.posts import bp as posts_bp
from app.api.images import bp as images_bp
from app.api.admin import bp as admin_bp
from app.api.workspaces import bp as workspaces_bp
from app.api.export import bp as export_bp

__all__ = ['auth_bp', 'posts_bp', 'images_bp', 'admin_bp', 'workspaces_bp', 'export_bp']