# routes/learning.py - Sistema de aprendizaje MEJORADO v2
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from datetime import datetime, timezone
import math
import sys
import os
from itertools import combinations

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from database import (
    get_db, Load, LoadItem, Placement, PlacementPattern,
    VerifiedLoad, BedPattern, MaterialCombo
)

router = APIRouter(prefix="/api", tags=["learning"])

EMA_ALPHA = 0.3
ZONE_A_LIMIT = 6025.0


def _calibre_bucket(calibre: float) -> float:
    if not calibre or calibre <= 0:
        return 0.0
    return round(calibre / 2) * 2.0


def _feature_key(material_type: str, calibre_bucket: float, almacen: str) -> str:
    return f"{material_type or ''}|{calibre_bucket}|{almacen or ''}"


def _classify_position(placements_in_bed: list, truck_width: float) -> str:
    """CENTER, LEFT, RIGHT o SPREAD según dónde están los paquetes en el ancho."""
    if not placements_in_bed:
        return "CENTER"
    z_centers = [(p.z + p.width_used / 2) for p in placements_in_bed]
    min_z = min(z_centers)
    max_z = max(z_centers)
    avg_z = sum(z_centers) / len(z_centers)
    rel_avg = avg_z / truck_width if truck_width > 0 else 0.5
    spread = (max_z - min_z) / truck_width if truck_width > 0 else 0
    if spread > 0.6:
        return "SPREAD"
    elif rel_avg < 0.3:
        return "LEFT"
    elif rel_avg > 0.7:
        return "RIGHT"
    else:
        return "CENTER"


