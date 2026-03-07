// main.js - Lógica principal de la aplicación

// ==================== THEME ====================
function initTheme() {
    // Cargar tema guardado o usar oscuro por defecto
    const savedTheme = localStorage.getItem('tyasa-theme') || 'dark';
    applyTheme(savedTheme);
}

function toggleTheme() {
    const isLight = document.documentElement.classList.contains('light-mode');
    const newTheme = isLight ? 'dark' : 'light';
    applyTheme(newTheme);
    localStorage.setItem('tyasa-theme', newTheme);
}

function applyTheme(theme) {
    const root = document.documentElement;
    const icon = $('themeIcon');
    const text = $('themeText');
    
    if (theme === 'light') {
        root.classList.add('light-mode');
        if (icon) icon.textContent = '☀️';
        if (text) text.textContent = 'Claro';
    } else {
        root.classList.remove('light-mode');
        if (icon) icon.textContent = '🌙';
        if (text) text.textContent = 'Oscuro';
    }
    
    // Actualizar visualizaciones si existen
    if (typeof update3DBackground === 'function') {
        update3DBackground();
    }
    if (typeof render3D === 'function') {
        setTimeout(() => {
            render3D();
            draw2D(state.selectedBed || 1);
        }, 100);
    }
}

// ==================== INIT ====================
async function init() {
    console.log('Iniciando TYASA...');
    
    initTheme();
    fillDates();
    bindEvents();
    
    await waitForThree();
    init3D();
    
    // Inicializar modo manual
    if (typeof initManualMode === 'function') {
        initManualMode();
    }
    
    await checkConnection();
    
    // Obtener el siguiente número de carga para mostrarlo
    try {
        const nextNum = await api.getNextLoadNumber();
        state.load = {
            id: null,
            fecha: utils.getToday(),
            numero_carga: nextNum.next_number,
            status: 'DRAFT',
            isNew: true
        };
    } catch (e) {
        state.load = {
            id: null,
            fecha: utils.getToday(),
            numero_carga: `TY-${new Date().getFullYear()}-1`,
            status: 'DRAFT',
            isNew: true
        };
    }
    
    updateAllUI();
    render3D();
    draw2D(1);
    
    console.log('Eventos configurados');
}

async function waitForThree() {
    return new Promise(resolve => {
        if (window.THREE) resolve();
        else {
            window.addEventListener('three-ready', resolve, { once: true });
            setTimeout(resolve, 3000);
        }
    });
}

function fillDates() {
    const now = new Date();
    const fill = (sel, arr, val) => {
        if (!sel) return;
        sel.innerHTML = arr.map(x => `<option value="${x}">${utils.pad(x)}</option>`).join('');
        sel.value = val;
    };
    fill($('qYear'), [2024, 2025, 2026, 2027], now.getFullYear());
    fill($('qMonth'), [...Array(12)].map((_, i) => i + 1), now.getMonth() + 1);
    fill($('qDay'), [...Array(31)].map((_, i) => i + 1), now.getDate());
}

function getQueryDate() {
    return `${$('qYear')?.value}-${utils.pad($('qMonth')?.value)}-${utils.pad($('qDay')?.value)}`;
}

// ==================== CONNECTION ====================
async function checkConnection() {
    try {
        await api.health();
        updateConnectionStatus(true);
        await loadTrucks();
        toast('Conectado al servidor', 'success');
    } catch (e) {
        updateConnectionStatus(false);
        toast('Backend no disponible', 'error');
    }
}

// ==================== TRUCKS ====================
async function loadTrucks() {
    try {
        state.trucks = await api.getTrucks();
        console.log('Camiones cargados:', state.trucks.length);
        renderTruckSelect();
        
        // Seleccionar primer camión por defecto
        if (state.trucks.length > 0 && !state.truck) {
            $('truckSelect').value = state.trucks[0].id;
            onTruckChange();
        }
    } catch (e) {
        console.error('Error cargando camiones:', e);
    }
}

// ==================== BÚSQUEDA MÚLTIPLE DE MATERIALES ====================
function openBusquedaMultiple() {
    openModal('modalBusquedaMultiple');
    $('txtClavesSAP').value = '';
    $('listaMaterialesEncontrados').style.display = 'none';
    $('materialesEncontradosContainer').innerHTML = '';
}

