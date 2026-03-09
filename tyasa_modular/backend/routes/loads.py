# routes/loads.py - Endpoints de cargas
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import Optional
import sys
import os
import math
import re
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from database import get_db, Load, LoadItem, Aditamento, Placement, TruckType, BedNote
from schemas import LoadCreate, LoadUpdate

router = APIRouter(prefix="/api/loads", tags=["loads"])


@router.get("/next-number")
def get_next_load_number(db: Session = Depends(get_db)):
    """Obtener el siguiente número de carga consecutivo para el año actual"""
    current_year = datetime.now().year
    prefix = f"TY-{current_year}-"
    
    # Buscar todas las cargas del año actual con formato correcto
    loads = db.query(Load).filter(Load.numero_carga.like(f"{prefix}%")).all()
    
    max_num = 0
    for load in loads:
        # Extraer el número del final (TY-2026-5 -> 5)
        # Solo considerar números pequeños (formato nuevo consecutivo)
        match = re.search(r'TY-\d{4}-(\d+)$', load.numero_carga)
        if match:
            num = int(match.group(1))
            # Ignorar números muy grandes (formato viejo aleatorio)
            if num < 100000 and num > max_num:
                max_num = num
    
    next_num = max_num + 1
    next_carga = f"{prefix}{next_num}"
    
    return {"next_number": next_carga, "sequence": next_num}


@router.delete("/reset-all")
def reset_all_loads(db: Session = Depends(get_db)):
    """Eliminar TODAS las cargas para empezar desde cero (usar con cuidado)"""
    try:
        db.query(Placement).delete()
        db.query(Aditamento).delete()
        db.query(BedNote).delete()
        db.query(LoadItem).delete()
        db.query(Load).delete()
        db.commit()
        return {"message": "Todas las cargas han sido eliminadas. El contador empezará desde TY-XXXX-1"}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{load_id}")
def delete_load(load_id: int, db: Session = Depends(get_db)):
    """Eliminar una carga y todos sus datos relacionados"""
    load = db.query(Load).filter(Load.id == load_id).first()
    if not load:
        raise HTTPException(status_code=404, detail="Carga no encontrada")
    
    # Eliminar placements
    db.query(Placement).filter(Placement.load_id == load_id).delete()
    
    # Eliminar aditamentos
    db.query(Aditamento).filter(Aditamento.load_id == load_id).delete()
    
    # Eliminar notas de camas
    db.query(BedNote).filter(BedNote.load_id == load_id).delete()
    
    # Eliminar items
    db.query(LoadItem).filter(LoadItem.load_id == load_id).delete()
    
    # Eliminar la carga
    db.delete(load)
    db.commit()
    
    return {"message": f"Carga {load.numero_carga} eliminada correctamente", "id": load_id}


@router.get("")
def get_loads(
    fecha: Optional[str] = None,
    numero_viaje: Optional[str] = None,
    numero_embarque: Optional[str] = None,
    cliente: Optional[str] = None,
    db: Session = Depends(get_db)
):
    """Obtener todas las cargas con filtros opcionales"""
    q = db.query(Load)
    
    if fecha:
        q = q.filter(Load.fecha == fecha)
    if numero_viaje:
        q = q.filter(Load.numero_viaje.ilike(f"%{numero_viaje}%"))
    if numero_embarque:
        q = q.filter(Load.numero_embarque.ilike(f"%{numero_embarque}%"))
    if cliente:
        q = q.filter(Load.cliente.ilike(f"%{cliente}%"))
    
    loads = q.order_by(Load.id.desc()).all()
    return [{
        "id": l.id,
        "fecha": l.fecha,
        "numero_carga": l.numero_carga,
        "truck_id": l.truck_id,
        "total_tons": l.total_tons,
        "total_aditamentos_kg": l.total_aditamentos_kg,
        "status": l.status,
        "items_count": len(l.items),
        "numero_viaje": l.numero_viaje or "",
        "numero_embarque": l.numero_embarque or "",
        "cliente": l.cliente or ""
    } for l in loads]


@router.get("/{load_id}")
def get_load(load_id: int, db: Session = Depends(get_db)):
    """Obtener detalle de una carga"""
    load = db.query(Load).filter(Load.id == load_id).first()
    if not load:
        raise HTTPException(status_code=404, detail="Carga no encontrada")
    
    # Información del camión
    truck = None
    if load.truck_id:
        t = db.query(TruckType).filter(TruckType.id == load.truck_id).first()
        if t:
            truck = {
                "id": t.id, "name": t.name, "beds_count": t.beds_count,
                "length_mm": t.length_mm, "width_mm": t.width_mm,
                "height_mm": t.height_mm, "max_payload_kg": t.max_payload_kg
            }
    
    return {
        "id": load.id,
        "fecha": load.fecha,
        "numero_carga": load.numero_carga,
        "truck_id": load.truck_id,
        "truck": truck,
        "total_tons": load.total_tons,
        "total_aditamentos_kg": load.total_aditamentos_kg,
        "status": load.status,
        "numero_viaje": load.numero_viaje or "",
        "numero_embarque": load.numero_embarque or "",
        "cliente": load.cliente or "",
        "items": [{
            "id": i.id, 
            "sap_code": i.sap_code, 
            "description": i.description,
            "material_type": i.material_type, 
            "almacen": i.almacen, 
            "tons_solicitadas": i.tons_solicitadas,
            "tons_en_paquetes": i.tons_en_paquetes,
            "tons_sobrantes": i.tons_sobrantes,
            "largo_mm": i.largo_mm, 
            "ancho_mm": i.ancho_mm, 
            "alto_mm": i.alto_mm,
            "kg_por_paquete": i.kg_por_paquete, 
            "num_paquetes": i.num_paquetes,
            "calibre": i.calibre or 0,
            "almacen": i.almacen or "",
            "is_deferred": getattr(i, 'is_deferred', False) or False
        } for i in load.items],
        "aditamentos": [{
            "id": a.id, "name": a.name, "peso_kg": a.peso_kg, "cantidad": a.cantidad
        } for a in load.aditamentos],
        "placements": [{
            "id": p.id, "load_item_id": p.load_item_id, "paquete_index": p.paquete_index,
            "platform": getattr(p, 'platform', 1) or 1,  # Plana 1 o 2
            "bed_number": p.bed_number, "x": p.x, "y": p.y, "z": p.z,
            "rotated": p.rotated, "length_used": p.length_used,
            "width_used": p.width_used, "height_used": p.height_used, "placed": p.placed
        } for p in load.placements],
        "bed_notes": [{
            "id": n.id, "bed_number": n.bed_number, "note": n.note
        } for n in load.bed_notes]
    }


