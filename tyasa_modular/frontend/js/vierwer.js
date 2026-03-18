// vierwer.js - Visualización 3D con Three.js
// CAMAS = CAPAS APILADAS VERTICALMENTE
// Cama 1 = primera capa en el piso
// Cama 2 = apilada ENCIMA de cama 1, etc.

let scene, camera, renderer, controls;
let truckGroup, packagesGroup;

// ── Auto-aprendizaje: guardar patrones silenciosamente después de cada movimiento ──
let _autoLearnTimer = null;
function triggerAutoLearn() {
    if (!state.loadId) return;
    clearTimeout(_autoLearnTimer);
    _autoLearnTimer = setTimeout(async () => {
        try {
            await api.autoLearn(state.loadId);
        } catch (e) {
            // Silencioso — no interrumpir el flujo del usuario
            console.debug('[auto-learn] error silencioso:', e.message);
        }
    }, 2000); // 2 segundos de debounce
}

// ==================== RECALCULAR ALTURA TOTAL ====================
function recalculateTotalHeight() {
    // Recalcular altura basándose en los placements locales
    if (!state.placements || state.placements.length === 0) {
        state.totalHeight = 0;
        return;
    }
    
    // Agrupar por cama
    const bedHeights = {};
    for (const p of state.placements) {
        if (!p.placed) continue;
        const bed = p.bed_number;
        const topY = (p.y || 0) + (p.height_used || 0);
        if (!bedHeights[bed] || topY > bedHeights[bed]) {
            bedHeights[bed] = topY;
        }
    }
    
    // La altura total es el máximo de todas las camas
    const maxHeight = Math.max(...Object.values(bedHeights), 0);
    state.totalHeight = maxHeight;
    
    // Actualizar UI si existe el elemento
    const heightDisplay = document.querySelector('.altura-total-value');
    if (heightDisplay) {
        heightDisplay.textContent = (maxHeight / 1000).toFixed(2) + 'm';
    }
    
    console.log('[DEBUG] Altura total recalculada:', maxHeight, 'mm');
}

// Función para actualizar fondo 3D según el tema
function update3DBackground() {
    if (!scene) return;
    const isLightMode = document.documentElement.classList.contains('light-mode');
    // En modo claro usamos un azul oscuro para que se vean bien los elementos
    const bgColor = isLightMode ? 0x1e3a5f : 0x0a1628;
    scene.background = new THREE.Color(bgColor);
}

// ==================== INIT ====================
function init3D() {
    if (!window.THREE) {
        console.error('THREE.js no cargado');
        return;
    }
    
    const container = $('viewer3d');
    if (!container) return;
    
    const w = container.clientWidth;
    const h = container.clientHeight;
    
    // Scene
    scene = new THREE.Scene();
    update3DBackground();  // Usar función para detectar tema
    
    // Camera
    camera = new THREE.PerspectiveCamera(45, w / h, 100, 100000);
    camera.position.set(18000, 8000, 12000);
    
    // Renderer
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);
    
    // Controls
    if (window.OrbitControls) {
        controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.05;
        controls.target.set(7000, 1000, 1200);
    }
    
    // Lights
    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(10000, 20000, 5000);
    scene.add(dirLight);
    
    // Grid - más grande para cubrir 2 planas del Full (13.6m x 2 + gap = ~28m)
    const gridHelper = new THREE.GridHelper(60000, 120, 0x1e3a5f, 0x0f2847);
    gridHelper.position.set(15000, 0, 1200); // Centrar mejor para 2 planas
    scene.add(gridHelper);
    
    // Groups
    truckGroup = new THREE.Group();
    packagesGroup = new THREE.Group();
    scene.add(truckGroup);
    scene.add(packagesGroup);
    
    // Animation loop
    function animate() {
        requestAnimationFrame(animate);
        controls?.update();
        renderer.render(scene, camera);
    }
    animate();
    
    // Resize
    window.addEventListener('resize', () => {
        const w = container.clientWidth;
        const h = container.clientHeight;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
    });
    
    console.log('3D inicializado');
}

// ==================== RENDER 3D ====================
function render3D() {
    if (!scene) return;
    
    console.log('render3D llamado');
    console.log('  - Truck:', state.truck?.name);
    console.log('  - Placements:', state.placements?.length);
    console.log('  - Materials:', state.materials?.length);
    
    clearGroup(truckGroup);
    clearGroup(packagesGroup);
    
    if (!state.truck) return;
    
    const t = state.truck;
    const L = t.length_mm;
    const W = t.width_mm;
    const H = t.height_mm;
    
    // Constantes de separación
    const FLOOR_HEIGHT = 50;        // Altura del piso visual
    const GROUND_CLEARANCE = 100;   // Separación del suelo a la primera cama (10 cm = 100 mm)
    
    // Detectar número de plataformas
    // Prioridad: truckQuantity del state > is_dual_platform > 1
    const truckQuantity = state.truckQuantity || 1;
    const isDualBase = t.is_dual_platform || t.id === 'FULL' || t.id === 'TORTON_DOBLE';
    
    let numPlatforms;
    if (truckQuantity > 1) {
        numPlatforms = truckQuantity;
    } else if (isDualBase) {
        numPlatforms = 2;
    } else {
        numPlatforms = 1;
    }
    
    const isDual = numPlatforms > 1;
    const platformGap = isDual ? (t.platform_gap_mm || 500) : 0;
    
    // Dibujar planas
    for (let platNum = 1; platNum <= numPlatforms; platNum++) {
        // Offset X para cada plana (la segunda se dibuja a la derecha)
        const offsetX = (platNum - 1) * (L + platformGap);
        
        // Piso de la plana
        const floorGeo = new THREE.BoxGeometry(L, FLOOR_HEIGHT, W);
        const floorMat = new THREE.MeshStandardMaterial({ color: 0x1a2744 });
        const floor = new THREE.Mesh(floorGeo, floorMat);
        floor.position.set(offsetX + L/2, FLOOR_HEIGHT/2, W/2);
        truckGroup.add(floor);
        
        // Wireframe de la plana
        const boxGeo = new THREE.BoxGeometry(L, H, W);
        const edges = new THREE.EdgesGeometry(boxGeo);
        const wireColor = platNum === 1 ? 0x3b82f6 : 0x22c55e;  // Azul para P1, Verde para P2
        const wireframe = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: wireColor }));
        wireframe.position.set(offsetX + L/2, H/2 + FLOOR_HEIGHT, W/2);
        truckGroup.add(wireframe);
        
        // Etiqueta de la plana
        if (isDual) {
            addTextLabel3D(`P${platNum}`, offsetX + L/2, H + 200, W/2, wireColor, false);
        }
        
        // ========== ETIQUETAS DE LADOS (PILOTO/COPILOTO) ==========
        addTextLabel3D('◀ LADO COPILOTO', offsetX + L/2, FLOOR_HEIGHT + 200, -400, 0x22c55e, false);
        addTextLabel3D('LADO PILOTO ▶', offsetX + L/2, FLOOR_HEIGHT + 200, W + 400, 0x22c55e, false);
        
        // ========== ETIQUETAS DE ZONAS A/B (solo para tráiler/full >= 12m) ==========
        if (L >= 11000) {
            const zoneLimit = 6025;
            
            // Línea divisoria entre zonas
            const divLineMat = new THREE.LineBasicMaterial({ color: 0xf59e0b, linewidth: 2 });
            const divPoints = [
                new THREE.Vector3(offsetX + zoneLimit, FLOOR_HEIGHT + 5, 0),
                new THREE.Vector3(offsetX + zoneLimit, FLOOR_HEIGHT + 5, W)
            ];
            const divLineGeo = new THREE.BufferGeometry().setFromPoints(divPoints);
            const divLine = new THREE.Line(divLineGeo, divLineMat);
            truckGroup.add(divLine);
            
            // Línea vertical
            const divVertPoints = [
                new THREE.Vector3(offsetX + zoneLimit, FLOOR_HEIGHT, W/2),
                new THREE.Vector3(offsetX + zoneLimit, FLOOR_HEIGHT + 400, W/2)
            ];
            const divVertGeo = new THREE.BufferGeometry().setFromPoints(divVertPoints);
            const divVertLine = new THREE.Line(divVertGeo, divLineMat);
            truckGroup.add(divVertLine);
            
            // Etiquetas de zona
            addTextLabel3D('ZONA A - Delantera', offsetX + zoneLimit/2, FLOOR_HEIGHT + 80, W + 350, 0x3b82f6, false);
            addTextLabel3D('ZONA B - Trasera/Ejes', offsetX + zoneLimit + (L - zoneLimit)/2, FLOOR_HEIGHT + 80, W + 350, 0xf59e0b, false);
        }
    }
    
    // Etiqueta CONCHA
    addTextLabel3D('◀ CONCHA', -600, H/2, W/2, 0x22c55e, true);
    
    // Renderizar paquetes
    let placedCount = 0;
    state.placements.forEach((p) => {
        if (!p.placed) return;
        placedCount++;
        
        // Calcular offset X según la plana
        const platform = p.platform || 1;
        const offsetX = (platform - 1) * (L + platformGap);
        
        // Buscar el item para obtener el calibre
        let item = state.materials.find(m => m.id === p.load_item_id);
        if (!item && state.materials.length > 0) {
            item = state.materials[0];
        }
        
        // Color basado en CALIBRE
        const calibre = item?.calibre || 0;
        const color = getColorByCalibre(calibre);
        
        // Crear caja
        const geo = new THREE.BoxGeometry(p.length_used, p.height_used, p.width_used);
        const mat = new THREE.MeshStandardMaterial({
            color: color.three,
            transparent: true,
            opacity: 0.9
        });
        const mesh = new THREE.Mesh(geo, mat);
        
        // Guardar calibre y plana en userData para referencia
        mesh.userData.calibre = calibre;
        mesh.userData.itemId = item?.id;
        mesh.userData.platform = platform;
        
        // Posición con offset de plana y separación del suelo
        mesh.position.set(
            offsetX + p.x + p.length_used / 2,
            FLOOR_HEIGHT + GROUND_CLEARANCE + p.y + p.height_used / 2,
            p.z + p.width_used / 2
        );
        packagesGroup.add(mesh);
        
        // Bordes
        const edgeGeo = new THREE.EdgesGeometry(geo);
        const edgeLine = new THREE.LineSegments(edgeGeo, new THREE.LineBasicMaterial({ color: 0xffffff }));
        edgeLine.position.copy(mesh.position);
        packagesGroup.add(edgeLine);
    });
    
    console.log('  - Paquetes renderizados:', placedCount);
    
    // ========== INDICADOR DE ALTURA TOTAL ==========
    if (state.placements.length > 0 && state.totalHeight > 0) {
        const totalHeight = state.totalHeight;
        const displayHeight = FLOOR_HEIGHT + GROUND_CLEARANCE + totalHeight;
        
        // Línea vertical de altura (más a la izquierda para no sobreponerse con FRENTE)
        const lineGeo = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(-800, FLOOR_HEIGHT, W/2),
            new THREE.Vector3(-800, displayHeight, W/2)
        ]);
        const lineMat = new THREE.LineBasicMaterial({ color: 0xf59e0b, linewidth: 3 });
        const heightLine = new THREE.Line(lineGeo, lineMat);
        truckGroup.add(heightLine);
        
        // Líneas horizontales (marcas superior e inferior)
        const topMarkGeo = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(-900, displayHeight, W/2),
            new THREE.Vector3(-700, displayHeight, W/2)
        ]);
        const topMark = new THREE.Line(topMarkGeo, lineMat);
        truckGroup.add(topMark);
        
        const bottomMarkGeo = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(-900, FLOOR_HEIGHT, W/2),
            new THREE.Vector3(-700, FLOOR_HEIGHT, W/2)
        ]);
        const bottomMark = new THREE.Line(bottomMarkGeo, lineMat);
        truckGroup.add(bottomMark);
        
        // Etiqueta de altura - ARRIBA de la línea superior
        const heightMeters = (totalHeight / 1000).toFixed(2);
        const labelColor = totalHeight > 3100 ? 0xef4444 : 0xf59e0b;  // Rojo si excede
        addTextLabel3D(`${heightMeters}m`, -800, displayHeight + 150, W/2, labelColor, false);
        
        // Línea de límite máximo (3.10m) si está cerca o excede
        if (totalHeight > 2500) {
            const maxHeightY = FLOOR_HEIGHT + GROUND_CLEARANCE + 3100;
            const maxLineGeo = new THREE.BufferGeometry().setFromPoints([
                new THREE.Vector3(-100, maxHeightY, 0),
                new THREE.Vector3(-100, maxHeightY, W)
            ]);
            const maxLineMat = new THREE.LineDashedMaterial({ 
                color: 0xef4444, 
                dashSize: 100, 
                gapSize: 50 
            });
            const maxLine = new THREE.Line(maxLineGeo, maxLineMat);
            maxLine.computeLineDistances();
            truckGroup.add(maxLine);
            
            addTextLabel3D('Máx 3.10m', -300, maxHeightY + 100, W/2, 0xef4444, false);
        }
    }
    
    // ========== ETIQUETAS DE CAMAS (NIVELES) ==========
    if (state.placements.length > 0) {
        // Obtener camas únicas con sus alturas
        const bedsInfo = {};
        state.placements.forEach(p => {
            if (!p.placed) return;
            const bedNum = p.bed_number;
            if (!bedsInfo[bedNum]) {
                bedsInfo[bedNum] = { minY: Infinity, maxY: 0 };
            }
            const baseY = p.y;
            const topY = p.y + p.height_used;
            bedsInfo[bedNum].minY = Math.min(bedsInfo[bedNum].minY, baseY);
            bedsInfo[bedNum].maxY = Math.max(bedsInfo[bedNum].maxY, topY);
        });
        
        // Dibujar etiquetas para cada cama
        Object.keys(bedsInfo).sort((a, b) => parseInt(a) - parseInt(b)).forEach(bedNum => {
            const info = bedsInfo[bedNum];
            const centerY = FLOOR_HEIGHT + GROUND_CLEARANCE + (info.minY + info.maxY) / 2;
            
            // Etiqueta en el lado derecho del camión
            addTextLabel3D(`Cama ${bedNum}`, L + 300, centerY, W / 2, 0x22c55e, false);
            
            // Línea horizontal indicando el nivel de la cama
            const levelLineGeo = new THREE.BufferGeometry().setFromPoints([
                new THREE.Vector3(L + 100, centerY, W / 2 - 200),
                new THREE.Vector3(L + 100, centerY, W / 2 + 200)
            ]);
            const levelLineMat = new THREE.LineBasicMaterial({ color: 0x22c55e });
            const levelLine = new THREE.Line(levelLineGeo, levelLineMat);
            truckGroup.add(levelLine);
            
            // Flecha pequeña apuntando hacia el camión
            const arrowGeo = new THREE.BufferGeometry().setFromPoints([
                new THREE.Vector3(L + 100, centerY, W / 2),
                new THREE.Vector3(L + 200, centerY + 50, W / 2),
                new THREE.Vector3(L + 200, centerY - 50, W / 2),
                new THREE.Vector3(L + 100, centerY, W / 2)
            ]);
            const arrowMat = new THREE.LineBasicMaterial({ color: 0x22c55e });
            const arrow = new THREE.Line(arrowGeo, arrowMat);
            truckGroup.add(arrow);
        });
    }
    
    // Preview si no hay placements
    if (state.placements.length === 0 && state.materials.length > 0) {
        let x = 100, z = 100;
        state.materials.forEach(m => {
            const l = m.largo_mm || 1000;
            const w = m.ancho_mm || 500;
            const h = m.alto_mm || 300;
            const calibre = m.calibre || 0;
            const color = getColorByCalibre(calibre);
            
            const geo = new THREE.BoxGeometry(l, h, w);
            const mat = new THREE.MeshStandardMaterial({ color: color.three, transparent: true, opacity: 0.4 });
            const mesh = new THREE.Mesh(geo, mat);
            mesh.position.set(x + l/2, 50 + h/2, z + w/2);
            packagesGroup.add(mesh);
            
            x += l + 200;
            if (x > L - 500) { x = 100; z += w + 200; }
        });
    }
}

