# config.py - Configuración del sistema
import os
import sys

# Detectar si estamos en modo ejecutable o desarrollo
if getattr(sys, 'frozen', False):
    # Modo ejecutable - usar directorio del .exe
    BASE_DIR = os.path.dirname(sys.executable)
    INTERNAL_DIR = sys._MEIPASS
else:
    # Modo desarrollo - usar directorio del proyecto
    BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    INTERNAL_DIR = BASE_DIR

# Base de datos - en el directorio del ejecutable (persistente)
DATABASE_FILE = os.path.join(BASE_DIR, "tyasa.db")
DATABASE_URL = f"sqlite:///{DATABASE_FILE}"

# También revisar variable de entorno (usada por server.py)
if os.environ.get('TYASA_DB_PATH'):
    DATABASE_FILE = os.environ.get('TYASA_DB_PATH')
    DATABASE_URL = f"sqlite:///{DATABASE_FILE}"

# Archivo Excel de productos
EXCEL_PRODUCTS_PATH = os.path.join(BASE_DIR, "FORMADOS PERFILES TUBULARES.xlsx")

# Logo para PDF
LOGO_PATH = os.path.join(BASE_DIR, "imagenes", "logotyasacar.png")

# Servidor
HOST = "127.0.0.1"
PORT = 8000

# CORS - Orígenes permitidos
CORS_ORIGINS = [
    "http://127.0.0.1:5500",
    "http://localhost:5500",
    "http://127.0.0.1:8080",
    "http://localhost:8080",
    "*"
]

# Camiones por defecto
# NOTA: El Full tiene 2 planas físicas separadas (is_dual_platform=True)
# Cada plana tiene sus propias dimensiones y se visualizan con separación
DEFAULT_TRUCKS = [
    {
        "id": "TRAILER", 
        "name": "Tráiler", 
        "beds_count": 7, 
        "length_mm": 12050,  # 12m
        "width_mm": 2400,    # 2.4m
        "height_mm": 2900,   # 2.9m altura de carga
        "max_payload_kg": 36000,  # 36 ton
        "is_dual_platform": False,
        "platforms": 1
    },
    {
        "id": "FULL",
        "name": "Full",
        "beds_count": 7,  # 7 camas por plana
        "length_mm": 12050,  # 12m cada plana
        "width_mm": 2400,    # 2.4m
        "height_mm": 2900,   # 2.9m altura de carga
        "max_payload_kg": 25500,  # 25.5 ton POR PLANA (total = 51 ton en 2 planas)
        "is_dual_platform": True,  # TIENE 2 PLANAS
        "platforms": 2,
        "platform_gap_mm": 500  # Separación visual entre planas
    },
    {
        "id": "TORTON", 
        "name": "Tortón", 
        "beds_count": 5, 
        "length_mm": 7500,   # 7.5m
        "width_mm": 2400,    # 2.4m
        "height_mm": 2900,   # 2.9m altura de carga
        "max_payload_kg": 18000,  # 18 ton
        "is_dual_platform": False,
        "platforms": 1
    },
    {
        "id": "TORTON_DOBLE", 
        "name": "2 Tortons", 
        "beds_count": 5,  # 5 camas por plana (igual que Tortón individual)
        "length_mm": 7500,   # 7.5m cada plana
        "width_mm": 2400,    # 2.4m
        "height_mm": 2900,   # 2.9m altura de carga
        "max_payload_kg": 18000,  # 18 ton POR PLANA (total = 36 ton en 2 tortons)
        "is_dual_platform": True,  # TIENE 2 PLANAS (2 Tortons)
        "platforms": 2,
        "platform_gap_mm": 500  # Separación visual entre planas
    },
]

