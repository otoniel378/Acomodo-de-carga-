# routes/trucks.py - Endpoints de camiones
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from database import get_db, TruckType
from schemas import TruckCreate, TruckResponse

router = APIRouter(prefix="/api/trucks", tags=["trucks"])


@router.get("", response_model=List[TruckResponse])
def get_trucks(db: Session = Depends(get_db)):
    """Obtener todos los camiones"""
    return db.query(TruckType).all()


@router.get("/{truck_id}", response_model=TruckResponse)
def get_truck(truck_id: str, db: Session = Depends(get_db)):
    """Obtener un camión por ID"""
    truck = db.query(TruckType).filter(TruckType.id == truck_id).first()
    if not truck:
        raise HTTPException(status_code=404, detail="Camión no encontrado")
    return truck


@router.post("", response_model=TruckResponse)
def create_truck(truck: TruckCreate, db: Session = Depends(get_db)):
    """Crear nuevo camión"""
    if db.query(TruckType).filter(TruckType.id == truck.id).first():
        raise HTTPException(status_code=400, detail="ID de camión ya existe")
    
    db_truck = TruckType(**truck.model_dump())
    db.add(db_truck)
    db.commit()
    db.refresh(db_truck)
    return db_truck


@router.put("/{truck_id}", response_model=TruckResponse)
def update_truck(truck_id: str, truck: TruckCreate, db: Session = Depends(get_db)):
    """Actualizar camión existente"""
    db_truck = db.query(TruckType).filter(TruckType.id == truck_id).first()
    if not db_truck:
        raise HTTPException(status_code=404, detail="Camión no encontrado")
    
    # Actualizar campos
    for key, value in truck.model_dump().items():
        if hasattr(db_truck, key):
            setattr(db_truck, key, value)
    
    db.commit()
    db.refresh(db_truck)
    return db_truck


@router.delete("/{truck_id}")
def delete_truck(truck_id: str, db: Session = Depends(get_db)):
    """Eliminar camión"""
    truck = db.query(TruckType).filter(TruckType.id == truck_id).first()
    if not truck:
        raise HTTPException(status_code=404, detail="Camión no encontrado")
    
    db.delete(truck)
    db.commit()
    return {"message": "Camión eliminado", "id": truck_id}