@router.post("")
def create_load(load: LoadCreate, db: Session = Depends(get_db)):
    """Crear nueva carga"""
    db_load = Load(
        fecha=load.fecha,
        numero_carga=load.numero_carga,
        truck_id=load.truck_id,
        numero_viaje=load.numero_viaje or "",
        numero_embarque=load.numero_embarque or "",
        cliente=load.cliente or ""
    )
    db.add(db_load)
    db.commit()
    db.refresh(db_load)
    return {"id": db_load.id, "message": "Carga creada"}


@router.put("/{load_id}")
def update_load(load_id: int, data: LoadUpdate, db: Session = Depends(get_db)):
    """Actualizar carga con materiales y aditamentos"""
    load = db.query(Load).filter(Load.id == load_id).first()
    if not load:
        raise HTTPException(status_code=404, detail="Carga no encontrada")
    
    # Actualizar camión
    if data.truck_id is not None:
        load.truck_id = data.truck_id

    # Actualizar número de carga (se asigna al guardar explícitamente)
    if data.numero_carga is not None:
        load.numero_carga = data.numero_carga

    # Actualizar campos de identificación
    if data.numero_viaje is not None:
        load.numero_viaje = data.numero_viaje
    if data.numero_embarque is not None:
        load.numero_embarque = data.numero_embarque
    if data.cliente is not None:
        load.cliente = data.cliente
    
    # Actualizar materiales
    if data.items is not None:
        # Limpiar items y placements existentes
        db.query(LoadItem).filter(LoadItem.load_id == load_id).delete()
        db.query(Placement).filter(Placement.load_id == load_id).delete()
        
        total_tons = 0
        total_tons_sobrantes = 0
        
        for item in data.items:
            kg_paq = item.kg_por_paquete or 1000
            tons_solicitadas = item.tons_solicitadas
            
            # Si tons_solicitadas es exactamente kg_paq/1000, es un paquete individual
            # El frontend ya envía cada paquete como un item separado
            num_paq = 1  # Cada item del frontend es 1 paquete
            tons_en_paquetes = tons_solicitadas
            tons_sobrantes = 0
            
            is_def = getattr(item, 'is_deferred', False) or False
            import sys
            print(f"[SAVE] Item {item.sap_code}: is_deferred={is_def}, alto={item.alto_mm}", flush=True)
            sys.stdout.flush()
            
            db_item = LoadItem(
                load_id=load_id,
                sap_code=item.sap_code,
                description=item.description,
                material_type=item.material_type,
                almacen=item.almacen,
                calibre=item.calibre or 0,
                tons_solicitadas=tons_solicitadas,
                tons_en_paquetes=tons_en_paquetes,
                tons_sobrantes=tons_sobrantes,
                largo_mm=item.largo_mm,
                ancho_mm=item.ancho_mm,
                alto_mm=item.alto_mm,
                kg_por_paquete=kg_paq,
                num_paquetes=num_paq,
                is_deferred=is_def
            )
            db.add(db_item)
            total_tons += tons_en_paquetes
            total_tons_sobrantes += tons_sobrantes
        
        load.total_tons = total_tons
        load.status = "DRAFT"
    
    # Actualizar aditamentos
    if data.aditamentos is not None:
        db.query(Aditamento).filter(Aditamento.load_id == load_id).delete()
        
        total_adit = 0
        for adit in data.aditamentos:
            db_adit = Aditamento(
                load_id=load_id,
                name=adit.name,
                peso_kg=adit.peso_kg,
                cantidad=adit.cantidad
            )
            db.add(db_adit)
            total_adit += adit.peso_kg * adit.cantidad
        
        load.total_aditamentos_kg = total_adit
    
    db.commit()
    return {"message": "Carga actualizada", "id": load_id}


@router.delete("/{load_id}")
def delete_load(load_id: int, db: Session = Depends(get_db)):
    """Eliminar carga"""
    load = db.query(Load).filter(Load.id == load_id).first()
    if not load:
        raise HTTPException(status_code=404, detail="Carga no encontrada")
    
    db.delete(load)
    db.commit()
    return {"message": "Carga eliminada", "id": load_id}