# Productos de ejemplo con datos realistas
# Campos: material_type, sap_code, description, almacen, 
#         largo_mm (del paquete), ancho_mm (del paquete), alto_mm (calibre/altura paquete),
#         peso_pieza_kg, piezas_por_paquete, kg_por_paquete
DEFAULT_PRODUCTS = [
    {
        "material_type": "LARGOS",
        "sap_code": "10001234",
        "description": "Varilla corrugada 3/8\" x 12m",
        "almacen": "LARGOS-A1",
        "largo_mm": 12000,
        "ancho_mm": 300,
        "alto_mm": 180,
        "peso_pieza_kg": 8.5,
        "piezas_por_paquete": 235,
        "kg_por_paquete": 2000
    },
    {
        "material_type": "LARGOS",
        "sap_code": "10001235",
        "description": "Varilla corrugada 1/2\" x 12m",
        "almacen": "LARGOS-A1",
        "largo_mm": 12000,
        "ancho_mm": 350,
        "alto_mm": 200,
        "peso_pieza_kg": 14.2,
        "piezas_por_paquete": 176,
        "kg_por_paquete": 2500
    },
    {
        "material_type": "LARGOS",
        "sap_code": "10001236",
        "description": "Varilla corrugada 5/8\" x 12m",
        "almacen": "LARGOS-A2",
        "largo_mm": 12000,
        "ancho_mm": 400,
        "alto_mm": 220,
        "peso_pieza_kg": 22.2,
        "piezas_por_paquete": 112,
        "kg_por_paquete": 2490
    },
    {
        "material_type": "LARGOS",
        "sap_code": "10004567",
        "description": "Alambrón 5.5mm (rollo)",
        "almacen": "LARGOS-B1",
        "largo_mm": 1200,
        "ancho_mm": 1200,
        "alto_mm": 1200,
        "peso_pieza_kg": 1,
        "piezas_por_paquete": 1,
        "kg_por_paquete": 1
    },
    {
        "material_type": "SBQ",
        "sap_code": "20001111",
        "description": "Barra redonda SBQ 1\" x 6m",
        "almacen": "SBQ-C1",
        "largo_mm": 6000,
        "ancho_mm": 400,
        "alto_mm": 250,
        "peso_pieza_kg": 1,
        "piezas_por_paquete": 120,
        "kg_por_paquete": 120
    },
    {
        "material_type": "SBQ",
        "sap_code": "20001112",
        "description": "Barra redonda SBQ 1-1/4\" x 6m",
        "almacen": "SBQ-C1",
        "largo_mm": 6000,
        "ancho_mm": 450,
        "alto_mm": 280,
        "peso_pieza_kg": 1,
        "piezas_por_paquete": 90,
        "kg_por_paquete": 90
    },
    {
        "material_type": "PLANOS",
        "sap_code": "30002222",
        "description": "Lámina HR Cal.10 4x8",
        "almacen": "PLANOS-D1",
        "largo_mm": 2440,
        "ancho_mm": 1220,
        "alto_mm": 100,
        "peso_pieza_kg": 58.4,
        "piezas_por_paquete": 14,
        "kg_por_paquete": 818
    },
    {
        "material_type": "PLANOS",
        "sap_code": "30003333",
        "description": "Placa 1/2\" x 4x8",
        "almacen": "PLANOS-D2",
        "largo_mm": 2440,
        "ancho_mm": 1220,
        "alto_mm": 200,
        "peso_pieza_kg": 238,
        "piezas_por_paquete": 10,
        "kg_por_paquete": 2380
    },
    {
        "material_type": "GALV",
        "sap_code": "40001111",
        "description": "Lámina galvanizada Cal.22 4x8",
        "almacen": "GALV-E1",
        "largo_mm": 2440,
        "ancho_mm": 1220,
        "alto_mm": 80,
        "peso_pieza_kg": 14.6,
        "piezas_por_paquete": 28,
        "kg_por_paquete": 409
    },
    {
        "material_type": "GALV",
        "sap_code": "40001112",
        "description": "Lámina galvanizada Cal.18 4x8",
        "almacen": "GALV-E1",
        "largo_mm": 2440,
        "ancho_mm": 1220,
        "alto_mm": 120,
        "peso_pieza_kg": 23.3,
        "piezas_por_paquete": 20,
        "kg_por_paquete": 466
    },
]