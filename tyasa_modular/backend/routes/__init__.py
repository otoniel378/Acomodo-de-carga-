# routes/__init__.py
from .trucks import router as trucks_router
from .products import router as products_router
from .loads import router as loads_router
from .optimize import router as optimize_router

__all__ = ["trucks_router", "products_router", "loads_router", "optimize_router"]