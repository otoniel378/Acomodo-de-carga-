@echo off
title TYASA - Sistema de Acomodo de Carga
color 0A

echo ============================================
echo    TYASA - Sistema de Acomodo de Carga
echo ============================================
echo.

:: Verificar Python
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Python no esta instalado
    echo Descarga Python de: https://www.python.org/downloads/
    pause
    exit /b 1
)

:: Ir a carpeta backend
cd /d "%~dp0backend"

:: Instalar TODAS las dependencias necesarias
echo [1/3] Instalando dependencias...
pip install fastapi uvicorn sqlalchemy pydantic python-multipart pandas openpyxl --quiet

:: Iniciar backend
echo.
echo [2/3] Iniciando servidor backend...
start "TYASA Backend" cmd /k "python main.py"

:: Esperar a que inicie
timeout /t 3 /nobreak >nul

:: Abrir frontend
echo.
echo [3/3] Abriendo frontend...
cd /d "%~dp0frontend"
start "" "http://127.0.0.1:5500/index.html"

:: Iniciar servidor frontend simple
echo.
echo Iniciando servidor frontend en puerto 5500...
python -m http.server 5500

pause