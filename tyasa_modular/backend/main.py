# main.py - Punto de entrada del servidor
"""
TYASA - Sistema de Acomodo de Carga
====================================
Backend modular con FastAPI

Ejecutar: python main.py
App: http://127.0.0.1:8000
Docs: http://127.0.0.1:8000/docs
"""

import sys
import os

# Agregar el directorio actual al path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, Response

# Importar configuración
try:
    from config import HOST, PORT, CORS_ORIGINS
except ImportError:
    HOST = "127.0.0.1"
    PORT = 8000
    CORS_ORIGINS = ["*"]

# Importar database
try:
    from database import init_database
except ImportError as e:
    print(f"Error importando database: {e}")
    init_database = None

# ==================== APP ====================
app = FastAPI(
    title="TYASA - Sistema de Acomodo de Carga",
    description="API para gestión y optimización de carga en transportes",
    version="2.1.0"
)

# ==================== CORS ====================
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ==================== IMPORTAR ROUTERS ====================
try:
    from routes.trucks import router as trucks_router
    app.include_router(trucks_router)
    print("✓ Rutas de trucks cargadas")
except ImportError as e:
    print(f"⚠ Error cargando trucks: {e}")

try:
    from routes.products import router as products_router
    app.include_router(products_router)
    print("✓ Rutas de products cargadas")
except ImportError as e:
    print(f"⚠ Error cargando products: {e}")

try:
    from routes.loads import router as loads_router
    app.include_router(loads_router)
    print("✓ Rutas de loads cargadas")
except ImportError as e:
    print(f"⚠ Error cargando loads: {e}")

try:
    from routes.optimize import router as optimize_router
    app.include_router(optimize_router)
    print("✓ Rutas de optimize cargadas")
except ImportError as e:
    print(f"⚠ Error cargando optimize: {e}")

try:
    from routes.learning import router as learning_router
    app.include_router(learning_router)
    print("✓ Rutas de learning cargadas")
except ImportError as e:
    print(f"⚠ Error cargando learning: {e}")


# ==================== ARCHIVOS ESTÁTICOS ====================
# Ruta al directorio frontend (relativo al backend)
FRONTEND_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "frontend")
IMAGES_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "imagenes")

# Montar carpetas estáticas
if os.path.exists(os.path.join(FRONTEND_DIR, "css")):
    app.mount("/css", StaticFiles(directory=os.path.join(FRONTEND_DIR, "css")), name="css")
    print("✓ CSS montado")

if os.path.exists(os.path.join(FRONTEND_DIR, "js")):
    app.mount("/js", StaticFiles(directory=os.path.join(FRONTEND_DIR, "js")), name="js")
    print("✓ JS montado")

if os.path.exists(IMAGES_DIR):
    app.mount("/imagenes", StaticFiles(directory=IMAGES_DIR), name="imagenes")
    print("✓ Imágenes montadas")


# ==================== SERVIR HTML ====================
@app.get("/")
def serve_index():
    """Servir el archivo HTML principal"""
    index_path = os.path.join(FRONTEND_DIR, "index.html")
    if os.path.exists(index_path):
        return FileResponse(index_path, media_type="text/html")
    return {"message": "TYASA API - Frontend no encontrado", "docs": "/docs"}


@app.get("/favicon.ico", include_in_schema=False)
def favicon():
    return Response(content=b"", status_code=204)


@app.get("/api/health")
def health():
    return {"status": "ok", "version": "2.1.0"}


# ==================== STARTUP ====================
@app.on_event("startup")
def startup():
    print("\n" + "=" * 50)
    print("TYASA - Sistema de Acomodo de Carga")
    print("=" * 50)
    if init_database:
        try:
            init_database()
        except Exception as e:
            print(f"⚠ Error inicializando BD: {e}")
    print("=" * 50)
    print(f"✓ App: http://{HOST}:{PORT}")
    print(f"✓ Docs: http://{HOST}:{PORT}/docs")
    print("=" * 50 + "\n")


# ==================== RUN ====================
if __name__ == "__main__":
    import uvicorn
    print("\nIniciando servidor...")
    # reload=False para evitar recargas automáticas
    uvicorn.run("main:app", host=HOST, port=PORT, reload=False)