"""Independent mind-map capability, sharing DouBlog's database and authentication."""
from app.mindmap.routes import router
from .mcp_api import mcp_provider as mcp_provider

__all__ = ['router']
