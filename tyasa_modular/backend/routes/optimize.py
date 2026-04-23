# routes/optimize.py - v21
#
# LOGICA OPT1: Superficie completa (12m) - sin cambios
# LOGICA OPT2: DOS FASES - LLENAR HACIA ARRIBA PRIMERO
#   FASE 1: Llenar 0-6m HACIA ARRIBA hasta agotar altura máxima
#   FASE 2: Solo cuando altura agotada, llenar 6m-12m hacia arriba
#
# ORDENAMIENTO: Almacén > Calibre ASC (14,16,18,20...) > Altura DESC > Área DESC
# Tolerancia altura: ±2cm (20mm)

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Dict
import sys
import os
import math

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from database import get_db, Load, LoadItem, Placement, TruckType, PlacementPattern
from schemas import OptimizeRequest, OptimizeResponse, PlacementUpdate, BedStats, NotPlacedDetail

router = APIRouter(prefix="/api", tags=["optimize"])

# =========================
# Constantes (valores por defecto, pueden ser sobrescritos por request)
# =========================
DEFAULT_GAP_BETWEEN_BEDS = 100      # 10 cm entre camas (mm)
DEFAULT_GAP_FLOOR_TO_BED = 0        # 0 cm del suelo a primera cama (mm)
GAP_H = 10                          # 1 cm separación horizontal (mm)
FRONTAL_ZONE = 6025                 # 6.025m zona frontal (mm)

MAX_HEIGHT_DIFF = 20.0              # 2 cm tolerancia de altura (mm)
MAX_TOTAL_HEIGHT = 2700             # 2.00 m altura máxima (mm)

# Variables globales para configuración de la optimización actual
current_gap_between_beds = DEFAULT_GAP_BETWEEN_BEDS
current_gap_floor_to_bed = DEFAULT_GAP_FLOOR_TO_BED
current_max_height_diff = MAX_HEIGHT_DIFF  # se ajusta por request según height_diff_mode
current_strict_calibre   = True            # False en modo flexible/libre


# =========================
# Utilidades
# =========================
def calculate_fill_percentage(placements, max_length, max_width):
    if not placements:
        return 0
    used_area = sum(p["length_used"] * p["width_used"] for p in placements)
    total_area = max_length * max_width
    return (used_area / total_area) * 100 if total_area > 0 else 0


def get_total_height(platforms):
    max_height = 0
    for platform in platforms:
        for bed in platform["beds"]:
            if bed["placements"]:
                bed_top = bed["base_y"] + bed["max_pkg_height"]
                max_height = max(max_height, bed_top)
    return max_height


def center_packages_in_bed(bed_placements: List[Dict], max_width: float) -> None:
    """
    Centra los paquetes de una cama en el ancho (eje Z) si sobra espacio.
    Modifica los placements in-place.
    
    Solo centra si los paquetes no ocupan todo el ancho de la cama.
    """
    if not bed_placements:
        return
    
    # Calcular el ancho máximo ocupado por los paquetes (en el eje Z)
    min_z = min(p["z"] for p in bed_placements)
    max_z = max(p["z"] + p["width_used"] for p in bed_placements)
    
    used_width = max_z - min_z
    
    # Si hay espacio sobrante, centrar
    if used_width < max_width:
        # Calcular offset para centrar
        offset_z = (max_width - used_width) / 2 - min_z
        
        # Aplicar offset a todos los paquetes
        for p in bed_placements:
            p["z"] = p["z"] + offset_z


def center_all_beds(platforms: List[Dict], max_width: float, placements_db: List) -> None:
    """
    Centra los paquetes de todas las camas en todas las plataformas.
    También actualiza los placements en la base de datos.
    """
    for platform in platforms:
        for bed in platform["beds"]:
            if bed["placements"]:
                # Centrar en la estructura temporal
                center_packages_in_bed(bed["placements"], max_width)
                
                # Actualizar los placements_db correspondientes
                for p in bed["placements"]:
                    # Buscar el placement correspondiente en placements_db
                    for db_p in placements_db:
                        if (db_p.load_item_id == p.get("pkg", {}).get("item_id") and 
                            db_p.paquete_index == p.get("pkg", {}).get("pkg_index") and
                            db_p.bed_number == p["bed_number"] and
                            db_p.platform == platform["number"]):
                            db_p.z = p["z"]
                            break


def last_normal_bed(platform: Dict) -> Dict:
    for b in reversed(platform["beds"]):
        if not b.get("is_overflow", False):
            return b
    return platform["beds"][-1]


def last_overflow_bed(platform: Dict):
    for b in reversed(platform["beds"]):
        if b.get("is_overflow", False):
            return b
    return None


# =========================
# Regla de altura y calibre por cama
# =========================
def bed_priority_compatible(bed: Dict, pkg: Dict) -> bool:
    """
    Returns True if a package can join this bed based on priority and deferred status.
    Rules:
    - Deferred packages only join beds that already contain deferred packages (or empty beds).
    - Non-deferred packages with explicit priority only join beds that share the SAME priority.
    - Non-deferred packages without explicit priority can join any non-deferred bed.
    """
    if not bed.get("placements"):
        return True  # empty bed — anyone can start it

    is_deferred = pkg.get("is_deferred", False)
    pkg_prio    = pkg.get("almacen_priority", 999)

    for p in bed["placements"]:
        bed_pkg = p.get("pkg")
        if not bed_pkg:
            continue
        bed_deferred = bed_pkg.get("is_deferred", False)
        bed_prio     = bed_pkg.get("almacen_priority", 999)

        # Never mix deferred with non-deferred in the same bed
        if is_deferred != bed_deferred:
            return False

        # Non-deferred explicit priorities must match to share a bed
        if not is_deferred and pkg_prio < 999 and bed_prio < 999:
            if pkg_prio != bed_prio:
                return False

    return True


def bed_height_range_ok(bed: Dict, pkg_h: float, pkg_calibre: float = None) -> bool:
    """
    Verifica si un paquete es compatible con una cama por ALTURA.
    Reglas:
    1. Si la cama está vacía, cualquier paquete es compatible
    2. Si la diferencia de altura es mayor a MAX_HEIGHT_DIFF (2cm), NO es compatible
    
    NOTA: Los calibres PUEDEN combinarse en la misma cama.
    El orden de procesamiento (14 → 18 → 20) garantiza que se acomoden correctamente.
    """
    if not bed.get("placements"):
        return True
    
    placements = bed["placements"]
    if not placements:
        return True
    
    # Solo verificar diferencia de altura
    heights = [float(p["height_used"]) for p in placements]
    if not heights:
        return True
    
    min_h = min(heights)
    max_h = max(heights)
    new_min = min(min_h, float(pkg_h))
    new_max = max(max_h, float(pkg_h))

    return (new_max - new_min) <= current_max_height_diff


