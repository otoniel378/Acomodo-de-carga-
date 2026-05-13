# routes/products.py - Endpoints de productos (desde Excel)
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import List, Optional
import pandas as pd
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from database import get_db, Product
from schemas import ProductCreate, ProductResponse
from config import EXCEL_PRODUCTS_PATH, IS_PRODUCTION

router = APIRouter(prefix="/api/products", tags=["products"])

# Cache del Excel para no leerlo cada vez
_excel_cache = None
_excel_mtime = 0


def _db_row_to_product(p: Product) -> dict:
    """Convertir fila de DB a formato de respuesta"""
    kg = float(p.kg_por_paquete or 0)
    alto = float(p.alto_mm or 0)
    ancho = float(p.ancho_mm or 0)
    largo = float(p.largo_mm or 0)
    return {
        "id": p.id,
        "sap_code": p.sap_code,
        "description": p.description,
        "material_type": p.material_type,
        "almacen": p.almacen or "",
        "medida": getattr(p, 'medida', '') or "",
        "calibre": float(getattr(p, 'calibre', 0) or 0),
        "largo_mm": largo,
        "ancho_mm": ancho,
        "alto_mm": alto,
        "largo_cm": largo / 10,
        "ancho_cm": ancho / 10,
        "alto_cm": alto / 10,
        "kg_por_paquete": kg,
        "peso_ton": kg / 1000,
        "peso_pieza_kg": float(p.peso_pieza_kg or 0),
        "piezas_por_paquete": int(p.piezas_por_paquete or 1),
    }


def sync_excel_to_db(db: Session):
    """Importa productos del Excel a la BD (agrega los que falten)"""
    df = load_excel_products()
    if df.empty:
        print("⚠ No se pudo sincronizar Excel → DB: Excel vacío")
        return
    count = 0
    for _, row in df.iterrows():
        sap = str(row.get('sap_code', '')).strip()
        if not sap:
            continue
        exists = db.query(Product).filter(Product.sap_code == sap).first()
        if not exists:
            db.add(Product(
                sap_code=sap,
                description=str(row.get('description', '')),
                material_type=str(row.get('material_type', '')),
                almacen=str(row.get('almacen', '')),
                medida=str(row.get('medida', '')),
                calibre=float(row.get('calibre', 0) or 0),
                largo_mm=int(row.get('largo_mm', 0) or 0),
                ancho_mm=int(row.get('ancho_mm', 0) or 0),
                alto_mm=int(row.get('alto_mm', 0) or 0),
                kg_por_paquete=float(row.get('kg_por_paquete', 0) or 0),
                peso_pieza_kg=0,
                piezas_por_paquete=1,
            ))
            count += 1
    db.commit()
    print(f"✓ {count} productos sincronizados de Excel → DB")