// Crear etiqueta de texto 3D usando sprite
function addTextLabel3D(text, x, y, z, color, vertical = false) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    
    if (vertical) {
        // Texto vertical
        canvas.width = 64;
        canvas.height = 256;
        
        ctx.fillStyle = 'transparent';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        ctx.font = 'bold 32px Arial';
        ctx.fillStyle = '#' + color.toString(16).padStart(6, '0');
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        
        // Rotar contexto para escribir vertical
        ctx.save();
        ctx.translate(canvas.width/2, canvas.height/2);
        ctx.rotate(-Math.PI/2);  // Rotar -90 grados
        ctx.fillText(text, 0, 0);
        ctx.restore();
        
        const texture = new THREE.CanvasTexture(canvas);
        const material = new THREE.SpriteMaterial({ map: texture });
        const sprite = new THREE.Sprite(material);
        sprite.position.set(x, y, z);
        sprite.scale.set(400, 1500, 1);  // Invertir escala para vertical
        truckGroup.add(sprite);
    } else {
        // Texto horizontal normal
        canvas.width = 256;
        canvas.height = 64;
        
        ctx.fillStyle = 'transparent';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        ctx.font = 'bold 32px Arial';
        ctx.fillStyle = '#' + color.toString(16).padStart(6, '0');
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, canvas.width/2, canvas.height/2);
        
        const texture = new THREE.CanvasTexture(canvas);
        const material = new THREE.SpriteMaterial({ map: texture });
        const sprite = new THREE.Sprite(material);
        sprite.position.set(x, y, z);
        sprite.scale.set(1500, 400, 1);
        truckGroup.add(sprite);
    }
}

function clearGroup(group) {
    while (group.children.length) {
        const obj = group.children.pop();
        obj.geometry?.dispose();
        obj.material?.dispose();
    }
}

// ==================== CAMERA CONTROLS ====================
function resetView3D() {
    if (!controls) return;
    camera.position.set(18000, 8000, 12000);
    controls.target.set(7000, 1000, 1200);
}

function topView3D() {
    if (!controls || !state.truck) return;
    const t = state.truck;
    camera.position.set(t.length_mm/2, t.height_mm + 10000, t.width_mm/2);
    controls.target.set(t.length_mm/2, 0, t.width_mm/2);
}

function frontView3D() {
    if (!controls || !state.truck) return;
    const t = state.truck;
    camera.position.set(t.length_mm + 5000, t.height_mm/2, t.width_mm/2);
    controls.target.set(t.length_mm/2, t.height_mm/2, t.width_mm/2);
}

function sideView3D() {
    if (!controls || !state.truck) return;
    const t = state.truck;
    camera.position.set(t.length_mm/2, t.height_mm/2, t.width_mm + 5000);
    controls.target.set(t.length_mm/2, t.height_mm/2, t.width_mm/2);
}

function focusBed3D(bedNum) {
    if (!controls || !state.truck) return;
    // Enfocar en los paquetes de esa cama
    const bedPlacements = state.placements.filter(p => p.bed_number === bedNum && p.placed);
    if (bedPlacements.length === 0) {
        resetView3D();
        return;
    }
    
    // Calcular centro de los paquetes de esta cama
    const avgX = bedPlacements.reduce((s, p) => s + p.x + p.length_used/2, 0) / bedPlacements.length;
    const avgY = bedPlacements.reduce((s, p) => s + p.y + p.height_used/2, 0) / bedPlacements.length;
    const avgZ = bedPlacements.reduce((s, p) => s + p.z + p.width_used/2, 0) / bedPlacements.length;
    
    controls.target.set(avgX, 50 + avgY, avgZ);
    camera.position.set(avgX + 5000, 50 + avgY + 3000, avgZ + 5000);
}

// ==================== VISTA 2D ====================
function resizeCanvas2D() {
    const canvas = $('canvas2d');
    if (!canvas) return;
    
    const container = canvas.parentElement;
    if (!container) return;
    
    // Obtener el ancho del contenedor
    const rect = container.getBoundingClientRect();
    const newWidth = Math.max(rect.width - 24, 400); // 24px de padding, mínimo 400
    const newHeight = 200;
    
    // Solo actualizar si cambió significativamente
    if (Math.abs(canvas.width - newWidth) > 10) {
        canvas.width = newWidth;
        canvas.height = newHeight;
        // Redibujar
        if (state.selectedBed) {
            draw2D(state.selectedBed);
        }
    }
}

function draw2DWithPlatform(platform, bedNum) {
    state.selectedPlatform = platform;
    state.selectedBed = bedNum;
    draw2D(bedNum);
}

window.draw2DWithPlatform = draw2DWithPlatform;