@router.get("/{load_id}/pdf")
def export_pdf(load_id: int, db: Session = Depends(get_db)):
    """Exportar carga a PDF con vistas y distribución por camas"""
    try:
        from reportlab.lib import colors
        from reportlab.lib.pagesizes import letter, landscape
        from reportlab.lib.units import inch, mm
        from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer, PageBreak, Image
        from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
        from reportlab.graphics.shapes import Drawing, Rect, String, Line
        import tempfile
    except ImportError:
        raise HTTPException(status_code=500, detail="Instala reportlab: pip install reportlab")
    
    # Importar ruta del logo
    try:
        from config import LOGO_PATH
    except:
        LOGO_PATH = r"C:\Users\OTONIEL\Documents\tyasa_modular\imagenes\logotyasacar.png"
    
    load = db.query(Load).filter(Load.id == load_id).first()
    if not load:
        raise HTTPException(status_code=404, detail="Carga no encontrada")
    
    truck = db.query(TruckType).filter(TruckType.id == load.truck_id).first() if load.truck_id else None
    placements = db.query(Placement).filter(Placement.load_id == load_id, Placement.placed == True).all()
    
    # ==================== DETECTAR NÚMERO DE PLANAS ====================
    # Detectar planas usadas basándose en los placements reales
    platforms_used = set()
    for p in placements:
        plat = getattr(p, 'platform', 1) or 1
        platforms_used.add(plat)
    
    num_platforms = max(platforms_used) if platforms_used else 1
    is_dual = num_platforms > 1
    
    # Calcular peso por plana
    platform_weights = {}
    platform_packages = {}
    for plat in range(1, num_platforms + 1):
        platform_weights[plat] = 0
        platform_packages[plat] = 0
    
    for p in placements:
        plat = getattr(p, 'platform', 1) or 1
        item = next((i for i in load.items if i.id == p.load_item_id), None)
        if item:
            platform_weights[plat] = platform_weights.get(plat, 0) + (item.kg_por_paquete or 0)
            platform_packages[plat] = platform_packages.get(plat, 0) + 1
    
    with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as tmp:
        doc = SimpleDocTemplate(tmp.name, pagesize=letter, 
                               leftMargin=0.5*inch, rightMargin=0.5*inch,
                               topMargin=0.3*inch, bottomMargin=0.3*inch)
        styles = getSampleStyleSheet()
        
        # Estilos personalizados con márgenes
        title_style = ParagraphStyle('CustomTitle', parent=styles['Title'], 
                                     fontSize=18, textColor=colors.HexColor("#1e40af"),
                                     alignment=1)  # Centrado
        heading_style = ParagraphStyle('CustomHeading', parent=styles['Heading2'],
                                       fontSize=12, textColor=colors.HexColor("#3b82f6"),
                                       spaceBefore=12, spaceAfter=8,
                                       leftIndent=20)  # Margen izquierdo
        small_style = ParagraphStyle('SmallText', parent=styles['Normal'], fontSize=8,
                                    leftIndent=20)
        
        elements = []
        
        # ==================== PÁGINA 1: ENCABEZADO CON LOGO ====================
        # Logo grande en esquina superior izquierda
        try:
            if os.path.exists(LOGO_PATH):
                # Logo grande (como en la imagen que te gustó)
                logo = Image(LOGO_PATH, width=2.3*inch, height=1.5*inch)
                logo.hAlign = 'LEFT'
                elements.append(logo)
                elements.append(Spacer(1, -90))
        except Exception as e:
            print(f"Error cargando logo: {e}")
        
        elements.append(Paragraph("Reporte de Acomodo de Carga", title_style))
        elements.append(Spacer(1, 50))
        
        
        # Información general en tabla
        info_data = [
            ["Número de Carga:", load.numero_carga, "Fecha:", load.fecha],
            ["Camión:", truck.name if truck else 'N/A', "Estado:", load.status],
            ["No. Viaje:", load.numero_viaje or '—', "No. Embarque:", load.numero_embarque or '—'],
            ["Cliente:", load.cliente or '—', "Toneladas:", f"{load.total_tons:.2f} t"],
        ]
        info_table = Table(info_data, colWidths=[1.2*inch, 2*inch, 1.2*inch, 2*inch])
        info_table.setStyle(TableStyle([
            ('FONTNAME', (0, 0), (0, -1), 'Helvetica-Bold'),
            ('FONTNAME', (2, 0), (2, -1), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, -1), 9),
            ('TEXTCOLOR', (0, 0), (0, -1), colors.HexColor("#374151")),
            ('TEXTCOLOR', (2, 0), (2, -1), colors.HexColor("#374151")),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
        ]))
        elements.append(info_table)
        elements.append(Spacer(1, 10))
        
        if truck:
            planas_text = f" - {num_platforms} PLANA{'S' if num_platforms > 1 else ''}" if num_platforms > 1 else ""
            max_payload_per = truck.max_payload_kg
            elements.append(Paragraph(f"<b>Dimensiones del camión:</b> {truck.length_mm}mm × {truck.width_mm}mm × {truck.height_mm}mm ({truck.beds_count} camas/plana){planas_text}", small_style))
            elements.append(Paragraph(f"<b>Capacidad máxima por plana:</b> {max_payload_per:,.0f} kg", small_style))
        elements.append(Spacer(1, 10))
        
        # ==================== RESUMEN POR PLANA ====================
        if is_dual:
            elements.append(Paragraph("Resumen por Plana/Transporte", heading_style))
            
            plana_summary_data = [["Plana", "Paquetes", "Peso Total", "Capacidad", "% Uso"]]
            for plat in range(1, num_platforms + 1):
                peso_kg = platform_weights.get(plat, 0)
                pkgs = platform_packages.get(plat, 0)
                max_kg = truck.max_payload_kg if truck else 36000
                pct = (peso_kg / max_kg * 100) if max_kg > 0 else 0
                pct_str = f"{pct:.1f}%"
                plana_summary_data.append([
                    f"Plana {plat}",
                    str(pkgs),
                    f"{peso_kg/1000:.2f} t",
                    f"{max_kg/1000:.0f} t",
                    pct_str
                ])
            
            # Totales
            total_peso = sum(platform_weights.values())
            total_pkgs = sum(platform_packages.values())
            plana_summary_data.append([
                "TOTAL",
                str(total_pkgs),
                f"{total_peso/1000:.2f} t",
                f"{(truck.max_payload_kg * num_platforms)/1000:.0f} t" if truck else "—",
                ""
            ])
            
            plana_table = Table(plana_summary_data, colWidths=[1*inch, 0.8*inch, 1*inch, 1*inch, 0.8*inch])
            plana_table.setStyle(TableStyle([
                ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor("#1e40af")),
                ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
                ('BACKGROUND', (0, -1), (-1, -1), colors.HexColor("#e5e7eb")),
                ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
                ('FONTNAME', (0, -1), (-1, -1), 'Helvetica-Bold'),
                ('FONTSIZE', (0, 0), (-1, -1), 9),
                ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
                ('GRID', (0, 0), (-1, -1), 0.5, colors.grey),
                ('ROWBACKGROUNDS', (0, 1), (-1, -2), [colors.white, colors.HexColor("#f3f4f6")]),
            ]))
            plana_table.hAlign = 'CENTER'
            elements.append(plana_table)
            elements.append(Spacer(1, 15))
        
        # ==================== GUÍA DE CAMAS (VISTA FRONTAL) ====================
        if truck and placements:
            elements.append(Paragraph("Vista General de Camas", title_style))
            elements.append(Spacer(1, 5))
            elements.append(Paragraph(
                "Esta vista frontal muestra la distribución vertical de las camas. "
                "Usa esta guía para entender los niveles del acomodo.",
                small_style
            ))
            elements.append(Spacer(1, 5))
            
            front_guide = create_front_beds_guide(truck, placements, load.items)
            if front_guide:
                elements.append(front_guide)
            elements.append(Spacer(1, 20))
        
        # ==================== DISTRIBUCIÓN POR CAMAS ====================
        elements.append(Paragraph("Distribución por Camas (Vista Superior)", title_style))
        elements.append(Spacer(1, 10))
        
        # Determinar si es tráiler/full (>=12m) para mostrar zonas
        is_long_truck = truck and truck.length_mm >= 11000
        
        # Agrupar placements por plana y cama
        for plat_num in range(1, num_platforms + 1):
            # Filtrar placements de esta plana (usar or 1 para manejar platform=None)
            plat_placements = [p for p in placements if (p.platform or 1) == plat_num]
            
            if is_dual and len(plat_placements) > 0:
                elements.append(Paragraph(f"═══ PLANA {plat_num} ═══", ParagraphStyle('PlatformTitle', parent=styles['Heading1'],
                                         fontSize=14, textColor=colors.HexColor("#22c55e" if plat_num == 2 else "#3b82f6"),
                                         spaceBefore=15, spaceAfter=10, alignment=1)))
            
            if is_long_truck:
                # Para tráiler/full: mostrar cama completa (Zona A + B juntas) por bed_number
                all_beds = {}
                for p in plat_placements:
                    if p.bed_number not in all_beds:
                        all_beds[p.bed_number] = []
                    all_beds[p.bed_number].append(p)

                for idx, bed_num in enumerate(sorted(all_beds.keys()), 1):
                    bed_placements = all_beds[bed_num]
                    bed_label = f"Cama {idx}" if not is_dual else f"P{plat_num}-Cama {idx}"
                    # Contar paquetes por zona: usar bed_zone si existe, si no, usar coordenada X
                    def _get_zone(p):
                        return p.bed_zone if p.bed_zone in ('A', 'B') else ("B" if p.x >= 6025 else "A")
                    n_a = sum(1 for p in bed_placements if _get_zone(p) == 'A')
                    n_b = sum(1 for p in bed_placements if _get_zone(p) == 'B')
                    zone_info = f"  [Zona A: {n_a} paq  |  Zona B: {n_b} paq]"
                    elements.append(Paragraph(f"{bed_label} - {len(bed_placements)} paquetes{zone_info}", heading_style))

                    if truck:
                        bed_drawing = create_bed_view_with_coords(truck, bed_placements, load.items, bed_num, plat_num if is_dual else None)
                        elements.append(bed_drawing)

                    # Tabla con columna Zona
                    bed_data = [["#", "SAP", "Descripción", "Dimensiones", "Peso", "Cal", "Almacén", "Zona", "Pos X"]]
                    for bidx, p in enumerate(bed_placements, 1):
                        item = next((i for i in load.items if i.id == p.load_item_id), None)
                        if item:
                            zona = p.bed_zone if p.bed_zone in ('A', 'B') else ("B" if p.x >= 6025 else "A")
                            bed_data.append([str(bidx), str(item.sap_code)[:10], (item.description or "")[:28],
                                f"{p.length_used:.0f}×{p.width_used:.0f}×{p.height_used:.0f}",
                                f"{(item.kg_por_paquete or 0)/1000:.2f}", str(int(item.calibre)) if item.calibre else "—",
                                item.almacen or "—", zona, f"{p.x:.0f}"])

                    if len(bed_data) > 1:
                        bed_table = Table(bed_data, colWidths=[0.2*inch, 0.5*inch, 1.3*inch, 0.85*inch, 0.4*inch, 0.3*inch, 0.5*inch, 0.3*inch, 0.4*inch])
                        bed_table.setStyle(TableStyle([
                            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor("#3b82f6")),
                            ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
                            ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
                            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
                            ('FONTSIZE', (0, 0), (-1, -1), 6),
                            ('GRID', (0, 0), (-1, -1), 0.5, colors.grey),
                            ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor("#f3f4f6")]),
                        ]))
                        elements.append(bed_table)
                    elements.append(Spacer(1, 10))
            else:
                # Para camiones cortos: nomenclatura simple
                beds_used = {}
                for p in plat_placements:
                    if p.bed_number not in beds_used:
                        beds_used[p.bed_number] = []
                    beds_used[p.bed_number].append(p)
                
                for bed_num in sorted(beds_used.keys()):
                    bed_placements = beds_used[bed_num]
                    
                    bed_title = f"Plana {plat_num} - Cama {bed_num}" if is_dual else f"Cama {bed_num}"
                    elements.append(Paragraph(f"{bed_title} - {len(bed_placements)} paquetes", heading_style))
                    
                    if truck:
                        bed_drawing = create_bed_view_with_coords(truck, bed_placements, load.items, bed_num, plat_num if is_dual else None)
                        elements.append(bed_drawing)
                    
                    bed_note = next((n for n in load.bed_notes if n.bed_number == bed_num), None)
                    if bed_note and bed_note.note:
                        note_style = ParagraphStyle('NoteStyle', parent=styles['Normal'], 
                                                   fontSize=8, textColor=colors.HexColor("#f59e0b"),
                                                   backColor=colors.HexColor("#fef3c7"),
                                                   borderColor=colors.HexColor("#f59e0b"),
                                                   borderWidth=1, borderPadding=5)
                        elements.append(Spacer(1, 5))
                        elements.append(Paragraph(f"<b>📝 Nota:</b> {bed_note.note}", note_style))
                    
                    elements.append(Spacer(1, 5))
                    
                    bed_data = [["#", "Clave SAP", "Descripción", "Dimensiones (mm)", "Peso (ton)", "Calibre", "Almacén", "Ubicación"]]
                    for idx, p in enumerate(bed_placements, 1):
                        item = next((i for i in load.items if i.id == p.load_item_id), None)
                        if item:
                            dims = f"{p.length_used:.0f} × {p.width_used:.0f} × {p.height_used:.0f}"
                            peso = f"{(item.kg_por_paquete or 0) / 1000:.3f}"
                            pos = f"X:{p.x:.0f}, Z:{p.z:.0f}"
                            calibre_val = str(int(item.calibre)) if item.calibre and item.calibre > 0 else "—"
                            almacen_val = item.almacen or "—"
                            bed_data.append([str(idx), str(item.sap_code), (item.description or "")[:35], dims, peso, calibre_val, almacen_val, pos])
                    
                    if len(bed_data) > 1:
                        bed_table = Table(bed_data, colWidths=[0.25*inch, 0.55*inch, 1.7*inch, 1.0*inch, 0.5*inch, 0.4*inch, 0.5*inch, 0.7*inch])
                        bed_table.setStyle(TableStyle([
                            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor("#22c55e" if is_dual and plat_num == 2 else "#3b82f6")),
                            ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
                            ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
                            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
                            ('FONTSIZE', (0, 0), (-1, -1), 6),
                            ('GRID', (0, 0), (-1, -1), 0.5, colors.grey),
                            ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor("#f3f4f6")]),
                        ]))
                        bed_table.hAlign = 'CENTER'
                        elements.append(bed_table)
                    
                    elements.append(Spacer(1, 15))
        
        # ==================== LISTA COMPLETA DE MATERIALES ====================
        elements.append(PageBreak())
        elements.append(Paragraph("Lista Completa de Materiales", title_style))
        elements.append(Spacer(1, 5))
        elements.append(Paragraph(
            "A continuación se presenta el listado completo de todos los materiales cargados, "
            "incluyendo su ubicación en el camión. Los materiales están organizados por clave SAP "
            "y muestran las dimensiones del paquete, peso, calibre, almacén y la cama asignada.",
            small_style
        ))
        elements.append(Spacer(1, 10))
        
        # Tabla completa con todas las columnas (incluyendo Plana para Full)
        if is_dual:
            full_data = [["#", "Clave SAP", "Descripción", "Dimensiones (mm)", "Peso (ton)", "Calibre", "Almacén", "Plana", "Cama", "Posición"]]
        else:
            full_data = [["#", "Clave SAP", "Descripción", "Dimensiones (mm)", "Peso (ton)", "Calibre", "Almacén", "Cama", "Posición"]]
        
        global_idx = 1
        # Ordenar por plana, cama, x, z
        sorted_placements = sorted(placements, key=lambda x: (getattr(x, 'platform', 1), x.bed_number, x.x, x.z))
        for p in sorted_placements:
            item = next((i for i in load.items if i.id == p.load_item_id), None)
            if item:
                dims = f"{p.length_used:.0f}×{p.width_used:.0f}×{p.height_used:.0f}"
                peso = f"{(item.kg_por_paquete or 0) / 1000:.3f}"
                pos = f"X:{p.x:.0f}, Z:{p.z:.0f}"
                calibre_val = str(int(item.calibre)) if item.calibre and item.calibre > 0 else "—"
                almacen_val = item.almacen or "—"
                plat_num = getattr(p, 'platform', 1)
                
                if is_dual:
                    full_data.append([
                        str(global_idx),
                        str(item.sap_code),
                        (item.description or "")[:28],
                        dims,
                        peso,
                        calibre_val,
                        almacen_val,
                        str(plat_num),
                        str(p.bed_number),
                        pos
                    ])
                else:
                    full_data.append([
                        str(global_idx),
                        str(item.sap_code),
                        (item.description or "")[:30],
                        dims,
                        peso,
                        calibre_val,
                        almacen_val,
                        str(p.bed_number),
                        pos
                    ])
                global_idx += 1
        
        if len(full_data) > 1:
            if is_dual:
                full_table = Table(full_data, colWidths=[0.22*inch, 0.45*inch, 1.4*inch, 0.95*inch, 0.45*inch, 0.35*inch, 0.45*inch, 0.3*inch, 0.3*inch, 0.65*inch])
            else:
                full_table = Table(full_data, colWidths=[0.25*inch, 0.5*inch, 1.6*inch, 1.0*inch, 0.5*inch, 0.4*inch, 0.5*inch, 0.35*inch, 0.7*inch])
            full_table.setStyle(TableStyle([
                ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor("#1e40af")),
                ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
                ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
                ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
                ('FONTSIZE', (0, 0), (-1, -1), 6),
                ('GRID', (0, 0), (-1, -1), 0.5, colors.grey),
                ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor("#f3f4f6")]),
                ('LEFTPADDING', (0, 0), (-1, -1), 2),
                ('RIGHTPADDING', (0, 0), (-1, -1), 2),
            ]))
            elements.append(full_table)
        
        # Resumen final
        elements.append(Spacer(1, 20))
        elements.append(Paragraph("Resumen de Carga", heading_style))
        
        total_weight = sum((next((i.kg_por_paquete for i in load.items if i.id == p.load_item_id), 0) or 0) for p in placements)
        
        # Contar camas usadas total
        total_beds_used = len(set((getattr(p, 'platform', 1), p.bed_number) for p in placements))
        
        summary_data = [
            ["Total de paquetes:", str(len(placements))],
            ["Planas/Transportes:", str(num_platforms)],
        ]
        
        if is_dual:
            for plat in range(1, num_platforms + 1):
                p_count = platform_packages.get(plat, 0)
                p_weight = platform_weights.get(plat, 0)
                summary_data.append([f"Plana {plat}:", f"{p_count} paq · {p_weight/1000:.2f} t"])
        
        summary_data.extend([
            ["Camas utilizadas:", str(total_beds_used)],
            ["Peso total materiales:", f"{total_weight/1000:.2f} toneladas"],
            ["Aditamentos:", f"{load.total_aditamentos_kg:.1f} kg"],
            ["Peso total carga:", f"{(total_weight + (load.total_aditamentos_kg or 0))/1000:.2f} toneladas"],
        ])
        
        if truck:
            capacidad_total = truck.max_payload_kg * num_platforms
            summary_data.append(["Capacidad total:", f"{capacidad_total/1000:.0f} toneladas"])
            disponible = capacidad_total - total_weight - (load.total_aditamentos_kg or 0)
            summary_data.append(["Disponible:", f"{disponible/1000:.2f} toneladas"])
        
        summary_table = Table(summary_data, colWidths=[2*inch, 2.5*inch])
        summary_table.setStyle(TableStyle([
            ('FONTNAME', (0, 0), (0, -1), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, -1), 10),
            ('ALIGN', (1, 0), (1, -1), 'LEFT'),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
        ]))
        elements.append(summary_table)
        
        doc.build(elements)
        
        return FileResponse(
            tmp.name,
            media_type="application/pdf",
            filename=f"carga_{load.numero_carga}.pdf"
        )


