# routes/learning.py - Sistema de aprendizaje de acomodos
#
# Extrae patrones de prioridad de carga desde cargas verificadas por el usuario
# y los almacena en placement_patterns para que el optimizador los use.
#
# FLUJO:
#   1. Usuario optimiza → edita → queda satisfecho
#   2. POST /api/loads/{id}/verify  → extrae patrones y actualiza BD
#   3. Próxima optimización usa esos patrones para ordenar paquetes

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from datetime import datetime, timezone
import math
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from database import get_db, Load, LoadItem, Placement, PlacementPattern, VerifiedLoad

router = APIRouter(prefix="/api", tags=["learning"])

# Peso de la nueva observación en el promedio móvil exponencial (EMA)
# 0.3 = la nueva carga tiene 30% de peso, el historial 70%
EMA_ALPHA = 0.3


def _calibre_bucket(calibre: float) -> float:
    """Redondea el calibre al par más cercano: 14→14, 15→16, 17→18, etc."""
    if not calibre or calibre <= 0:
        return 0.0
    return round(calibre / 2) * 2.0


def _feature_key(material_type: str, calibre_bucket: float, almacen: str) -> str:
    return f"{material_type or ''}|{calibre_bucket}|{almacen or ''}"


@router.post("/loads/{load_id}/verify")
def verify_load(load_id: int, db: Session = Depends(get_db)):
    """
    Marca una carga como verificada y extrae patrones de acomodo para aprendizaje.
    Actualiza placement_patterns con media móvil exponencial.
    """
    load = db.query(Load).filter(Load.id == load_id).first()
    if not load:
        raise HTTPException(status_code=404, detail="Carga no encontrada")

    # Solo cargas que ya fueron optimizadas tienen placements útiles
    placements = db.query(Placement).filter(
        Placement.load_id == load_id,
        Placement.placed == True
    ).all()

    if not placements:
        raise HTTPException(status_code=400, detail="La carga no tiene paquetes colocados. Optimiza primero.")

    # Verificar que no se haya verificado ya
    existing_verification = db.query(VerifiedLoad).filter(
        VerifiedLoad.load_id == load_id
    ).first()
    if existing_verification:
        raise HTTPException(status_code=409, detail="Esta carga ya fue verificada anteriormente.")

    # ── Calcular prioridad normalizada por placement ──────────────────────────
    # Lógica: bed_number + y_position → score 0.0 (primero) a 1.0 (último)
    max_bed = max(p.bed_number for p in placements)
    max_y_global = max((p.y + p.height_used) for p in placements) or 1.0

    # Acumular prioridades por feature_key
    # { feature_key: { meta..., priorities: [float], is_deferred: bool } }
    pattern_data: dict = {}

    for p in placements:
        item = db.query(LoadItem).filter(LoadItem.id == p.load_item_id).first()
        if not item:
            continue

        # Score compuesto: bed position (70%) + y height (30%)
        bed_score = (p.bed_number - 1) / max(1, max_bed - 1) if max_bed > 1 else 0.0
        y_score = p.y / max_y_global
        priority = bed_score * 0.7 + y_score * 0.3

        cb = _calibre_bucket(item.calibre or 0)
        fkey = _feature_key(item.material_type, cb, item.almacen)

        if fkey not in pattern_data:
            pattern_data[fkey] = {
                "feature_key": fkey,
                "material_type": item.material_type or "",
                "calibre_bucket": cb,
                "almacen": item.almacen or "",
                "priorities": [],
                "is_deferred": item.is_deferred or False,
                "truck_type_id": load.truck_id,
            }
        pattern_data[fkey]["priorities"].append(priority)

    # ── Actualizar placement_patterns con EMA ─────────────────────────────────
    patterns_updated = 0
    for fkey, data in pattern_data.items():
        avg_new = sum(data["priorities"]) / len(data["priorities"])

        existing = db.query(PlacementPattern).filter(
            PlacementPattern.feature_key == fkey,
            PlacementPattern.truck_type_id == data["truck_type_id"],
        ).first()

        if existing:
            existing.avg_priority = (1 - EMA_ALPHA) * existing.avg_priority + EMA_ALPHA * avg_new
            existing.times_seen += 1
            if data["is_deferred"]:
                existing.times_deferred += 1
            existing.last_updated = datetime.now(timezone.utc)
        else:
            db.add(PlacementPattern(
                feature_key=fkey,
                truck_type_id=data["truck_type_id"],
                material_type=data["material_type"],
                calibre_bucket=data["calibre_bucket"],
                almacen=data["almacen"],
                avg_priority=avg_new,
                times_seen=1,
                times_deferred=1 if data["is_deferred"] else 0,
                last_updated=datetime.now(timezone.utc),
            ))
        patterns_updated += 1

    # ── Guardar registro de verificación ─────────────────────────────────────
    db.add(VerifiedLoad(
        load_id=load_id,
        truck_id=load.truck_id,
        total_packages=len(placements),
        materials_count=len(pattern_data),
        patterns_updated=patterns_updated,
        verified_at=datetime.now(timezone.utc),
    ))

    # Cambiar status de la carga a VERIFIED
    load.status = "VERIFIED"
    db.commit()

    print(f"[LEARN] Carga {load_id} verificada: {patterns_updated} patrones actualizados, {len(placements)} paquetes aprendidos", flush=True)

    return {
        "success": True,
        "load_id": load_id,
        "patterns_updated": patterns_updated,
        "packages_learned": len(placements),
    }


@router.get("/learning/stats")
def get_learning_stats(db: Session = Depends(get_db)):
    """Retorna estadísticas globales del sistema de aprendizaje."""
    total_verified = db.query(VerifiedLoad).count()
    total_patterns = db.query(PlacementPattern).count()
    total_packages = db.query(VerifiedLoad).with_entities(
        db.query(VerifiedLoad).count()  # placeholder
    )

    # Suma real de paquetes aprendidos
    from sqlalchemy import func
    pkg_sum = db.query(func.sum(VerifiedLoad.total_packages)).scalar() or 0

    # Patrones con más de 1 observación (los "confiables")
    reliable = db.query(PlacementPattern).filter(PlacementPattern.times_seen >= 3).count()

    # Última verificación
    last = db.query(VerifiedLoad).order_by(VerifiedLoad.verified_at.desc()).first()
    last_date = last.verified_at.isoformat() if last else None

    return {
        "verified_loads": total_verified,
        "total_patterns": total_patterns,
        "reliable_patterns": reliable,
        "total_packages_learned": int(pkg_sum),
        "last_verified_at": last_date,
    }


@router.get("/learning/patterns")
def get_patterns(truck_type_id: str = None, db: Session = Depends(get_db)):
    """Lista todos los patrones aprendidos, opcionalmente filtrados por tipo de camión."""
    q = db.query(PlacementPattern)
    if truck_type_id:
        q = q.filter(
            (PlacementPattern.truck_type_id == truck_type_id) |
            (PlacementPattern.truck_type_id == None)
        )
    patterns = q.order_by(PlacementPattern.avg_priority).all()
    return [
        {
            "feature_key": p.feature_key,
            "material_type": p.material_type,
            "calibre_bucket": p.calibre_bucket,
            "almacen": p.almacen,
            "avg_priority": round(p.avg_priority, 3),
            "times_seen": p.times_seen,
            "times_deferred": p.times_deferred,
            "truck_type_id": p.truck_type_id,
            "last_updated": p.last_updated.isoformat() if p.last_updated else None,
        }
        for p in patterns
    ]