def load_excel_products():
    """Cargar productos desde el archivo Excel"""
    global _excel_cache, _excel_mtime
    
    if not os.path.exists(EXCEL_PRODUCTS_PATH):
        print(f"⚠ Archivo Excel no encontrado: {EXCEL_PRODUCTS_PATH}")
        return pd.DataFrame()
    
    # Verificar si el archivo cambió
    current_mtime = os.path.getmtime(EXCEL_PRODUCTS_PATH)
    if _excel_cache is not None and current_mtime == _excel_mtime:
        return _excel_cache
    
    try:
        # Leer Excel - la primera fila es el header
        df = pd.read_excel(EXCEL_PRODUCTS_PATH, sheet_name=0, header=0)
        
        # Limpiar nombres de columnas (quitar espacios al inicio y final)
        df.columns = df.columns.str.strip()
        
        # Eliminar columnas duplicadas (quedarse con la primera)
        df = df.loc[:, ~df.columns.duplicated()]
        
        print(f"Columnas encontradas en Excel: {list(df.columns)}")
        
        # Crear DataFrame normalizado
        df_norm = pd.DataFrame()
        
        # Mapear columnas - Clave SAP (convertir a string limpio)
        if 'Clave Sap' in df.columns:
            # Convertir a string, manejar números enteros sin decimales
            def clean_sap(x):
                try:
                    # Si es número, convertir a int para quitar decimales, luego a string
                    if pd.isna(x):
                        return ''
                    num = float(x)
                    if num == int(num):
                        return str(int(num))
                    return str(x)
                except:
                    return str(x).strip()
            df_norm['sap_code'] = df['Clave Sap'].apply(clean_sap)
        
        # Nombre/Descripción
        if 'Nombre' in df.columns:
            df_norm['description'] = df['Nombre'].astype(str)
        
        # Producto (tipo de material)
        if 'Producto' in df.columns:
            df_norm['material_type'] = df['Producto'].astype(str).str.strip()
        
        # Medida
        if 'Medida' in df.columns:
            df_norm['medida'] = df['Medida'].astype(str).str.strip()
        
        # Almacén
        if 'Almacen' in df.columns:
            df_norm['almacen'] = df['Almacen'].astype(str).str.strip()
        
        # Calibre
        if 'Calibre' in df.columns:
            df_norm['calibre'] = pd.to_numeric(df['Calibre'], errors='coerce').fillna(0)
        
        # Alto del paquete en cm
        if 'Alto del paquete' in df.columns:
            df_norm['alto_cm'] = pd.to_numeric(df['Alto del paquete'], errors='coerce').fillna(15)
        else:
            df_norm['alto_cm'] = 15.0
        
        # Ancho del paquete en cm
        if 'Ancho del paquete' in df.columns:
            df_norm['ancho_cm'] = pd.to_numeric(df['Ancho del paquete'], errors='coerce').fillna(30)
        else:
            df_norm['ancho_cm'] = 30.0
        
        # Largo del paquete en cm
        if 'Largo del paquete' in df.columns:
            df_norm['largo_cm'] = pd.to_numeric(df['Largo del paquete'], errors='coerce').fillna(600)
        else:
            df_norm['largo_cm'] = 600.0
        
        # Peso por paquete en toneladas
        if 'Peso por paquete ton' in df.columns:
            df_norm['peso_ton'] = pd.to_numeric(df['Peso por paquete ton'], errors='coerce').fillna(0.5)
        else:
            df_norm['peso_ton'] = 0.5
        
        # Convertir a mm para uso interno
        df_norm['alto_mm'] = df_norm['alto_cm'] * 10
        df_norm['ancho_mm'] = df_norm['ancho_cm'] * 10
        df_norm['largo_mm'] = df_norm['largo_cm'] * 10
        df_norm['kg_por_paquete'] = df_norm['peso_ton'] * 1000
        
        _excel_cache = df_norm
        _excel_mtime = current_mtime
        print(f"✓ Excel cargado: {len(df_norm)} productos")
        
        # Debug: mostrar primer producto
        if len(df_norm) > 0:
            print(f"  Ejemplo - SAP: {df_norm['sap_code'].iloc[0]}, Calibre: {df_norm['calibre'].iloc[0]}, Almacen: {df_norm['almacen'].iloc[0]}")
        
        return df_norm
        
    except Exception as e:
        print(f"✗ Error leyendo Excel: {e}")
        import traceback
        traceback.print_exc()
        return pd.DataFrame()


def excel_row_to_product(row):
    """Convertir fila de Excel a formato de producto"""
    return {
        "id": int(row.name) if hasattr(row, 'name') else 0,
        "sap_code": str(row.get('sap_code', '')),
        "description": str(row.get('description', '')),
        "material_type": str(row.get('material_type', '')),
        "almacen": str(row.get('almacen', '')),
        "medida": str(row.get('medida', '')),
        "calibre": float(row.get('calibre', 0)),
        "largo_mm": int(row.get('largo_mm', 6000)),
        "ancho_mm": float(row.get('ancho_mm', 300)),
        "alto_mm": float(row.get('alto_mm', 150)),
        "largo_cm": float(row.get('largo_cm', 600)),
        "ancho_cm": float(row.get('ancho_cm', 30)),
        "alto_cm": float(row.get('alto_cm', 15)),
        "kg_por_paquete": float(row.get('kg_por_paquete', 500)),
        "peso_ton": float(row.get('peso_ton', 0.5)),
        "peso_pieza_kg": 0,
        "piezas_por_paquete": 1
    }


