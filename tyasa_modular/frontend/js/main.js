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
    
    // Inicializar carga nueva local (sin número hasta que el usuario guarde)
    state.load = {
        id: null,
        fecha: utils.getToday(),
        numero_carga: null,
        status: 'DRAFT',
        isNew: true,
        userSaved: false
    };
    
    updateAllUI();
    render3D();
    draw2D(1);
    loadLearningStats();

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
    const sapTA = $('pasteClavesSAP');
    const pesoTA = $('pastePesos');
    const tonsTA = $('pasteToneladas');
    if (sapTA) sapTA.value = '';
    if (pesoTA) pesoTA.value = '';
    if (tonsTA) tonsTA.value = '';
    $('listaMaterialesEncontrados').style.display = 'none';
    $('materialesEncontradosContainer').innerHTML = '';
}

async function buscarMaterialesMultiple() {
    const sapLines = ($('pasteClavesSAP')?.value || '').split('\n').map(s => s.trim()).filter(s => s);
    const pesoLines = ($('pastePesos')?.value || '').split('\n').map(s => s.trim()).filter(s => s);
    const tonsLines = ($('pasteToneladas')?.value || '').split('\n').map(s => s.trim()).filter(s => s);

    if (sapLines.length === 0) {
        toast('Pega al menos una Clave SAP', 'error');
        return;
    }

    const items = sapLines.map((sap, i) => ({
        sap,
        peso: parseFloat(pesoLines[i]) || 0,
        tons: parseFloat(tonsLines[i]) || 0
    }));

    toast(`Buscando ${items.length} materiales...`, 'info');

    const container = $('materialesEncontradosContainer');
    container.innerHTML = '';

    let encontrados = 0;
    const noEncontrados = [];
    const inputStyle = 'width:100%;padding:4px 5px;background:var(--card);border:1px solid var(--border);border-radius:4px;color:var(--text-primary);font-size:11px;';

    for (const item of items) {
        try {
            const producto = await api.getProduct(item.sap);
            encontrados++;

            const card = document.createElement('div');
            card.className = 'material-card-multiple';
            card.style.cssText = 'border:1px solid var(--border);border-radius:8px;padding:12px;margin-bottom:10px;background:var(--bg-secondary);';

            const calibreTag = producto.calibre ? `<span style="font-size:11px;background:var(--primary);color:white;padding:2px 6px;border-radius:4px;margin-left:5px;">Cal. ${producto.calibre}</span>` : '';
            card.innerHTML = `
                <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:6px;">
                    <div>
                        <strong style="color:var(--primary);">${producto.sap_code}</strong>${calibreTag}
                        <span style="font-size:10px;color:var(--muted);margin-left:6px;">${producto.almacen || ''}</span>
                    </div>
                    <button class="btn btn-danger btn-sm" onclick="this.closest('.material-card-multiple').remove()" style="padding:2px 8px;">✕</button>
                </div>
                <div style="font-size:12px;color:var(--muted);margin-bottom:8px;">${producto.description}</div>
                <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;font-size:11px;margin-bottom:8px;">
                    <div>
                        <label style="display:block;color:var(--muted);margin-bottom:2px;">Largo (cm) ✏️</label>
                        <input type="number" class="input-multi" data-field="largo" value="${producto.largo_cm || 600}" style="${inputStyle}">
                    </div>
                    <div>
                        <label style="display:block;color:var(--muted);margin-bottom:2px;">Ancho (cm) ✏️</label>
                        <input type="number" class="input-multi" data-field="ancho" value="${producto.ancho_cm || 30}" style="${inputStyle}">
                    </div>
                    <div>
                        <label style="display:block;color:var(--muted);margin-bottom:2px;">Alto (cm) ✏️</label>
                        <input type="number" class="input-multi" data-field="alto" value="${producto.alto_cm || 15}" style="${inputStyle}">
                    </div>
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:11px;margin-bottom:8px;">
                    <div>
                        <label style="display:block;color:var(--muted);margin-bottom:2px;">Peso/Paq (ton)</label>
                        <input type="number" class="input-multi" data-field="peso" value="${item.peso || producto.peso_ton || ''}" step="0.001" style="${inputStyle}" oninput="updateCardPreview(this)">
                    </div>
                    <div>
                        <label style="display:block;color:var(--muted);margin-bottom:2px;">Toneladas a Enviar</label>
                        <input type="number" class="input-multi" data-field="tons" value="${item.tons || ''}" step="0.1" style="${inputStyle}" oninput="updateCardPreview(this)">
                    </div>
                </div>
                <div class="card-calc-preview" style="display:none;font-size:11px;background:var(--card);border-radius:4px;padding:6px 8px;margin-bottom:8px;border-left:3px solid var(--primary);"></div>
                <div style="display:flex;align-items:center;gap:8px;">
                    <input type="checkbox" class="chk-diferido-multi" id="chkDif_${producto.sap_code}" style="width:15px;height:15px;">
                    <label for="chkDif_${producto.sap_code}" style="font-size:11px;color:#ff6b6b;cursor:pointer;">Diferido</label>
                    <button class="btn btn-success btn-sm" onclick="agregarMaterialDesdeCard(this)" style="margin-left:auto;padding:4px 12px;">+ Agregar</button>
                </div>
            `;
            card.dataset.producto = JSON.stringify(producto);
            container.appendChild(card);

            // Mostrar preview si ya hay peso y toneladas prellenados
            const tonsInput = card.querySelector('[data-field="tons"]');
            if (tonsInput && parseFloat(tonsInput.value) > 0) {
                updateCardPreview(tonsInput);
            }

        } catch (e) {
            noEncontrados.push(item);
        }
    }

    $('listaMaterialesEncontrados').style.display = 'block';

    // Mostrar sección de no encontrados con opción de crear
    if (noEncontrados.length > 0) {
        const notFoundDiv = document.createElement('div');
        notFoundDiv.style.cssText = 'background:rgba(239,68,68,0.08);border:1px solid #ef4444;border-radius:8px;padding:12px;margin-top:10px;';
        notFoundDiv.innerHTML = `
            <div style="font-weight:bold;color:#ef4444;margin-bottom:8px;font-size:12px;">⚠️ ${noEncontrados.length} clave(s) no encontrada(s) en el catálogo:</div>
            ${noEncontrados.map(item => `
                <div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid rgba(239,68,68,0.2);">
                    <span style="font-family:monospace;font-size:12px;">${item.sap}</span>
                    <button onclick="abrirCrearMaterialDesdeNoEncontrado('${item.sap}', ${item.peso || 0}, ${item.tons || 0})"
                        style="font-size:11px;padding:3px 10px;background:var(--primary);color:white;border-radius:4px;border:none;cursor:pointer;">
                        + Crear en catálogo
                    </button>
                </div>
            `).join('')}
        `;
        container.appendChild(notFoundDiv);
    }

    if (encontrados > 0) toast(`${encontrados} material(es) encontrado(s)`, 'success');
    if (noEncontrados.length > 0) toast(`${noEncontrados.length} no encontrado(s) — ver abajo para crear`, 'warning');
}