async function buscarMaterialesMultiple() {
    const txt = $('txtClavesSAP')?.value.trim();
    if (!txt) {
        toast('Escribe al menos una clave SAP', 'error');
        return;
    }
    
    // Parsear claves (por línea, coma, o espacio)
    const claves = txt.split(/[\n,\s]+/).map(c => c.trim()).filter(c => c.length > 0);
    
    if (claves.length === 0) {
        toast('No se encontraron claves válidas', 'error');
        return;
    }
    
    toast(`Buscando ${claves.length} materiales...`, 'info');
    
    const container = $('materialesEncontradosContainer');
    container.innerHTML = '';
    
    let encontrados = 0;
    let noEncontrados = [];
    
    for (const sap of claves) {
        try {
            const producto = await api.getProduct(sap);
            encontrados++;
            
            // Crear card para cada material
            const card = document.createElement('div');
            card.className = 'material-card-multiple';
            card.style.cssText = 'border:1px solid var(--border); border-radius:8px; padding:12px; margin-bottom:10px; background:var(--bg-secondary);';
            card.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:start; margin-bottom:8px;">
                    <div>
                        <strong style="color:var(--primary);">${producto.sap_code}</strong>
                        <span style="font-size:11px; background:var(--primary); color:white; padding:2px 6px; border-radius:4px; margin-left:5px;">Cal. ${producto.calibre}</span>
                    </div>
                    <button class="btn btn-danger btn-sm" onclick="this.closest('.material-card-multiple').remove()" style="padding:2px 8px;">✕</button>
                </div>
                <div style="font-size:12px; color:var(--muted); margin-bottom:8px;">${producto.description}</div>
                <div style="display:grid; grid-template-columns:1fr 1fr 1fr 1fr 1fr; gap:8px; font-size:11px;">
                    <div>
                        <label style="display:block; color:var(--muted);">Largo</label>
                        <input type="number" class="input-multi" data-field="largo" value="${producto.default_length_cm || 600}" style="width:100%; padding:4px;">
                    </div>
                    <div>
                        <label style="display:block; color:var(--muted);">Ancho</label>
                        <input type="number" class="input-multi" data-field="ancho" value="${producto.default_width_cm || 30}" style="width:100%; padding:4px;">
                    </div>
                    <div>
                        <label style="display:block; color:var(--muted);">Alto</label>
                        <input type="number" class="input-multi" data-field="alto" value="${producto.default_height_cm || 30}" style="width:100%; padding:4px;">
                    </div>
                    <div>
                        <label style="display:block; color:var(--muted);">Peso/Paq</label>
                        <input type="number" class="input-multi" data-field="peso" value="${producto.default_weight_per_package || 0.605}" step="0.001" style="width:100%; padding:4px;">
                    </div>
                    <div>
                        <label style="display:block; color:var(--muted);">Toneladas</label>
                        <input type="number" class="input-multi" data-field="tons" value="12.5" step="0.1" style="width:100%; padding:4px;">
                    </div>
                </div>
                <div style="display:flex; align-items:center; gap:8px; margin-top:8px;">
                    <input type="checkbox" class="chk-diferido-multi" id="chkDif_${producto.sap_code}" style="width:16px; height:16px;">
                    <label for="chkDif_${producto.sap_code}" style="font-size:11px; color:#ff6b6b;">📦 Diferido</label>
                    <button class="btn btn-success btn-sm" onclick="agregarMaterialDesdeCard(this)" style="margin-left:auto; padding:4px 12px;">+ Agregar</button>
                </div>
            `;
            card.dataset.producto = JSON.stringify(producto);
            container.appendChild(card);
            
        } catch (e) {
            noEncontrados.push(sap);
        }
    }
    
    $('listaMaterialesEncontrados').style.display = 'block';
    
    if (encontrados > 0) {
        toast(`${encontrados} material(es) encontrado(s)`, 'success');
    }
    if (noEncontrados.length > 0) {
        toast(`No encontrados: ${noEncontrados.join(', ')}`, 'warning');
    }
}

async function agregarMaterialDesdeCard(btn) {
    const card = btn.closest('.material-card-multiple');
    const producto = JSON.parse(card.dataset.producto);
    
    const largo = parseFloat(card.querySelector('[data-field="largo"]').value) || 600;
    const ancho = parseFloat(card.querySelector('[data-field="ancho"]').value) || 30;
    const alto = parseFloat(card.querySelector('[data-field="alto"]').value) || 30;
    const peso = parseFloat(card.querySelector('[data-field="peso"]').value) || 0.605;
    const tons = parseFloat(card.querySelector('[data-field="tons"]').value) || 1;
    const isDiferido = card.querySelector('.chk-diferido-multi')?.checked || false;
    
    // Crear material igual que en addMaterial
    const numPaquetes = Math.floor((tons * 1000) / (peso * 1000));
    const tonsPorPaquete = peso;
    
    for (let i = 0; i < numPaquetes; i++) {
        const material = {
            sap_code: producto.sap_code,
            description: producto.description,
            material_type: producto.material_type,
            almacen: producto.almacen || 'Formados',
            calibre: producto.calibre || 0,
            largo_mm: largo * 10,
            ancho_mm: ancho * 10,
            alto_mm: alto * 10,
            kg_por_paquete: peso * 1000,
            tons_solicitadas: tonsPorPaquete,
            is_deferred: isDiferido
        };
        state.materials.push(material);
    }
    
    // Actualizar UI
    renderMaterialsTable();
    updateAllUI();
    render3D();
    draw2D(state.selectedBed || 1);
    
    // Marcar como agregado
    card.style.opacity = '0.5';
    btn.textContent = '✓ Agregado';
    btn.disabled = true;
    btn.classList.remove('btn-success');
    btn.classList.add('btn-secondary');
    
    toast(`${numPaquetes} paquete(s) de ${producto.sap_code} agregados`, 'success');
}

function onTruckChange() {
    const id = $('truckSelect')?.value;
    const quantity = parseInt($('truckQuantity')?.value) || 1;
    
    state.truck = state.trucks.find(t => t.id === id) || null;
    state.truckQuantity = quantity;
    state.selectedBed = 1;
    
    updateTruckInfo();
    updatePayloadInfo();
    renderBedsTabs();
    render3D();
    draw2D(state.selectedBed);
}

// Función para mostrar/ocultar lista de sin colocar
function toggleNotPlacedList() {
    const list = $('notPlacedList');
    if (list) {
        list.style.display = list.style.display === 'none' ? 'block' : 'none';
    }
}

// Función para actualizar lista de sin colocar
function updateNotPlacedList() {
    const container = $('notPlacedContainer');
    const notPlacedItem = $('notPlacedItem');
    const sumNotPlaced = $('sumNotPlaced');
    
    if (!container || !state.placements) return;
    
    // Filtrar paquetes sin colocar
    const notPlaced = state.placements.filter(p => !p.placed);
    
    // Actualizar contador
    if (sumNotPlaced) {
        sumNotPlaced.textContent = notPlaced.length;
        sumNotPlaced.style.color = notPlaced.length > 0 ? '#ef4444' : 'inherit';
    }
    
    // Si no hay sin colocar, ocultar
    if (notPlaced.length === 0) {
        container.innerHTML = '<div style="color:var(--muted); text-align:center;">✓ Todos los paquetes fueron colocados</div>';
        if (notPlacedItem) notPlacedItem.style.display = 'none';
        return;
    }
    
    if (notPlacedItem) notPlacedItem.style.display = 'block';
    
    // Agrupar por material
    const grouped = {};
    for (const p of notPlaced) {
        const mat = state.materials.find(m => m.id === p.load_item_id);
        const key = mat?.sap_code || p.load_item_id;
        if (!grouped[key]) {
            grouped[key] = {
                sap_code: mat?.sap_code || 'N/A',
                description: mat?.description || 'Material',
                count: 0,
                kg: 0
            };
        }
        grouped[key].count++;
        grouped[key].kg += (mat?.kg_por_paquete || 0) / 1000;
    }
    
    // Renderizar
    let html = '';
    for (const key in grouped) {
        const g = grouped[key];
        html += `<div style="display:flex; justify-content:space-between; padding:4px 0; border-bottom:1px solid var(--border);">
            <span><strong>${g.sap_code}</strong> - ${g.description.substring(0, 30)}...</span>
            <span style="color:#ef4444;">${g.count} paq (${g.kg.toFixed(2)} ton)</span>
        </div>`;
    }
    
    container.innerHTML = html;
}

window.toggleNotPlacedList = toggleNotPlacedList;

async function createTruck() {
    const data = {
        id: $('newTruckId')?.value.trim().toUpperCase().replace(/\s+/g, '_'),
        name: $('newTruckName')?.value.trim(),
        beds_count: parseInt($('newTruckBeds')?.value) || 6,
        length_mm: parseInt($('newTruckL')?.value) || 0,
        width_mm: parseInt($('newTruckW')?.value) || 0,
        height_mm: parseInt($('newTruckH')?.value) || 0,
        max_payload_kg: parseInt($('newTruckKg')?.value) || 0
    };
    
    if (!data.id || !data.name) return toast('ID y nombre requeridos', 'error');
    if (data.length_mm <= 0) return toast('Dimensiones inválidas', 'error');
    
    try {
        await api.createTruck(data);
        toast('Camión creado', 'success');
        closeModal('modalTruck');
        await loadTrucks();
    } catch (e) {
        toast('Error: ' + e.message, 'error');
    }
}

// ==================== PRODUCTS ====================
async function searchProduct() {
    const sap = $('sapCode')?.value.trim();
    if (!sap) return toast('Ingresa clave SAP', 'error');
    
    try {
        state.product = await api.getProduct(sap);
        renderProductInfo();
        // Mostrar botón de editar cuando hay producto
        const btnEdit = $('btnEditMaterial');
        if (btnEdit) btnEdit.style.display = 'inline-block';
        toast('Producto encontrado', 'success');
        $('tons')?.focus();
    } catch (e) {
        state.product = null;
        renderProductInfo();
        // Ocultar botón de editar
        const btnEdit = $('btnEditMaterial');
        if (btnEdit) btnEdit.style.display = 'none';
        toast('Producto no encontrado', 'error');
    }
}

// Abrir modal para editar material
function openEditMaterialModal() {
    if (!state.product) {
        toast('Primero busca un producto', 'error');
        return;
    }
    
    const p = state.product;
    
    // Llenar campos con datos actuales
    $('editMatSap').value = p.sap_code || '';
    $('editMatType').value = p.material_type || '';
    $('editMatDesc').value = p.description || '';
    $('editMatAlmacen').value = p.almacen || '';
    $('editMatMedida').value = p.medida || '';
    $('editMatCalibre').value = p.calibre || '';
    $('editMatLargo').value = p.largo_cm || (p.largo_mm / 10) || 600;
    $('editMatAncho').value = p.ancho_cm || (p.ancho_mm / 10) || 30;
    $('editMatAlto').value = p.alto_cm || (p.alto_mm / 10) || 15;
    $('editMatPeso').value = p.peso_ton || (p.kg_por_paquete / 1000) || 0.5;
    
    openModal('modalEditMaterial');
}

// Guardar cambios del material editado
async function saveEditMaterial() {
    const sapCode = $('editMatSap')?.value.trim();
    if (!sapCode) return toast('Error: Sin código SAP', 'error');
    
    const largo_cm = parseFloat($('editMatLargo')?.value) || 600;
    const ancho_cm = parseFloat($('editMatAncho')?.value) || 30;
    const alto_cm = parseFloat($('editMatAlto')?.value) || 15;
    const peso_ton = parseFloat($('editMatPeso')?.value) || 0.5;
    
    const data = {
        material_type: $('editMatType')?.value.trim() || '',
        sap_code: sapCode,
        description: $('editMatDesc')?.value.trim() || '',
        almacen: $('editMatAlmacen')?.value.trim() || '',
        medida: $('editMatMedida')?.value.trim() || '',
        calibre: parseFloat($('editMatCalibre')?.value) || 0,
        largo_mm: Math.round(largo_cm * 10),
        ancho_mm: Math.round(ancho_cm * 10),
        alto_mm: Math.round(alto_cm * 10),
        kg_por_paquete: peso_ton * 1000,
        peso_pieza_kg: 0,
        piezas_por_paquete: 1
    };
    
    try {
        await api.updateProduct(sapCode, data);
        toast('Material actualizado en Excel', 'success');
        closeModal('modalEditMaterial');
        
        // Recargar el producto para ver cambios
        state.product = await api.getProduct(sapCode);
        renderProductInfo();
    } catch (e) {
        toast('Error: ' + e.message, 'error');
    }
}

async function createMaterial() {
    // Ahora las dimensiones vienen en CM y el peso en TON
    const largo_cm = parseFloat($('newMatLargo')?.value) || 600;
    const ancho_cm = parseFloat($('newMatAncho')?.value) || 30;
    const alto_cm = parseFloat($('newMatAlto')?.value) || 15;
    const peso_ton = parseFloat($('newMatKgPaq')?.value) || 0.5;
    const calibre = parseFloat($('newMatCalibre')?.value) || 0;
    
    const data = {
        material_type: $('newMatType')?.value.trim() || 'LARGOS',
        sap_code: $('newMatSap')?.value.trim(),
        description: $('newMatDesc')?.value.trim(),
        almacen: $('newMatAlmacen')?.value.trim() || '',
        medida: $('newMatMedida')?.value.trim() || '',
        calibre: calibre,
        // Convertir CM a MM para el backend
        largo_mm: Math.round(largo_cm * 10),
        ancho_mm: Math.round(ancho_cm * 10),
        alto_mm: Math.round(alto_cm * 10),
        peso_pieza_kg: 0,
        piezas_por_paquete: 1,
        // Convertir TON a KG para el backend
        kg_por_paquete: peso_ton * 1000
    };
    
    if (!data.sap_code || !data.description) return toast('SAP y descripción requeridos', 'error');
    if (peso_ton <= 0) return toast('Peso por paquete requerido', 'error');
    
    try {
        await api.createProduct(data);
        toast('Material creado y guardado en Excel', 'success');
        closeModal('modalMaterial');
        // Limpiar campos
        $('newMatType').value = '';
        $('newMatSap').value = '';
        $('newMatDesc').value = '';
        $('newMatAlmacen').value = '';
        $('newMatMedida').value = '';
        $('newMatCalibre').value = '';
        $('newMatLargo').value = '600';
        $('newMatAncho').value = '';
        $('newMatAlto').value = '';
        $('newMatKgPaq').value = '';
        // Buscar el producto recién creado
        $('sapCode').value = data.sap_code;
        searchProduct();
    } catch (e) {
        toast('Error: ' + e.message, 'error');
    }
}

// ==================== MATERIALS ====================
function addMaterial() {
    if (!state.product) return toast('Primero busca un producto', 'error');
    
    const tons = parseFloat($('tons')?.value);
    const pesoTon = parseFloat($('pesoPaquete')?.value);
    
    // Obtener dimensiones editadas por el usuario (en cm)
    const largoCm = parseFloat($('pkgLargo')?.value);
    const anchoCm = parseFloat($('pkgAncho')?.value);
    const altoCm = parseFloat($('pkgAlto')?.value);
    
    // Checkbox de diferido
    const isDiferido = $('chkDiferido')?.checked || false;
    
    // Validaciones
    if (isNaN(largoCm) || largoCm <= 0) return toast('Ingresa largo del paquete', 'error');
    if (isNaN(anchoCm) || anchoCm <= 0) return toast('Ingresa ancho del paquete', 'error');
    if (isNaN(altoCm) || altoCm <= 0) return toast('Ingresa alto del paquete', 'error');
    if (isNaN(pesoTon) || pesoTon <= 0) return toast('Ingresa peso por paquete', 'error');
    if (isNaN(tons) || tons <= 0) return toast('Ingresa toneladas', 'error');
    
    const p = state.product;
    
    // Convertir cm a mm para uso interno
    const largoMm = largoCm * 10;
    const anchoMm = anchoCm * 10;
    const altoMm = altoCm * 10;
    
    console.log('Producto a agregar:', p);
    console.log('  - Calibre:', p.calibre);
    console.log('  - Almacén:', p.almacen);
    console.log('  - Dimensiones (mm):', largoMm, 'x', anchoMm, 'x', altoMm);
    console.log('  - Peso/paq (manual):', pesoTon, 'ton');
    console.log('  - Diferido:', isDiferido);
    
    const kgPaq = pesoTon * 1000;  // Convertir ton a kg
    const kgTotal = tons * 1000;
    const numPaq = Math.floor(kgTotal / kgPaq);
    
    if (numPaq <= 0) return toast(`Toneladas menores a un paquete (${pesoTon} ton)`, 'error');
    
    const kgEnPaquetes = numPaq * kgPaq;
    const kgSobrante = kgTotal - kgEnPaquetes;
    
    // CREAR UN MATERIAL POR CADA PAQUETE INDIVIDUAL
    for (let i = 0; i < numPaq; i++) {
        state.materials.push({
            id: Date.now() + i,  // ID único para cada paquete
            sap_code: p.sap_code,
            description: p.description,
            material_type: p.material_type,
            almacen: p.almacen,
            calibre: p.calibre || 0,  // Calibre del material
            tons_solicitadas: kgPaq / 1000,  // Toneladas de este paquete individual
            tons_en_paquetes: kgPaq / 1000,
            tons_sobrantes: 0,
            largo_mm: largoMm,   // Usar dimensiones del usuario
            ancho_mm: anchoMm,   // Usar dimensiones del usuario
            alto_mm: altoMm,     // Usar dimensiones del usuario
            kg_por_paquete: kgPaq,
            num_paquetes: 1,  // Cada entrada es 1 paquete
            paquete_index: i + 1,  // Índice del paquete
            is_deferred: isDiferido  // Si es diferido
        });
    }
    
    console.log('Materiales después de agregar:', state.materials);
    
    // Limpiar placements porque cambió la carga
    state.placements = [];
    
    $('tons').value = '';
    $('pesoPaquete').value = '';
    if ($('chkDiferido')) $('chkDiferido').checked = false;  // Limpiar checkbox
    const preview = $('calcPreview');
    if (preview) preview.style.display = 'none';
    
    // Mostrar mensaje con info del sobrante si hay
    let msg = `${numPaq} paquetes agregados (${largoCm}×${anchoCm}×${altoCm} cm)`;
    if (kgSobrante > 0) {
        msg += ` · Sobrante: ${(kgSobrante/1000).toFixed(3)} ton`;
    }
    toast(msg, 'success');
    updateAllUI();
    render3D();
}

function removeMaterial(index) {
    state.materials.splice(index, 1);
    state.placements = [];
    updateAllUI();
    render3D();
}

// ==================== ADITAMENTOS ====================
function addAditamento() {
    const name = $('aditName')?.value.trim();
    const peso = parseFloat($('aditPeso')?.value);
    
    if (!name) return toast('Ingresa nombre', 'error');
    if (isNaN(peso) || peso <= 0) return toast('Ingresa peso', 'error');
    
    state.aditamentos.push({ name, peso_kg: peso, cantidad: 1 });
    $('aditName').value = '';
    $('aditPeso').value = '';
    toast('Aditamento agregado', 'success');
    updateAllUI();
}

function removeAditamento(index) {
    state.aditamentos.splice(index, 1);
    updateAllUI();
}

// ==================== LOADS ====================
async function createLoad() {
    const fecha = utils.getToday();
    
    // Obtener el siguiente número del servidor
    let numero;
    try {
        const nextNum = await api.getNextLoadNumber();
        numero = nextNum.next_number;
    } catch (e) {
        numero = `TY-${new Date().getFullYear()}-1`;
    }
    
    // Solo crear estado local, NO guardar en BD todavía
    state.loadId = null;  // Sin ID porque no está guardado
    state.load = { 
        id: null, 
        fecha, 
        numero_carga: numero, 
        status: 'DRAFT',
        isNew: true  // Marcar como nueva (no guardada)
    };
    state.placements = [];
    state.bedsStats = [];
    state.materials = [];
    state.aditamentos = [];
    
    console.log('Nueva carga creada localmente (sin guardar):', numero);
    return true;
}

async function saveLoadToDatabase() {
    // Crear la carga en la BD si es nueva
    const fecha = state.load?.fecha || utils.getToday();
    
    // Usar el número que ya está en state.load (ya viene del servidor)
    let numero = state.load?.numero_carga;
    
    // Si por alguna razón no hay número, obtenerlo del servidor
    if (!numero) {
        try {
            const nextNum = await api.getNextLoadNumber();
            numero = nextNum.next_number;
        } catch (e) {
            numero = `TY-${new Date().getFullYear()}-1`;
        }
    }
    
    try {
        const res = await api.createLoad({ fecha, numero_carga: numero });
        state.loadId = res.id;
        state.load.id = res.id;
        state.load.isNew = false;
        console.log('Carga guardada en BD con ID:', state.loadId);
        return res.id;
    } catch (e) {
        console.error('Error guardando carga en BD:', e);
        toast('Error al guardar carga: ' + e.message, 'error');
        return null;
    }
}

async function saveLoad() {
    // Si es carga nueva (no guardada), primero crearla en BD
    if (!state.loadId || state.load?.isNew) {
        const id = await saveLoadToDatabase();
        if (!id) return false;
    }
    
    if (!state.truck) {
        toast('Selecciona un camión', 'error');
        return false;
    }
    if (state.materials.length === 0) {
        toast('Agrega materiales', 'error');
        return false;
    }
    
    try {
        // Incluir campos de identificación si existen
        const updateData = {
            truck_id: state.truck.id,
            items: state.materials.map(m => ({
                sap_code: m.sap_code,
                description: m.description,
                material_type: m.material_type,
                almacen: m.almacen,
                calibre: m.calibre || 0,
                tons_solicitadas: m.tons_solicitadas,
                largo_mm: m.largo_mm,
                ancho_mm: m.ancho_mm,
                alto_mm: m.alto_mm,
                kg_por_paquete: m.kg_por_paquete,
                is_deferred: m.is_deferred || false
            })),
            aditamentos: state.aditamentos.map(a => ({
                name: a.name,
                peso_kg: a.peso_kg,
                cantidad: a.cantidad || 1
            }))
        };
        
        // Agregar campos de identificación si vienen del modal
        if (state.saveData) {
            updateData.numero_viaje = state.saveData.numeroViaje;
            updateData.numero_embarque = state.saveData.numeroEmbarque;
            updateData.cliente = state.saveData.cliente;
            // Actualizar state.load también
            if (state.load) {
                state.load.numero_viaje = state.saveData.numeroViaje;
                state.load.numero_embarque = state.saveData.numeroEmbarque;
                state.load.cliente = state.saveData.cliente;
            }
            state.saveData = null; // Limpiar
        }
        
        await api.updateLoad(state.loadId, updateData);
        console.log('Carga guardada:', state.loadId);
        toast('Carga guardada', 'success');
        updateAllUI();
        return true;
    } catch (e) {
        console.error('Error guardando:', e);
        toast('Error al guardar: ' + e.message, 'error');
        return false;
    }
}

// Guardar SOLO metadatos (viaje, embarque, cliente) SIN tocar items ni placements
async function saveMetadataOnly() {
    if (!state.loadId) {
        toast('No hay carga para guardar', 'error');
        return false;
    }
    
    try {
        const updateData = {
            truck_id: state.truck?.id
        };
        
        // Solo agregar metadatos, NO enviar items
        if (state.saveData) {
            updateData.numero_viaje = state.saveData.numeroViaje;
            updateData.numero_embarque = state.saveData.numeroEmbarque;
            updateData.cliente = state.saveData.cliente;
            
            if (state.load) {
                state.load.numero_viaje = state.saveData.numeroViaje;
                state.load.numero_embarque = state.saveData.numeroEmbarque;
                state.load.cliente = state.saveData.cliente;
            }
            state.saveData = null;
        }
        
        await api.updateLoad(state.loadId, updateData);
        console.log('Metadatos guardados:', state.loadId);
        toast('Carga guardada', 'success');
        return true;
    } catch (e) {
        console.error('Error guardando metadatos:', e);
        toast('Error al guardar: ' + e.message, 'error');
        return false;
    }
}

// ==================== EDITAR DIMENSIONES TRANSPORTE ====================
function openEditTruckModal() {
    if (!state.truck) {
        toast('Selecciona un camión primero', 'warning');
        return;
    }
    
    const t = state.truck;
    $('editTruckName').textContent = t.name;
    $('editTruckL').value = t.length_mm;
    $('editTruckW').value = t.width_mm;
    $('editTruckH').value = t.height_mm;
    $('editTruckBeds').value = t.beds_count;
    $('editTruckKg').value = t.max_payload_kg;
    
    openModal('modalEditTruck');
}

function applyTruckEdit() {
    if (!state.truck) return;
    
    const newL = parseInt($('editTruckL').value) || state.truck.length_mm;
    const newW = parseInt($('editTruckW').value) || state.truck.width_mm;
    const newH = parseInt($('editTruckH').value) || state.truck.height_mm;
    const newBeds = parseInt($('editTruckBeds').value) || state.truck.beds_count;
    const newKg = parseInt($('editTruckKg').value) || state.truck.max_payload_kg;
    
    // Actualizar el state del camión (cambio temporal)
    state.truck.length_mm = newL;
    state.truck.width_mm = newW;
    state.truck.height_mm = newH;
    state.truck.beds_count = newBeds;
    state.truck.max_payload_kg = newKg;
    
    closeModal('modalEditTruck');
    toast('Dimensiones actualizadas (cambio temporal)', 'success');
    
    // Actualizar UI
    updateTruckInfo();
    updatePayloadInfo();
    render3D();
}

// Función para cambiar el modo de optimización
async function setOptimizeMode(mode) {
    state.optimizeMode = mode;
    
    // Actualizar UI de botones
    const btn1 = $('btnMode1');
    const btn2 = $('btnMode2');
    
    if (btn1 && btn2) {
        btn1.classList.toggle('active', mode === 'opt1');
        btn2.classList.toggle('active', mode === 'opt2');
    }
    
    const modeLabel = mode === 'opt2' ? 'Optimizacion 2 (Superficie completa 12m)' : 'Optimizacion 1 (Frontal 6m)';
    console.log('Modo de optimizacion:', modeLabel);
    
    // Si ya hay carga guardada y materiales, ejecutar optimizacion automaticamente
    if (state.loadId && state.materials.length > 0 && state.truck) {
        console.log('Ejecutando optimizacion automatica para modo:', mode);
        await optimize();
    }
}

// Abrir modal de prioridades
function openPriorityModal() {
    // Obtener almacenes únicos de los materiales
    const almacenes = [...new Set(state.materials.map(m => m.almacen).filter(a => a))];
    
    if (almacenes.length === 0) {
        toast('Agrega materiales primero para configurar prioridades', 'warning');
        return;
    }
    
    // Crear lista de prioridades
    const container = $('almacenPriorityList');
    container.innerHTML = '';
    
    // Ordenar por prioridad existente o alfabéticamente
    const sortedAlmacenes = almacenes.sort((a, b) => {
        const prioA = state.almacenPriorities.find(p => p.almacen === a)?.priority || 999;
        const prioB = state.almacenPriorities.find(p => p.almacen === b)?.priority || 999;
        return prioA - prioB;
    });
    
    sortedAlmacenes.forEach((almacen, idx) => {
        const existingPrio = state.almacenPriorities.find(p => p.almacen === almacen);
        const priority = existingPrio ? existingPrio.priority : idx + 1;
        
        const div = document.createElement('div');
        div.className = 'priority-item';
        div.innerHTML = `
            <span class="priority-almacen">${almacen}</span>
            <select class="priority-select" data-almacen="${almacen}">
                ${Array.from({length: almacenes.length}, (_, i) => 
                    `<option value="${i+1}" ${priority === i+1 ? 'selected' : ''}>${i+1}</option>`
                ).join('')}
            </select>
        `;
        container.appendChild(div);
    });
    
    openModal('modalPriority');
}

// Guardar prioridades
function savePriorities() {
    const selects = document.querySelectorAll('.priority-select');
    state.almacenPriorities = [];
    
    selects.forEach(sel => {
        state.almacenPriorities.push({
            almacen: sel.dataset.almacen,
            priority: parseInt(sel.value)
        });
    });
    
    // Ordenar por prioridad
    state.almacenPriorities.sort((a, b) => a.priority - b.priority);
    
    console.log('Prioridades guardadas:', state.almacenPriorities);
    toast('Prioridades guardadas', 'success');
    closeModal('modalPriority');
}

async function optimize() {
    // Validaciones
    if (!state.truck) return toast('Selecciona un camión', 'error');
    if (state.materials.length === 0) return toast('Agrega materiales', 'error');
    
    // Obtener modo de optimización seleccionado
    const optimizeMode = state.optimizeMode || 'opt1';
    const modeLabel = optimizeMode === 'opt2' ? 'Optimización 2' : 'Optimización 1';
    
    // Obtener configuración de espaciado (en cm, convertir a mm)
    const gapFloorToBed = (parseFloat($('gapFloorToBed')?.value) || 0) * 10; // cm a mm
    const gapBetweenBeds = (parseFloat($('gapBetweenBeds')?.value) || 10) * 10; // cm a mm
    const centerPackages = $('centerPackages')?.checked !== false; // default true
    
    // Guardar copia local de materiales ANTES de todo
    const materialesLocal = JSON.parse(JSON.stringify(state.materials));
    const aditamentosLocal = JSON.parse(JSON.stringify(state.aditamentos));
    const truckLocal = JSON.parse(JSON.stringify(state.truck));
    const loadIdLocal = state.loadId;
    
    console.log('=== INICIO OPTIMIZACIÓN ===');
    console.log('Modo:', modeLabel);
    console.log('Prioridades:', state.almacenPriorities);
    console.log('Materiales antes:', materialesLocal.length);
    console.log('LoadId antes:', loadIdLocal);
    console.log('Gap suelo->cama1:', gapFloorToBed, 'mm');
    console.log('Gap entre camas:', gapBetweenBeds, 'mm');
    console.log('Centrar paquetes:', centerPackages);
    
    try {
        toast(`Optimizando (${modeLabel})...`, 'info');
        
        // Crear carga si no existe
        if (!state.loadId) {
            const id = await createLoad();
            if (!id) return;
            console.log('Carga creada:', id);
        }
        
        // Guardar materiales en servidor
        const saved = await saveLoad();
        if (!saved) {
            console.error('Error al guardar, restaurando estado...');
            state.materials = materialesLocal;
            state.aditamentos = aditamentosLocal;
            state.truck = truckLocal;
            return;
        }
        console.log('Carga guardada en servidor');
        
        // Obtener cantidad de transportes
        const truckQuantity = state.truckQuantity || parseInt($('truckQuantity')?.value) || 1;
        
        // Optimizar con el modo seleccionado, prioridades, cantidad de transportes y configuración de espaciado
        const res = await api.optimize(state.loadId, optimizeMode, state.almacenPriorities, truckQuantity, gapFloorToBed, gapBetweenBeds, centerPackages);
        console.log('Resultado optimización:', res);
        
        // Guardar stats de camas y altura total
        state.bedsStats = res.beds_stats || [];
        state.totalHeight = res.total_height_mm || 0;
        
        // Obtener datos completos del servidor
        const data = await api.getLoad(state.loadId);
        console.log('Datos del servidor:', {
            placements: data.placements?.length || 0,
            items: data.items?.length || 0
        });
        
        // Guardar placements
        state.placements = data.placements || [];
        
        // IMPORTANTE: Actualizar los IDs de materiales locales con los del servidor
        if (data.items && data.items.length > 0) {
            data.items.forEach((serverItem, index) => {
                if (materialesLocal[index]) {
                    materialesLocal[index].id = serverItem.id;
                    materialesLocal[index].num_paquetes = serverItem.num_paquetes;
                }
            });
        }
        
        // Restaurar materiales locales (ahora con IDs actualizados)
        state.materials = materialesLocal;
        state.aditamentos = aditamentosLocal;
        state.truck = truckLocal;
        
        // Actualizar estado de la carga
        state.load = { 
            id: state.loadId,
            numero_carga: data.numero_carga,
            fecha: data.fecha,
            status: 'OPTIMIZED',
            total_tons: data.total_tons,
            truck_id: data.truck_id
        };
        
        console.log('=== ESTADO FINAL ===');
        console.log('LoadId:', state.loadId);
        console.log('Materiales:', state.materials.length);
        console.log('Placements:', state.placements.length);
        console.log('Truck:', state.truck?.name);
        
        // Actualizar UI completa
        console.log('Actualizando UI...');
        updateAllUI();
        
        // Actualizar lista de sin colocar
        updateNotPlacedList();
        
        console.log('Renderizando 3D...');
        render3D();
        
        console.log('Dibujando 2D cama:', state.selectedBed);
        draw2D(state.selectedBed);
        
        console.log('=== FIN OPTIMIZACIÓN ===');
        
        // Mostrar mensaje con sin colocar si hay
        const notPlaced = state.placements.filter(p => !p.placed).length;
        if (notPlaced > 0) {
            toast(`⚠️ ${res.placed_packages}/${res.total_packages} paquetes - ${notPlaced} sin colocar`, 'warning');
        } else {
            toast(`✓ ${res.placed_packages}/${res.total_packages} paquetes en ${res.beds_used} camas`, 'success');
        }
    } catch (e) {
        console.error('Error optimizando:', e);
        // Restaurar en caso de error
        state.materials = materialesLocal;
        state.aditamentos = aditamentosLocal;
        state.truck = truckLocal;
        toast('Error: ' + e.message, 'error');
    }
}

async function loadCurrentLoad() {
    if (!state.loadId) return;
    
    try {
        const data = await api.getLoad(state.loadId);
        console.log('Carga recibida del servidor:', data);
        
        state.load = data;
        state.placements = data.placements || [];
        state.bedNotes = data.bed_notes || [];
        
        // Cargar materiales desde servidor
        state.materials = (data.items || []).map(item => ({
            id: item.id,
            sap_code: item.sap_code,
            description: item.description,
            material_type: item.material_type,
            almacen: item.almacen,
            calibre: item.calibre || 0,
            tons_solicitadas: item.tons_solicitadas,
            tons_en_paquetes: item.tons_en_paquetes,
            tons_sobrantes: item.tons_sobrantes,
            largo_mm: item.largo_mm,
            ancho_mm: item.ancho_mm,
            alto_mm: item.alto_mm,
            kg_por_paquete: item.kg_por_paquete,
            num_paquetes: item.num_paquetes
        }));
        
        state.aditamentos = (data.aditamentos || []).map(a => ({
            id: a.id,
            name: a.name,
            peso_kg: a.peso_kg,
            cantidad: a.cantidad
        }));
        
        // Seleccionar camión
        if (data.truck_id && $('truckSelect')) {
            $('truckSelect').value = data.truck_id;
            state.truck = state.trucks.find(t => t.id === data.truck_id) || data.truck;
        }
        
        // Calcular estadísticas de camas desde placements
        if (state.placements.length > 0) {
            const bedsMap = {};
            state.placements.forEach(p => {
                if (p.placed && p.bed_number > 0) {
                    if (!bedsMap[p.bed_number]) {
                        bedsMap[p.bed_number] = { packages: 0, weight_kg: 0 };
                    }
                    bedsMap[p.bed_number].packages++;
                    // Buscar el material para obtener el peso
                    const mat = state.materials.find(m => m.id === p.load_item_id);
                    if (mat) {
                        bedsMap[p.bed_number].weight_kg += (mat.kg_por_paquete || 0);
                    }
                }
            });
            
            state.bedsStats = Object.keys(bedsMap).map(bedNum => ({
                bed_number: parseInt(bedNum),
                packages: bedsMap[bedNum].packages,
                weight_kg: bedsMap[bedNum].weight_kg
            }));
            
            console.log('Beds stats calculados:', state.bedsStats);
        }
        
        // Seleccionar primera cama con paquetes
        const firstBedWithPackages = state.bedsStats?.find(b => b.packages > 0);
        if (firstBedWithPackages) {
            state.selectedBed = firstBedWithPackages.bed_number;
        } else {
            state.selectedBed = 1;
        }
        
        console.log('Placements cargados:', state.placements.length);
        console.log('Materiales cargados:', state.materials.length);
        console.log('Cama seleccionada:', state.selectedBed);
        
        updateAllUI();
        render3D();
        draw2D(state.selectedBed);
        renderBedsTabs();
        
    } catch (e) {
        console.error('Error cargando:', e);
        toast('Error al cargar: ' + e.message, 'error');
    }
}

async function searchLoads() {
    const activeTab = state.searchTab || 'fecha';
    let params = {};
    
    if (activeTab === 'fecha') {
        params.fecha = getQueryDate();
    } else if (activeTab === 'viaje') {
        const viaje = $('qViaje')?.value.trim();
        if (!viaje) return toast('Ingresa número de viaje', 'error');
        params.numero_viaje = viaje;
    } else if (activeTab === 'embarque') {
        const embarque = $('qEmbarque')?.value.trim();
        if (!embarque) return toast('Ingresa número de embarque', 'error');
        params.numero_embarque = embarque;
    } else if (activeTab === 'cliente') {
        const cliente = $('qCliente')?.value.trim();
        if (!cliente) return toast('Ingresa nombre de cliente', 'error');
        params.cliente = cliente;
    }
    
    try {
        const loads = await api.searchLoads(params);
        renderLoadsList(loads);
    } catch (e) {
        toast('Error: ' + e.message, 'error');
    }
}

function renderLoadsList(loads) {
    const container = $('loadsList');
    if (!container) return;
    
    if (loads.length === 0) {
        container.innerHTML = '<div class="empty-msg">No se encontraron cargas</div>';
        return;
    }
    
    container.innerHTML = loads.map(L => `
        <div class="load-item" data-id="${L.id}">
            <div class="load-item-content" onclick="selectLoadItem(${L.id})" ondblclick="loadSelectedLoadDirect(${L.id})">
                <div class="load-item-header">
                    <span class="load-item-id">#${L.id} - ${L.numero_carga}</span>
                    <span class="load-item-status ${L.status === 'DRAFT' ? 'draft' : ''}">${L.status}</span>
                </div>
                <div class="load-item-details">
                    <div>📅 <b>${L.fecha}</b></div>
                    <div>⚖️ <b>${L.total_tons?.toFixed(1) || 0} t</b></div>
                </div>
                ${L.numero_viaje || L.numero_embarque || L.cliente ? `
                <div class="load-item-meta">
                    ${L.numero_viaje ? `<span>🚚 ${L.numero_viaje}</span>` : ''}
                    ${L.numero_embarque ? `<span>📦 ${L.numero_embarque}</span>` : ''}
                    ${L.cliente ? `<span>👤 ${L.cliente}</span>` : ''}
                </div>
                ` : ''}
            </div>
            <button class="btn-delete-load" onclick="event.stopPropagation(); confirmDeleteLoad(${L.id}, '${L.numero_carga}')" title="Eliminar carga">🗑️</button>
        </div>
    `).join('');
}

// Confirmar eliminación de carga
async function confirmDeleteLoad(id, numeroCarga) {
    if (!confirm(`¿Estás seguro de eliminar la carga ${numeroCarga}?\n\nEsta acción no se puede deshacer.`)) {
        return;
    }
    
    try {
        await api.deleteLoad(id);
        toast(`Carga ${numeroCarga} eliminada`, 'success');
        // Recargar la lista
        searchLoads();
        
        // Si la carga eliminada es la actual, limpiar estado
        if (state.loadId === id) {
            state.loadId = null;
            state.load = null;
            state.materials = [];
            state.placements = [];
            updateAllUI();
            render3D();
        }
    } catch (e) {
        toast('Error al eliminar: ' + e.message, 'error');
    }
}

function selectLoadItem(id) {
    // Deseleccionar todos
    document.querySelectorAll('.load-item').forEach(el => el.classList.remove('selected'));
    // Seleccionar el clickeado
    const item = document.querySelector(`.load-item[data-id="${id}"]`);
    if (item) item.classList.add('selected');
    state.selectedLoadId = id;
}

async function loadSelectedLoad() {
    const id = state.selectedLoadId;
    if (!id) return toast('Selecciona una carga de la lista', 'error');
    
    await loadSelectedLoadDirect(id);
}

async function loadSelectedLoadDirect(id) {
    state.loadId = id;
    await loadCurrentLoad();
    closeModal('modalConsulta');
    toast(`Carga #${id} cargada`, 'success');
}

function switchSearchTab(tab) {
    state.searchTab = tab;
    
    // Actualizar tabs
    ['fecha', 'viaje', 'embarque', 'cliente'].forEach(t => {
        const tabEl = $(`tab${t.charAt(0).toUpperCase() + t.slice(1)}`);
        const panelEl = $(`search${t.charAt(0).toUpperCase() + t.slice(1)}`);
        if (tabEl) tabEl.classList.toggle('active', t === tab);
        if (panelEl) panelEl.style.display = t === tab ? 'block' : 'none';
    });
}

// Modal de guardar
function openSaveModal() {
    // Pre-cargar datos si ya existen
    if (state.load) {
        $('saveNumViaje').value = state.load.numero_viaje || '';
        $('saveNumEmbarque').value = state.load.numero_embarque || '';
        $('saveCliente').value = state.load.cliente || '';
    } else {
        $('saveNumViaje').value = '';
        $('saveNumEmbarque').value = '';
        $('saveCliente').value = '';
    }
    openModal('modalGuardar');
}

async function confirmSave() {
    const numeroViaje = $('saveNumViaje')?.value.trim() || '';
    const numeroEmbarque = $('saveNumEmbarque')?.value.trim() || '';
    const cliente = $('saveCliente')?.value.trim() || '';
    
    // Guardar en state para usar en saveLoad
    state.saveData = { numeroViaje, numeroEmbarque, cliente };
    
    closeModal('modalGuardar');
    
    // Si ya hay placements (carga optimizada), solo guardar metadatos
    // para no borrar los placements
    if (state.placements && state.placements.length > 0) {
        console.log('Carga ya optimizada - guardando solo metadatos');
        await saveMetadataOnly();
    } else {
        console.log('Carga sin optimizar - guardando todo');
        await saveLoad();
    }
}

function exportPDF() {
    if (!state.loadId) return toast('No hay carga guardada', 'error');
    window.open(api.getPdfUrl(state.loadId), '_blank');
}

// ==================== BED SELECTION ====================
function selectBed(n) {
    state.selectedBed = n;
    renderBedsTabs();
    draw2D(n);
    renderBedMaterialsList(n);
    if (typeof focusBed3D === 'function') focusBed3D(n);
    // Cargar nota de esta cama
    if (typeof loadBedNote === 'function') loadBedNote();
}

// ==================== EVENTS ====================
function bindEvents() {
    // Toggle de tema
    $('themeToggle')?.addEventListener('click', toggleTheme);
    
    $('truckSelect')?.addEventListener('change', onTruckChange);
    $('truckQuantity')?.addEventListener('change', onTruckChange);
    $('truckQuantity')?.addEventListener('input', onTruckChange);
    $('btnNewTruck')?.addEventListener('click', () => openModal('modalTruck'));
    $('btnCreateTruck')?.addEventListener('click', createTruck);
    $('btnEditTruck')?.addEventListener('click', openEditTruckModal);
    $('btnApplyTruckEdit')?.addEventListener('click', applyTruckEdit);
    
    $('btnBuscarSAP')?.addEventListener('click', searchProduct);
    $('sapCode')?.addEventListener('keypress', e => { if (e.key === 'Enter') searchProduct(); });
    
    // Búsqueda múltiple
    $('btnBusquedaMultiple')?.addEventListener('click', openBusquedaMultiple);
    $('btnBuscarMultiple')?.addEventListener('click', buscarMaterialesMultiple);
    
    $('btnNewMaterial')?.addEventListener('click', () => openModal('modalMaterial'));
    $('btnCreateMaterial')?.addEventListener('click', createMaterial);
    $('btnEditMaterial')?.addEventListener('click', openEditMaterialModal);
    $('btnSaveEditMaterial')?.addEventListener('click', saveEditMaterial);
    $('btnSwapPosition')?.addEventListener('click', swapPackagePositions);
    
    $('btnAgregarMat')?.addEventListener('click', addMaterial);
    $('tons')?.addEventListener('keypress', e => { if (e.key === 'Enter') addMaterial(); });
    $('tons')?.addEventListener('input', updateCalcPreview);
    $('pesoPaquete')?.addEventListener('input', updateCalcPreview);
    $('pesoPaquete')?.addEventListener('keypress', e => { if (e.key === 'Enter') $('tons')?.focus(); });
    
    $('btnAddAdit')?.addEventListener('click', addAditamento);
    
    $('btnCrearCarga')?.addEventListener('click', async () => {
        // Obtener el siguiente número de carga del servidor
        let numeroCarga;
        try {
            const nextNum = await api.getNextLoadNumber();
            numeroCarga = nextNum.next_number;
        } catch (e) {
            // Fallback si hay error - usar número 1
            numeroCarga = `TY-${new Date().getFullYear()}-1`;
        }
        
        // Limpiar estado para nueva carga - NO guardar en BD
        state.loadId = null;
        state.load = {
            id: null,
            fecha: utils.getToday(),
            numero_carga: numeroCarga,
            status: 'DRAFT',
            isNew: true
        };
        state.materials = [];
        state.aditamentos = [];
        state.placements = [];
        state.bedsStats = [];
        state.product = null;
        
        toast('Nueva carga iniciada (sin guardar)', 'info');
        updateAllUI();
        render3D();
    });
    
    $('btnGuardar')?.addEventListener('click', openSaveModal);
    $('btnConfirmSave')?.addEventListener('click', confirmSave);
    $('btnOptimizar')?.addEventListener('click', optimize);
    
    // Botones de modo de optimización
    $('btnMode1')?.addEventListener('click', () => setOptimizeMode('opt1'));
    $('btnMode2')?.addEventListener('click', () => setOptimizeMode('opt2'));
    $('btnConfigPriority')?.addEventListener('click', openPriorityModal);
    $('btnSavePriority')?.addEventListener('click', savePriorities);
    
    $('btnConsultar')?.addEventListener('click', () => {
        state.searchTab = 'fecha';
        switchSearchTab('fecha');
        openModal('modalConsulta');
    });
    $('btnExportPDF')?.addEventListener('click', exportPDF);
    
    $('btnSearchLoads')?.addEventListener('click', searchLoads);
    $('btnLoadSelected')?.addEventListener('click', loadSelectedLoad);
    
    $('btnResetView')?.addEventListener('click', () => { if (typeof resetView3D === 'function') resetView3D(); });
    $('btnTopView')?.addEventListener('click', () => { if (typeof topView3D === 'function') topView3D(); });
    $('btnFrontView')?.addEventListener('click', () => { if (typeof frontView3D === 'function') frontView3D(); });
    $('btnSideView')?.addEventListener('click', () => { if (typeof sideView3D === 'function') sideView3D(); });
    
    $('btnModeOpt')?.addEventListener('click', () => {
        state.mode = 'OPT';
        $('btnModeOpt')?.classList.add('active');
        $('btnModeMan')?.classList.remove('active');
        if (typeof setManualMode === 'function') setManualMode(false);
    });
    $('btnModeMan')?.addEventListener('click', () => {
        state.mode = 'MAN';
        $('btnModeMan')?.classList.add('active');
        $('btnModeOpt')?.classList.remove('active');
        if (typeof setManualMode === 'function') setManualMode(true);
    });
    
    // Eventos del panel de edición manual
    $('btnApplyEdit')?.addEventListener('click', () => {
        if (typeof applyPlacementEdit === 'function') applyPlacementEdit();
    });
    $('btnRotate')?.addEventListener('click', () => {
        if (typeof rotatePlacement === 'function') rotatePlacement();
    });
    $('btnCancelEdit')?.addEventListener('click', () => {
        if (typeof deselectPlacement === 'function') deselectPlacement();
    });
    $('btnSelectAllBed')?.addEventListener('click', () => {
        if (typeof selectAllBed === 'function') selectAllBed();
    });
    
    // === EVENTOS DE NOTAS DE CAMA ===
    $('btnAddNote')?.addEventListener('click', showNoteEditor);
    $('btnSaveNote')?.addEventListener('click', saveBedNote);
    $('btnCancelNote')?.addEventListener('click', hideNoteEditor);
    $('btnEditNote')?.addEventListener('click', editBedNote);
    
    document.querySelectorAll('.modal-backdrop').forEach(modal => {
        modal.addEventListener('click', e => {
            if (e.target === modal) modal.classList.remove('open');
        });
    });
    
    document.addEventListener('keydown', e => {
        if ((e.ctrlKey || e.metaKey) && e.key === 's') {
            e.preventDefault();
            saveLoad();
        }
        if (e.key === 'Escape') {
            document.querySelectorAll('.modal-backdrop.open').forEach(m => m.classList.remove('open'));
        }
    });
}

// ==================== BED NOTES ====================
function showNoteEditor() {
    const noteSection = $('bedNoteSection');
    const noteDisplay = $('bedNoteDisplay');
    const noteText = $('bedNoteText');
    
    if (noteSection) noteSection.style.display = 'block';
    if (noteDisplay) noteDisplay.style.display = 'none';
    if (noteText) noteText.focus();
}

function hideNoteEditor() {
    const noteSection = $('bedNoteSection');
    if (noteSection) noteSection.style.display = 'none';
    loadBedNote(); // Recargar para mostrar nota actual si existe
}

function editBedNote() {
    const noteContent = $('bedNoteContent');
    const noteText = $('bedNoteText');
    
    if (noteText && noteContent) {
        noteText.value = noteContent.textContent || '';
    }
    showNoteEditor();
}

async function saveBedNote() {
    if (!state.load?.id || !state.selectedBed) {
        toast('No hay carga o cama seleccionada', 'error');
        return;
    }
    
    const noteText = $('bedNoteText')?.value?.trim() || '';
    
    try {
        await api.saveBedNote(state.load.id, state.selectedBed, noteText);
        
        // Actualizar state.bedNotes
        if (!state.bedNotes) state.bedNotes = [];
        const existingIdx = state.bedNotes.findIndex(n => n.bed_number === state.selectedBed);
        if (existingIdx >= 0) {
            state.bedNotes[existingIdx].note = noteText;
        } else {
            state.bedNotes.push({ bed_number: state.selectedBed, note: noteText });
        }
        
        hideNoteEditor();
        toast('Nota guardada', 'success');
    } catch (err) {
        console.error('Error guardando nota:', err);
        toast('Error al guardar nota', 'error');
    }
}

async function loadBedNote() {
    const noteSection = $('bedNoteSection');
    const noteDisplay = $('bedNoteDisplay');
    const noteContent = $('bedNoteContent');
    const noteText = $('bedNoteText');
    
    if (noteSection) noteSection.style.display = 'none';
    if (noteDisplay) noteDisplay.style.display = 'none';
    
    if (!state.load?.id || !state.selectedBed) return;
    
    // Buscar nota en state.bedNotes (cargadas al cargar la carga)
    const note = state.bedNotes?.find(n => n.bed_number === state.selectedBed);
    
    if (note && note.note) {
        if (noteContent) noteContent.textContent = note.note;
        if (noteText) noteText.value = note.note;
        if (noteDisplay) noteDisplay.style.display = 'flex';
    }
}

// Exportar función para llamarla al cambiar de cama
window.loadBedNote = loadBedNote;

// ==================== GLOBAL ====================
window.removeMaterial = removeMaterial;
window.removeAditamento = removeAditamento;
window.selectBed = selectBed;
window.closeModal = closeModal;
window.switchSearchTab = switchSearchTab;
window.selectLoadItem = selectLoadItem;
window.loadSelectedLoad = loadSelectedLoad;
window.loadSelectedLoadDirect = loadSelectedLoadDirect;

// ==================== START ====================
document.addEventListener('DOMContentLoaded', init);