@router.get("")
def get_products(
    material_type: Optional[str] = None,
    search: Optional[str] = None,
    db: Session = Depends(get_db)
):
    """Obtener productos, opcionalmente filtrados"""
    if IS_PRODUCTION:
        q = db.query(Product)
        if material_type:
            q = q.filter(Product.material_type == material_type.upper())
        if search:
            s = f"%{search.lower()}%"
            from sqlalchemy import or_, func
            q = q.filter(or_(
                func.lower(Product.sap_code).like(s),
                func.lower(Product.description).like(s)
            ))
        return [_db_row_to_product(p) for p in q.limit(100).all()]

    df = load_excel_products()
    if df.empty:
        q = db.query(Product)
        if material_type:
            q = q.filter(Product.material_type == material_type)
        return q.all()
    if material_type:
        df = df[df['material_type'].str.upper() == material_type.upper()]
    if search:
        search_lower = search.lower()
        mask = (
            df['sap_code'].str.lower().str.contains(search_lower, na=False) |
            df['description'].str.lower().str.contains(search_lower, na=False)
        )
        df = df[mask]
    return [excel_row_to_product(row) for _, row in df.iterrows()][:100]


@router.get("/search/{sap_code}")
def search_product(sap_code: str, db: Session = Depends(get_db)):
    """Buscar producto por código SAP"""
    if IS_PRODUCTION:
        try:
            norm = str(int(float(sap_code.strip())))
        except Exception:
            norm = sap_code.strip()
        product = db.query(Product).filter(Product.sap_code == norm).first()
        if not product:
            product = db.query(Product).filter(Product.sap_code.contains(sap_code.strip())).first()
        if not product:
            raise HTTPException(status_code=404, detail=f"Producto '{sap_code}' no encontrado")
        result = _db_row_to_product(product)
        print(f"✓ Producto encontrado: SAP={result['sap_code']}, Calibre={result['calibre']}")
        return result

    df = load_excel_products()
    if df.empty:
        product = db.query(Product).filter(Product.sap_code.contains(sap_code)).first()
        if not product:
            raise HTTPException(status_code=404, detail="Producto no encontrado")
        return product
    search_code = sap_code.strip()
    matches = df[df['sap_code'] == search_code]
    if matches.empty:
        try:
            numeric_code = str(int(float(search_code)))
            matches = df[df['sap_code'] == numeric_code]
        except Exception:
            pass
    if matches.empty:
        mask = df['sap_code'].str.contains(search_code, na=False, regex=False)
        matches = df[mask]
    if matches.empty:
        raise HTTPException(status_code=404, detail=f"Producto '{sap_code}' no encontrado")
    row = matches.iloc[0]
    result = excel_row_to_product(row)
    print(f"✓ Producto encontrado: SAP={result['sap_code']}, Calibre={result['calibre']}, Almacen={result['almacen']}")
    return result


@router.get("/{sap_code}")
def get_product(sap_code: str, db: Session = Depends(get_db)):
    """Obtener producto por código SAP exacto"""
    return search_product(sap_code, db)