# =========================
# Búsqueda de posiciones
# =========================
def find_position(bed_placements, pkg_l, pkg_w, max_length, max_width, x_min=0, x_max=None):
    if x_max is None:
        x_max = max_length
    
    search_x_max = min(x_max, max_length)
    
    x_candidates = [float(x_min)]
    z_candidates = [0.0]
    
    for item in bed_placements:
        x_right = float(item["x"]) + float(item["length_used"]) + GAP_H
        if x_right >= x_min and x_right + pkg_l <= search_x_max:
            x_candidates.append(x_right)
        
        z_bottom = float(item["z"]) + float(item["width_used"]) + GAP_H
        if z_bottom + pkg_w <= max_width:
            z_candidates.append(z_bottom)
    
    x_candidates = sorted(set(x_candidates))
    z_candidates = sorted(set(z_candidates))
    
    for z in z_candidates:
        if z + pkg_w > max_width:
            continue
        for x in x_candidates:
            if x < x_min or x + pkg_l > search_x_max:
                continue
            
            collision = False
            for item in bed_placements:
                ix, iz = float(item["x"]), float(item["z"])
                il, iw = float(item["length_used"]), float(item["width_used"])
                if (x < ix + il and x + pkg_l > ix and z < iz + iw and z + pkg_w > iz):
                    collision = True
                    break
            
            if not collision:
                return (x, z)
    
    return None


def try_place(bed, pkg, max_l, max_w, x_min=0, x_max=None):
    pkg_l = float(pkg["length"])
    pkg_w = float(pkg["width"])
    
    pos = find_position(bed["placements"], pkg_l, pkg_w, max_l, max_w, x_min, x_max)
    if pos:
        return pos[0], pos[1], False, pkg_l, pkg_w
    
    if pkg_l != pkg_w:
        pos = find_position(bed["placements"], pkg_w, pkg_l, max_l, max_w, x_min, x_max)
        if pos:
            return pos[0], pos[1], True, pkg_w, pkg_l
    
    return None


# =========================
# Crear camas
# =========================
def create_new_bed(platform, pkg_height, is_overflow=False):
    global current_gap_between_beds
    
    last_bed = platform["beds"][-1]
    if last_bed["max_pkg_height"] > 0:
        new_base_y = float(last_bed["base_y"]) + float(last_bed["max_pkg_height"]) + current_gap_between_beds
    else:
        new_base_y = float(last_bed["base_y"])
    
    if new_base_y + float(pkg_height) > MAX_TOTAL_HEIGHT:
        return None
    
    new_bed = {
        "number": len(platform["beds"]) + 1,
        "base_y": new_base_y,
        "placements": [],
        "max_pkg_height": 0.0,
        "weight": 0.0,
        "is_overflow": is_overflow
    }
    platform["beds"].append(new_bed)
    return new_bed


def _fill_bed(placed_bed, pending, placements_db, load, platform,
              available_payload, MAX_L, MAX_W, x_min, x_max, current_weight,
              not_placed_reasons, is_deferred_bed):
    """
    Rellena una cama con todos los paquetes restantes compatibles en altura y espacio.
    Usa múltiples pasadas: cada vez que se coloca un paquete, sus bordes crean nuevas
    posiciones candidatas que pueden habilitar paquetes que antes no cabían.
    Modifica 'pending' in-place eliminando los paquetes que coloca.
    Retorna el current_weight actualizado.
    """
    platform_max_payload = platform.get("max_payload", available_payload)
    free_mode = (current_max_height_diff >= 9999.0)

    while True:
        placed_indices = []

        for idx, fill_pkg in enumerate(pending):
            # No mezclar diferidos con normales y viceversa
            if bool(fill_pkg.get("is_deferred")) != is_deferred_bed:
                continue
            # Límite peso total
            if current_weight + fill_pkg["weight"] > available_payload:
                continue
            # Límite peso plataforma
            if platform.get("current_weight", 0.0) + fill_pkg["weight"] > platform_max_payload:
                continue
            fill_h   = float(fill_pkg["height"])
            fill_cal = fill_pkg.get("calibre")
            # En modo libre no hay restricción de altura — solo peso y espacio físico
            if not free_mode and not bed_height_range_ok(placed_bed, fill_h, fill_cal):
                continue
            fill_res = try_place(placed_bed, fill_pkg, MAX_L, MAX_W, x_min, x_max)
            if fill_res:
                fx, fz, frot, fl, fw = fill_res
                if float(placed_bed["base_y"]) + max(float(placed_bed["max_pkg_height"]), fill_h) <= MAX_TOTAL_HEIGHT:
                    fp = {
                        "x": fx, "y": float(placed_bed["base_y"]), "z": fz,
                        "length_used": fl, "width_used": fw, "height_used": fill_h,
                        "rotated": frot, "bed_number": placed_bed["number"], "pkg": fill_pkg
                    }
                    current_weight = add_placement(fp, placed_bed, fill_pkg, platform,
                                                   placements_db, load, current_weight)
                    placed_indices.append(idx)

        if not placed_indices:
            break  # ningún paquete más cabe en esta cama

        for idx in reversed(placed_indices):
            pending.pop(idx)

    return current_weight


def add_placement(result, bed, pkg, platform, placements_db, load, current_weight):
    bed["placements"].append(result)
    bed["max_pkg_height"] = max(float(bed["max_pkg_height"]), float(result["height_used"]))
    bed["weight"] += float(pkg["weight"])
    
    # Actualizar peso de la plataforma
    platform["current_weight"] = platform.get("current_weight", 0.0) + float(pkg["weight"])
    
    # Determinar zona basándose en la posición X del paquete
    # Si el centro del paquete está antes de 6025mm, es zona A (delantera)
    pkg_center_x = result["x"] + result["length_used"] / 2
    bed_zone = "A" if pkg_center_x < FRONTAL_ZONE else "B"
    
    placements_db.append(Placement(
        load_id=load.id,
        load_item_id=pkg["item_id"],
        paquete_index=pkg["pkg_index"],
        platform=platform["number"],
        bed_number=result["bed_number"],
        bed_zone=bed_zone,
        x=result["x"], y=result["y"], z=result["z"],
        rotated=result["rotated"],
        length_used=result["length_used"],
        width_used=result["width_used"],
        height_used=result["height_used"],
        placed=True
    ))
    return current_weight + float(pkg["weight"])