function draw2D(bedNum) {
    const canvas = $('canvas2d');
    if (!canvas) return;
    
    // Verificar y ajustar tamaño si es necesario
    const container = canvas.parentElement;
    if (container) {
        const rect = container.getBoundingClientRect();
        const targetWidth = Math.max(rect.width - 24, 400);
        if (canvas.width < 400 || Math.abs(canvas.width - targetWidth) > 50) {
            canvas.width = targetWidth;
            canvas.height = 300;  // Más grande
        }
    }
    
    const ctx = canvas.getContext('2d');
    const CW = canvas.width;
    const CH = canvas.height;
    
    // Detectar tema
    const isLightMode = document.documentElement.classList.contains('light-mode');
    const bgColor = isLightMode ? '#e2e8f0' : '#0a1628';
    const textColor = isLightMode ? '#1e293b' : '#6b7280';
    const borderColor = isLightMode ? '#2563eb' : '#3b82f6';
    const gridColor = isLightMode ? 'rgba(37,99,235,0.15)' : 'rgba(59,130,246,0.1)';
    const labelColor = isLightMode ? '#059669' : '#22c55e';
    
    // Limpiar
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, CW, CH);
    
    // Título
    const title = $('canvas2dTitle');
    if (title) title.textContent = `Vista 2D - Cama ${bedNum} (vista desde arriba)`;
    
    if (!state.truck) {
        ctx.fillStyle = textColor;
        ctx.font = '14px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Selecciona un camión', CW/2, CH/2);
        return;
    }
    
    const t = state.truck;
    const truckL = t.length_mm;
    const truckW = t.width_mm;
    
    // Escala
    const margin = 50;
    const scaleX = (CW - margin * 2) / truckL;
    const scaleY = (CH - margin * 2) / truckW;
    const scale = Math.min(scaleX, scaleY);
    
    const offsetX = (CW - truckL * scale) / 2;
    const offsetY = (CH - truckW * scale) / 2;
    
    // Grid
    ctx.strokeStyle = gridColor;
    ctx.lineWidth = 1;
    const gridStep = 1000;
    for (let x = 0; x <= truckL; x += gridStep) {
        ctx.beginPath();
        ctx.moveTo(offsetX + x * scale, offsetY);
        ctx.lineTo(offsetX + x * scale, offsetY + truckW * scale);
        ctx.stroke();
    }
    for (let z = 0; z <= truckW; z += gridStep) {
        ctx.beginPath();
        ctx.moveTo(offsetX, offsetY + z * scale);
        ctx.lineTo(offsetX + truckL * scale, offsetY + z * scale);
        ctx.stroke();
    }
    
    // Borde del camión
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 2;
    ctx.strokeRect(offsetX, offsetY, truckL * scale, truckW * scale);
    
    // ========== ETIQUETA FRENTE (vertical) ==========
    ctx.fillStyle = '#22c55e';
    ctx.font = 'bold 11px sans-serif';
    ctx.save();
    ctx.translate(offsetX - 15, offsetY + truckW * scale / 2);
    ctx.rotate(-Math.PI/2);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('◀ CONCHA', 0, 0);
    ctx.restore();
    
    // ========== ETIQUETAS LADO PILOTO / COPILOTO ==========
    ctx.fillStyle = '#22c55e';
    ctx.font = 'bold 9px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('▲ LADO COPILOTO (DERECHO)', offsetX + truckL * scale / 2, offsetY - 8);
    ctx.fillText('▼ LADO PILOTO (IZQUIERDO)', offsetX + truckL * scale / 2, offsetY + truckW * scale + 20);
    
    // ========== LÍNEA DIVISORIA ZONA A / B (para tráiler/full) ==========
    if (truckL >= 11000) {
        const zoneLimit = 6025;
        const zoneLimitX = offsetX + zoneLimit * scale;
        
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.moveTo(zoneLimitX, offsetY);
        ctx.lineTo(zoneLimitX, offsetY + truckW * scale);
        ctx.stroke();
        ctx.setLineDash([]);
        
        ctx.font = 'bold 8px sans-serif';
        ctx.fillStyle = '#3b82f6';
        ctx.fillText('ZONA A - Delantera (Atrás de la concha)', offsetX + (zoneLimit * scale) / 2, offsetY - 20);
        ctx.fillStyle = '#f59e0b';
        ctx.fillText('ZONA B - Trasera (Sobre los ejes)', zoneLimitX + ((truckL - zoneLimit) * scale) / 2, offsetY - 20);
    }
    
    // Dimensiones
    ctx.fillStyle = '#6b7280';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(`${(truckL/1000).toFixed(1)}m`, offsetX + truckL * scale / 2, offsetY + truckW * scale + 32);
    ctx.save();
    ctx.translate(offsetX - 35, offsetY + truckW * scale / 2);
    ctx.rotate(-Math.PI/2);
    ctx.textBaseline = 'middle';
    ctx.fillText(`${(truckW/1000).toFixed(1)}m`, 0, 0);
    ctx.restore();
    
    // Filtrar paquetes de esta cama y plana
    const currentPlatform = state.selectedPlatform || 1;
    const bedPlacements = state.placements.filter(p => 
        p.bed_number === bedNum && 
        (p.platform || 1) === currentPlatform && 
        p.placed
    );
    
    // Dibujar cada paquete
    bedPlacements.forEach((p, i) => {
        // Buscar material por load_item_id
        let item = state.materials.find(m => m.id === p.load_item_id);
        if (!item && state.materials.length > 0) {
            item = state.materials[0];
        }

        // Color basado en CALIBRE
        const calibre = item?.calibre || 0;
        const color = getColorByCalibre(calibre);

        // Zona B: paquetes con x >= 6025mm en camiones largos
        const isZoneB = truckL >= 11000 && p.x >= 6025;

        // Posición en canvas
        const px = offsetX + p.x * scale;
        const py = offsetY + p.z * scale;
        const pw = p.length_used * scale;
        const ph = p.width_used * scale;

        if (isZoneB) {
            // Zona B: fondo ámbar, borde ámbar intenso
            ctx.fillStyle = '#92400e' + 'dd';
            ctx.fillRect(px, py, pw, ph);
            // Capa de color calibre encima (más transparente)
            ctx.fillStyle = color.hex + '55';
            ctx.fillRect(px, py, pw, ph);
            ctx.strokeStyle = '#f59e0b';
            ctx.lineWidth = 1.5;
        } else {
            // Zona A: color por calibre normal
            ctx.fillStyle = color.hex + 'dd';
            ctx.fillRect(px, py, pw, ph);
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 1;
        }
        ctx.strokeRect(px, py, pw, ph);
        
        // Número del paquete (índice + 1 para coincidir con la lista)
        const pkgNumber = i + 1;
        
        // Dibujar número centrado - tamaño más grande y visible
        ctx.fillStyle = '#fff';
        // Tamaño mínimo 10px, máximo 16px, adaptativo al tamaño del paquete
        const fontSize = Math.min(16, Math.max(10, Math.min(pw, ph) * 0.5));
        ctx.font = `bold ${fontSize}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(pkgNumber, px + pw/2, py + ph/2);
    });
    
    // Info con plana si es Full
    const isDual = (state.truckQuantity || 1) > 1 || state.truck?.is_dual_platform || state.truck?.id === 'FULL' || state.truck?.id === 'TORTON_DOBLE';
    const titleText = isDual 
        ? `Plana ${currentPlatform} - Cama ${bedNum} · ${bedPlacements.length} paquetes`
        : `Cama ${bedNum} · ${bedPlacements.length} paquetes`;
    
    ctx.fillStyle = '#384cff';
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(titleText, 8, 8);
    
    // Calcular altura promedio de esta cama
    if (bedPlacements.length > 0) {
        const avgHeight = bedPlacements.reduce((s, p) => s + p.y, 0) / bedPlacements.length;
        ctx.fillStyle = '#3b82f6';
        ctx.font = '11px sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(`Altura base: ${(avgHeight/1000).toFixed(2)}m`, CW - 10, 10);
    }
    
    // Leyenda por CALIBRE
    if (bedPlacements.length > 0) {
        // Obtener calibres únicos de los paquetes en esta cama
        const calibres = [...new Set(bedPlacements.map(p => {
            const item = state.materials.find(m => m.id === p.load_item_id);
            return parseInt(item?.calibre) || 0;
        }))].sort((a, b) => a - b);
        
        let ly = CH - 12 - calibres.length * 14;
        ctx.font = '9px sans-serif';
        ctx.textAlign = 'left';
        
        calibres.forEach(cal => {
            const color = getColorByCalibre(cal);
            const count = bedPlacements.filter(p => {
                const item = state.materials.find(m => m.id === p.load_item_id);
                return (parseInt(item?.calibre) || 0) === cal;
            }).length;
            
            ctx.fillStyle = color.hex;
            ctx.fillRect(8, ly, 12, 10);
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 0.5;
            ctx.strokeRect(8, ly, 12, 10);
            
            ctx.fillStyle = '#9ca3af';
            const label = cal > 0 ? `Cal. ${cal}: ${count}` : `Sin cal: ${count}`;
            ctx.fillText(label, 24, ly + 8);
            ly += 14;
        });
    }
    
    // Si no hay paquetes en esta cama
    if (bedPlacements.length === 0) {
        ctx.fillStyle = '#6b7280';
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('Sin paquetes en esta cama', CW/2, CH/2);
    }
    
    // Guardar datos para click detection
    canvas._draw2dData = {
        offsetX, offsetY, scale, bedNum, truckL, truckW
    };
}

// ==================== MANUAL MODE - MULTI-SELECTION & DRAG ====================
let selectedPlacements = [];  // Array de placements seleccionados
let selectedPlacement = null; // Para compatibilidad con código existente
const MOVE_STEP = 50;

// Variables para arrastre
let isDragging = false;
let dragStartX = 0;
let dragStartZ = 0;
let dragOffsets = []; // Offsets de cada paquete respecto al punto de inicio

// Variables para selección por área
let isSelecting = false;
let selectionStartX = 0;
let selectionStartY = 0;

function initManualMode() {
    const canvas = $('canvas2d');
    if (!canvas) return;
    
    // Event listeners para el canvas
    canvas.addEventListener('mousedown', handleCanvasMouseDown);
    canvas.addEventListener('mousemove', handleCanvasMouseMove);
    canvas.addEventListener('mouseup', handleCanvasMouseUp);
    canvas.addEventListener('mouseleave', handleCanvasMouseUp);
    
    // Event listener para teclas (flechas y Escape)
    document.addEventListener('keydown', handleKeyboardMove);
    
    // Resize observer para el canvas
    window.addEventListener('resize', () => {
        setTimeout(resizeCanvas2D, 100);
    });
}

function handleCanvasMouseDown(e) {
    if (!state.manualMode) return;
    
    const canvas = e.target;
    const rect = canvas.getBoundingClientRect();
    const scaleFactorX = canvas.width / rect.width;
    const scaleFactorY = canvas.height / rect.height;
    const canvasX = (e.clientX - rect.left) * scaleFactorX;
    const canvasY = (e.clientY - rect.top) * scaleFactorY;
    
    const data = canvas._draw2dData;
    if (!data) return;
    
    // Convertir a coordenadas del camión
    const truckX = (canvasX - data.offsetX) / data.scale;
    const truckZ = (canvasY - data.offsetY) / data.scale;
    
    // Buscar paquete bajo el cursor - FILTRAR POR CAMA Y PLATAFORMA
    const currentPlatform = state.selectedPlatform || 1;
    const bedPlacements = state.placements.filter(p => 
        p.bed_number === data.bedNum && 
        (p.platform || 1) === currentPlatform && 
        p.placed
    );
    let clickedPlacement = null;
    
    for (let i = bedPlacements.length - 1; i >= 0; i--) {
        const p = bedPlacements[i];
        if (truckX >= p.x && truckX <= p.x + p.length_used &&
            truckZ >= p.z && truckZ <= p.z + p.width_used) {
            clickedPlacement = p;
            break;
        }
    }
    
    if (clickedPlacement) {
        // Click sobre un paquete
        if (e.ctrlKey || e.metaKey) {
            // Ctrl+click: agregar/quitar de la selección
            toggleSelection(clickedPlacement);
        } else if (selectedPlacements.some(p => p.id === clickedPlacement.id)) {
            // Click sobre paquete ya seleccionado: iniciar arrastre
            startDragging(truckX, truckZ);
        } else {
            // Click normal: seleccionar solo este paquete
            selectSinglePlacement(clickedPlacement);
            startDragging(truckX, truckZ);
        }
    } else {
        // Click en área vacía
        if (!e.ctrlKey && !e.metaKey) {
            // Limpiar selección y empezar selección por área
            clearSelection();
            isSelecting = true;
            selectionStartX = canvasX;
            selectionStartY = canvasY;
        }
    }
}

function handleCanvasMouseMove(e) {
    if (!state.manualMode) return;
    
    const canvas = e.target;
    const rect = canvas.getBoundingClientRect();
    const scaleFactorX = canvas.width / rect.width;
    const scaleFactorY = canvas.height / rect.height;
    const canvasX = (e.clientX - rect.left) * scaleFactorX;
    const canvasY = (e.clientY - rect.top) * scaleFactorY;
    
    const data = canvas._draw2dData;
    if (!data) return;
    
    if (isDragging && selectedPlacements.length > 0) {
        // Arrastrando paquetes
        const truckX = (canvasX - data.offsetX) / data.scale;
        const truckZ = (canvasY - data.offsetY) / data.scale;
        
        // Calcular desplazamiento
        const deltaX = truckX - dragStartX;
        const deltaZ = truckZ - dragStartZ;
        
        // Actualizar posiciones temporales y redibujar
        drawDragPreview(deltaX, deltaZ);
        
    } else if (isSelecting) {
        // Dibujando rectángulo de selección
        drawSelectionRect(canvasX, canvasY);
    }
    
    // Cambiar cursor si está sobre un paquete seleccionado
    const truckX = (canvasX - data.offsetX) / data.scale;
    const truckZ = (canvasY - data.offsetY) / data.scale;
    
    // Filtrar por cama Y plataforma
    const currentPlatform = state.selectedPlatform || 1;
    const bedPlacements = state.placements.filter(p => 
        p.bed_number === data.bedNum && 
        (p.platform || 1) === currentPlatform && 
        p.placed
    );
    let overSelected = false;
    
    for (const p of bedPlacements) {
        if (truckX >= p.x && truckX <= p.x + p.length_used &&
            truckZ >= p.z && truckZ <= p.z + p.width_used) {
            if (selectedPlacements.some(sp => sp.id === p.id)) {
                overSelected = true;
            }
            break;
        }
    }
    
    canvas.style.cursor = overSelected ? 'move' : (isDragging ? 'grabbing' : 'crosshair');
}

async function handleCanvasMouseUp(e) {
    if (!state.manualMode) return;
    
    const canvas = $('canvas2d');
    const data = canvas?._draw2dData;
    
    if (isDragging && selectedPlacements.length > 0 && data) {
        // Finalizar arrastre
        const rect = canvas.getBoundingClientRect();
        const scaleFactorX = canvas.width / rect.width;
        const scaleFactorY = canvas.height / rect.height;
        const canvasX = (e.clientX - rect.left) * scaleFactorX;
        const canvasY = (e.clientY - rect.top) * scaleFactorY;
        
        const truckX = (canvasX - data.offsetX) / data.scale;
        const truckZ = (canvasY - data.offsetY) / data.scale;
        
        const deltaX = truckX - dragStartX;
        const deltaZ = truckZ - dragStartZ;
        
        // Solo mover si hubo desplazamiento significativo
        if (Math.abs(deltaX) > 5 || Math.abs(deltaZ) > 5) {
            await applyDragMove(deltaX, deltaZ);
        }
        
        isDragging = false;
        dragOffsets = [];
    }
    
    if (isSelecting && data) {
        // Finalizar selección por área
        const rect = canvas.getBoundingClientRect();
        const scaleFactorX = canvas.width / rect.width;
        const scaleFactorY = canvas.height / rect.height;
        const canvasX = (e.clientX - rect.left) * scaleFactorX;
        const canvasY = (e.clientY - rect.top) * scaleFactorY;
        
        selectInRect(selectionStartX, selectionStartY, canvasX, canvasY);
        isSelecting = false;
    }
    
    // Redibujar
    draw2DWithMultiSelection(state.selectedBed);
}

function startDragging(truckX, truckZ) {
    isDragging = true;
    dragStartX = truckX;
    dragStartZ = truckZ;
    
    // Guardar offsets de cada paquete respecto al punto de inicio
    dragOffsets = selectedPlacements.map(p => ({
        id: p.id,
        offsetX: p.x - truckX,
        offsetZ: p.z - truckZ
    }));
}

function drawDragPreview(deltaX, deltaZ) {
    const canvas = $('canvas2d');
    if (!canvas) return;
    
    // Redibujar normal primero
    draw2D(state.selectedBed);
    
    const ctx = canvas.getContext('2d');
    const data = canvas._draw2dData;
    if (!data) return;
    
    // Dibujar posiciones fantasma de los paquetes arrastrados
    ctx.globalAlpha = 0.5;
    selectedPlacements.forEach(p => {
        const newX = p.x + deltaX;
        const newZ = p.z + deltaZ;
        
        const px = data.offsetX + newX * data.scale;
        const py = data.offsetY + newZ * data.scale;
        const pw = p.length_used * data.scale;
        const ph = p.width_used * data.scale;
        
        ctx.fillStyle = '#22c55e';
        ctx.fillRect(px, py, pw, ph);
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.strokeRect(px, py, pw, ph);
    });
    ctx.globalAlpha = 1.0;
    
    // Dibujar selección sobre los originales
    selectedPlacements.forEach(p => {
        const px = data.offsetX + p.x * data.scale;
        const py = data.offsetY + p.z * data.scale;
        const pw = p.length_used * data.scale;
        const ph = p.width_used * data.scale;
        
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 4]);
        ctx.strokeRect(px - 1, py - 1, pw + 2, ph + 2);
        ctx.setLineDash([]);
    });
}

function drawSelectionRect(currentX, currentY) {
    const canvas = $('canvas2d');
    if (!canvas) return;
    
    // Redibujar normal primero
    draw2D(state.selectedBed);
    
    const ctx = canvas.getContext('2d');
    
    // Dibujar rectángulo de selección
    const x = Math.min(selectionStartX, currentX);
    const y = Math.min(selectionStartY, currentY);
    const w = Math.abs(currentX - selectionStartX);
    const h = Math.abs(currentY - selectionStartY);
    
    ctx.fillStyle = 'rgba(34, 197, 94, 0.2)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = '#22c55e';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);
}

function selectInRect(x1, y1, x2, y2) {
    const canvas = $('canvas2d');
    const data = canvas?._draw2dData;
    if (!data) return;
    
    // Convertir a coordenadas del camión
    const minX = (Math.min(x1, x2) - data.offsetX) / data.scale;
    const maxX = (Math.max(x1, x2) - data.offsetX) / data.scale;
    const minZ = (Math.min(y1, y2) - data.offsetY) / data.scale;
    const maxZ = (Math.max(y1, y2) - data.offsetY) / data.scale;
    
    // Seleccionar todos los paquetes que intersectan el rectángulo - FILTRAR POR CAMA Y PLATAFORMA
    const currentPlatform = state.selectedPlatform || 1;
    const bedPlacements = state.placements.filter(p => 
        p.bed_number === data.bedNum && 
        (p.platform || 1) === currentPlatform && 
        p.placed
    );
    
    bedPlacements.forEach(p => {
        // Verificar intersección
        if (p.x + p.length_used > minX && p.x < maxX &&
            p.z + p.width_used > minZ && p.z < maxZ) {
            if (!selectedPlacements.some(sp => sp.id === p.id)) {
                selectedPlacements.push(p);
            }
        }
    });
    
    updateSelectionUI();
}

async function applyDragMove(deltaX, deltaZ) {
    // Redondear a múltiplos de 10mm
    deltaX = Math.round(deltaX / 10) * 10;
    deltaZ = Math.round(deltaZ / 10) * 10;

    if (deltaX === 0 && deltaZ === 0) return;

    // Modo manual: sin restricciones — el experto decide la posición final.
    // No se validan colisiones, límites ni compatibilidad de altura.

    // Aplicar movimiento a todos
    try {
        for (const p of selectedPlacements) {
            const newX = p.x + deltaX;
            const newZ = p.z + deltaZ;

            await api.updatePlacement(p.id, { x: newX, z: newZ });

            // Actualizar localmente
            p.x = newX;
            p.z = newZ;

            // Recalcular bed_zone según la nueva posición X (solo para tráiler/full >= 11m)
            if (state.truck && state.truck.length_mm >= 11000) {
                const pkgCenterX = p.x + p.length_used / 2;
                p.bed_zone = pkgCenterX < 6025 ? 'A' : 'B';
            }
        }

        if (state.load) state.load.status = 'MANUAL';
        toast(`${selectedPlacements.length} paquete(s) movido(s)`, 'success');
        triggerAutoLearn();

        // Recalcular altura
        recalculateTotalHeight();

        render3D();
        draw2DWithMultiSelection(state.selectedBed);
        updateSelectionUI();

        // Para camiones largos: si la zona del tab activo ya no tiene paquetes
        // en la cama seleccionada, actualizar selectedZone al que sí tiene
        if (state.truck && state.truck.length_mm >= 11000 && state.selectedBed) {
            const bedPkgs = state.placements.filter(p =>
                p.bed_number === state.selectedBed &&
                (p.platform || 1) === (state.selectedPlatform || 1) &&
                p.placed
            );
            const zoneACnt = bedPkgs.filter(p => (p.bed_zone || (p.x < 6025 ? 'A' : 'B')) === 'A').length;
            const zoneBCnt = bedPkgs.length - zoneACnt;
            if (state.selectedZone === 'A' && zoneACnt === 0 && zoneBCnt > 0) {
                state.selectedZone = 'B';
            } else if (state.selectedZone === 'B' && zoneBCnt === 0 && zoneACnt > 0) {
                state.selectedZone = 'A';
            }
        }

        // Actualizar tabs de camas y distribución (reflejan zonas A/B recalculadas)
        renderBedsTabs();
        renderBedsDistribution();
        renderBedMaterialsList(state.selectedBed, state.selectedPlatform || 1);
        
    } catch (err) {
        console.error('Error moviendo paquetes:', err);
        toast('Error al mover: ' + err.message, 'error');
    }
}

function selectSinglePlacement(p) {
    selectedPlacements = [p];
    selectedPlacement = p; // Compatibilidad
    updateSelectionUI();
    draw2DWithMultiSelection(state.selectedBed);
    // Resaltar en 3D - usar highlightMultipleIn3D para consistencia
    highlightMultipleIn3D();
}

function toggleSelection(p) {
    const idx = selectedPlacements.findIndex(sp => sp.id === p.id);
    if (idx >= 0) {
        selectedPlacements.splice(idx, 1);
    } else {
        selectedPlacements.push(p);
    }
    selectedPlacement = selectedPlacements[0] || null;
    updateSelectionUI();
    draw2DWithMultiSelection(state.selectedBed);
    // Resaltar en 3D - usar highlightMultipleIn3D para todos los seleccionados
    highlightMultipleIn3D();
}

function clearSelection() {
    selectedPlacements = [];
    selectedPlacement = null;
    updateSelectionUI();
    draw2D(state.selectedBed);
    // Limpiar resaltado 3D - resetear todos los emissive
    highlightMultipleIn3D();
}

function updateSelectionUI() {
    const infoDiv = $('selectedPkgInfo');
    const controlsDiv = $('manualEditControls');
    const selectAllSection = $('selectAllSection');
    const swapSection = $('swapSection');
    const btnApplyEdit = $('btnApplyEdit');
    
    // Mostrar botón de seleccionar todos cuando estamos en modo manual
    if (selectAllSection) {
        selectAllSection.style.display = state.manualMode ? 'block' : 'none';
    }
    
    if (selectedPlacements.length === 0) {
        if (infoDiv) {
            infoDiv.innerHTML = 'Selecciona paquetes en la vista 2D<br><small>Ctrl+click para selección múltiple<br>Arrastra para mover</small>';
            infoDiv.classList.remove('active');
        }
        if (controlsDiv) controlsDiv.style.display = 'none';
        return;
    }
    
    if (infoDiv) {
        if (selectedPlacements.length === 1) {
            const p = selectedPlacements[0];
            const item = state.materials.find(m => m.id === p.load_item_id);
            
            // Calcular el índice visual (posición en la cama)
            const currentBed = p.bed_number;
            const currentPlatform = p.platform || 1;
            const allBedPkgs = state.placements.filter(pkg => 
                pkg.bed_number === currentBed && 
                (pkg.platform || 1) === currentPlatform &&
                pkg.placed
            ).sort((a, b) => {
                if (a.z !== b.z) return a.z - b.z;
                return a.x - b.x;
            });
            const visualIndex = allBedPkgs.findIndex(pkg => pkg.id === p.id) + 1;
            
            infoDiv.innerHTML = `
                <div class="pkg-label">📦 Paquete #${visualIndex}</div>
                <div class="pkg-details">
                    <div>Material: <b>${item?.sap_code || 'N/A'}</b></div>
                    <div>Cama: <b>${p.bed_number}</b></div>
                    <div>Posición: <b>X:${p.x.toFixed(0)}, Z:${p.z.toFixed(0)}</b></div>
                    <div>Tamaño: <b>${p.length_used}×${p.width_used}×${p.height_used}mm</b></div>
                </div>
                <div class="move-hint">⌨️ Flechas para mover | Arrastra con mouse</div>
            `;
            
            // Mostrar sección de intercambio solo para 1 paquete
            if (swapSection) swapSection.style.display = 'block';
            if (btnApplyEdit) btnApplyEdit.textContent = '✓ Mover';
        } else {
            infoDiv.innerHTML = `
                <div class="pkg-label">📦 ${selectedPlacements.length} paquetes seleccionados</div>
                <div class="pkg-details">
                    <div>Selecciona cama destino y presiona "Mover todos"</div>
                    <div>Ctrl+click para agregar/quitar</div>
                </div>
                <div class="move-hint">⌨️ Flechas para mover todos juntos</div>
            `;
            
            // Ocultar sección de intercambio para múltiples
            if (swapSection) swapSection.style.display = 'none';
            if (btnApplyEdit) btnApplyEdit.textContent = `✓ Mover todos (${selectedPlacements.length})`;
        }
        infoDiv.classList.add('active');
    }
    
    if (controlsDiv) {
        controlsDiv.style.display = 'block';
        
        // Limpiar mensaje de validación previo
        const validationDiv = $('editValidation');
        if (validationDiv) {
            validationDiv.style.display = 'none';
        }
        
        // Llenar selector de camas - usar el número real de camas existentes + opción de nueva
        const bedSelect = $('editBedNum');
        if (bedSelect && selectedPlacements.length > 0) {
            // Encontrar el número máximo de cama en los placements actuales
            const currentPlatform = selectedPlacements[0].platform || 1;
            const bedsInPlatform = state.placements
                .filter(p => (p.platform || 1) === currentPlatform && p.placed)
                .map(p => p.bed_number);
            const maxExistingBed = bedsInPlatform.length > 0 ? Math.max(...bedsInPlatform) : 1;
            
            // Usar el mayor entre beds_count y las camas realmente existentes + 1 para crear nueva
            const numBeds = Math.max(state.truck?.beds_count || 6, maxExistingBed + 1);
            const currentBed = selectedPlacements[0].bed_number;
            
            bedSelect.innerHTML = '';
            for (let i = 1; i <= numBeds; i++) {
                const opt = document.createElement('option');
                opt.value = i;
                opt.textContent = i > maxExistingBed ? `Cama ${i} (nueva)` : `Cama ${i}`;
                if (i === currentBed) opt.selected = true;
                bedSelect.appendChild(opt);
            }
        }
        
        // Llenar selector de intercambio de paquetes (solo si hay 1 seleccionado)
        const swapSelect = $('swapWithPackage');
        if (swapSelect) {
            swapSelect.innerHTML = '<option value="">— Seleccionar —</option>';
            
            if (selectedPlacements.length === 1) {
                const currentBed = selectedPlacements[0].bed_number;
                const currentPlatform = selectedPlacements[0].platform || 1;
                const currentId = selectedPlacements[0].id;
                
                // Obtener paquetes en la misma cama y plana, ordenados por posición
                const sameBedPkgs = state.placements.filter(p => 
                    p.bed_number === currentBed && 
                    (p.platform || 1) === currentPlatform &&
                    p.id !== currentId &&
                    p.placed
                ).sort((a, b) => {
                    // Ordenar por Z (de arriba a abajo) y luego por X
                    if (a.z !== b.z) return a.z - b.z;
                    return a.x - b.x;
                });
                
                // Crear un mapa de índices visuales (como se ven en la vista 2D)
                const allBedPkgs = state.placements.filter(p => 
                    p.bed_number === currentBed && 
                    (p.platform || 1) === currentPlatform &&
                    p.placed
                ).sort((a, b) => {
                    if (a.z !== b.z) return a.z - b.z;
                    return a.x - b.x;
                });
                
                sameBedPkgs.forEach(p => {
                    const item = state.materials.find(m => m.id === p.load_item_id);
                    // Encontrar el índice visual (posición en la cama)
                    const visualIndex = allBedPkgs.findIndex(pkg => pkg.id === p.id) + 1;
                    const opt = document.createElement('option');
                    opt.value = p.id;
                    opt.textContent = `#${visualIndex} - ${item?.sap_code || 'N/A'}`;
                    swapSelect.appendChild(opt);
                });
            }
        }
        
        // Mostrar/ocultar selector de plana según el tipo de camión
        const platformSelector = $('platformSelector');
        const platformSelect = $('editPlatformNum');
        const isDual = (state.truckQuantity || 1) > 1 || state.truck?.is_dual_platform || state.truck?.id === 'FULL' || state.truck?.id === 'TORTON_DOBLE';
        
        if (platformSelector && platformSelect) {
            if (isDual) {
                platformSelector.style.display = 'block';
                const currentPlatform = selectedPlacements[0]?.platform || 1;
                platformSelect.value = currentPlatform;
            } else {
                platformSelector.style.display = 'none';
            }
        }
    }
    
    highlightMultipleIn3D();
}