def _extract_and_update_patterns(load, placements, db: Session):
    from database import TruckType
    truck = db.query(TruckType).filter(TruckType.id == load.truck_id).first()
    truck_length = truck.length_mm if truck else 12000
    truck_width  = truck.width_mm  if truck else 2500

    max_bed = max(p.bed_number for p in placements) if placements else 1
    max_y_global = max((p.y + p.height_used) for p in placements) or 1.0

    # ── 1. PlacementPattern original ────────────────────────────────────────
    pattern_data: dict = {}
    for p in placements:
        item = db.query(LoadItem).filter(LoadItem.id == p.load_item_id).first()
        if not item:
            continue
        bed_score = (p.bed_number - 1) / max(1, max_bed - 1) if max_bed > 1 else 0.0
        y_score   = p.y / max_y_global
        priority  = bed_score * 0.7 + y_score * 0.3
        x_norm = min(1.0, max(0.0, (p.x + p.length_used / 2) / truck_length))
        z_norm = min(1.0, max(0.0, (p.z + p.width_used  / 2) / truck_width))
        cb   = _calibre_bucket(item.calibre or 0)
        fkey = _feature_key(item.material_type, cb, item.almacen)
        if fkey not in pattern_data:
            pattern_data[fkey] = {
                "feature_key": fkey, "material_type": item.material_type or "",
                "calibre_bucket": cb, "almacen": item.almacen or "",
                "priorities": [], "x_positions": [], "z_positions": [],
                "is_deferred": item.is_deferred or False,
                "truck_type_id": load.truck_id,
            }
        pattern_data[fkey]["priorities"].append(priority)
        pattern_data[fkey]["x_positions"].append(x_norm)
        pattern_data[fkey]["z_positions"].append(z_norm)

    patterns_updated = 0
    for fkey, data in pattern_data.items():
        avg_new   = sum(data["priorities"]) / len(data["priorities"])
        avg_x_new = sum(data["x_positions"]) / len(data["x_positions"])
        avg_z_new = sum(data["z_positions"]) / len(data["z_positions"])
        existing = db.query(PlacementPattern).filter(
            PlacementPattern.feature_key   == fkey,
            PlacementPattern.truck_type_id == data["truck_type_id"],
        ).first()
        if existing:
            existing.avg_priority     = (1 - EMA_ALPHA) * existing.avg_priority    + EMA_ALPHA * avg_new
            existing.avg_x_normalized = (1 - EMA_ALPHA) * (existing.avg_x_normalized or 0.5) + EMA_ALPHA * avg_x_new
            existing.avg_z_normalized = (1 - EMA_ALPHA) * (existing.avg_z_normalized or 0.5) + EMA_ALPHA * avg_z_new
            existing.times_seen += 1
            if data["is_deferred"]:
                existing.times_deferred += 1
            existing.last_updated = datetime.now(timezone.utc)
        else:
            db.add(PlacementPattern(
                feature_key=fkey, truck_type_id=data["truck_type_id"],
                material_type=data["material_type"], calibre_bucket=data["calibre_bucket"],
                almacen=data["almacen"], avg_priority=avg_new,
                avg_x_normalized=avg_x_new, avg_z_normalized=avg_z_new,
                times_seen=1, times_deferred=1 if data["is_deferred"] else 0,
                last_updated=datetime.now(timezone.utc),
            ))
        patterns_updated += 1

    # ── 2. BedPattern: zona + posición + paquetes/cama ──────────────────────
    bed_groups: dict = {}
    for p in placements:
        item = db.query(LoadItem).filter(LoadItem.id == p.load_item_id).first()
        if not item:
            continue
        pkg_center_x = p.x + p.length_used / 2
        zone = "A" if pkg_center_x < ZONE_A_LIMIT else "B"
        cb   = _calibre_bucket(item.calibre or 0)
        fkey = _feature_key(item.material_type, cb, item.almacen)
        gkey = (fkey, p.bed_number, zone)
        if gkey not in bed_groups:
            bed_groups[gkey] = {
                "fkey": fkey, "material_type": item.material_type or "",
                "calibre_bucket": cb, "almacen": item.almacen or "",
                "bed_number": p.bed_number, "zone": zone, "placements": [],
            }
        bed_groups[gkey]["placements"].append(p)

    for gkey, grp in bed_groups.items():
        fkey, bed_number, zone = gkey
        pkgs_in_group = len(grp["placements"])
        position = _classify_position(grp["placements"], truck_width)
        try:
            existing_bp = db.query(BedPattern).filter(
                BedPattern.feature_key   == fkey,
                BedPattern.zone          == zone,
                BedPattern.truck_type_id == load.truck_id,
            ).first()
            if existing_bp:
                alpha = EMA_ALPHA
                existing_bp.typical_pkgs_per_bed = (1 - alpha) * existing_bp.typical_pkgs_per_bed + alpha * pkgs_in_group
                existing_bp.typical_bed_number   = (1 - alpha) * existing_bp.typical_bed_number   + alpha * bed_number
                existing_bp.times_seen += 1
                if existing_bp.times_seen >= 3 and existing_bp.preferred_position != position:
                    existing_bp.preferred_position = position
                existing_bp.last_updated = datetime.now(timezone.utc)
            else:
                db.add(BedPattern(
                    truck_type_id=load.truck_id, feature_key=fkey,
                    zone=zone, preferred_position=position,
                    typical_pkgs_per_bed=float(pkgs_in_group),
                    typical_bed_number=float(bed_number),
                    times_seen=1, last_updated=datetime.now(timezone.utc),
                ))
        except Exception as e:
            print(f"[LEARN] BedPattern skip: {e}", flush=True)

    # ── 3. MaterialCombo: SAPs que van juntos en la misma cama ──────────────
    sap_by_bed: dict = {}
    for p in placements:
        item = db.query(LoadItem).filter(LoadItem.id == p.load_item_id).first()
        if not item:
            continue
        bed = p.bed_number
        if bed not in sap_by_bed:
            sap_by_bed[bed] = set()
        sap_by_bed[bed].add(item.sap_code)

    for bed_num, sap_set in sap_by_bed.items():
        if len(sap_set) < 2:
            continue
        for sap_a, sap_b in combinations(sorted(sap_set), 2):
            try:
                existing_combo = db.query(MaterialCombo).filter(
                    MaterialCombo.sap_code_a    == sap_a,
                    MaterialCombo.sap_code_b    == sap_b,
                    MaterialCombo.truck_type_id == load.truck_id,
                ).first()
                bed_pkgs = [p for p in placements if
                    db.query(LoadItem).filter(LoadItem.id == p.load_item_id).first() and
                    db.query(LoadItem).filter(LoadItem.id == p.load_item_id).first().sap_code in (sap_a, sap_b)]
                avg_bed = (sum(p.bed_number for p in bed_pkgs) / len(bed_pkgs)) if bed_pkgs else float(bed_num)
                if existing_combo:
                    existing_combo.same_bed_count   += 1
                    existing_combo.total_loads_seen += 1
                    existing_combo.avg_bed_number    = (
                        (existing_combo.avg_bed_number * (existing_combo.total_loads_seen - 1) + avg_bed)
                        / existing_combo.total_loads_seen
                    )
                    existing_combo.last_updated = datetime.now(timezone.utc)
                else:
                    db.add(MaterialCombo(
                        truck_type_id=load.truck_id, sap_code_a=sap_a, sap_code_b=sap_b,
                        same_bed_count=1, total_loads_seen=1, avg_bed_number=avg_bed,
                        last_updated=datetime.now(timezone.utc),
                    ))
            except Exception as e:
                print(f"[LEARN] MaterialCombo skip: {e}", flush=True)

    return pattern_data, patterns_updated


