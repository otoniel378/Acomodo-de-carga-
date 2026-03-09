# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

TYASA - Sistema de Acomodo de Carga: a load arrangement/optimization system for a steel products company. It calculates how to pack steel material packages (bundles) onto truck platforms (planas) using a bin-packing algorithm.

## Running the Application

**Quick start (Windows):**
```bat
tyasa_modular\iniciar.bat
```
This installs dependencies, starts the backend on port 8000, and serves the frontend on port 5500.

**Backend only (development):**
```bash
cd tyasa_modular/backend
pip install fastapi uvicorn sqlalchemy pydantic python-multipart pandas openpyxl
python main.py
```
- App: http://127.0.0.1:8000
- API docs: http://127.0.0.1:8000/docs

**Frontend:** served by the backend at `/` (static files), or independently via `python -m http.server 5500` from the `frontend/` directory.

## Architecture

```
tyasa_modular/
  backend/
    main.py          # FastAPI app, mounts static files, registers routers
    config.py        # HOST, PORT, DATABASE_URL, DEFAULT_TRUCKS, DEFAULT_PRODUCTS
    database.py      # SQLAlchemy models + init_database()
    schemas.py       # Pydantic request/response models
    routes/
      trucks.py      # CRUD for truck types
      products.py    # CRUD for product catalog (also imports from Excel)
      loads.py       # CRUD for loads + PDF generation
      optimize.py    # Bin-packing optimization engine
  frontend/
    index.html
    css/styles.css
    js/
      api.js         # All fetch() calls to the backend API
      state.js       # Global app state object
      main.js        # Initialization, event binding, load management UI
      ui.js          # UI helpers, forms, modals
      vierwer.js     # 2D/3D visualization of the truck load (Three.js)
  tyasa.db           # SQLite database (auto-created on first run)
  FORMADOS PERFILES TUBULARES.xlsx  # Product catalog source
```

## Key Domain Concepts

**Truck types** (defined in `config.py::DEFAULT_TRUCKS`):
- `TRAILER`: 12m single platform, 36 ton
- `FULL`: 12m dual platform (`is_dual_platform=True`), 50 ton total
- `TORTON`: 7.5m single platform, 18 ton
- `TORTON_DOBLE`: 7.5m dual platform, 36 ton

**Material types:** LARGOS (long bars/rods), SBQ (special bar quality), PLANOS (flat sheets), GALV (galvanized sheets).

**Load flow:** Create Load -> Add LoadItems (materials with tons requested) -> Run Optimization -> Placements are generated.

**Placement coordinate system:** X = length axis (0 to truck length_mm), Z = width axis (0 to truck width_mm), Y = height axis (base_y = bottom of the "cama"/bed layer).

## Optimization Engine (`routes/optimize.py`)

Two modes controlled by `OptimizeRequest.mode`:
- **opt1**: Packs across the full truck surface (0 to MAX_L)
- **opt2**: Two-phase — fills frontal zone (0–6025mm) vertically first, then rear zone (6025mm–MAX_L)

**Sorting order:** almacen priority > calibre ASC (14→18→20) > height DESC > area DESC. This ensures thinner calibre packages fill the bottom beds first.

**Height constraint per bed:** Packages in the same bed must have heights within ±20mm of each other (`MAX_HEIGHT_DIFF = 20`). Max stack height is 2700mm (`MAX_TOTAL_HEIGHT`).

**Deferred items** (`is_deferred=True` on a LoadItem): placed last after all normal packages, following the same stacking logic.

**Dual-platform loads:** Platform 1 fills first; overflow goes to Platform 2. Each platform has its own weight limit (`payload_per_platform`).

## Database

SQLite at `tyasa_modular/tyasa.db`. Schema managed by SQLAlchemy (`Base.metadata.create_all`). On startup, `init_database()` checks if the DB has the expected columns; if not, it deletes and recreates it — **the DB is not migrated, it is recreated**. Default trucks and sample products are seeded on first run.

Key tables: `truck_types`, `products`, `loads`, `load_items`, `aditamentos`, `placements`, `bed_notes`.

The `TYASA_DB_PATH` environment variable overrides the database file location.