function draw2DWithMultiSelection(bedNum) {
    // Primero dibuja normal
    draw2D(bedNum);
    
    if (selectedPlacements.length === 0) return;
    
    const canvas = $('canvas2d');
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    const data = canvas._draw2dData;
    if (!data) return;
    
    // Resaltar todos los seleccionados
    selectedPlacements.forEach(p => {
        if (p.bed_number !== bedNum) return;
        
        const px = data.offsetX + p.x * data.scale;
        const py = data.offsetY + p.z * data.scale;
        const pw = p.length_used * data.scale;
        const ph = p.width_used * data.scale;
        
        // Borde de selección
        ctx.strokeStyle = '#22c55e';
        ctx.lineWidth = 3;
        ctx.setLineDash([5, 3]);
        ctx.strokeRect(px - 2, py - 2, pw + 4, ph + 4);
        ctx.setLineDash([]);
    });
}

function highlightMultipleIn3D() {
    if (!packagesGroup) return;
    
    // Resetear todos los paquetes
    packagesGroup.children.forEach(child => {
        if (child.isMesh && child.material) {
            child.material.emissive?.setHex(0x000000);
        }
    });
    
    // Obtener configuración del camión para calcular offsets
    const t = state.truck;
    if (!t) return;
    
    const L = t.length_mm;
    const truckQuantity = state.truckQuantity || 1;
    const isDualBase = t.is_dual_platform || t.id === 'FULL' || t.id === 'TORTON_DOBLE';
    const isDual = truckQuantity > 1 || isDualBase;
    const platformGap = isDual ? (t.platform_gap_mm || 500) : 0;
    
    const FLOOR_HEIGHT = 50;
    const GROUND_CLEARANCE = 100;
    
    // Resaltar los seleccionados
    selectedPlacements.forEach(p => {
        // Calcular offset de la plataforma
        const platform = p.platform || 1;
        const offsetX = (platform - 1) * (L + platformGap);
        
        // Posición esperada del mesh
        const expectedX = offsetX + p.x + p.length_used / 2;
        const expectedY = FLOOR_HEIGHT + GROUND_CLEARANCE + p.y + p.height_used / 2;
        const expectedZ = p.z + p.width_used / 2;
        
        const tolerance = 200;  // Tolerancia amplia para mejor detección
        
        packagesGroup.children.forEach(child => {
            if (child.isMesh && child.material) {
                const pos = child.position;
                if (Math.abs(pos.x - expectedX) < tolerance &&
                    Math.abs(pos.y - expectedY) < tolerance &&
                    Math.abs(pos.z - expectedZ) < tolerance) {
                    // Resaltar con color verde brillante
                    child.material.emissive?.setHex(0x22c55e);
                }
            }
        });
    });
}