# =========================
# Función para procesar una zona (usada por Opt2)
# =========================
def process_zone(packages, platforms, placements_db, load, MAX_L, MAX_W,
                 current_weight, available_payload, x_min, x_max, not_placed_reasons=None):
    """
    Procesa una zona específica (frontal o trasera) como una carga completa.
    
    REGLA CLAVE PARA OPT2: Llenar la zona hacia ARRIBA (camas) hasta agotar
    la altura máxima permitida. Solo cuando no se puede crear más camas,
    los paquetes pasan a 'remaining' para la siguiente zona.
    
    Procesa paquetes normales (los diferidos ya se separaron).
    IMPORTANTE: Solo trabaja con la PRIMERA plataforma (plana 1).
    RESPETA EL LÍMITE DE PESO POR PLATAFORMA.
    """
    not_placed = 0
    platform = platforms[0]
    platform_max_payload = platform.get("max_payload", available_payload)

    pending = list(packages)   # cola mutable de paquetes a colocar
    remaining = []             # paquetes que no cupieron (peso o altura agotada)
    free_mode = (current_max_height_diff >= 9999.0)

    while pending:
        pkg = pending.pop(0)

        # Límite peso total
        if current_weight + pkg["weight"] > available_payload:
            not_placed += 1
            if not_placed_reasons is not None:
                not_placed_reasons[(pkg["item_id"], pkg["pkg_index"])] = "peso_excedido"
            placements_db.append(Placement(
                load_id=load.id, load_item_id=pkg["item_id"],
                paquete_index=pkg["pkg_index"], platform=1, bed_number=0,
                x=0, y=0, z=0, rotated=False,
                length_used=pkg["length"], width_used=pkg["width"], height_used=pkg["height"],
                placed=False
            ))
            continue

        # Límite peso plataforma → pasa a plana 2 pero sigue con los demás
        if platform.get("current_weight", 0.0) + pkg["weight"] > platform_max_payload:
            remaining.append(pkg)
            continue

        pkg_h      = float(pkg["height"])
        pkg_calibre = pkg.get("calibre")
        placed_bed  = None

        # Buscar cama existente compatible
        for bed in platform["beds"]:
            if bed.get("is_overflow"):
                continue
            if not free_mode and not bed_height_range_ok(bed, pkg_h, pkg_calibre):
                continue
            res = try_place(bed, pkg, MAX_L, MAX_W, x_min, x_max)
            if res:
                x, z, rotated, l_used, w_used = res
                if float(bed["base_y"]) + max(float(bed["max_pkg_height"]), pkg_h) <= MAX_TOTAL_HEIGHT:
                    placement = {
                        "x": x, "y": float(bed["base_y"]), "z": z,
                        "length_used": l_used, "width_used": w_used, "height_used": pkg_h,
                        "rotated": rotated, "bed_number": bed["number"], "pkg": pkg
                    }
                    current_weight = add_placement(placement, bed, pkg, platform, placements_db, load, current_weight)
                    placed_bed = bed
                    break

        # Sin cama → crear nueva
        if placed_bed is None:
            new_bed = create_new_bed(platform, pkg_h, is_overflow=False)
            if new_bed is None:
                remaining.append(pkg)
                continue
            res = try_place(new_bed, pkg, MAX_L, MAX_W, x_min, x_max)
            if res:
                x, z, rotated, l_used, w_used = res
                placement = {
                    "x": x, "y": float(new_bed["base_y"]), "z": z,
                    "length_used": l_used, "width_used": w_used, "height_used": pkg_h,
                    "rotated": rotated, "bed_number": new_bed["number"], "pkg": pkg
                }
                current_weight = add_placement(placement, new_bed, pkg, platform, placements_db, load, current_weight)
                placed_bed = new_bed
            else:
                remaining.append(pkg)
                continue

        # ── FILL PASS ────────────────────────────────────────────────────────
        # Rellena la cama con TODOS los paquetes restantes compatibles en altura.
        # La prioridad determina CUÁL material abre cada cama; el relleno
        # garantiza que cada cama se use al máximo antes de crear la siguiente.
        current_weight = _fill_bed(
            placed_bed, pending, placements_db, load, platform,
            available_payload, MAX_L, MAX_W, x_min, x_max,
            current_weight, not_placed_reasons,
            is_deferred_bed=bool(pkg.get("is_deferred"))
        )

    return current_weight, not_placed, remaining, []


# =========================
# Regla de altura por cama (solo para una zona específica)
# =========================
def bed_height_range_ok_in_zone(bed: Dict, pkg_h: float, x_min: float, x_max: float, pkg_calibre: float = None) -> bool:
    """
    Verifica si el paquete es compatible por ALTURA y CALIBRE con la cama,
    pero SOLO considerando los paquetes que están en la zona especificada (x_min a x_max).
    """
    if not bed.get("placements"):
        return True
    
    # Filtrar solo los paquetes que están en la zona especificada
    heights_in_zone = []
    calibres_in_zone = []
    for p in bed["placements"]:
        pkg_x = float(p["x"])
        # El paquete está en la zona si su inicio está dentro de la zona
        if pkg_x >= x_min and pkg_x < x_max:
            heights_in_zone.append(float(p["height_used"]))
            if p.get("pkg") and p["pkg"].get("calibre") is not None:
                calibres_in_zone.append(p["pkg"]["calibre"])
    
    if not heights_in_zone:
        return True  # No hay paquetes en esta zona, cualquier altura es compatible
    
    # Verificar calibre solo en modo estricto
    if current_strict_calibre and pkg_calibre is not None and calibres_in_zone:
        if pkg_calibre not in calibres_in_zone:
            return False

    min_h = min(heights_in_zone)
    max_h = max(heights_in_zone)
    new_min = min(min_h, float(pkg_h))
    new_max = max(max_h, float(pkg_h))

    return (new_max - new_min) <= current_max_height_diff


# =========================
# Función para procesar zona trasera (Opt2 Fase 2)
# =========================
def process_rear_zone(packages, platforms, placements_db, load, MAX_L, MAX_W,
                      current_weight, available_payload, x_min, x_max, not_placed_reasons=None):
    """
    Procesa la zona trasera (paquetes normales, diferidos ya separados).
    RESPETA EL LÍMITE DE PESO POR PLATAFORMA.
    """
    not_placed = 0
    platform = platforms[0]
    platform_max_payload = platform.get("max_payload", available_payload)

    # Ordenar por prioridad, calibre, altura DESC
    pending = sorted(packages, key=lambda p: (
        p.get("almacen_priority", 999), p.get("calibre", 99),
        -p["height"], -(p["length"] * p["width"])
    ))
    remaining = []
    free_mode = (current_max_height_diff >= 9999.0)

    while pending:
        pkg = pending.pop(0)

        if current_weight + pkg["weight"] > available_payload:
            not_placed += 1
            if not_placed_reasons is not None:
                not_placed_reasons[(pkg["item_id"], pkg["pkg_index"])] = "peso_excedido"
            placements_db.append(Placement(
                load_id=load.id, load_item_id=pkg["item_id"],
                paquete_index=pkg["pkg_index"], platform=1, bed_number=0,
                x=0, y=0, z=0, rotated=False,
                length_used=pkg["length"], width_used=pkg["width"], height_used=pkg["height"],
                placed=False
            ))
            continue

        if platform.get("current_weight", 0.0) + pkg["weight"] > platform_max_payload:
            remaining.append(pkg)
            continue

        pkg_h       = float(pkg["height"])
        pkg_calibre = pkg.get("calibre")
        placed_bed  = None

        beds_normal = [b for b in platform["beds"] if not b.get("is_overflow")]
        for bed in beds_normal:
            if not free_mode and not bed_height_range_ok_in_zone(bed, pkg_h, x_min, x_max, pkg_calibre):
                continue
            res = try_place(bed, pkg, MAX_L, MAX_W, x_min, x_max)
            if res:
                x, z, rotated, l_used, w_used = res
                if float(bed["base_y"]) + max(float(bed["max_pkg_height"]), pkg_h) <= MAX_TOTAL_HEIGHT:
                    placement = {
                        "x": x, "y": float(bed["base_y"]), "z": z,
                        "length_used": l_used, "width_used": w_used, "height_used": pkg_h,
                        "rotated": rotated, "bed_number": bed["number"], "pkg": pkg
                    }
                    current_weight = add_placement(placement, bed, pkg, platform, placements_db, load, current_weight)
                    placed_bed = bed
                    break

        if placed_bed is None:
            new_bed = create_new_bed(platform, pkg_h, is_overflow=False)
            if new_bed is None:
                remaining.append(pkg)
                continue
            res = try_place(new_bed, pkg, MAX_L, MAX_W, x_min, x_max)
            if res:
                x, z, rotated, l_used, w_used = res
                placement = {
                    "x": x, "y": float(new_bed["base_y"]), "z": z,
                    "length_used": l_used, "width_used": w_used, "height_used": pkg_h,
                    "rotated": rotated, "bed_number": new_bed["number"], "pkg": pkg
                }
                current_weight = add_placement(placement, new_bed, pkg, platform, placements_db, load, current_weight)
                placed_bed = new_bed
            else:
                remaining.append(pkg)
                continue

        # FILL PASS
        current_weight = _fill_bed(
            placed_bed, pending, placements_db, load, platform,
            available_payload, MAX_L, MAX_W, x_min, x_max,
            current_weight, not_placed_reasons,
            is_deferred_bed=bool(pkg.get("is_deferred"))
        )

    return current_weight, not_placed, remaining, []