@router.post("/loads/{load_id}/verify")
def verify_load(load_id: int, db: Session = Depends(get_db)):
    load = db.query(Load).filter(Load.id == load_id).first()
    if not load:
        raise HTTPException(status_code=404, detail="Carga no encontrada")
    placements = db.query(Placement).filter(
        Placement.load_id == load_id, Placement.placed == True
    ).all()
    if not placements:
        raise HTTPException(status_code=400, detail="La carga no tiene paquetes colocados. Optimiza primero.")
    existing_verification = db.query(VerifiedLoad).filter(VerifiedLoad.load_id == load_id).first()
    pattern_data, patterns_updated = _extract_and_update_patterns(load, placements, db)
    if existing_verification:
        existing_verification.total_packages   = len(placements)
        existing_verification.materials_count  = len(pattern_data)
        existing_verification.patterns_updated = patterns_updated
        existing_verification.verified_at      = datetime.now(timezone.utc)
    else:
        db.add(VerifiedLoad(
            load_id=load_id, truck_id=load.truck_id,
            total_packages=len(placements), materials_count=len(pattern_data),
            patterns_updated=patterns_updated, verified_at=datetime.now(timezone.utc),
        ))
    load.status = "VERIFIED"
    db.commit()
    print(f"[LEARN] Carga {load_id} verificada: {patterns_updated} patrones, {len(placements)} paquetes", flush=True)
    return {"success": True, "load_id": load_id, "patterns_updated": patterns_updated, "packages_learned": len(placements)}


@router.post("/loads/{load_id}/auto-learn")
def auto_learn(load_id: int, db: Session = Depends(get_db)):
    load = db.query(Load).filter(Load.id == load_id).first()
    if not load:
        return {"success": False, "detail": "Carga no encontrada"}
    placements = db.query(Placement).filter(
        Placement.load_id == load_id, Placement.placed == True
    ).all()
    if not placements:
        return {"success": False, "detail": "Sin paquetes colocados"}
    try:
        pattern_data, patterns_updated = _extract_and_update_patterns(load, placements, db)
        db.commit()
        print(f"[AUTO-LEARN] Carga {load_id}: {patterns_updated} patrones actualizados", flush=True)
        return {"success": True, "patterns_updated": patterns_updated}
    except Exception as e:
        db.rollback()
        return {"success": False, "detail": str(e)}


@router.get("/learning/stats")
def get_learning_stats(db: Session = Depends(get_db)):
    from sqlalchemy import func
    total_verified = db.query(VerifiedLoad).count()
    total_patterns = db.query(PlacementPattern).count()
    pkg_sum        = db.query(func.sum(VerifiedLoad.total_packages)).scalar() or 0
    reliable       = db.query(PlacementPattern).filter(PlacementPattern.times_seen >= 3).count()
    last           = db.query(VerifiedLoad).order_by(VerifiedLoad.verified_at.desc()).first()
    try:
        bed_patterns_count = db.query(BedPattern).count()
        material_combos    = db.query(MaterialCombo).filter(MaterialCombo.same_bed_count >= 2).count()
    except Exception:
        bed_patterns_count = 0
        material_combos    = 0
    return {
        "verified_loads": total_verified, "total_patterns": total_patterns,
        "reliable_patterns": reliable, "total_packages_learned": int(pkg_sum),
        "last_verified_at": last.verified_at.isoformat() if last else None,
        "bed_patterns": bed_patterns_count, "material_combos_learned": material_combos,
    }


@router.get("/learning/patterns")
def get_patterns(truck_type_id: str = None, db: Session = Depends(get_db)):
    q = db.query(PlacementPattern)
    if truck_type_id:
        q = q.filter(
            (PlacementPattern.truck_type_id == truck_type_id) |
            (PlacementPattern.truck_type_id == None)
        )
    patterns = q.order_by(PlacementPattern.avg_priority).all()
    return [{"feature_key": p.feature_key, "material_type": p.material_type,
             "calibre_bucket": p.calibre_bucket, "almacen": p.almacen,
             "avg_priority": round(p.avg_priority, 3), "times_seen": p.times_seen,
             "times_deferred": p.times_deferred,
             "avg_x_normalized": round(p.avg_x_normalized or 0.5, 3),
             "avg_z_normalized": round(p.avg_z_normalized or 0.5, 3),
             "truck_type_id": p.truck_type_id,
             "last_updated": p.last_updated.isoformat() if p.last_updated else None}
            for p in patterns]