async function handleKeyboardMove(e) {
    // Solo si hay paquetes seleccionados y estamos en modo manual
    if (selectedPlacements.length === 0 || !state.manualMode) return;
    
    // Escape para deseleccionar
    if (e.key === 'Escape') {
        clearSelection();
        return;
    }
    
    // Solo procesar flechas
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    
    e.preventDefault();
    
    let deltaX = 0;
    let deltaZ = 0;
    
    switch (e.key) {
        case 'ArrowLeft': deltaX = -MOVE_STEP; break;
        case 'ArrowRight': deltaX = MOVE_STEP; break;
        case 'ArrowUp': deltaZ = -MOVE_STEP; break;
        case 'ArrowDown': deltaZ = MOVE_STEP; break;
    }
    
    await applyDragMove(deltaX, deltaZ);
}

function showValidationMessage(message, isSuccess) {
    const validationDiv = $('editValidation');
    if (validationDiv) {
        validationDiv.style.display = 'block';
        validationDiv.className = 'edit-validation ' + (isSuccess ? 'success' : 'error');
        validationDiv.textContent = message;
        
        // Auto-ocultar después de 2 segundos
        setTimeout(() => {
            if (validationDiv.textContent === message) {
                validationDiv.style.display = 'none';
            }
        }, 2000);
    }
}