# =========================
# Procesar zona en Plana 2 (para Full)
# =========================
def process_zone_platform2(packages, platforms, placements_db, load, MAX_L, MAX_W,
                           current_weight, available_payload, x_min, x_max, not_placed_reasons=None):
    """
    Procesa paquetes en la PLANA 2 (paquetes normales, diferidos ya separados).
    RESPETA EL LÍMITE DE PESO POR PLATAFORMA.
    """
    if len(platforms) < 2:
        return current_weight, 0, packages, []

    not_placed = 0
    platform = platforms[1]  # PLANA 2
    platform_max_payload = platform.get("max_payload", available_payload)

    pending   = list(packages)
    remaining = []
    free_mode = (current_max_height_diff >= 9999.0)

    while pending:
        pkg = pending.pop(0)

        if current_weight + pkg["weight"] > available_payload:
            not_placed += 1
            if not_placed_reasons is not None:
                not_placed_reasons[(pkg["item_id"], pkg["pkg_index"])] = "peso_excedido"
            placements_db.append(Placement(
                load_id=load.id, load_item_id=pkg["item_id"],
                paquete_index=pkg["pkg_index"], platform=2, bed_number=0,
                x=0, y=0, z=0, rotated=False,
                length_used=pkg["length"], width_used=pkg["width"], height_used=pkg["height"],
                placed=False
            ))
            continue

        if platform.get("current_weight", 0.0) + pkg["weight"] > platform_max_payload:
            remaining.append(pkg)
            continue

        pkg_h       = float(pkg["height"])
        pkg_calibre = pkg.get("calibre")
        placed_bed  = None

        for bed in platform["beds"]:
            if bed.get("is_overflow"):
                continue
            if not free_mode and not bed_height_range_ok(bed, pkg_h, pkg_calibre):
                continue
            res = try_place(bed, pkg, MAX_L, MAX_W, x_min, x_max)
            if res:
                x, z, rotated, l_used, w_used = res
                if float(bed["base_y"]) + max(float(bed["max_pkg_height"]), pkg_h) <= MAX_TOTAL_HEIGHT:
                    placement = {
                        "x": x, "y": float(bed["base_y"]), "z": z,
                        "length_used": l_used, "width_used": w_used, "height_used": pkg_h,
                        "rotated": rotated, "bed_number": bed["number"], "pkg": pkg
                    }
                    current_weight = add_placement(placement, bed, pkg, platform, placements_db, load, current_weight)
                    placed_bed = bed
                    break

        if placed_bed is None:
            new_bed = create_new_bed(platform, pkg_h, is_overflow=False)
            if new_bed is None:
                remaining.append(pkg)
                continue
            res = try_place(new_bed, pkg, MAX_L, MAX_W, x_min, x_max)
            if res:
                x, z, rotated, l_used, w_used = res
                placement = {
                    "x": x, "y": float(new_bed["base_y"]), "z": z,
                    "length_used": l_used, "width_used": w_used, "height_used": pkg_h,
                    "rotated": rotated, "bed_number": new_bed["number"], "pkg": pkg
                }
                current_weight = add_placement(placement, new_bed, pkg, platform, placements_db, load, current_weight)
                placed_bed = new_bed
            else:
                remaining.append(pkg)
                continue

        # FILL PASS
        current_weight = _fill_bed(
            placed_bed, pending, placements_db, load, platform,
            available_payload, MAX_L, MAX_W, x_min, x_max,
            current_weight, not_placed_reasons,
            is_deferred_bed=bool(pkg.get("is_deferred"))
        )
    
    return current_weight, not_placed, remaining, []