def create_bed_view_with_coords(truck, bed_placements, items, bed_num, platform_num=None):
    """Crear vista superior de una cama con números y coordenadas - TAMAÑO GRANDE"""
    from reportlab.graphics.shapes import Drawing, Rect, String, Line
    from reportlab.lib import colors
    
    # Colores por calibre
    CALIBRE_COLORS_PDF = {
        14: "#ef4444",  # Rojo
        16: "#22c55e",  # Verde
        18: "#3b82f6",  # Azul
        20: "#f59e0b",  # Naranja
        0:  "#6b7280"   # Gris (sin calibre)
    }
    
    def get_color_by_calibre(calibre):
        cal = int(calibre) if calibre else 0
        return CALIBRE_COLORS_PDF.get(cal, CALIBRE_COLORS_PDF[0])
    
    # TAMAÑO MÁS GRANDE
    max_width = 500  # Aumentado de 420
    max_height = 120  # Aumentado de 90
    
    scale_x = max_width / truck.length_mm
    scale_y = max_height / truck.width_mm
    scale = min(scale_x, scale_y) * 0.90  # Aumentado de 0.85
    
    # Ancho total del dibujo = ancho de página para centrado
    page_width = 550
    truck_w = truck.length_mm * scale
    truck_h = truck.width_mm * scale
    
    # Calcular offset_x para centrar horizontalmente
    drawing_width = page_width
    offset_x = (page_width - truck_w) / 2 + 20
    offset_y = 30  # Aumentado de 25
    
    drawing_height = truck_h + 65  # Aumentado de 55
    
    d = Drawing(drawing_width, drawing_height)
    
    # Color del contorno según la plana (verde para plana 2, azul para plana 1)
    border_color = "#22c55e" if platform_num == 2 else "#3b82f6"
    
    # Contorno de la cama
    d.add(Rect(offset_x, offset_y, truck_w, truck_h,
               strokeColor=colors.HexColor(border_color), strokeWidth=2, 
               fillColor=colors.HexColor("#1e293b")))
    
    # Coordenadas en el eje X (largo) - cada 2000mm
    d.add(String(offset_x - 5, offset_y + truck_h + 10, "0", fontSize=7, fillColor=colors.HexColor("#6b7280")))
    for x_mm in range(2000, truck.length_mm + 1, 2000):
        x_pos = offset_x + x_mm * scale
        d.add(Line(x_pos, offset_y + truck_h, x_pos, offset_y + truck_h + 5, 
                   strokeColor=colors.HexColor("#6b7280"), strokeWidth=0.5))
        d.add(String(x_pos - 10, offset_y + truck_h + 10, f"{x_mm}", fontSize=7, fillColor=colors.HexColor("#6b7280")))
    
    # Coordenadas en el eje Z (ancho) - cada 500mm
    d.add(String(offset_x - 20, offset_y - 2, "0", fontSize=7, fillColor=colors.HexColor("#6b7280")))
    for z_mm in range(500, truck.width_mm + 1, 500):
        z_pos = offset_y + z_mm * scale
        d.add(Line(offset_x - 5, z_pos, offset_x, z_pos, 
                   strokeColor=colors.HexColor("#6b7280"), strokeWidth=0.5))
        d.add(String(offset_x - 25, z_pos - 2, f"{z_mm}", fontSize=7, fillColor=colors.HexColor("#6b7280")))
    
    # Etiquetas de ejes
    d.add(String(offset_x + truck_w / 2, offset_y + truck_h + 22, "X (mm)",
                 fontSize=8, fillColor=colors.HexColor("#9ca3af")))

    # Etiqueta FRENTE vertical (CONCHA = cab side, X=0)
    d.add(String(offset_x - 40, offset_y + truck_h / 2, "C",
                 fontSize=7, fillColor=colors.HexColor("#22c55e")))
    d.add(String(offset_x - 40, offset_y + truck_h / 2 - 9, "O",
                 fontSize=7, fillColor=colors.HexColor("#22c55e")))
    d.add(String(offset_x - 40, offset_y + truck_h / 2 - 18, "N",
                 fontSize=7, fillColor=colors.HexColor("#22c55e")))
    d.add(String(offset_x - 40, offset_y + truck_h / 2 - 27, "C",
                 fontSize=7, fillColor=colors.HexColor("#22c55e")))
    d.add(String(offset_x - 40, offset_y + truck_h / 2 - 36, "H",
                 fontSize=7, fillColor=colors.HexColor("#22c55e")))
    d.add(String(offset_x - 40, offset_y + truck_h / 2 - 45, "A",
                 fontSize=7, fillColor=colors.HexColor("#22c55e")))

    # Etiquetas LADO PILOTO (IZQUIERDO) y LADO COPILOTO (DERECHO)
    # Vista superior: Z=0   → abajo del diagrama  = LADO PILOTO (IZQUIERDO)
    #                 Z=max → arriba del diagrama = LADO COPILOTO (DERECHO)
    right_label_x = offset_x + truck_w + 4
    # LADO COPILOTO arriba (top edge = Z máximo = lado derecho del camión)
    d.add(String(right_label_x, offset_y + truck_h - 6, "LADO COPILOTO",
                 fontSize=6, fillColor=colors.HexColor("#f59e0b")))
    d.add(String(right_label_x, offset_y + truck_h - 13, "(DERECHO)",
                 fontSize=5, fillColor=colors.HexColor("#f59e0b")))
    # LADO PILOTO abajo (bottom edge = Z=0 = lado izquierdo del camión)
    d.add(String(right_label_x, offset_y + 9, "LADO PILOTO",
                 fontSize=6, fillColor=colors.HexColor("#22c55e")))
    d.add(String(right_label_x, offset_y + 2, "(IZQUIERDO)",
                 fontSize=5, fillColor=colors.HexColor("#22c55e")))
    
    # Línea divisoria Zona A / Zona B para camiones largos
    is_long = truck.length_mm >= 11000
    ZONE_LIMIT = 6025
    if is_long:
        zone_x = offset_x + ZONE_LIMIT * scale
        d.add(Line(zone_x, offset_y, zone_x, offset_y + truck_h,
                   strokeColor=colors.HexColor("#f59e0b"), strokeWidth=1.5,
                   strokeDashArray=[4, 3]))
        d.add(String(offset_x + 5, offset_y + truck_h + 35, "ZONA A - Delantera",
                     fontSize=7, fillColor=colors.HexColor("#3b82f6")))
        d.add(String(zone_x + 5, offset_y + truck_h + 35, "ZONA B - Trasera (Sobre ejes)",
                     fontSize=7, fillColor=colors.HexColor("#f59e0b")))

    # Dibujar paquetes con colores por calibre (Zona B en ámbar)
    for idx, p in enumerate(bed_placements, 1):
        # Buscar item para obtener calibre
        item = next((i for i in items if i.id == p.load_item_id), None)
        calibre = item.calibre if item else 0

        # Zona B: color ámbar en lugar del color por calibre
        zona_p = p.bed_zone if p.bed_zone in ('A', 'B') else ("B" if p.x >= ZONE_LIMIT else "A")
        is_zone_b = is_long and zona_p == "B"
        if is_zone_b:
            pkg_color = "#d97706"
        else:
            pkg_color = get_color_by_calibre(calibre)

        stroke_color = colors.HexColor("#fbbf24") if is_zone_b else colors.white

        px = offset_x + p.x * scale
        py = offset_y + p.z * scale
        pw = p.length_used * scale
        ph = p.width_used * scale

        # Rectángulo del paquete
        d.add(Rect(px, py, pw, ph,
                   strokeColor=stroke_color, strokeWidth=0.5,
                   fillColor=colors.HexColor(pkg_color)))

        # Número del paquete centrado
        num_x = px + pw/2 - 3
        num_y = py + ph/2 - 3
        d.add(String(num_x, num_y, str(idx), fontSize=6, fillColor=colors.white))

    return d