function updateSelectedPkgInfo() {
    updateSelectionUI();
}

function selectPlacement(p) {
    selectSinglePlacement(p);
}

function deselectPlacement() {
    clearSelection();
}

function draw2DWithSelection(bedNum) {
    draw2DWithMultiSelection(bedNum);
}

function highlightIn3D(p) {
    highlightMultipleIn3D();
}

const MAX_HEIGHT_DIFF = 20; // mm — tolerancia de altura entre paquetes de la misma cama

function validatePlacementEdit(newX, newZ, newBed, length, width, excludeId = null, platform = null, heightUsed = null) {
    // En modo manual el experto decide — sin restricciones de altura ni calibre
    if (state.manualMode) return { valid: true, message: 'Posición válida ✓' };

    if (!state.truck) return { valid: false, message: 'No hay camión seleccionado' };

    const maxL = state.truck.length_mm;
    const maxW = state.truck.width_mm;

    // Usar la plana proporcionada o la seleccionada actualmente
    const currentPlatform = platform || state.selectedPlatform || 1;

    // Verificar límites
    if (newX < 0) return { valid: false, message: 'Posición X fuera del límite izquierdo' };
    if (newZ < 0) return { valid: false, message: 'Posición Z fuera del límite superior' };
    if (newX + length > maxL) return { valid: false, message: `Excede largo del camión (máx: ${maxL}mm)` };
    if (newZ + width > maxW) return { valid: false, message: `Excede ancho del camión (máx: ${maxW}mm)` };

    // IDs a excluir (el propio paquete y todos los seleccionados que se mueven juntos)
    const excludeIds = new Set();
    if (excludeId) excludeIds.add(excludeId);
    selectedPlacements.forEach(p => excludeIds.add(p.id));

    // Verificar colisiones y compatibilidad de altura con otros paquetes en la misma cama Y PLANA
    const otherPlacements = state.placements.filter(p =>
        (p.platform || 1) === currentPlatform &&  // MISMA PLANA
        p.bed_number === newBed &&
        p.placed &&
        !excludeIds.has(p.id)
    );

    for (const other of otherPlacements) {
        // Verificar superposición
        if (newX < other.x + other.length_used &&
            newX + length > other.x &&
            newZ < other.z + other.width_used &&
            newZ + width > other.z) {
            return { valid: false, message: `Colisión con otro paquete` };
        }
    }

    // Verificar compatibilidad de altura con la cama destino (solo al mover a una cama diferente)
    // Si el paquete ya está en la cama destino (drag dentro de la misma cama), omitir este chequeo
    const draggingPkg = excludeId ? state.placements.find(p => p.id === excludeId) : null;
    const isSameBedDrag = draggingPkg && draggingPkg.bed_number === newBed;
    if (!isSameBedDrag && heightUsed !== null && otherPlacements.length > 0) {
        const bedHeights = otherPlacements.map(p => p.height_used);
        const minBedH = Math.min(...bedHeights);
        const maxBedH = Math.max(...bedHeights);
        if (Math.abs(heightUsed - minBedH) > MAX_HEIGHT_DIFF || Math.abs(heightUsed - maxBedH) > MAX_HEIGHT_DIFF) {
            return { valid: false, message: `Altura incompatible con cama ${newBed} (dif. máx ±${MAX_HEIGHT_DIFF}mm)` };
        }
    }

    return { valid: true, message: 'Posición válida ✓' };
}

async function applyPlacementEdit() {
    // Verificar que hay paquetes seleccionados
    if (selectedPlacements.length === 0) {
        showValidationMessage('No hay paquetes seleccionados', false);
        return;
    }
    
    let newBed = parseInt($('editBedNum')?.value) || selectedPlacements[0].bed_number;
    const isDual = (state.truckQuantity || 1) > 1 || state.truck?.is_dual_platform || state.truck?.id === 'FULL' || state.truck?.id === 'TORTON_DOBLE';
    const newPlatform = isDual ? (parseInt($('editPlatformNum')?.value) || 1) : 1;
    
    // Verificar si todos los paquetes ya están en el destino
    const allAlreadyThere = selectedPlacements.every(p => 
        p.bed_number === newBed && (p.platform || 1) === newPlatform
    );
    
    if (allAlreadyThere) {
        showValidationMessage('Los paquetes ya están en esta ubicación', false);
        return;
    }
    
    // Mover todos los paquetes seleccionados
    let movedCount = 0;
    let errorCount = 0;

    // Ordenar los paquetes seleccionados para colocarlos en orden
    const sortedPlacements = [...selectedPlacements].sort((a, b) => {
        if (a.z !== b.z) return a.z - b.z;
        return a.x - b.x;
    });

    // Calcular nueva Y basada en la cama destino
    // Primero ver si la cama destino ya tiene paquetes con Y definida (excluir los que se mueven)
    const movingIds = new Set(sortedPlacements.map(p => p.id));
    const existingInDest = state.placements.filter(p =>
        (p.platform || 1) === newPlatform &&
        p.bed_number === newBed &&
        p.placed &&
        !movingIds.has(p.id)
    );
    let newY = 0;
    if (existingInDest.length > 0) {
        // Respetar la cama formada: usar la misma Y base de los paquetes ya colocados
        newY = existingInDest[0].y;
    } else if (newBed > 1) {
        // Cama nueva: calcular desde la parte superior de las camas inferiores
        const lowerPlacements = state.placements.filter(p =>
            (p.platform || 1) === newPlatform &&
            p.bed_number < newBed &&
            p.placed &&
            !movingIds.has(p.id)
        );
        if (lowerPlacements.length > 0) {
            const maxY = Math.max(...lowerPlacements.map(p => p.y + p.height_used));
            newY = maxY + (state.gapBetweenBeds || 100);
        }
    }
    
    // Modo manual: sin restricción de altura al cambiar camas.
    // El experto decide qué paquetes van en qué cama.

    for (const placement of sortedPlacements) {
        // Saltar si ya está en el destino
        if (placement.bed_number === newBed && (placement.platform || 1) === newPlatform) {
            continue;
        }

        // Modo manual: conservar la posición X/Z original del paquete en la nueva cama.
        // El experto decide la distribución — no forzamos reubicación automática.
        const newPosition = state.manualMode
            ? { x: placement.x, z: placement.z }
            : (findAvailablePositionForMultiple(newPlatform, newBed, placement.length_used, placement.width_used, sortedPlacements.map(p => p.id)) || { x: 0, z: 0 });
        
        try {
            // Actualizar en servidor
            await api.updatePlacement(placement.id, {
                platform: newPlatform,
                bed_number: newBed,
                x: newPosition.x,
                y: newY,
                z: newPosition.z
            });
            
            // Actualizar localmente
            placement.platform = newPlatform;
            placement.bed_number = newBed;
            placement.x = newPosition.x;
            placement.y = newY;
            placement.z = newPosition.z;

            // Recalcular bed_zone para tráiler/full
            if (state.truck && state.truck.length_mm >= 11000) {
                const pkgCenterX = placement.x + placement.length_used / 2;
                placement.bed_zone = pkgCenterX < 6025 ? 'A' : 'B';
            }

            movedCount++;
        } catch (e) {
            console.error('Error moviendo paquete:', e);
            errorCount++;
        }
    }
    
    // Actualizar estado de la carga a MANUAL
    if (state.load && movedCount > 0) {
        state.load.status = 'MANUAL';
        triggerAutoLearn();
    }

    // Mensaje de resultado
    const platLabel = isDual ? `Plana ${newPlatform} - ` : '';
    if (errorCount === 0) {
        showValidationMessage(`${movedCount} paquete(s) movido(s) a ${platLabel}Cama ${newBed}`, true);
        toast(`${movedCount} paquete(s) movido(s) correctamente`, 'success');
    } else {
        showValidationMessage(`${movedCount} movido(s), ${errorCount} sin espacio`, movedCount > 0);
        toast(`${movedCount} movido(s), ${errorCount} sin espacio`, 'warning');
    }
    
    // Cambiar a la cama/plana donde se movió
    state.selectedPlatform = newPlatform;
    state.selectedBed = newBed;

    // Para camiones largos: determinar zona de la cama destino y actualizar selectedZone
    if (state.truck && state.truck.length_mm >= 11000 && movedCount > 0) {
        const destPkgs = state.placements.filter(p =>
            p.bed_number === newBed &&
            (p.platform || 1) === newPlatform &&
            p.placed
        );
        const zoneACnt = destPkgs.filter(p => {
            const zone = p.bed_zone || (p.x < 6025 ? 'A' : 'B');
            return zone === 'A';
        }).length;
        const zoneBCnt = destPkgs.length - zoneACnt;
        state.selectedZone = zoneBCnt > zoneACnt ? 'B' : 'A';
    }

    renderBedsTabs();

    // Actualizar distribución por camas
    renderBedsDistribution();

    // Recalcular altura total después de mover
    recalculateTotalHeight();

    // Redibujar
    render3D();
    draw2DWithMultiSelection(state.selectedBed);
    updateSelectionUI();
    renderBedMaterialsList(state.selectedBed, state.selectedPlatform || 1);

    // Actualizar selector de cama
    const bedSelect = $('editBedNum');
    if (bedSelect) bedSelect.value = newBed;
}

