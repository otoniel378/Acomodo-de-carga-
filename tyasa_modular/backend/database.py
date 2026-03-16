# database.py - Conexión y modelos de base de datos
from sqlalchemy import create_engine, Column, Integer, String, Float, DateTime, Boolean, ForeignKey
from sqlalchemy.orm import sessionmaker, relationship, declarative_base
from datetime import datetime, timezone
import os

from config import DATABASE_URL, DATABASE_FILE, DEFAULT_TRUCKS, DEFAULT_PRODUCTS

# Crear engine
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

# ==================== MODELOS ====================

class TruckType(Base):
    """Tipos de camión/transporte"""
    __tablename__ = "truck_types"
    
    id = Column(String, primary_key=True)
    name = Column(String, nullable=False)
    beds_count = Column(Integer, default=6)
    length_mm = Column(Integer, nullable=False)
    width_mm = Column(Integer, nullable=False)
    height_mm = Column(Integer, nullable=False)
    max_payload_kg = Column(Integer, nullable=False)
    # Nuevos campos para Full con 2 planas
    is_dual_platform = Column(Boolean, default=False)  # True si tiene 2 planas
    platforms = Column(Integer, default=1)  # Número de planas (1 o 2)
    platform_gap_mm = Column(Integer, default=500)  # Separación visual entre planas


class Product(Base):
    """Catálogo de productos/materiales"""
    __tablename__ = "products"
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    material_type = Column(String, nullable=False)  # LARGOS, SBQ, PLANOS, GALV
    sap_code = Column(String, unique=True, nullable=False)
    description = Column(String, nullable=False)
    almacen = Column(String, default="")
    # Dimensiones del paquete
    largo_mm = Column(Integer, default=0)
    ancho_mm = Column(Integer, default=0)
    alto_mm = Column(Integer, default=0)  # Calibre o altura del paquete
    # Pesos y cantidades
    peso_pieza_kg = Column(Float, default=0)
    piezas_por_paquete = Column(Integer, default=1)
    kg_por_paquete = Column(Float, default=0)


class Load(Base):
    """Carga principal"""
    __tablename__ = "loads"
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    fecha = Column(String, nullable=False)
    numero_carga = Column(String, nullable=False)
    truck_id = Column(String, ForeignKey("truck_types.id"), nullable=True)
    total_tons = Column(Float, default=0)
    total_aditamentos_kg = Column(Float, default=0)
    status = Column(String, default="DRAFT")  # DRAFT, OPTIMIZED, MANUAL
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    # Nuevos campos para identificación
    numero_viaje = Column(String, default="")
    numero_embarque = Column(String, default="")
    cliente = Column(String, default="")
    
    # Relaciones
    items = relationship("LoadItem", back_populates="load", cascade="all, delete-orphan")
    aditamentos = relationship("Aditamento", back_populates="load", cascade="all, delete-orphan")
    placements = relationship("Placement", back_populates="load", cascade="all, delete-orphan")
    bed_notes = relationship("BedNote", back_populates="load", cascade="all, delete-orphan")


class LoadItem(Base):
    """Materiales en una carga"""
    __tablename__ = "load_items"
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    load_id = Column(Integer, ForeignKey("loads.id"))
    sap_code = Column(String, nullable=False)
    description = Column(String)
    material_type = Column(String)
    almacen = Column(String)
    calibre = Column(Float, default=0)  # Calibre del material (14, 16, 18, 20, etc.)
    # Toneladas solicitadas y calculadas
    tons_solicitadas = Column(Float, nullable=False)  # Lo que pidió el usuario
    tons_en_paquetes = Column(Float, default=0)  # Lo que cabe en paquetes completos
    tons_sobrantes = Column(Float, default=0)  # Lo que sobra (no completa un paquete)
    # Dimensiones del paquete
    largo_mm = Column(Integer, default=0)
    ancho_mm = Column(Integer, default=0)
    alto_mm = Column(Integer, default=0)
    # Pesos y cantidades
    kg_por_paquete = Column(Float, default=0)
    num_paquetes = Column(Integer, default=1)
    # Diferido - va al final del acomodo (última cama)
    is_deferred = Column(Boolean, default=False)
    
    load = relationship("Load", back_populates="items")


class Aditamento(Base):
    """Aditamentos (peso extra sin acomodar)"""
    __tablename__ = "aditamentos"
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    load_id = Column(Integer, ForeignKey("loads.id"))
    name = Column(String, nullable=False)
    peso_kg = Column(Float, nullable=False)
    cantidad = Column(Integer, default=1)
    
    load = relationship("Load", back_populates="aditamentos")


class Placement(Base):
    """Posición de cada paquete en el camión"""
    __tablename__ = "placements"
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    load_id = Column(Integer, ForeignKey("loads.id"))
    load_item_id = Column(Integer, ForeignKey("load_items.id"))
    paquete_index = Column(Integer, default=0)
    platform = Column(Integer, default=1)  # Plana 1 o 2 (para Full con 2 planas)
    bed_number = Column(Integer, nullable=False)
    bed_zone = Column(String, default='A')  # Zona: 'A' = Delantera (0-6m), 'B' = Trasera (6-12m)
    x = Column(Float, default=0)
    y = Column(Float, default=0)
    z = Column(Float, default=0)
    rotated = Column(Boolean, default=False)
    length_used = Column(Float, default=0)
    width_used = Column(Float, default=0)
    height_used = Column(Float, default=0)
    placed = Column(Boolean, default=True)
    
    load = relationship("Load", back_populates="placements")