def create_front_beds_guide(truck, placements, items):
    """Crear vista frontal mostrando las camas apiladas como guía"""
    from reportlab.graphics.shapes import Drawing, Rect, String, Line
    from reportlab.lib import colors
    
    CALIBRE_COLORS_PDF = {
        14: "#ef4444", 16: "#22c55e", 18: "#3b82f6", 20: "#f59e0b", 0: "#6b7280"
    }
    
    def get_color_by_calibre(calibre):
        cal = int(calibre) if calibre else 0
        return CALIBRE_COLORS_PDF.get(cal, CALIBRE_COLORS_PDF[0])
    
    # Constante de gap entre camas (100mm = 10cm)
    GAP_BETWEEN_BEDS = 100
    
    # Calcular altura total y camas
    beds_info = {}
    for p in placements:
        if not p.placed:
            continue
        bed_num = p.bed_number
        if bed_num not in beds_info:
            beds_info[bed_num] = {'min_y': float('inf'), 'max_y': 0, 'placements': []}
        beds_info[bed_num]['min_y'] = min(beds_info[bed_num]['min_y'], p.y)
        beds_info[bed_num]['max_y'] = max(beds_info[bed_num]['max_y'], p.y + p.height_used)
        beds_info[bed_num]['placements'].append(p)
    
    if not beds_info:
        return None
    
    # Dimensiones del dibujo
    drawing_width = 550
    drawing_height = 280
    
    d = Drawing(drawing_width, drawing_height)
    
    # Escala - incluir espacio desde la superficie (GAP_BETWEEN_BEDS)
    max_height_mm = max(info['max_y'] for info in beds_info.values()) + GAP_BETWEEN_BEDS
    scale_y = 200 / max(max_height_mm, 2350)
    scale_x = 350 / truck.length_mm
    
    offset_x = 80  # Ajustado para dar espacio a FRENTE en la derecha
    offset_y = 40
    
    # Título
    d.add(String(drawing_width / 2, drawing_height - 15, "GUÍA DE CAMAS (Vista Frontal)", 
                 fontSize=12, fillColor=colors.HexColor("#1e40af"), textAnchor='middle'))
    
    # Dibujar contorno del camión
    truck_w = truck.length_mm * scale_x
    truck_h = 2350 * scale_y  # Altura máxima permitida
    
    d.add(Rect(offset_x, offset_y, truck_w, truck_h,
               strokeColor=colors.HexColor("#3b82f6"), strokeWidth=1.5, 
               fillColor=colors.HexColor("#1e293b")))
    
    # Superficie de la plana (línea en la base)
    d.add(Rect(offset_x, offset_y, truck_w, 4,
               strokeColor=colors.HexColor("#475569"), strokeWidth=0,
               fillColor=colors.HexColor("#475569")))
    d.add(String(offset_x - 5, offset_y - 12, "Superficie de la plana", 
                 fontSize=7, fillColor=colors.HexColor("#475569")))
    
    # Dibujar las camas
    # IMPORTANTE: Agregar el gap visual de 10cm desde la superficie para cama 1
    visual_gap = GAP_BETWEEN_BEDS * scale_y  # Gap visual en píxeles
    
    for bed_num in sorted(beds_info.keys()):
        info = beds_info[bed_num]
        
        # Obtener el color dominante de la cama (primer paquete)
        first_placement = info['placements'][0]
        item = next((i for i in items if i.id == first_placement.load_item_id), None)
        bed_color = get_color_by_calibre(item.calibre if item else 0)
        
        # Rectángulo representando la cama
        # Agregar el gap visual desde la superficie (100mm = 10cm)
        bed_y = offset_y + visual_gap + info['min_y'] * scale_y
        bed_height = (info['max_y'] - info['min_y']) * scale_y
        
        d.add(Rect(offset_x + 5, bed_y, truck_w - 10, max(bed_height, 8),
                   strokeColor=colors.white, strokeWidth=1,
                   fillColor=colors.HexColor(bed_color)))
        
        # Etiqueta de la cama (a la derecha)
        d.add(String(offset_x + truck_w + 15, bed_y + bed_height/2 - 4, 
                     f"Cama {bed_num}", fontSize=9, fillColor=colors.HexColor("#22c55e")))
        
        # Flecha
        arrow_x = offset_x + truck_w + 5
        arrow_y = bed_y + bed_height/2
        d.add(Line(arrow_x, arrow_y, arrow_x + 8, arrow_y,
                   strokeColor=colors.HexColor("#22c55e"), strokeWidth=1))
    
    # Etiqueta de altura (izquierda)
    d.add(String(offset_x - 30, offset_y + truck_h/2, "Altura", 
                 fontSize=8, fillColor=colors.HexColor("#6b7280")))
    
    # Marca de altura máxima
    d.add(Line(offset_x - 10, offset_y + truck_h, offset_x + truck_w + 10, offset_y + truck_h,
               strokeColor=colors.HexColor("#ef4444"), strokeWidth=1, strokeDashArray=[3, 3]))
    d.add(String(offset_x + truck_w + 15, offset_y + truck_h - 4, "2.70m máx", 
                 fontSize=7, fillColor=colors.HexColor("#ef4444")))
    
    # Etiqueta FRENTE - LADO DERECHO
    d.add(String(offset_x - 40, offset_y + 5 + truck_h + 15, "CONCHA", 
                 fontSize=8, fillColor=colors.HexColor("#22c55e")))
    
    return d