@router.get("/learning/bed-patterns")
def get_bed_patterns(truck_type_id: str = None, db: Session = Depends(get_db)):
    try:
        q = db.query(BedPattern)
        if truck_type_id:
            q = q.filter(BedPattern.truck_type_id == truck_type_id)
        patterns = q.order_by(BedPattern.typical_bed_number).all()
        return [{"feature_key": p.feature_key, "zone": p.zone,
                 "preferred_position": p.preferred_position,
                 "typical_pkgs_per_bed": round(p.typical_pkgs_per_bed, 1),
                 "typical_bed_number": round(p.typical_bed_number, 1),
                 "times_seen": p.times_seen, "truck_type_id": p.truck_type_id}
                for p in patterns]
    except Exception:
        return []


@router.get("/learning/combos")
def get_material_combos(truck_type_id: str = None, min_count: int = 2, db: Session = Depends(get_db)):
    try:
        q = db.query(MaterialCombo).filter(MaterialCombo.same_bed_count >= min_count)
        if truck_type_id:
            q = q.filter(MaterialCombo.truck_type_id == truck_type_id)
        combos = q.order_by(MaterialCombo.same_bed_count.desc()).limit(50).all()
        return [{"sap_code_a": c.sap_code_a, "sap_code_b": c.sap_code_b,
                 "same_bed_count": c.same_bed_count,
                 "avg_bed_number": round(c.avg_bed_number, 1),
                 "truck_type_id": c.truck_type_id}
                for c in combos]
    except Exception:
        return []


@router.get("/learning/suggest/{load_id}")
def suggest_arrangement(load_id: int, db: Session = Depends(get_db)):
    load = db.query(Load).filter(Load.id == load_id).first()
    if not load:
        raise HTTPException(status_code=404, detail="Carga no encontrada")
    items = db.query(LoadItem).filter(LoadItem.load_id == load_id).all()
    if not items:
        return {"suggestions": [], "summary": "Sin materiales en la carga"}
    suggestions = []
    try:
        pos_labels = {"CENTER": "centrado", "SPREAD": "distribuido a los extremos",
                      "LEFT": "al lado piloto (izquierdo)", "RIGHT": "al lado copiloto (derecho)"}
        seen_keys = set()
        for item in items:
            cb   = round((item.calibre or 0) / 2) * 2.0
            fkey = f"{item.material_type or ''}|{cb}|{item.almacen or ''}"
            if fkey in seen_keys:
                continue
            seen_keys.add(fkey)
            for zone, zona_text in [("A", "atrás de la concha (Zona A)"), ("B", "sobre los ejes (Zona B)")]:
                bp = db.query(BedPattern).filter(
                    BedPattern.feature_key   == fkey,
                    BedPattern.zone          == zone,
                    BedPattern.truck_type_id == load.truck_id,
                ).first()
                if bp and bp.times_seen >= 1:
                    suggestions.append({
                        "sap_code": item.sap_code, "description": item.description or item.sap_code,
                        "zona": zone, "cama_tipica": round(bp.typical_bed_number),
                        "pkgs_tipicos": round(bp.typical_pkgs_per_bed),
                        "posicion": bp.preferred_position, "confianza": bp.times_seen,
                        "texto": (f"📦 {item.sap_code}: normalmente va {zona_text}, "
                                  f"cama ~{round(bp.typical_bed_number)}, "
                                  f"~{round(bp.typical_pkgs_per_bed)} paquetes, "
                                  f"{pos_labels.get(bp.preferred_position, 'centrado')}"),
                    })
        sap_codes = list(set(item.sap_code for item in items))
        combo_suggestions = []
        if len(sap_codes) >= 2:
            for sap_a, sap_b in combinations(sorted(sap_codes), 2):
                try:
                    combo = db.query(MaterialCombo).filter(
                        MaterialCombo.sap_code_a    == sap_a,
                        MaterialCombo.sap_code_b    == sap_b,
                        MaterialCombo.truck_type_id == load.truck_id,
                        MaterialCombo.same_bed_count >= 1,
                    ).first()
                    if combo:
                        combo_suggestions.append({
                            "sap_a": sap_a, "sap_b": sap_b,
                            "cama": round(combo.avg_bed_number), "veces": combo.same_bed_count,
                            "texto": (f"🔗 {sap_a} y {sap_b} suelen ir juntos "
                                      f"en cama ~{round(combo.avg_bed_number)} "
                                      f"({combo.same_bed_count} veces aprendido)"),
                        })
                except Exception:
                    pass
        return {"suggestions": suggestions, "combo_suggestions": combo_suggestions,
                "summary": f"{len(suggestions)} sugerencia(s) · {len(combo_suggestions)} combo(s)"}
    except Exception as e:
        return {"suggestions": [], "summary": f"Error: {str(e)}"}