function abrirCrearMaterialDesdeNoEncontrado(sap, peso, tons) {
    closeModal('modalBusquedaMultiple');
    if ($('newMatSap')) $('newMatSap').value = sap;
    if ($('newMatKgPaq') && peso > 0) $('newMatKgPaq').value = peso;
    openModal('modalMaterial');
}
window.abrirCrearMaterialDesdeNoEncontrado = abrirCrearMaterialDesdeNoEncontrado;

function updateCardPreview(input) {
    const card = input.closest('.material-card-multiple');
    if (!card) return;
    const preview = card.querySelector('.card-calc-preview');
    if (!preview) return;

    const peso = parseFloat(card.querySelector('[data-field="peso"]').value) || 0;
    const tons = parseFloat(card.querySelector('[data-field="tons"]').value) || 0;

    if (peso <= 0 || tons <= 0) {
        preview.style.display = 'none';
        return;
    }

    const kgPaq = peso * 1000;
    const kgTotal = tons * 1000;
    let numPaq = Math.floor(kgTotal / kgPaq);
    if (numPaq <= 0) {
        preview.style.display = 'none';
        return;
    }

    const kgSobrante = kgTotal - (numPaq * kgPaq);
    const kgFaltante = kgSobrante > 0 ? kgPaq - kgSobrante : 0;
    const autoCompletarHabilitado = $('chkAutoCompletarLista')?.checked !== false;
    const autoCompletar = kgSobrante > 0 && kgFaltante < 400 && autoCompletarHabilitado;
    const numPaqFinal = autoCompletar ? numPaq + 1 : numPaq;
    const tonEnPaquetes = (numPaqFinal * kgPaq) / 1000;

    let html = `<span style="color:var(--text-primary);">📦 <b>${numPaqFinal}</b> paquete(s) · <b>${tonEnPaquetes.toFixed(3)}</b> t</span>`;
    if (autoCompletar) {
        html += `&nbsp;<span style="color:var(--green);">⚡ +1 auto-completado (+${kgFaltante.toFixed(1)} kg)</span>`;
    } else if (kgSobrante > 0) {
        html += `&nbsp;<span style="color:var(--amber);">⚠️ Sobrante: ${(kgSobrante/1000).toFixed(3)} t</span>`;
    }

    preview.innerHTML = html;
    preview.style.display = 'block';
}
window.updateCardPreview = updateCardPreview;

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
    const kgPaq = peso * 1000;
    const kgTotal = tons * 1000;
    let numPaquetes = Math.floor(kgTotal / kgPaq);
    const kgSobrante = kgTotal - (numPaquetes * kgPaq);
    const kgFaltante = kgSobrante > 0 ? kgPaq - kgSobrante : 0;
    const autoCompletarHabilitadoLista = $('chkAutoCompletarLista')?.checked !== false;
    const autoCompletar = kgSobrante > 0 && kgFaltante < 400 && autoCompletarHabilitadoLista;
    if (autoCompletar) numPaquetes += 1;
    const tonsPorPaquete = peso;

    for (let i = 0; i < numPaquetes; i++) {
        const esAutoCompletado = autoCompletar && i === numPaquetes - 1;
        const material = {
            sap_code: producto.sap_code,
            description: producto.description,
            material_type: producto.material_type,
            almacen: producto.almacen || 'Formados',
            calibre: producto.calibre || 0,
            largo_mm: largo * 10,
            ancho_mm: ancho * 10,
            alto_mm: alto * 10,
            kg_por_paquete: kgPaq,
            tons_solicitadas: tonsPorPaquete,
            is_deferred: isDiferido,
            auto_completado_kg: esAutoCompletado ? kgFaltante : 0
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

    let msgCard = `${numPaquetes} paquete(s) de ${producto.sap_code} agregados`;
    if (autoCompletar) msgCard += ` · Auto-completado: +${kgFaltante.toFixed(1)} kg para paquete extra`;
    toast(msgCard, 'success');
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
    
    // Construir mapa de razones desde la última optimización
    const reasonMap = {};
    if (state.notPlacedDetails && state.notPlacedDetails.length > 0) {
        for (const d of state.notPlacedDetails) {
            reasonMap[d.sap_code] = d.reason;
        }
    }

    // Renderizar
    let html = '';
    for (const key in grouped) {
        const g = grouped[key];
        const reason = reasonMap[g.sap_code];
        let reasonLabel = '';
        if (reason === 'peso_excedido') {
            reasonLabel = `<span style="color:#f59e0b; font-size:0.8em; margin-left:6px;" title="El transporte alcanzó su límite de peso">(Peso excedido)</span>`;
        } else if (reason === 'sin_espacio') {
            reasonLabel = `<span style="color:#6366f1; font-size:0.8em; margin-left:6px;" title="No hay espacio o altura disponible en el transporte">(Sin espacio)</span>`;
        }
        html += `<div style="display:flex; justify-content:space-between; padding:4px 0; border-bottom:1px solid var(--border);">
            <span><strong>${g.sap_code}</strong> - ${g.description.substring(0, 30)}...${reasonLabel}</span>
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
    let numPaq = Math.floor(kgTotal / kgPaq);

    if (numPaq <= 0) return toast(`Toneladas menores a un paquete (${pesoTon} ton)`, 'error');

    const kgEnPaquetesBase = numPaq * kgPaq;
    const kgSobrante = kgTotal - kgEnPaquetesBase;
    const kgFaltante = kgSobrante > 0 ? kgPaq - kgSobrante : 0;
    const autoCompletarHabilitado = $('chkAutoCompletar')?.checked !== false;
    const autoCompletar = kgSobrante > 0 && kgFaltante < 400 && autoCompletarHabilitado;
    if (autoCompletar) numPaq += 1;

    // CREAR UN MATERIAL POR CADA PAQUETE INDIVIDUAL
    for (let i = 0; i < numPaq; i++) {
        const esAutoCompletado = autoCompletar && i === numPaq - 1;
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
            is_deferred: isDiferido,  // Si es diferido
            auto_completado_kg: esAutoCompletado ? kgFaltante : 0  // Kg auto-completados
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

    // Mostrar mensaje con info
    let msg = `${numPaq} paquetes agregados (${largoCm}×${anchoCm}×${altoCm} cm)`;
    if (autoCompletar) {
        msg += ` · Auto-completado: +${kgFaltante.toFixed(1)} kg para paquete extra`;
    } else if (kgSobrante > 0) {
        msg += ` · Sobrante: ${(kgSobrante/1000).toFixed(3)} ton`;
    }
    toast(msg, 'success');
    updateAllUI();
    render3D();
}

async function removeMaterial(index) {
    const material = state.materials[index];
    if (!material) return;

    // Si hay placements y el material tiene un ID de BD, eliminar solo los de ese item
    if (material.id && state.placements.length > 0) {
        if (state.loadId) {
            try {
                await api.deleteLoadItem(state.loadId, material.id);
            } catch (e) {
                console.warn('No se pudo eliminar del servidor:', e.message);
            }
        }
        // Filtrar solo los placements del material eliminado
        state.placements = state.placements.filter(p => p.load_item_id !== material.id);
    } else if (!material.id && state.placements.length > 0) {
        // Material sin ID (carga sin guardar): limpiar todos los placements
        state.placements = [];
    }

    state.materials.splice(index, 1);
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

    // Solo crear estado local, NO guardar en BD todavía
    // El número se asigna solo cuando el usuario guarda explícitamente
    state.loadId = null;
    state.load = {
        id: null,
        fecha,
        numero_carga: null,
        status: 'DRAFT',
        isNew: true,
        userSaved: false
    };
    state.placements = [];
    state.bedsStats = [];
    state.materials = [];
    state.aditamentos = [];

    console.log('Nueva carga iniciada localmente (sin número asignado)');
    return true;
}

async function saveLoadToDatabase() {
    // Crear la carga en la BD si es nueva
    const fecha = state.load?.fecha || utils.getToday();

    // Usar el número del state; si no hay (carga no guardada por usuario), usar placeholder
    const numero = state.load?.numero_carga || 'BORRADOR';
    
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

        // Incluir número de carga definitivo
        if (state.load?.numero_carga) {
            updateData.numero_carga = state.load.numero_carga;
        }

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

async function applyTruckEdit() {
    if (!state.truck) return;

    const newL    = parseInt($('editTruckL').value)    || state.truck.length_mm;
    const newW    = parseInt($('editTruckW').value)    || state.truck.width_mm;
    const newH    = parseInt($('editTruckH').value)    || state.truck.height_mm;
    const newBeds = parseInt($('editTruckBeds').value) || state.truck.beds_count;
    const newKg   = parseInt($('editTruckKg').value)   || state.truck.max_payload_kg;

    const payload = {
        id: state.truck.id,
        name: state.truck.name,
        length_mm: newL,
        width_mm: newW,
        height_mm: newH,
        beds_count: newBeds,
        max_payload_kg: newKg,
        is_dual_platform: state.truck.is_dual_platform || false,
        platforms: state.truck.platforms || 1,
        platform_gap_mm: state.truck.platform_gap_mm || 500
    };

    try {
        const updated = await api.updateTruck(state.truck.id, payload);
        // Actualizar state local
        Object.assign(state.truck, updated);
        // Actualizar en el array de camiones
        const idx = state.trucks.findIndex(t => t.id === state.truck.id);
        if (idx >= 0) Object.assign(state.trucks[idx], updated);

        closeModal('modalEditTruck');
        toast('Camión actualizado y guardado correctamente', 'success');
        updateTruckInfo();
        updatePayloadInfo();
        render3D();
    } catch (e) {
        toast('Error al guardar camión: ' + e.message, 'error');
    }
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

// Colores por tipo de material
const MAT_TYPE_COLORS = {
    'LARGOS': '#f59e0b', 'SBQ': '#8b5cf6', 'PLANOS': '#06b6d4', 'GALV': '#10b981'
};

// Abrir modal de prioridades (por SAP + almacén)
function openPriorityModal() {
    if (state.materials.length === 0) {
        toast('Agrega materiales primero para configurar prioridades', 'warning');
        return;
    }

    // Agrupar materiales únicos por (sap_code, almacen)
    const groupsMap = {};
    state.materials.forEach(m => {
        const key = `${m.sap_code}||${m.almacen || ''}`;
        if (!groupsMap[key]) {
            groupsMap[key] = {
                key,
                sap_code: m.sap_code,
                almacen: m.almacen || '',
                material_type: m.material_type || 'LARGOS',
                description: m.description || m.sap_code,
                calibre: m.calibre || null,
                count: 0
            };
        }
        groupsMap[key].count += (m.num_paquetes || 1);
    });

    const groups = Object.values(groupsMap);
    if (groups.length === 0) { toast('Sin materiales', 'warning'); return; }

    // Ordenar: forzados primero, luego por prioridad guardada, luego alfabético
    groups.sort((a, b) => {
        const pa = state.almacenPriorities.find(p => p.sap_code === a.sap_code && p.almacen === a.almacen);
        const pb = state.almacenPriorities.find(p => p.sap_code === b.sap_code && p.almacen === b.almacen);
        const fa = pa?.forced ? 0 : (pa?.priority || 999);
        const fb = pb?.forced ? 0 : (pb?.priority || 999);
        if (fa !== fb) return fa - fb;
        return a.description.localeCompare(b.description);
    });

    const container = $('almacenPriorityList');
    container.innerHTML = '';
    const numGroups = groups.length;

    const note = document.createElement('div');
    note.style.cssText = 'font-size:11px;color:var(--muted);margin-bottom:8px;padding:6px 8px;background:var(--surface);border-radius:4px;';
    note.textContent = 'Forzar = ese material se coloca SIEMPRE primero. Prioridad 1° = primero. Sin asignar = el algoritmo decide con lo aprendido.';
    container.appendChild(note);

    groups.forEach((group, idx) => {
        const saved = state.almacenPriorities.find(p => p.sap_code === group.sap_code && p.almacen === group.almacen);
        const isForzado = saved?.forced || false;
        const priority = saved?.priority || (idx + 1);
        const color = MAT_TYPE_COLORS[group.material_type] || '#6b7280';
        const almacenTag = group.almacen ? `<span style="font-size:10px;color:var(--muted);margin-left:4px;">${group.almacen}</span>` : '';

        const div = document.createElement('div');
        div.style.cssText = `display:flex;align-items:center;gap:8px;padding:7px 10px;background:var(--bg-secondary);border:1px solid ${isForzado ? '#22c55e' : 'var(--border)'};border-radius:6px;margin-bottom:5px;`;
        div.innerHTML = `
            <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color};flex-shrink:0;"></span>
            <div style="flex:1;min-width:0;">
                <div style="font-size:12px;font-weight:600;word-break:break-word;line-height:1.3;">${group.sap_code} - ${group.description}</div>
                <div style="font-size:10px;color:var(--muted);">${almacenTag} ${group.count} paq · Cal.${group.calibre || '—'}</div>
            </div>
            <label style="font-size:11px;color:#22c55e;white-space:nowrap;cursor:pointer;display:flex;align-items:center;gap:3px;">
                <input type="checkbox" class="forced-check"
                    data-sap="${group.sap_code}" data-almacen="${group.almacen}"
                    ${isForzado ? 'checked' : ''}>
                Forzar
            </label>
            <select class="priority-select"
                data-sap="${group.sap_code}" data-almacen="${group.almacen}"
                data-material-type="${group.material_type}"
                style="padding:3px 6px;border-radius:4px;border:1px solid var(--border);background:var(--surface);color:var(--text-primary);font-size:11px;width:60px;">
                <option value="0">—</option>
                ${Array.from({length: numGroups}, (_, i) =>
                    `<option value="${i+1}" ${priority === i+1 ? 'selected' : ''}>${i+1}°</option>`
                ).join('')}
            </select>
        `;
        container.appendChild(div);
    });

    openModal('modalPriority');
}

// Guardar prioridades por SAP + almacén
function savePriorities() {
    state.almacenPriorities = [];

    document.querySelectorAll('.priority-select').forEach(sel => {
        const prio = parseInt(sel.value);
        const forced = document.querySelector(`.forced-check[data-sap="${sel.dataset.sap}"][data-almacen="${sel.dataset.almacen}"]`)?.checked || false;
        if (prio > 0 || forced) {
            state.almacenPriorities.push({
                sap_code: sel.dataset.sap,
                almacen: sel.dataset.almacen,
                material_type: sel.dataset.materialType || null,
                calibre: null,
                priority: forced ? 1 : prio,
                forced
            });
        }
    });

    state.almacenPriorities.sort((a, b) => (a.forced ? 0 : a.priority) - (b.forced ? 0 : b.priority));
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
    const usePriorities = $('usePriorities')?.checked !== false; // default true
    const heightDiffMode = document.querySelector('.height-mode-btn.active')?.dataset?.mode || 'strict';
    
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
        const prioridades = usePriorities ? state.almacenPriorities : [];
        const res = await api.optimize(state.loadId, optimizeMode, prioridades, truckQuantity, gapFloorToBed, gapBetweenBeds, centerPackages, heightDiffMode);
        console.log('Resultado optimización:', res);
        // Guardar configuración de gaps para usarla en movimientos manuales
        state.gapBetweenBeds = gapBetweenBeds;
        state.gapFloorToBed  = gapFloorToBed;
        
        // Guardar stats de camas y altura total
        state.bedsStats = res.beds_stats || [];
        state.totalHeight = res.total_height_mm || 0;
        state.notPlacedDetails = res.not_placed_details || [];
        
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

        // Habilitar botón de verificar ahora que hay placements
        enableVerifyButton(true);
        enableSuggestionsButton(true);

        // Mostrar mensaje con sin colocar si hay
        const notPlaced = state.placements.filter(p => !p.placed).length;
        const learnInfo = res.patterns_applied > 0
            ? ` · 🧠 ${res.patterns_applied} patrones (${Math.round((res.learning_alpha || 0) * 100)}% influencia)`
            : '';
        if (notPlaced > 0) {
            toast(`⚠️ ${notPlaced} sin colocar${learnInfo}`, 'warning');
        } else {
            toast(`✓ ${res.total_placed} paquetes en ${res.beds_used} camas${learnInfo}`, 'success');
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
        
        state.load = { ...data, userSaved: true };
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

        // Botón verificar: habilitado si hay placements y no fue verificada ya
        const isVerified = data.status === 'VERIFIED';
        const hasPlaced = state.placements.some(p => p.placed);
        const btn = $('btnVerificarAprender');
        if (btn) {
            if (isVerified) {
                btn.textContent = '✅ Ya verificada';
                btn.disabled = true;
                btn.style.opacity = '0.6';
                btn.style.cursor = 'not-allowed';
            } else {
                btn.textContent = '✅ Verificar y Aprender';
                enableVerifyButton(hasPlaced);
            }
        }

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

    // Asignar número definitivo de carga solo si no tiene uno válido aún
    const tieneNumero = state.load?.numero_carga && !state.load.numero_carga.startsWith('BORRADOR');
    if (!tieneNumero) {
        try {
            const nextNum = await api.getNextLoadNumber();
            if (state.load) state.load.numero_carga = nextNum.next_number;
        } catch (e) {
            if (state.load) state.load.numero_carga = `TY-${new Date().getFullYear()}-1`;
        }
    }

    if (state.load) state.load.userSaved = true;

    // Guardar en state para usar en saveLoad / saveMetadataOnly
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
        // Si hay un borrador auto-guardado (no guardado explícitamente por el usuario), eliminarlo
        if (state.loadId && !state.load?.userSaved) {
            try {
                await api.deleteLoad(state.loadId);
            } catch (e) {
                // Ignorar errores al limpiar borrador
            }
        }

        // Limpiar estado local — NO guardar en BD, sin asignar número
        state.loadId = null;
        state.load = {
            id: null,
            fecha: utils.getToday(),
            numero_carga: null,
            status: 'DRAFT',
            isNew: true,
            userSaved: false
        };
        state.materials = [];
        state.aditamentos = [];
        state.placements = [];
        state.bedsStats = [];
        state.product = null;

        // Resetear botón verificar
        const btnV = $('btnVerificarAprender');
        if (btnV) { btnV.textContent = '✅ Verificar y Aprender'; }
        enableVerifyButton(false);
        enableSuggestionsButton(false);

        toast('Nueva carga iniciada', 'info');
        updateAllUI();
        render3D();
    });
    
    $('btnGuardar')?.addEventListener('click', openSaveModal);
    $('btnConfirmSave')?.addEventListener('click', confirmSave);
    $('btnOptimizar')?.addEventListener('click', optimize);
    
    // Botones de modo de optimización
    $('btnMode1')?.addEventListener('click', () => setOptimizeMode('opt1'));
    $('btnMode2')?.addEventListener('click', () => setOptimizeMode('opt2'));

    // Botones de tolerancia de altura
    document.querySelectorAll('.height-mode-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.height-mode-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        });
    });

    $('btnConfigPriority')?.addEventListener('click', openPriorityModal);
    $('btnSavePriority')?.addEventListener('click', savePriorities);
    
    $('btnVerificarAprender')?.addEventListener('click', verifyLoad);

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

// ==================== APRENDIZAJE ====================

function enableVerifyButton(enabled) {
    const btn = $('btnVerificarAprender');
    if (!btn) return;
    if (enabled) {
        btn.disabled = false;
        btn.style.opacity = '1';
        btn.style.cursor = 'pointer';
        btn.title = 'Guardar este acomodo para que el sistema aprenda de él';
    } else {
        btn.disabled = true;
        btn.style.opacity = '0.5';
        btn.style.cursor = 'not-allowed';
        btn.title = 'Optimiza la carga primero para habilitar esta opción';
    }
    if (typeof enableSuggestionsButton === 'function') {
        enableSuggestionsButton(enabled);
    }
}

async function verifyLoad() {
    if (!state.loadId) return toast('No hay carga guardada', 'error');
    if (!state.placements || state.placements.length === 0) return toast('Optimiza primero antes de verificar', 'error');

    const btn = $('btnVerificarAprender');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Aprendiendo...'; }

    try {
        const res = await api.verifyLoad(state.loadId);
        toast(`✅ Aprendido: ${res.patterns_updated} grupos de materiales · ${res.packages_learned} paquetes`, 'success');

        // Actualizar estado local
        if (state.load) state.load.status = 'VERIFIED';
        updateLoadStatus();

        // Deshabilitar el botón (ya fue verificada esta carga)
        if (btn) {
            btn.textContent = '✅ Verificado';
            btn.style.opacity = '0.6';
            btn.style.cursor = 'not-allowed';
            btn.disabled = true;
        }

        // Refrescar badge de estadísticas
        await loadLearningStats();
    } catch (e) {
        const msg = e.message || 'Error al verificar';
        toast(msg.includes('ya fue verificada') ? '⚠️ Esta carga ya fue verificada anteriormente' : `Error: ${msg}`, 'error');
        if (btn) { btn.disabled = false; btn.textContent = '✅ Verificar y Aprender'; }
    }
}

async function loadLearningStats() {
    try {
        const stats = await api.getLearningStats();
        const badge = $('learningBadge');
        const text = $('learningStatsText');
        if (!badge || !text) return;

        if (stats.verified_loads > 0) {
            badge.style.display = 'block';
            const bedInfo = stats.bed_patterns > 0 ? ` · ${stats.bed_patterns} patrones de zona` : '';
            const comboInfo = stats.material_combos_learned > 0 ? ` · ${stats.material_combos_learned} combos` : '';
            text.textContent = `Aprendido de ${stats.verified_loads} carga(s) · ${stats.total_packages_learned} paquetes${bedInfo}${comboInfo}`;
        } else {
            badge.style.display = 'none';
        }
    } catch (e) {
        // Silencioso — el sistema de aprendizaje es opcional
    }
}

// ==================== GLOBAL ====================
window.removeMaterial = removeMaterial;
window.removeAditamento = removeAditamento;
window.selectBed = selectBed;
window.closeModal = closeModal;
window.switchSearchTab = switchSearchTab;
window.selectLoadItem = selectLoadItem;
window.loadSelectedLoad = loadSelectedLoad;
window.loadSelectedLoadDirect = loadSelectedLoadDirect;
window.verifyLoad = verifyLoad;
window.enableVerifyButton = enableVerifyButton;

// ==================== SUGERENCIAS DE ACOMODO ====================

async function openSuggestions() {
  if (!state.loadId) {
    if (state.materials.length === 0) { toast('Agrega materiales primero', 'error'); return; }
    toast('Guardando materiales...', 'info');
    const saved = await saveLoad();
    if (!saved) return;
  }
  document.getElementById('modalSugerencias').classList.add('open');
  await loadSuggestions();
}

function closeSuggestions() {
  document.getElementById('modalSugerencias').classList.remove('open');
}

async function loadSuggestions() {
  const body = document.getElementById('suggestionsBody');
  if (!body) return;
  body.innerHTML = '<div class="sug-loading">🔍 Consultando patrones aprendidos...</div>';
  try {
    const data = await api.request(`/api/learning/suggest/${state.loadId}`);
    const hasResults = (data.suggestions || []).length > 0 || (data.combo_suggestions || []).length > 0;

    if (!hasResults) {
      // Verificar si hay cargas verificadas pero sin BedPattern (tablas nuevas vacías)
      const stats = await api.getLearningStats();
      if (stats.verified_loads > 0 && stats.bed_patterns === 0) {
        body.innerHTML = '<div class="sug-loading">🔄 Primera vez con datos nuevos — reconstruyendo patrones de zona...</div>';
        try {
          const rebuilt = await api.rebuildPatterns();
          if (rebuilt.success) {
            // Reintentar sugerencias
            const data2 = await api.request(`/api/learning/suggest/${state.loadId}`);
            renderSuggestions(data2);
            await loadLearningStats();
            return;
          }
        } catch (e2) { /* continuar con mensaje normal */ }
      }
    }
    renderSuggestions(data);
  } catch (e) {
    body.innerHTML = `<div class="sug-empty"><div style="font-size:32px;margin-bottom:10px">🧠</div>
      <p>No hay suficientes cargas verificadas todavía.<br>
      <small>Verifica más cargas con "✅ Verificar y Aprender".</small></p></div>`;
  }
}

function renderSuggestions(data) {
  const body = document.getElementById('suggestionsBody');
  if (!body) return;
  const sugsA  = (data.suggestions || []).filter(s => s.zona === 'A');
  const sugsB  = (data.suggestions || []).filter(s => s.zona === 'B');
  const combos = data.combo_suggestions || [];
  if (sugsA.length === 0 && sugsB.length === 0 && combos.length === 0) {
    body.innerHTML = `<div class="sug-empty"><div style="font-size:32px;margin-bottom:10px">🧠</div>
      <p>El sistema aún no tiene suficientes datos para esta carga.<br>
      <small>Verifica más cargas para que aprenda tus patrones.</small></p></div>`;
    return;
  }
  const posLabels = { CENTER:'🎯 Centrado', SPREAD:'↔️ Distribuido', LEFT:'⬅️ Lado piloto', RIGHT:'➡️ Lado copiloto' };
  function buildCard(s) {
    const isA = s.zona === 'A';
    const tagZone = isA
      ? '<span class="sug-tag tag-zona-a">📍 Atrás de la concha</span>'
      : '<span class="sug-tag tag-zona-b">⚙️ Sobre los ejes</span>';
    const confPct = Math.min(100, s.confianza * 20);
    return `<div class="sug-card">
      <div class="sug-icon ${isA ? 'zone-a' : 'zone-b'}">${isA ? '🔵' : '🟡'}</div>
      <div class="sug-content">
        <div class="sug-sap">${s.sap_code}</div>
        <div class="sug-desc" title="${s.description}">${(s.description||'').substring(0,40)}</div>
        <div class="sug-tags">
          ${tagZone}
          <span class="sug-tag tag-cama">Cama ~${s.cama_tipica}</span>
          <span class="sug-tag tag-pkgs">~${s.pkgs_tipicos} paq/cama</span>
          <span class="sug-tag tag-pos">${posLabels[s.posicion]||s.posicion}</span>
        </div>
      </div>
      <div class="sug-confidence">${s.confianza}x
        <div class="confidence-bar"><div class="confidence-fill" style="width:${confPct}%"></div></div>
      </div>
    </div>`;
  }
  function buildCombo(c) {
    return `<div class="combo-card"><span style="font-size:18px">🔗</span>
      <div style="flex:1"><div class="combo-saps">${c.sap_a} + ${c.sap_b}</div>
      <div class="combo-info">Suelen ir juntos en cama ~${c.cama}</div></div>
      <span class="combo-badge">${c.veces}×</span></div>`;
  }
  body.innerHTML = `
    <div class="sug-summary">🧠 ${sugsA.length + sugsB.length} sugerencia(s) · ${combos.length} combo(s)</div>
    <div class="sug-tabs">
      <button class="sug-tab ${sugsA.length ? 'active-a' : ''}" onclick="showSugTab('a')">🔵 Zona A · Concha (${sugsA.length})</button>
      <button class="sug-tab" onclick="showSugTab('b')">🟡 Zona B · Ejes (${sugsB.length})</button>
      ${combos.length ? `<button class="sug-tab" onclick="showSugTab('c')">🔗 Combos (${combos.length})</button>` : ''}
    </div>
    <div id="sugPanelA">${sugsA.length ? sugsA.map(buildCard).join('') : '<div class="sug-empty">Sin sugerencias para Zona A</div>'}</div>
    <div id="sugPanelB" style="display:none">${sugsB.length ? sugsB.map(buildCard).join('') : '<div class="sug-empty">Sin sugerencias para Zona B</div>'}</div>
    <div id="sugPanelC" style="display:none">${combos.length ? combos.map(buildCombo).join('') : '<div class="sug-empty">Sin combos aprendidos</div>'}</div>`;
}

function showSugTab(tab) {
  ['a','b','c'].forEach(t => {
    const p = document.getElementById('sugPanel' + t.toUpperCase());
    if (p) p.style.display = t === tab ? 'block' : 'none';
  });
  document.querySelectorAll('.sug-tab').forEach((el, i) => {
    el.className = 'sug-tab';
    if (['a','b','c'][i] === tab) el.classList.add(tab === 'a' ? 'active-a' : tab === 'b' ? 'active-b' : 'active-c');
  });
}

function enableSuggestionsButton(enabled) {
  const btn = document.getElementById('btnVerSugerencias');
  if (btn) btn.disabled = !enabled;
}

window.openSuggestions  = openSuggestions;
window.closeSuggestions = closeSuggestions;
window.showSugTab       = showSugTab;
window.enableSuggestionsButton = enableSuggestionsButton;

// ==================== START ====================
document.addEventListener('DOMContentLoaded', init);