# ==================== BED NOTES ====================

@router.post("/{load_id}/notes")
def save_bed_note(load_id: int, bed_number: int, note: str, db: Session = Depends(get_db)):
    """Guardar o actualizar nota de una cama"""
    load = db.query(Load).filter(Load.id == load_id).first()
    if not load:
        raise HTTPException(status_code=404, detail="Carga no encontrada")
    
    # Buscar nota existente
    existing = db.query(BedNote).filter(
        BedNote.load_id == load_id,
        BedNote.bed_number == bed_number
    ).first()
    
    if existing:
        existing.note = note
    else:
        new_note = BedNote(load_id=load_id, bed_number=bed_number, note=note)
        db.add(new_note)
    
    db.commit()
    return {"message": "Nota guardada", "bed_number": bed_number}


@router.get("/{load_id}/notes/{bed_number}")
def get_bed_note(load_id: int, bed_number: int, db: Session = Depends(get_db)):
    """Obtener nota de una cama"""
    note = db.query(BedNote).filter(
        BedNote.load_id == load_id,
        BedNote.bed_number == bed_number
    ).first()
    
    return {"note": note.note if note else ""}


@router.delete("/{load_id}/notes/{bed_number}")
def delete_bed_note(load_id: int, bed_number: int, db: Session = Depends(get_db)):
    """Eliminar nota de una cama"""
    db.query(BedNote).filter(
        BedNote.load_id == load_id,
        BedNote.bed_number == bed_number
    ).delete()
    db.commit()
    return {"message": "Nota eliminada"}