// Función para buscar posición disponible excluyendo múltiples IDs
function findAvailablePositionForMultiple(platform, bedNum, length, width, excludeIds) {
    if (!state.truck) return null;
    
    const maxL = state.truck.length_mm;
    const maxW = state.truck.width_mm;
    const GAP = 10; // Gap entre paquetes
    
    // Convertir a Set para búsqueda rápida
    const excludeSet = new Set(excludeIds || []);
    
    // Obtener paquetes existentes en esa cama Y plana, excluyendo los que se mueven
    const existingPlacements = state.placements.filter(p => 
        (p.platform || 1) === platform &&
        p.bed_number === bedNum && 
        p.placed && 
        !excludeSet.has(p.id)
    );
    
    // Generar posiciones candidatas
    const candidates = [{x: 0, z: 0}];
    
    // Agregar posiciones al lado y debajo de cada paquete existente
    existingPlacements.forEach(p => {
        candidates.push({x: p.x + p.length_used + GAP, z: p.z}); // A la derecha
        candidates.push({x: p.x, z: p.z + p.width_used + GAP}); // Abajo
        candidates.push({x: 0, z: p.z + p.width_used + GAP}); // Nueva fila
    });
    
    // También considerar posiciones después de los paquetes ya movidos en esta operación
    // (los que tienen bed_number === bedNum pero están en excludeIds)
    state.placements.filter(p => 
        (p.platform || 1) === platform &&
        p.bed_number === bedNum && 
        p.placed && 
        excludeSet.has(p.id)
    ).forEach(p => {
        candidates.push({x: p.x + p.length_used + GAP, z: p.z});
        candidates.push({x: p.x, z: p.z + p.width_used + GAP});
    });
    
    // Ordenar candidatos para llenar de forma ordenada (primero Z, luego X)
    candidates.sort((a, b) => {
        if (a.z !== b.z) return a.z - b.z;
        return a.x - b.x;
    });
    
    // Probar cada posición candidata
    for (const pos of candidates) {
        // Verificar que cabe en el camión
        if (pos.x + length > maxL) continue;
        if (pos.z + width > maxW) continue;
        if (pos.x < 0 || pos.z < 0) continue;
        
        // Verificar colisiones con paquetes existentes (no los que se mueven)
        let collision = false;
        for (const other of existingPlacements) {
            if (pos.x < other.x + other.length_used &&
                pos.x + length > other.x &&
                pos.z < other.z + other.width_used &&
                pos.z + width > other.z) {
                collision = true;
                break;
            }
        }
        
        // También verificar colisiones con los paquetes ya movidos en esta operación
        if (!collision) {
            for (const other of state.placements.filter(p => 
                (p.platform || 1) === platform &&
                p.bed_number === bedNum && 
                p.placed && 
                excludeSet.has(p.id)
            )) {
                if (pos.x < other.x + other.length_used &&
                    pos.x + length > other.x &&
                    pos.z < other.z + other.width_used &&
                    pos.z + width > other.z) {
                    collision = true;
                    break;
                }
            }
        }
        
        if (!collision) {
            return pos;
        }
    }
    
    return null; // No se encontró espacio
}

// Buscar posición disponible en una cama
function findAvailablePosition(bedNum, length, width) {
    // Usar la plana actual si está disponible
    const currentPlatform = state.selectedPlatform || 1;
    return findAvailablePositionInPlatform(currentPlatform, bedNum, length, width);
}

function findAvailablePositionInPlatform(platform, bedNum, length, width) {
    if (!state.truck) return null;
    
    const maxL = state.truck.length_mm;
    const maxW = state.truck.width_mm;
    const GAP = 10; // Gap entre paquetes
    
    // Obtener paquetes existentes en esa cama Y plana
    const existingPlacements = state.placements.filter(p => 
        (p.platform || 1) === platform &&
        p.bed_number === bedNum && 
        p.placed && 
        p.id !== selectedPlacement?.id
    );
    
    // Generar posiciones candidatas
    const candidates = [{x: 0, z: 0}];
    
    // Agregar posiciones al lado y debajo de cada paquete existente
    existingPlacements.forEach(p => {
        candidates.push({x: p.x + p.length_used + GAP, z: p.z}); // A la derecha
        candidates.push({x: p.x, z: p.z + p.width_used + GAP}); // Abajo
        candidates.push({x: 0, z: p.z + p.width_used + GAP}); // Nueva fila
    });
    
    // Probar cada posición candidata
    for (const pos of candidates) {
        // Verificar que cabe en el camión
        if (pos.x + length > maxL) continue;
        if (pos.z + width > maxW) continue;
        if (pos.x < 0 || pos.z < 0) continue;
        
        // Verificar colisiones
        let collision = false;
        for (const other of existingPlacements) {
            if (pos.x < other.x + other.length_used &&
                pos.x + length > other.x &&
                pos.z < other.z + other.width_used &&
                pos.z + width > other.z) {
                collision = true;
                break;
            }
        }
        
        if (!collision) {
            return pos;
        }
    }
    
    return null; // No se encontró espacio
}

async function rotatePlacement() {
    // Rotar sobre el eje longitudinal (eje X/largo)
    // El paquete "rueda" sobre sí mismo: intercambia ANCHO ↔ ALTO
    // El largo (6000mm) se mantiene igual, sigue apuntando al frente
    if (selectedPlacements.length === 0) return;
    
    const p = selectedPlacements[0]; // Rotar el primero seleccionado
    
    // Intercambiar width (Z) y height (Y) - el paquete rueda sobre su eje largo
    // El largo (length_used) NO CAMBIA
    const newLength = p.length_used;  // Se mantiene igual (6000mm)
    const newWidth = p.height_used;   // El alto pasa a ser el ancho
    const newHeight = p.width_used;   // El ancho pasa a ser el alto
    
    const validationDiv = $('editValidation');
    
    if (!state.truck) {
        if (validationDiv) {
            validationDiv.style.display = 'block';
            validationDiv.className = 'edit-validation error';
            validationDiv.textContent = 'No hay camión seleccionado';
        }
        return;
    }
    
    const maxW = state.truck.width_mm;
    const maxH = state.truck.height_mm;
    
    // Modo manual: sin restricciones — el experto decide si rotar sin importar colisiones ni límites.
    if (!state.manualMode) {
        // Verificar que el nuevo ancho cabe en el camión
        if (newWidth > maxW) {
            if (validationDiv) {
                validationDiv.style.display = 'block';
                validationDiv.className = 'edit-validation error';
                validationDiv.textContent = `No cabe: ancho rotado (${newWidth}mm) > ancho camión (${maxW}mm)`;
            }
            return;
        }

        // Verificar que la nueva altura cabe
        const bedBaseY = p.y || 0;
        if (bedBaseY + newHeight > maxH) {
            if (validationDiv) {
                validationDiv.style.display = 'block';
                validationDiv.className = 'edit-validation error';
                validationDiv.textContent = `No cabe: altura rotada (${newHeight}mm) excede altura disponible`;
            }
            return;
        }

        // Validar posición y colisiones con el nuevo ancho
        const validation = validatePlacementEdit(
            p.x,
            p.z,
            p.bed_number,
            newLength,
            newWidth,
            p.id,
            p.platform || state.selectedPlatform || 1,
            newHeight
        );

        if (!validation.valid) {
            if (validationDiv) {
                validationDiv.style.display = 'block';
                validationDiv.className = 'edit-validation error';
                validationDiv.textContent = validation.message;
            }
            return;
        }
    }
    
    try {
        await api.updatePlacement(p.id, {
            rotated: !p.rotated,
            length_used: newLength,
            width_used: newWidth,
            height_used: newHeight
        });
        
        // Actualizar localmente
        p.length_used = newLength;
        p.width_used = newWidth;
        p.height_used = newHeight;
        p.rotated = !p.rotated;
        
        if (state.load) state.load.status = 'MANUAL';
        
        if (validationDiv) {
            validationDiv.style.display = 'block';
            validationDiv.className = 'edit-validation success';
            validationDiv.textContent = `Rotado ✓ (${newWidth}×${newHeight}mm)`;
        }
        
        toast('Paquete rotado', 'success');
        
        render3D();
        draw2DWithMultiSelection(state.selectedBed);
        updateSelectionUI();
        
    } catch (e) {
        console.error('Error rotando:', e);
        toast('Error al rotar: ' + e.message, 'error');
    }
}

// Rotación Y es lo mismo - girar 90° sobre el eje Y (intercambia X y Z)
async function rotateYPlacement() {
    // Es la misma operación que rotatePlacement
    await rotatePlacement();
}

function setManualMode(enabled) {
    state.manualMode = enabled;
    
    const canvas2dWrap = document.querySelector('.canvas-2d-wrap');
    const editPanel = $('manualEditPanel');
    
    if (canvas2dWrap) {
        canvas2dWrap.classList.toggle('manual-mode', enabled);
    }
    
    if (editPanel) {
        editPanel.style.display = enabled ? 'block' : 'none';
    }
    
    if (!enabled) {
        deselectPlacement();
    }
}