class BedNote(Base):
    """Notas por cama en una carga"""
    __tablename__ = "bed_notes"

    id = Column(Integer, primary_key=True, autoincrement=True)
    load_id = Column(Integer, ForeignKey("loads.id"))
    bed_number = Column(Integer, nullable=False)
    note = Column(String, default="")
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    load = relationship("Load", back_populates="bed_notes")


class PlacementPattern(Base):
    """Patrones de acomodo aprendidos de cargas verificadas"""
    __tablename__ = "placement_patterns"

    id = Column(Integer, primary_key=True, autoincrement=True)
    # Clave del grupo: combinación material_type + calibre_bucket + almacen (+ truck)
    feature_key = Column(String, nullable=False)
    truck_type_id = Column(String, nullable=True)     # Si None aplica a todos los camiones
    material_type = Column(String, nullable=False)
    calibre_bucket = Column(Float, default=0)         # Calibre redondeado al par más cercano
    almacen = Column(String, default="")
    # Estadísticas aprendidas
    avg_priority = Column(Float, default=0.5)         # 0.0 = va primero, 1.0 = va al final
    avg_x_normalized = Column(Float, default=0.5)    # Posición X preferida (0.0=frente, 1.0=fondo)
    avg_z_normalized = Column(Float, default=0.5)    # Posición Z preferida (0.0=izq, 1.0=der)
    times_seen = Column(Integer, default=0)           # Veces que se ha observado este grupo
    times_deferred = Column(Integer, default=0)       # Veces que el usuario lo puso como diferido
    last_updated = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class VerifiedLoad(Base):
    """Registro de cargas verificadas y usadas para aprendizaje"""
    __tablename__ = "verified_loads"

    id = Column(Integer, primary_key=True, autoincrement=True)
    load_id = Column(Integer, ForeignKey("loads.id"))
    truck_id = Column(String, nullable=True)
    total_packages = Column(Integer, default=0)
    materials_count = Column(Integer, default=0)
    patterns_updated = Column(Integer, default=0)
    verified_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


# ==================== FUNCIONES ====================

def get_db():
    """Dependency para obtener sesión de BD"""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_database():
    """Inicializa la BD y datos por defecto"""
    # Verificar si BD existe y tiene esquema correcto
    if os.path.exists(DATABASE_FILE):
        try:
            import sqlite3
            conn = sqlite3.connect(DATABASE_FILE)
            cursor = conn.cursor()
            # Verificar que existan las columnas nuevas
            cursor.execute("SELECT peso_pieza_kg FROM products LIMIT 1")
            cursor.execute("SELECT tons_sobrantes FROM load_items LIMIT 1")
            conn.close()
            print(f"✓ Base de datos existente válida")
            # Crear tablas nuevas que pudieran faltar (idempotente, no toca las existentes)
            Base.metadata.create_all(bind=engine)
            # Migrar columnas nuevas en placement_patterns si no existen
            try:
                conn_mig = sqlite3.connect(DATABASE_FILE)
                try:
                    conn_mig.execute("SELECT avg_x_normalized FROM placement_patterns LIMIT 1")
                except Exception:
                    conn_mig.execute("ALTER TABLE placement_patterns ADD COLUMN avg_x_normalized REAL DEFAULT 0.5")
                    conn_mig.execute("ALTER TABLE placement_patterns ADD COLUMN avg_z_normalized REAL DEFAULT 0.5")
                    conn_mig.commit()
                    print("✓ Columnas avg_x_normalized/avg_z_normalized agregadas a placement_patterns")
                finally:
                    conn_mig.close()
            except Exception:
                pass
            # Sincronizar max_payload_kg de camiones con los valores actuales de config
            db = SessionLocal()
            try:
                for t in DEFAULT_TRUCKS:
                    existing = db.query(TruckType).filter(TruckType.id == t['id']).first()
                    if existing and existing.max_payload_kg != t['max_payload_kg']:
                        print(f"  Actualizando {t['id']}: {existing.max_payload_kg} → {t['max_payload_kg']} kg/plana")
                        existing.max_payload_kg = t['max_payload_kg']
                db.commit()
            finally:
                db.close()
            return  # BD existe y es válida, no recrear
        except Exception as e:
            conn.close()
            os.remove(DATABASE_FILE)
            print(f"✓ BD con esquema incorrecto eliminada: {e}")
    
    # Crear tablas
    Base.metadata.create_all(bind=engine)
    print("✓ Tablas creadas/verificadas")
    
    # Insertar datos por defecto
    db = SessionLocal()
    try:
        # Camiones
        if db.query(TruckType).count() == 0:
            for t in DEFAULT_TRUCKS:
                db.add(TruckType(**t))
            db.commit()
            print(f"✓ {len(DEFAULT_TRUCKS)} camiones insertados")
        
        # Productos
        if db.query(Product).count() == 0:
            for p in DEFAULT_PRODUCTS:
                db.add(Product(**p))
            db.commit()
            print(f"✓ {len(DEFAULT_PRODUCTS)} productos insertados")
    finally:
        db.close()