@router.put("/{sap_code}")
def update_product(sap_code: str, product: ProductCreate, db: Session = Depends(get_db)):
    """Actualizar producto existente"""
    if IS_PRODUCTION:
        try:
            norm = str(int(float(sap_code.strip())))
        except Exception:
            norm = sap_code.strip()
        existing = db.query(Product).filter(Product.sap_code == norm).first()
        if not existing:
            raise HTTPException(status_code=404, detail=f"Producto '{sap_code}' no encontrado")
        existing.description = product.description
        existing.material_type = product.material_type
        existing.almacen = product.almacen or ""
        existing.medida = getattr(product, 'medida', '') or ""
        existing.calibre = getattr(product, 'calibre', 0) or 0
        existing.alto_mm = int(product.alto_mm or 0)
        existing.ancho_mm = int(product.ancho_mm or 0)
        existing.largo_mm = int(product.largo_mm or 0)
        existing.kg_por_paquete = float(product.kg_por_paquete or 0)
        db.commit()
        print(f"✓ Producto '{sap_code}' actualizado en DB")
        return {"message": "Producto actualizado", "sap_code": sap_code}

    global _excel_cache, _excel_mtime
    
    try:
        # Leer el Excel actual completo
        if not os.path.exists(EXCEL_PRODUCTS_PATH):
            raise HTTPException(status_code=500, detail="Archivo Excel no encontrado")
        
        df_excel = pd.read_excel(EXCEL_PRODUCTS_PATH, sheet_name=0, header=0)
        df_excel.columns = df_excel.columns.str.strip()
        df_excel = df_excel.loc[:, ~df_excel.columns.duplicated()]
        
        # Normalizar SAP codes del Excel igual que load_excel_products (elimina el .0 de floats)
        def _clean_sap(x):
            try:
                if pd.isna(x):
                    return ''
                num = float(str(x))
                return str(int(num)) if num == int(num) else str(x).strip()
            except:
                return str(x).strip()

        df_excel['_sap_norm'] = df_excel['Clave Sap'].apply(_clean_sap)
        search_code = _clean_sap(sap_code)

        mask = df_excel['_sap_norm'] == search_code

        if not mask.any():
            raise HTTPException(status_code=404, detail=f"Producto '{sap_code}' no encontrado")
        
        # Obtener índice de la fila a actualizar
        idx = mask.idxmax()
        
        # Obtener calibre y medida
        calibre = getattr(product, 'calibre', 0) or 0
        medida = getattr(product, 'medida', '') or ''
        almacen = product.almacen or ''
        
        # Actualizar los valores
        df_excel.at[idx, 'Nombre'] = product.description
        df_excel.at[idx, 'Producto'] = product.material_type
        df_excel.at[idx, 'Medida'] = medida
        df_excel.at[idx, 'Almacen'] = almacen
        df_excel.at[idx, 'Calibre'] = calibre
        df_excel.at[idx, 'Alto del paquete'] = product.alto_mm / 10  # mm a cm
        df_excel.at[idx, 'Ancho del paquete'] = product.ancho_mm / 10
        df_excel.at[idx, 'Largo del paquete'] = product.largo_mm / 10
        df_excel.at[idx, 'Peso por paquete ton'] = product.kg_por_paquete / 1000  # kg a ton
        
        print(f"Actualizando producto SAP={sap_code}: Almacen={almacen}, Calibre={calibre}, Medida={medida}")

        # Eliminar columna auxiliar antes de guardar
        df_excel.drop(columns=['_sap_norm'], inplace=True)

        # Guardar en Excel
        df_excel.to_excel(EXCEL_PRODUCTS_PATH, index=False)
        print(f"✓ Producto '{sap_code}' actualizado en Excel")
        
        # Invalidar cache
        _excel_cache = None
        _excel_mtime = 0
        
        return {
            "message": "Producto actualizado",
            "sap_code": sap_code,
            "description": product.description,
            "material_type": product.material_type,
            "almacen": almacen,
            "medida": medida,
            "calibre": calibre
        }
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"✗ Error actualizando producto: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Error actualizando producto: {str(e)}")