// Intercambiar posiciones entre dos paquetes
async function swapPackagePositions() {
    if (selectedPlacements.length !== 1) {
        toast('Selecciona un solo paquete para intercambiar', 'error');
        return;
    }
    
    const swapSelect = $('swapWithPackage');
    const targetId = parseInt(swapSelect?.value);
    
    if (!targetId) {
        toast('Selecciona un paquete con el cual intercambiar', 'error');
        return;
    }
    
    const pkg1 = selectedPlacements[0];
    const pkg2 = state.placements.find(p => p.id === targetId);
    
    if (!pkg2) {
        toast('Paquete destino no encontrado', 'error');
        return;
    }
    
    // Calcular índices visuales antes del cambio
    const currentBed = pkg1.bed_number;
    const currentPlatform = pkg1.platform || 1;
    const allBedPkgs = state.placements.filter(p => 
        p.bed_number === currentBed && 
        (p.platform || 1) === currentPlatform &&
        p.placed
    ).sort((a, b) => {
        if (a.z !== b.z) return a.z - b.z;
        return a.x - b.x;
    });
    const visualIndex1 = allBedPkgs.findIndex(p => p.id === pkg1.id) + 1;
    const visualIndex2 = allBedPkgs.findIndex(p => p.id === pkg2.id) + 1;
    
    // Guardar posiciones y dimensiones originales
    const pos1 = { x: pkg1.x, z: pkg1.z, length: pkg1.length_used, width: pkg1.width_used };
    const pos2 = { x: pkg2.x, z: pkg2.z, length: pkg2.length_used, width: pkg2.width_used };
    
    // Intercambiar posiciones - ajustar para que no se sobrepongan
    // El paquete 1 va a la posición del paquete 2, pero ajustado a su tamaño
    // El paquete 2 va a la posición del paquete 1, pero ajustado a su tamaño
    
    // Estrategia: Mantener la misma posición inicial (esquina) pero intercambiar el orden
    pkg1.x = pos2.x;
    pkg1.z = pos2.z;
    pkg2.x = pos1.x;
    pkg2.z = pos1.z;
    
    // Verificar y corregir solapamientos después del intercambio
    // Reacomodar todos los paquetes de la cama para evitar solapamientos
    repackBed(currentBed, currentPlatform);
    
    // Si hay loadId, guardar en BD todos los cambios
    if (state.loadId) {
        try {
            // Guardar las nuevas posiciones de todos los paquetes de la cama
            const bedPkgs = state.placements.filter(p => 
                p.bed_number === currentBed && 
                (p.platform || 1) === currentPlatform &&
                p.placed
            );
            for (const pkg of bedPkgs) {
                await api.updatePlacement(state.loadId, pkg.id, { x: pkg.x, z: pkg.z });
            }
            state.load.status = 'MANUAL';
        } catch (e) {
            console.error('Error guardando intercambio:', e);
        }
    }
    
    // Actualizar visualizaciones
    render3D();
    draw2DWithMultiSelection(state.selectedBed);
    updateSelectionUI();
    
    toast(`Posiciones intercambiadas: #${visualIndex1} ↔ #${visualIndex2}`, 'success');
}

// Función para reacomodar los paquetes de una cama sin solapamientos
function repackBed(bedNum, platform = 1) {
    const truckWidth = state.truck?.width_mm || 2400;
    const truckLength = state.truck?.length_mm || 7500;
    
    // Obtener paquetes de la cama ordenados por Z (de adelante hacia atrás) y X
    const bedPkgs = state.placements.filter(p => 
        p.bed_number === bedNum && 
        (p.platform || 1) === platform &&
        p.placed
    ).sort((a, b) => {
        if (a.z !== b.z) return a.z - b.z;
        return a.x - b.x;
    });
    
    if (bedPkgs.length === 0) return;
    
    // Algoritmo simple de empaquetado por filas
    let currentZ = 0;
    let currentX = 0;
    let rowHeight = 0; // Máximo ancho (width) en la fila actual
    
    bedPkgs.forEach(pkg => {
        // Si el paquete no cabe en X, pasar a la siguiente fila
        if (currentX + pkg.length_used > truckLength) {
            currentX = 0;
            currentZ += rowHeight;
            rowHeight = 0;
        }
        
        // Verificar que cabe en Z
        if (currentZ + pkg.width_used > truckWidth) {
            // No cabe, dejarlo donde está (o ponerlo al inicio)
            console.warn(`Paquete ${pkg.id} no cabe en la cama ${bedNum}`);
            return;
        }
        
        // Asignar posición
        pkg.x = currentX;
        pkg.z = currentZ;
        
        // Avanzar X
        currentX += pkg.length_used;
        
        // Actualizar altura de fila
        if (pkg.width_used > rowHeight) {
            rowHeight = pkg.width_used;
        }
    });
}

// Reacomodar y guardar — ordena los paquetes de la cama actual sin encimarse y persiste
async function repackAndSave() {
    const bedNum = state.selectedBed;
    const platform = state.selectedPlatform || 1;

    if (!bedNum) { toast('Selecciona una cama primero', 'error'); return; }

    repackBed(bedNum, platform);

    // Guardar posiciones nuevas en el servidor
    const bedPkgs = state.placements.filter(p =>
        p.bed_number === bedNum && (p.platform || 1) === platform && p.placed
    );
    try {
        for (const p of bedPkgs) {
            await api.updatePlacement(p.id, { x: p.x, z: p.z });
        }
        if (state.load) state.load.status = 'MANUAL';
        recalculateTotalHeight();
        render3D();
        draw2DWithMultiSelection(bedNum);
        renderBedsTabs();
        renderBedsDistribution();
        renderBedMaterialsList(bedNum, platform);
        toast(`Cama ${bedNum} reacomodada (${bedPkgs.length} paquetes)`, 'success');
    } catch (e) {
        toast('Error al reacomodar: ' + e.message, 'error');
    }
}
window.repackAndSave = repackAndSave;

// ==================== HIGHLIGHT PACKAGE IN 3D ====================
let highlightedMesh = null;
let originalMaterial = null;

function highlightPackage3D(placementId) {
    // Restaurar el paquete anterior si había uno
    if (highlightedMesh && originalMaterial) {
        highlightedMesh.material = originalMaterial;
        highlightedMesh = null;
        originalMaterial = null;
    }
    
    if (!placementId || !packagesGroup) return;
    
    // Buscar el placement
    const placement = state.placements.find(p => p.id === placementId);
    if (!placement) return;
    
    // Buscar el mesh correspondiente
    const t = state.truck;
    if (!t) return;
    
    const L = t.length_mm;
    const isDual = t.is_dual_platform || t.id === 'FULL' || t.id === 'TORTON_DOBLE';
    const platformGap = isDual ? (t.platform_gap_mm || 500) : 0;
    const platform = placement.platform || 1;
    const offsetX = (platform - 1) * (L + platformGap);
    
    const FLOOR_HEIGHT = 50;
    const GROUND_CLEARANCE = 100;
    
    // Posición esperada del mesh
    const expectedX = offsetX + placement.x + placement.length_used / 2;
    const expectedY = FLOOR_HEIGHT + GROUND_CLEARANCE + placement.y + placement.height_used / 2;
    const expectedZ = placement.z + placement.width_used / 2;
    
    // Buscar el mesh por posición (con tolerancia amplia)
    const tolerance = 150;  // Aumentada para mejor detección
    let found = false;
    
    packagesGroup.children.forEach(child => {
        if (child.type === 'Mesh' && !found) {
            const pos = child.position;
            if (Math.abs(pos.x - expectedX) < tolerance &&
                Math.abs(pos.y - expectedY) < tolerance &&
                Math.abs(pos.z - expectedZ) < tolerance) {
                // Encontrado - resaltar
                highlightedMesh = child;
                originalMaterial = child.material;
                found = true;
                
                // Crear material de resaltado
                child.material = new THREE.MeshStandardMaterial({
                    color: 0xffff00,  // Amarillo brillante
                    emissive: 0xffff00,
                    emissiveIntensity: 0.5,
                    transparent: true,
                    opacity: 1
                });
            }
        }
    });
}

function clearHighlight3D() {
    if (highlightedMesh && originalMaterial) {
        highlightedMesh.material = originalMaterial;
        highlightedMesh = null;
        originalMaterial = null;
    }
}

// Seleccionar todos los paquetes de la cama actual
function selectAllBed() {
    const currentBed = state.selectedBed || 1;
    const currentPlatform = state.selectedPlatform || 1;
    
    // Obtener todos los paquetes de la cama actual
    const bedPlacements = state.placements.filter(p => 
        p.bed_number === currentBed && 
        (p.platform || 1) === currentPlatform &&
        p.placed
    );
    
    if (bedPlacements.length === 0) {
        toast('No hay paquetes en esta cama', 'info');
        return;
    }
    
    // Limpiar selección anterior
    selectedPlacements = [];
    
    // Seleccionar todos
    bedPlacements.forEach(p => {
        selectedPlacements.push(p);
    });
    
    // El primer seleccionado es el "principal" para compatibilidad
    selectedPlacement = selectedPlacements[0];
    
    // Actualizar UI
    updateSelectionUI();
    draw2DWithMultiSelection(currentBed);
    highlightMultipleIn3D();
    
    toast(`${selectedPlacements.length} paquetes seleccionados`, 'success');
}

// ==================== EXPORTS ====================
window.init3D = init3D;
window.render3D = render3D;
window.update3DBackground = update3DBackground;
window.resetView3D = resetView3D;
window.topView3D = topView3D;
window.frontView3D = frontView3D;
window.sideView3D = sideView3D;
window.focusBed3D = focusBed3D;
window.draw2D = draw2D;
window.resizeCanvas2D = resizeCanvas2D;
window.initManualMode = initManualMode;
window.setManualMode = setManualMode;
window.applyPlacementEdit = applyPlacementEdit;
window.rotatePlacement = rotatePlacement;
window.rotateYPlacement = rotateYPlacement;
window.deselectPlacement = deselectPlacement;
window.clearSelection = clearSelection;
window.deselectPlacement = deselectPlacement;
window.swapPackagePositions = swapPackagePositions;
window.highlightPackage3D = highlightPackage3D;
window.clearHighlight3D = clearHighlight3D;
window.selectAllBed = selectAllBed;