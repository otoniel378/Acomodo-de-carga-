# schemas.py - Modelos Pydantic para validación de datos
from pydantic import BaseModel
from typing import List, Optional


# ==================== TRUCKS ====================
class TruckBase(BaseModel):
    id: str
    name: str
    beds_count: int = 6
    length_mm: int
    width_mm: int
    height_mm: int
    max_payload_kg: int
    is_dual_platform: Optional[bool] = False  # True si tiene 2 planas
    platforms: Optional[int] = 1  # Número de planas (1 o 2)
    platform_gap_mm: Optional[int] = 500  # Separación entre planas

class TruckCreate(TruckBase):
    pass

class TruckResponse(TruckBase):
    class Config:
        from_attributes = True


# ==================== PRODUCTS ====================
class ProductBase(BaseModel):
    material_type: str
    sap_code: str
    description: str
    almacen: Optional[str] = ""
    medida: Optional[str] = ""
    calibre: Optional[float] = 0
    largo_mm: Optional[float] = 0
    ancho_mm: Optional[float] = 0
    alto_mm: Optional[float] = 0
    peso_pieza_kg: Optional[float] = 0
    piezas_por_paquete: Optional[int] = 1
    kg_por_paquete: Optional[float] = 0

class ProductCreate(ProductBase):
    pass

class ProductResponse(ProductBase):
    id: int
    
    class Config:
        from_attributes = True


# ==================== LOAD ITEMS ====================
class LoadItemBase(BaseModel):
    sap_code: str
    description: Optional[str] = ""
    material_type: Optional[str] = ""
    almacen: Optional[str] = ""
    calibre: Optional[float] = 0  # Calibre del material (14, 16, 18, 20, etc.)
    tons_solicitadas: float  # Toneladas que el usuario quiere enviar
    largo_mm: Optional[float] = 0
    ancho_mm: Optional[float] = 0
    alto_mm: Optional[float] = 0
    kg_por_paquete: Optional[float] = 0
    is_deferred: Optional[bool] = False  # Si es diferido, va al final del acomodo

class LoadItemResponse(LoadItemBase):
    id: int
    tons_en_paquetes: float
    tons_sobrantes: float
    num_paquetes: int
    is_deferred: bool = False
    
    class Config:
        from_attributes = True


# ==================== ADITAMENTOS ====================
class AditamentoBase(BaseModel):
    name: str
    peso_kg: float
    cantidad: int = 1

class AditamentoResponse(AditamentoBase):
    id: int
    
    class Config:
        from_attributes = True


# ==================== PLACEMENTS ====================
class PlacementBase(BaseModel):
    bed_number: int
    x: float = 0
    y: float = 0
    z: float = 0
    rotated: bool = False

class PlacementUpdate(BaseModel):
    bed_number: Optional[int] = None
    platform: Optional[int] = None  # Plana 1 o 2
    x: Optional[float] = None
    y: Optional[float] = None
    z: Optional[float] = None
    rotated: Optional[bool] = None
    length_used: Optional[float] = None
    width_used: Optional[float] = None
    height_used: Optional[float] = None

class PlacementResponse(BaseModel):
    id: int
    load_item_id: int
    paquete_index: int
    platform: int = 1  # Plana 1 o 2
    bed_number: int
    bed_zone: str = 'A'  # Zona: 'A' = Delantera, 'B' = Trasera
    x: float
    y: float
    z: float
    rotated: bool
    length_used: float
    width_used: float
    height_used: float
    placed: bool
    
    class Config:
        from_attributes = True


# ==================== LOADS ====================
class LoadCreate(BaseModel):
    fecha: str
    numero_carga: str
    truck_id: Optional[str] = None
    numero_viaje: Optional[str] = ""
    numero_embarque: Optional[str] = ""
    cliente: Optional[str] = ""

class LoadUpdate(BaseModel):
    truck_id: Optional[str] = None
    numero_carga: Optional[str] = None
    items: Optional[List[LoadItemBase]] = None
    aditamentos: Optional[List[AditamentoBase]] = None
    numero_viaje: Optional[str] = None
    numero_embarque: Optional[str] = None
    cliente: Optional[str] = None

class LoadResponse(BaseModel):
    id: int
    fecha: str
    numero_carga: str
    truck_id: Optional[str]
    total_tons: float
    total_aditamentos_kg: float
    status: str
    items_count: Optional[int] = 0
    numero_viaje: Optional[str] = ""
    numero_embarque: Optional[str] = ""
    cliente: Optional[str] = ""
    
    class Config:
        from_attributes = True

class LoadDetailResponse(BaseModel):
    id: int
    fecha: str
    numero_carga: str
    truck_id: Optional[str]
    truck: Optional[TruckResponse]
    total_tons: float
    total_aditamentos_kg: float
    status: str
    items: List[LoadItemResponse]
    aditamentos: List[AditamentoResponse]
    placements: List[PlacementResponse]
    numero_viaje: Optional[str] = ""
    numero_embarque: Optional[str] = ""
    cliente: Optional[str] = ""


# ==================== SEARCH ====================
class LoadSearchRequest(BaseModel):
    fecha: Optional[str] = None
    numero_viaje: Optional[str] = None
    numero_embarque: Optional[str] = None
    cliente: Optional[str] = None


# ==================== OPTIMIZE ====================
class AlmacenPriority(BaseModel):
    almacen: str
    calibre: Optional[float] = None  # None = aplica a todos los calibres de este almacén
    priority: int  # 1 es el más importante

class OptimizeRequest(BaseModel):
    load_id: int
    mode: str = "opt1"  # "opt1" o "opt2" (opt2 = frontal primero)
    almacen_priorities: List[AlmacenPriority] = []  # Lista de prioridades
    truck_quantity: int = 1  # Cantidad de transportes (1, 2, 3...)
    gap_floor_to_bed: int = 0  # Espacio del suelo a la primera cama (mm) - 0 = pegado al suelo
    gap_between_beds: int = 100  # Espacio entre camas (mm) - default 10cm
    center_packages: bool = True  # Centrar paquetes en el ancho de la cama

class BedStats(BaseModel):
    bed_number: int
    platform: int = 1  # Plana 1 o 2
    packages_count: int
    fill_percentage: float
    total_weight: float
    base_y: float = 0
    max_height: float = 0

class OptimizeResponse(BaseModel):
    success: bool
    message: str
    total_placed: int
    not_placed: int
    beds_used: int
    beds_stats: List[BedStats]
    total_weight_kg: float
    total_height_mm: float = 0  # Altura total desde piso hasta última cama