@router.post("")
def create_product(product: ProductCreate, db: Session = Depends(get_db)):
    """Crear nuevo producto"""
    if IS_PRODUCTION:
        existing = db.query(Product).filter(Product.sap_code == str(product.sap_code)).first()
        if existing:
            raise HTTPException(status_code=400, detail="Código SAP ya existe")
        new_p = Product(
            sap_code=str(product.sap_code),
            description=product.description,
            material_type=product.material_type,
            almacen=product.almacen or "",
            medida=getattr(product, 'medida', '') or "",
            calibre=getattr(product, 'calibre', 0) or 0,
            largo_mm=int(product.largo_mm or 0),
            ancho_mm=int(product.ancho_mm or 0),
            alto_mm=int(product.alto_mm or 0),
            kg_por_paquete=float(product.kg_por_paquete or 0),
            peso_pieza_kg=0,
            piezas_por_paquete=1,
        )
        db.add(new_p)
        db.commit()
        db.refresh(new_p)
        print(f"✓ Producto '{product.sap_code}' creado en DB")
        return _db_row_to_product(new_p)

    global _excel_cache, _excel_mtime
    
    # Verificar si ya existe en el Excel
    df = load_excel_products()
    if not df.empty:
        if str(product.sap_code) in df['sap_code'].values:
            raise HTTPException(status_code=400, detail="Código SAP ya existe en Excel")
    
    try:
        # Leer el Excel actual completo
        if os.path.exists(EXCEL_PRODUCTS_PATH):
            df_excel = pd.read_excel(EXCEL_PRODUCTS_PATH, sheet_name=0, header=0)
            # Limpiar nombres de columnas
            df_excel.columns = df_excel.columns.str.strip()
            # Eliminar columnas duplicadas
            df_excel = df_excel.loc[:, ~df_excel.columns.duplicated()]
        else:
            raise HTTPException(status_code=500, detail="Archivo Excel no encontrado")
        
        # Obtener calibre y medida del producto
        calibre = getattr(product, 'calibre', 0) or 0
        medida = getattr(product, 'medida', '') or ''
        almacen = product.almacen or ''
        
        # Crear nueva fila con los datos del producto (dimensiones en CM)
        nueva_fila = {
            'Clave Sap': product.sap_code,
            'Nombre': product.description,
            'Producto': product.material_type,
            'Medida': medida,
            'Almacen': almacen,
            'Calibre': calibre,
            'Alto del paquete': product.alto_mm / 10,  # mm a cm
            'Ancho del paquete': product.ancho_mm / 10,  # mm a cm
            'Largo del paquete': product.largo_mm / 10,  # mm a cm
            'Paquetes por cama': 1,
            'Ancho por cama': product.ancho_mm / 10,
            'Peso por paquete ton': product.kg_por_paquete / 1000,  # kg a ton
            'Peso por cama ton': product.kg_por_paquete / 1000
        }
        
        print(f"Guardando producto: SAP={product.sap_code}, Almacen={almacen}, Calibre={calibre}, Medida={medida}")
        
        # Agregar al DataFrame
        df_excel = pd.concat([df_excel, pd.DataFrame([nueva_fila])], ignore_index=True)
        
        # Guardar en Excel
        df_excel.to_excel(EXCEL_PRODUCTS_PATH, index=False)
        print(f"✓ Producto '{product.sap_code}' guardado en Excel")
        
        # Invalidar cache para que se recargue
        _excel_cache = None
        _excel_mtime = 0
        
        # Retornar el producto creado
        return {
            "id": len(df_excel),
            "sap_code": product.sap_code,
            "description": product.description,
            "material_type": product.material_type,
            "almacen": almacen,
            "medida": medida,
            "calibre": calibre,
            "largo_mm": product.largo_mm,
            "ancho_mm": product.ancho_mm,
            "alto_mm": product.alto_mm,
            "largo_cm": product.largo_mm / 10,
            "ancho_cm": product.ancho_mm / 10,
            "alto_cm": product.alto_mm / 10,
            "kg_por_paquete": product.kg_por_paquete,
            "peso_ton": product.kg_por_paquete / 1000
        }
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"✗ Error guardando en Excel: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Error guardando producto: {str(e)}")


@router.get("/reload/excel")
def reload_excel():
    """Forzar recarga del Excel"""
    global _excel_cache, _excel_mtime
    _excel_cache = None
    _excel_mtime = 0
    df = load_excel_products()
    if df.empty:
        return {"message": "Error: No se pudo cargar el Excel", "path": EXCEL_PRODUCTS_PATH}
    return {"message": f"Excel recargado: {len(df)} productos", "path": EXCEL_PRODUCTS_PATH}