# =========================
# Endpoint optimize
# =========================
@router.post("/optimize", response_model=OptimizeResponse)
def optimize_load(request: OptimizeRequest, db: Session = Depends(get_db)):
    global current_gap_between_beds, current_gap_floor_to_bed, current_max_height_diff, current_strict_calibre

    is_opt2 = request.mode == "opt2"
    mode_name = "Optimización 2 (Frontal 6m primero)" if is_opt2 else "Optimización 1 (Superficie completa)"

    # Configurar gaps desde el request
    current_gap_between_beds = request.gap_between_beds if request.gap_between_beds is not None else DEFAULT_GAP_BETWEEN_BEDS
    current_gap_floor_to_bed = request.gap_floor_to_bed if request.gap_floor_to_bed is not None else DEFAULT_GAP_FLOOR_TO_BED
    should_center = request.center_packages if request.center_packages is not None else True

    # Tolerancia de altura según modo
    _height_mode = getattr(request, "height_diff_mode", "strict")
    current_max_height_diff = {"strict": 20.0, "flexible": 80.0, "free": 9999.0}.get(_height_mode, 20.0)
    current_strict_calibre   = (_height_mode == "strict")
    print(f"[CONFIG] Tolerancia altura: {_height_mode} → ±{current_max_height_diff}mm, calibre_estricto={current_strict_calibre}", flush=True)
    
    print(f"\n[CONFIG] Gap suelo->cama1: {current_gap_floor_to_bed}mm, Gap entre camas: {current_gap_between_beds}mm, Centrar: {should_center}", flush=True)
    
    load = db.query(Load).filter(Load.id == request.load_id).first()
    if not load:
        raise HTTPException(status_code=404, detail="Carga no encontrada")
    if not load.truck_id:
        raise HTTPException(status_code=400, detail="Selecciona un camion primero")
    
    truck = db.query(TruckType).filter(TruckType.id == load.truck_id).first()
    if not truck:
        raise HTTPException(status_code=404, detail="Camion no encontrado")
    
    MAX_L = float(truck.length_mm)
    MAX_W = float(truck.width_mm)
    
    # Determinar número de plataformas
    # Prioridad: truck_quantity del request > is_dual_platform del camión > 1
    truck_quantity = request.truck_quantity or 1
    
    # Si el camión ya tiene is_dual_platform=True, usamos 2 como mínimo
    is_dual_base = getattr(truck, "is_dual_platform", False) or truck.id in ["FULL", "TORTON_DOBLE"]
    
    if truck_quantity > 1:
        num_platforms = truck_quantity
    elif is_dual_base:
        num_platforms = 2
    else:
        num_platforms = 1
    
    is_dual = num_platforms > 1
    
    # Calcular peso máximo total
    # Para dual-platform (Full/Torton Doble), max_payload_kg es POR PLANA → total = × num_platforms
    # Para camiones simples con truck_quantity > 1, multiplicar por cantidad
    max_payload_per_truck = float(truck.max_payload_kg)
    if is_dual_base:
        # max_payload_kg es por plana; el total es num_platforms veces ese valor
        total_max_payload = max_payload_per_truck * num_platforms
    elif truck_quantity > 1:
        total_max_payload = max_payload_per_truck * truck_quantity
    else:
        total_max_payload = max_payload_per_truck
    
    print(f"\n[CONFIG] Camión: {truck.name}, Cantidad: {truck_quantity}, Planas: {num_platforms}, Payload: {total_max_payload}kg", flush=True)
    
    # Prioridad: SAP específico > familia (material_type) > almacén+calibre
    sap_priority: dict = {}            # {(sap_code, almacen): priority}
    forced_sap: set = set()            # sap_codes forzados (van primero siempre, priority=0)
    material_type_priority: dict = {}  # {material_type: priority}
    almacen_priority: dict = {}        # {(almacen, calibre): priority} — legado
    if request.almacen_priorities:
        for ap in request.almacen_priorities:
            if ap.forced and ap.sap_code:
                forced_sap.add(ap.sap_code)
            if ap.sap_code:
                sap_priority[(ap.sap_code, ap.almacen)] = 0 if ap.forced else ap.priority
            elif ap.material_type:
                material_type_priority[ap.material_type] = ap.priority
            else:
                cal = ap.calibre if ap.calibre is not None else None
                almacen_priority[(ap.almacen, cal)] = ap.priority
    
    db.query(Placement).filter(Placement.load_id == load.id).delete()
    
    items = db.query(LoadItem).filter(LoadItem.load_id == load.id).all()
    if not items:
        raise HTTPException(status_code=400, detail="No hay materiales")
    
    # Expandir a paquetes
    packages: List[Dict] = []
    import sys
    print(f"\n========== LEYENDO ITEMS DE BD ==========", flush=True)
    for item in items:
        calibre = item.calibre or 99
        almacen = item.almacen or ""
        mat_type = item.material_type or ""
        sap = item.sap_code or ""
        # Prioridad: SAP específico > familia > almacén+calibre > sin prioridad
        if sap and (sap, almacen) in sap_priority:
            priority = sap_priority[(sap, almacen)]
        elif sap and sap in forced_sap:
            priority = 0
        elif mat_type and mat_type in material_type_priority:
            priority = material_type_priority[mat_type]
        else:
            item_calibre_real = float(item.calibre) if item.calibre and item.calibre != 0 else None
            priority = almacen_priority.get(
                (almacen, item_calibre_real),
                almacen_priority.get((almacen, None), 999)
            )
        is_deferred = getattr(item, 'is_deferred', False) or False
        
        print(f"[READ] Item {item.sap_code}: is_deferred={is_deferred}, alto={item.alto_mm}", flush=True)
        
        for idx in range(item.num_paquetes):
            packages.append({
                "item_id": item.id,
                "pkg_index": idx,
                "sap": sap,
                "length": float(item.largo_mm or 1000),
                "width": float(item.ancho_mm or 500),
                "height": float(item.alto_mm or 300),
                "weight": float(item.kg_por_paquete or 1000),
                "calibre": calibre,
                "almacen": almacen,
                "material_type": mat_type,
                "almacen_priority": priority,
                "is_deferred": is_deferred
            })
    sys.stdout.flush()
    
    # ── Cargar patrones aprendidos de cargas verificadas ─────────────────────
    from database import BedPattern as BedPatternModel, MaterialCombo as MaterialComboModel

    learned_patterns: dict = {}
    try:
        db_patterns = db.query(PlacementPattern).filter(
            (PlacementPattern.truck_type_id == load.truck_id) |
            (PlacementPattern.truck_type_id == None)
        ).all()
        for pat in db_patterns:
            learned_patterns[pat.feature_key] = {
                "avg_priority": pat.avg_priority,
                "times_seen": pat.times_seen,
            }
    except Exception as e:
        print(f"[LEARN] No se pudieron cargar patrones: {e}", flush=True)

    # ── BedPattern: zona y cama típica por familia de material ────────────────
    # {feature_key: {zone: {typical_bed_norm, times_seen}}}
    learned_bed_patterns: dict = {}
    try:
        bps = db.query(BedPatternModel).filter(
            BedPatternModel.truck_type_id == load.truck_id
        ).all()
        if bps:
            max_bp_bed = max(bp.typical_bed_number for bp in bps) or 1
            for bp in bps:
                if bp.feature_key not in learned_bed_patterns:
                    learned_bed_patterns[bp.feature_key] = {}
                learned_bed_patterns[bp.feature_key][bp.zone] = {
                    "typical_bed_norm": (bp.typical_bed_number - 1) / max(1, max_bp_bed - 1),
                    "times_seen": bp.times_seen,
                }
        print(f"[LEARN] {len(bps)} BedPatterns cargados", flush=True)
    except Exception as e:
        print(f"[LEARN] BedPatterns no cargados: {e}", flush=True)

    # ── MaterialCombo: SAPs que van juntos en la misma cama ───────────────────
    # {sap_code: {partner_sap: avg_bed_norm}}
    learned_combos: dict = {}
    try:
        combos_db = db.query(MaterialComboModel).filter(
            MaterialComboModel.truck_type_id == load.truck_id,
            MaterialComboModel.same_bed_count >= 2,
        ).all()
        if combos_db:
            max_cb_bed = max(c.avg_bed_number for c in combos_db) or 1
            for c in combos_db:
                bed_norm = (c.avg_bed_number - 1) / max(1, max_cb_bed - 1)
                for a, b in [(c.sap_code_a, c.sap_code_b), (c.sap_code_b, c.sap_code_a)]:
                    if a not in learned_combos:
                        learned_combos[a] = {}
                    learned_combos[a][b] = bed_norm
        print(f"[LEARN] {len(combos_db)} MaterialCombos cargados", flush=True)
    except Exception as e:
        print(f"[LEARN] MaterialCombos no cargados: {e}", flush=True)

    def _calibre_bucket_opt(c):
        if not c or c <= 0:
            return 0.0
        return round(c / 2) * 2.0

    def _feature_key_opt(p):
        cb = _calibre_bucket_opt(p.get("calibre", 0))
        return f"{p.get('material_type', '')}|{cb}|{p.get('almacen', '')}"

    total_patterns = len(learned_patterns)

    # ── Métricas para normalización ──────────────────────────────────────────
    max_calibre    = max((p["calibre"] for p in packages), default=20) or 20
    max_height     = max((p["height"]  for p in packages), default=500) or 500
    max_area       = max((p["length"] * p["width"] for p in packages), default=1) or 1
    max_pkg_width  = max((p["width"]   for p in packages), default=2400) or 2400

    # Contar cuántas familias de paquetes tienen un patrón aprendido.
    # Para los que tienen prioridad explícita, el alpha es más bajo (máx 25%).
    # Para los sin prioridad, el alpha puede llegar al 60%.
    patterns_applied_count = 0
    avg_alpha_sum = 0.0
    unique_fkeys_explicit = set(
        _feature_key_opt(p) for p in packages if p["almacen_priority"] < 999
    )
    unique_fkeys_free = set(
        _feature_key_opt(p) for p in packages if p["almacen_priority"] >= 999
    )
    for fk in unique_fkeys_explicit:
        pat = learned_patterns.get(fk)
        if pat and pat["times_seen"] > 0:
            patterns_applied_count += 1
            avg_alpha_sum += min(0.25, 0.05 + 0.025 * math.log(max(1, pat["times_seen"])))
    for fk in unique_fkeys_free:
        pat = learned_patterns.get(fk)
        if pat and pat["times_seen"] > 0:
            patterns_applied_count += 1
            avg_alpha_sum += min(0.60, 0.10 + 0.05 * math.log(max(1, pat["times_seen"])))
    avg_alpha = (avg_alpha_sum / patterns_applied_count) if patterns_applied_count > 0 else 0.0

    def no_priority_score(p):
        """Score para materiales SIN prioridad explícita (almacen_priority == 999)."""
        s_cal  = p["calibre"] / max_calibre
        s_h    = 1.0 - p["height"] / max_height
        s_area = 1.0 - (p["length"] * p["width"]) / max_area
        base = s_cal * 0.60 + s_h * 0.25 + s_area * 0.15
        # Mezclar con patrones aprendidos si existen
        fkey = _feature_key_opt(p)
        pat  = learned_patterns.get(fkey)
        if pat and pat["times_seen"] > 0:
            alpha = min(0.60, 0.10 + 0.05 * math.log(max(1, pat["times_seen"])))
            return (1.0 - alpha) * base + alpha * pat["avg_priority"]
        return base

    if total_patterns > 0:
        print(f"[LEARN] {total_patterns} patrones cargados, {patterns_applied_count} aplican a esta carga (α avg={avg_alpha:.2f}) para {load.truck_id}", flush=True)

    # ── Calcular max prioridad explícita para normalización ─────────────────
    has_explicit = any(p["almacen_priority"] < 999 for p in packages)
    max_explicit_prio = max(
        (p["almacen_priority"] for p in packages if p["almacen_priority"] < 999),
        default=1
    ) or 1

    # ── Función de ordenamiento UNIFICADA: prioridad + aprendizaje ───────────
    # La prioridad explícita del usuario manda (75-95% del peso).
    # El aprendizaje refina el orden (5-25% del peso, crece con más cargas).
    # Si no hay prioridad explícita, el material va al Tier 1 (al final).
    # Si no hay aprendizaje, solo se usa prioridad/calibre/altura.
    def unified_sort_key(p):
        prio = p["almacen_priority"]
        fkey = _feature_key_opt(p)
        pat  = learned_patterns.get(fkey)
        bp   = learned_bed_patterns.get(fkey)  # BedPattern para esta familia

        # Aporte de BedPattern: cama típica normalizada (0=frontal, 1=trasera)
        # Se usa como desempate fino dentro del mismo tier
        bed_score = 0.5  # centro por defecto si no hay patrón
        if bp:
            # Tomar el patrón de zona con más observaciones (mayor confianza)
            zone_scores = list(bp.values())
            if zone_scores:
                best = max(zone_scores, key=lambda z: z["times_seen"])
                bed_alpha = min(0.20, 0.04 * math.log(max(1, best["times_seen"])))
                bed_score = best["typical_bed_norm"] * bed_alpha + 0.5 * (1 - bed_alpha)

        if prio < 999:
            # ── Tier 0: material con prioridad explícita ──────────────────────
            # Normalizar prioridad del usuario a [0, 1]
            if max_explicit_prio > 1:
                explicit_norm = (float(prio) - 1.0) / float(max_explicit_prio - 1)
            else:
                explicit_norm = 0.0

            if pat and pat["times_seen"] > 0:
                # El aprendizaje puede influir hasta un 25% (crece lento para
                # no anular la decisión explícita del usuario).
                learn_alpha = min(0.25, 0.05 + 0.025 * math.log(max(1, pat["times_seen"])))
                score = (1.0 - learn_alpha) * explicit_norm + learn_alpha * pat["avg_priority"]
            else:
                score = explicit_norm

            # Desempate: calibre ASC, altura DESC, ancho DESC (más ancho primero = camas más llenas abajo), cama aprendida
            return (0, score, p["calibre"] / max_calibre, -p["height"] / max_height, -p["width"] / max_pkg_width, bed_score)
        else:
            # ── Tier 1: sin prioridad → al final, ordenado por aprendizaje + calibre ─
            return (1, no_priority_score(p), p["calibre"] / max_calibre, -p["height"] / max_height, -p["width"] / max_pkg_width, bed_score)

    packages.sort(key=unified_sort_key)

    # ── Agrupación por combos aprendidos ─────────────────────────────────────
    # Si el sistema aprendió que dos SAPs van juntos en la misma cama,
    # los acerca en el orden para que el optimizer los coloque consecutivamente.
    if learned_combos:
        n = len(packages)
        used = [False] * n
        result = []
        for i in range(n):
            if used[i]:
                continue
            used[i] = True
            result.append(packages[i])
            sap_i = packages[i].get("sap", "")
            partners = learned_combos.get(sap_i, {})
            if partners:
                for j in range(i + 1, n):
                    if not used[j] and packages[j].get("sap", "") in partners:
                        used[j] = True
                        result.append(packages[j])
        if len(result) == len(packages):
            packages[:] = result
            print(f"[LEARN] Combos aplicados: orden ajustado para {len(learned_combos)} SAPs", flush=True)

    print(f"\n[DEBUG] Orden de procesamiento (has_explicit={has_explicit}, patrones={patterns_applied_count}):", flush=True)
    for pkg in packages[:20]:
        pat_info = ""
        pat = learned_patterns.get(_feature_key_opt(pkg))
        if pat:
            la = min(0.25, 0.05 + 0.025 * math.log(max(1, pat["times_seen"])))
            pat_info = f" [aprendido: avg_prio={pat['avg_priority']:.2f} α={la:.2f}]"
        print(f"  prio={pkg['almacen_priority']} cal={pkg['calibre']} h={pkg['height']}mm{pat_info}", flush=True)
    
    # SEPARAR paquetes normales de diferidos
    # Diferidos = marcados como is_deferred por el usuario
    packages_normales = []
    packages_diferidos = []
    
    for pkg in packages:
        if pkg.get("is_deferred", False):
            packages_diferidos.append(pkg)
        else:
            packages_normales.append(pkg)
    
    import sys
    print(f"\n========== OPTIMIZACIÓN ==========", flush=True)
    print(f"[DEBUG] Total paquetes: {len(packages)}", flush=True)
    print(f"[DEBUG] Paquetes NORMALES: {len(packages_normales)}", flush=True)
    print(f"[DEBUG] Paquetes DIFERIDOS: {len(packages_diferidos)}", flush=True)
    for pkg in packages[:5]:
        print(f"  - {pkg.get('almacen')} cal={pkg.get('calibre')} h={pkg.get('height')} deferred={pkg.get('is_deferred')}", flush=True)
    sys.stdout.flush()
    
    # Calcular payload disponible POR PLATAFORMA
    # Cada plataforma tiene su propio límite de peso
    aditamentos_per_platform = float(load.total_aditamentos_kg or 0) / num_platforms
    payload_per_platform = max_payload_per_truck - aditamentos_per_platform
    
    # El payload total sigue siendo el mismo para referencia
    available_payload = total_max_payload - float(load.total_aditamentos_kg or 0)
    current_weight = 0.0
    
    print(f"[CONFIG] Payload por plataforma: {payload_per_platform}kg (límite individual)", flush=True)
    
    # Inicializar plataformas con su propio límite de peso
    # La primera cama empieza en current_gap_floor_to_bed (espacio del suelo a la primera cama)
    platforms: List[Dict] = []
    for plat_num in range(1, num_platforms + 1):
        platforms.append({
            "number": plat_num,
            "max_payload": payload_per_platform,  # Límite de peso para esta plana
            "current_weight": 0.0,  # Peso actual de esta plana
            "beds": [{
                "number": 1,
                "base_y": float(current_gap_floor_to_bed),  # Espacio del suelo a la primera cama
                "placements": [],
                "max_pkg_height": 0.0,
                "weight": 0.0,
                "is_overflow": False
            }]
        })
    
    placements_db: List[Placement] = []
    not_placed_count = 0
    not_placed_reasons: dict = {}  # {(item_id, pkg_index): reason}
    all_deferred = list(packages_diferidos)  # Empezar con los diferidos por altura

    if is_opt2:
        # =========================
        # OPTIMIZACIÓN 2: DOS FASES
        # =========================

        # FASE 1: Zona frontal (0-6m) - SOLO paquetes normales
        current_weight, not_placed_1, remaining, deferred_1 = process_zone(
            packages_normales, platforms, placements_db, load, MAX_L, MAX_W,
            current_weight, available_payload, 0, FRONTAL_ZONE, not_placed_reasons
        )
        not_placed_count += not_placed_1
        all_deferred.extend(deferred_1)

        # FASE 2: Zona trasera (6m-12m) con los que sobraron
        if remaining:
            current_weight, not_placed_2, still_remaining, deferred_2 = process_rear_zone(
                remaining, platforms, placements_db, load, MAX_L, MAX_W,
                current_weight, available_payload, FRONTAL_ZONE, MAX_L, not_placed_reasons
            )
            not_placed_count += not_placed_2
            all_deferred.extend(deferred_2)
            remaining = still_remaining
        else:
            remaining = []

    else:
        # =========================
        # OPTIMIZACIÓN 1: Superficie completa
        # =========================

        # Procesar PLANA 1 - SOLO paquetes normales
        current_weight, not_placed_1, remaining, deferred_1 = process_zone(
            packages_normales, platforms, placements_db, load, MAX_L, MAX_W,
            current_weight, available_payload, 0, MAX_L, not_placed_reasons
        )
        not_placed_count += not_placed_1
        all_deferred.extend(deferred_1)

        # Si es Full y hay remaining, procesarlos en PLANA 2
        if is_dual and remaining and len(platforms) > 1:
            current_weight, not_placed_2, still_remaining, deferred_2 = process_zone_platform2(
                remaining, platforms, placements_db, load, MAX_L, MAX_W,
                current_weight, available_payload, 0, MAX_L, not_placed_reasons
            )
            not_placed_count += not_placed_2
            all_deferred.extend(deferred_2)
            remaining = still_remaining
    
    # =========================
    # PROCESAR DIFERIDOS AL FINAL DEL ACOMODO
    # Siguen la misma lógica que los normales (de abajo hacia arriba)
    # En Opt2: primero zona frontal, luego trasera
    # En Opt1: toda la superficie
    # En Full: primero Plana 1, luego Plana 2
    # RESPETA EL LÍMITE DE PESO POR PLATAFORMA
    # =========================
    if all_deferred:
        print(f"[DEBUG] Procesando {len(all_deferred)} diferidos AL FINAL del acomodo", flush=True)
        
        # Ordenar diferidos igual que los normales (calibre, altura, área)
        all_deferred.sort(key=lambda p: (p.get("calibre", 99), -p["height"], -(p["length"] * p["width"])))
        
        # Definir zonas según modo
        if is_opt2:
            zonas = [(0, FRONTAL_ZONE), (FRONTAL_ZONE, MAX_L)]
        else:
            zonas = [(0, MAX_L)]
        
        for pkg in all_deferred:
            if current_weight + pkg["weight"] > available_payload:
                not_placed_count += 1
                not_placed_reasons[(pkg["item_id"], pkg["pkg_index"])] = "peso_excedido"
                placements_db.append(Placement(
                    load_id=load.id, load_item_id=pkg["item_id"],
                    paquete_index=pkg["pkg_index"], platform=1, bed_number=0,
                    x=0, y=0, z=0, rotated=False,
                    length_used=pkg["length"], width_used=pkg["width"], height_used=pkg["height"],
                    placed=False
                ))
                continue
            
            pkg_h = float(pkg["height"])
            placed = False
            
            # Intentar en cada plataforma (Plana 1 primero, luego Plana 2 si es Full)
            for plat_idx, platform in enumerate(platforms):
                if placed:
                    break
                
                plat_num = plat_idx + 1
                
                # Verificar límite de peso DE ESTA PLATAFORMA
                platform_max_payload = platform.get("max_payload", available_payload)
                platform_current = platform.get("current_weight", 0.0)
                if platform_current + pkg["weight"] > platform_max_payload:
                    # No cabe en esta plataforma por peso, intentar la siguiente
                    continue
                
                # Intentar en cada zona (frontal primero en Opt2)
                for x_min, x_max in zonas:
                    if placed:
                        break
                    
                    # Buscar en camas existentes DE ABAJO HACIA ARRIBA (como los normales)
                    normal_beds = [b for b in platform["beds"] if not b.get("is_overflow", False)]
                    normal_beds_sorted = sorted(normal_beds, key=lambda b: b["number"])  # Más baja primero

                    free_mode_def = (current_max_height_diff >= 9999.0)
                    for bed in normal_beds_sorted:
                        # Verificar compatibilidad de altura
                        if not free_mode_def and not bed_height_range_ok(bed, pkg_h):
                            continue
                        
                        res = try_place(bed, pkg, MAX_L, MAX_W, x_min, x_max)
                        if res:
                            x, z, rotated, l_used, w_used = res
                            if float(bed["base_y"]) + max(float(bed["max_pkg_height"]), pkg_h) <= MAX_TOTAL_HEIGHT:
                                placement = {
                                    "x": x, "y": float(bed["base_y"]), "z": z,
                                    "length_used": l_used, "width_used": w_used, "height_used": pkg_h,
                                    "rotated": rotated, "bed_number": bed["number"], "pkg": pkg
                                }
                                current_weight = add_placement(placement, bed, pkg, platform, placements_db, load, current_weight)
                                placed = True
                                print(f"[DEBUG] Diferido -> Plana {plat_num} Cama {bed['number']} zona ({x_min}-{x_max})", flush=True)
                                break
                    
                    # Si no cupo en camas existentes, crear nueva cama
                    if not placed:
                        new_bed = create_new_bed(platform, pkg_h, is_overflow=False)
                        if new_bed:
                            res = try_place(new_bed, pkg, MAX_L, MAX_W, x_min, x_max)
                            if res:
                                x, z, rotated, l_used, w_used = res
                                placement = {
                                    "x": x, "y": float(new_bed["base_y"]), "z": z,
                                    "length_used": l_used, "width_used": w_used, "height_used": pkg_h,
                                    "rotated": rotated, "bed_number": new_bed["number"], "pkg": pkg
                                }
                                current_weight = add_placement(placement, new_bed, pkg, platform, placements_db, load, current_weight)
                                placed = True
                                print(f"[DEBUG] Diferido -> Plana {plat_num} Nueva Cama {new_bed['number']} zona ({x_min}-{x_max})", flush=True)
            
            if not placed:
                not_placed_count += 1
                not_placed_reasons[(pkg["item_id"], pkg["pkg_index"])] = "sin_espacio"
                placements_db.append(Placement(
                    load_id=load.id, load_item_id=pkg["item_id"],
                    paquete_index=pkg["pkg_index"], platform=1, bed_number=0,
                    x=0, y=0, z=0, rotated=False,
                    length_used=pkg["length"], width_used=pkg["width"], height_used=pkg["height"],
                    placed=False
                ))
                print(f"[DEBUG] Diferido NO COLOCADO (sin espacio en ninguna plana)", flush=True)

    # Los remaining que no cupieron en ninguna zona
    for pkg in remaining:
        not_placed_count += 1
        not_placed_reasons[(pkg["item_id"], pkg["pkg_index"])] = "sin_espacio"
        placements_db.append(Placement(
            load_id=load.id, load_item_id=pkg["item_id"],
            paquete_index=pkg["pkg_index"], platform=1, bed_number=0,
            x=0, y=0, z=0, rotated=False,
            length_used=pkg["length"], width_used=pkg["width"], height_used=pkg["height"],
            placed=False
        ))
    
    # =========================
    # CENTRADO DE PAQUETES
    # Si está habilitado, centra los paquetes en el ancho de cada cama
    # =========================
    if should_center:
        print(f"[DEBUG] Centrando paquetes en el ancho de cada cama...", flush=True)
        for platform in platforms:
            for bed in platform["beds"]:
                if bed["placements"]:
                    # Calcular el ancho máximo ocupado por los paquetes (en el eje Z)
                    min_z = min(p["z"] for p in bed["placements"])
                    max_z_used = max(p["z"] + p["width_used"] for p in bed["placements"])
                    
                    used_width = max_z_used - min_z
                    
                    # Si hay espacio sobrante, centrar
                    if used_width < MAX_W:
                        # Calcular offset para centrar
                        offset_z = (MAX_W - used_width) / 2 - min_z
                        
                        print(f"[DEBUG] Plana {platform['number']} Cama {bed['number']}: ancho usado={used_width:.0f}mm, offset={offset_z:.0f}mm", flush=True)
                        
                        # Aplicar offset a todos los paquetes de esta cama
                        for p in bed["placements"]:
                            p["z"] = p["z"] + offset_z
                            
                            # Actualizar el placement correspondiente en placements_db
                            for db_p in placements_db:
                                pkg_info = p.get("pkg", {})
                                if (db_p.load_item_id == pkg_info.get("item_id") and 
                                    db_p.paquete_index == pkg_info.get("pkg_index") and
                                    db_p.bed_number == p["bed_number"] and
                                    db_p.platform == platform["number"]):
                                    db_p.z = p["z"]
                                    break
    
    # Guardar
    db.add_all(placements_db)
    load.status = "OPTIMIZED"
    load.total_tons = current_weight / 1000.0
    db.commit()
    
    # Stats
    total_height = get_total_height(platforms)
    beds_stats = []
    
    for platform in platforms:
        for bed in platform["beds"]:
            if bed["placements"]:
                fill_pct = calculate_fill_percentage(bed["placements"], MAX_L, MAX_W)
                beds_stats.append(BedStats(
                    bed_number=bed["number"],
                    platform=platform["number"],
                    packages_count=len(bed["placements"]),
                    fill_percentage=fill_pct,
                    total_weight=float(bed["weight"]),
                    base_y=float(bed["base_y"]),
                    max_height=float(bed["max_pkg_height"])
                ))
    
    total_placed = len(packages) - not_placed_count

    # Construir detalle de no colocados agrupado por item
    item_map = {item.id: item for item in items}
    grouped_reasons: dict = {}  # {item_id: {sap_code, description, count, reason}}
    for (item_id, pkg_index), reason in not_placed_reasons.items():
        if item_id not in grouped_reasons:
            it = item_map.get(item_id)
            grouped_reasons[item_id] = {
                "sap_code": it.sap_code if it else "N/A",
                "description": it.description if it else "Material",
                "count": 0,
                "reason": reason,
            }
        grouped_reasons[item_id]["count"] += 1
        # Si hay mezcla de razones para el mismo item, "peso_excedido" tiene prioridad
        if reason == "peso_excedido":
            grouped_reasons[item_id]["reason"] = "peso_excedido"

    not_placed_details = [
        NotPlacedDetail(**v) for v in grouped_reasons.values()
    ]

    return OptimizeResponse(
        success=True,
        message=f"{mode_name}: {total_placed}/{len(packages)} paquetes",
        total_placed=total_placed,
        not_placed=not_placed_count,
        beds_used=len(beds_stats),
        beds_stats=beds_stats,
        total_weight_kg=current_weight,
        total_height_mm=total_height,
        not_placed_details=not_placed_details,
        patterns_applied=patterns_applied_count,
        learning_alpha=round(avg_alpha, 3),
    )


@router.put("/placements/{placement_id}")
def update_placement(placement_id: int, data: PlacementUpdate, db: Session = Depends(get_db)):
    placement = db.query(Placement).filter(Placement.id == placement_id).first()
    if not placement:
        raise HTTPException(status_code=404, detail="Placement no encontrado")
    
    if data.bed_number is not None:
        placement.bed_number = data.bed_number
    if data.platform is not None:
        placement.platform = data.platform
    if data.x is not None:
        placement.x = data.x
    if data.y is not None:
        placement.y = data.y
    if data.z is not None:
        placement.z = data.z
    if data.rotated is not None:
        placement.rotated = data.rotated
    if data.length_used is not None:
        placement.length_used = data.length_used
    if data.width_used is not None:
        placement.width_used = data.width_used
    if data.height_used is not None:
        placement.height_used = data.height_used
    
    load = db.query(Load).filter(Load.id == placement.load_id).first()
    if load:
        load.status = "MANUAL"
    
    db.commit()
    return {"message": "Posicion actualizada", "id": placement_id}