@router.post("/learning/rebuild")
def rebuild_all_patterns(db: Session = Depends(get_db)):
    """
    Re-procesa TODAS las cargas verificadas para poblar/actualizar
    BedPattern y MaterialCombo desde cero.
    Útil cuando se actualiza el sistema de aprendizaje o hay tablas vacías.
    NO borra PlacementPattern (tiene historial valioso).
    """
    verified_loads = db.query(VerifiedLoad).all()
    if not verified_loads:
        return {"success": False, "detail": "No hay cargas verificadas aún"}

    # Limpiar BedPattern y MaterialCombo para reconstruir limpio
    try:
        db.query(BedPattern).delete()
        db.query(MaterialCombo).delete()
        db.commit()
    except Exception as e:
        db.rollback()
        print(f"[REBUILD] No se pudo limpiar tablas: {e}", flush=True)

    processed = 0
    errors = 0
    for vl in verified_loads:
        try:
            load = db.query(Load).filter(Load.id == vl.load_id).first()
            if not load:
                continue
            placements = db.query(Placement).filter(
                Placement.load_id == vl.load_id, Placement.placed == True
            ).all()
            if not placements:
                continue
            _extract_and_update_patterns(load, placements, db)
            db.commit()
            processed += 1
            print(f"[REBUILD] Carga {vl.load_id} reprocesada", flush=True)
        except Exception as e:
            db.rollback()
            errors += 1
            print(f"[REBUILD] Error en carga {vl.load_id}: {e}", flush=True)

    bed_count   = db.query(BedPattern).count()
    combo_count = db.query(MaterialCombo).count()
    pat_count   = db.query(PlacementPattern).count()

    print(f"[REBUILD] Completo: {processed} cargas, {bed_count} BedPatterns, {combo_count} combos", flush=True)
    return {
        "success": True,
        "loads_processed": processed,
        "errors": errors,
        "placement_patterns": pat_count,
        "bed_patterns_created": bed_count,
        "material_combos_created": combo_count,
    }


@router.get("/learning/diagnostics")
def get_diagnostics(truck_type_id: str = None, db: Session = Depends(get_db)):
    """
    Diagnóstico completo del sistema de aprendizaje:
    cuántos patrones hay, qué tan confiables son, y un preview del
    orden que el optimizador aplicará a cada familia de material.
    """
    q = db.query(PlacementPattern)
    if truck_type_id:
        q = q.filter(PlacementPattern.truck_type_id == truck_type_id)
    patterns = q.order_by(PlacementPattern.avg_priority).all()

    items = []
    for p in patterns:
        alpha = min(0.60, 0.10 + 0.05 * math.log(max(1, p.times_seen)))
        items.append({
            "feature_key": p.feature_key,
            "material_type": p.material_type,
            "calibre_bucket": p.calibre_bucket,
            "almacen": p.almacen,
            "avg_priority": round(p.avg_priority, 3),
            "times_seen": p.times_seen,
            "alpha_actual": round(alpha, 3),
            "influence_pct": f"{round(alpha * 100)}%",
            "confiable": p.times_seen >= 3,
        })

    bed_count   = 0
    combo_count = 0
    try:
        bed_count   = db.query(BedPattern).count()
        combo_count = db.query(MaterialCombo).count()
    except Exception:
        pass

    return {
        "placement_patterns": items,
        "bed_patterns_total": bed_count,
        "material_combos_total": combo_count,
        "summary": (
            f"{len(items)} patrones de prioridad · "
            f"{sum(1 for i in items if i['confiable'])} confiables (≥3 cargas) · "
            f"{bed_count} patrones de zona · {combo_count} combos"
        ),
    }
