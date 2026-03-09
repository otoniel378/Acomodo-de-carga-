// ui.js - Funciones de interfaz de usuario

// Selector corto
const $ = id => document.getElementById(id);

// ==================== TOAST ====================
function toast(message, type = 'info') {
    const t = $('toast');
    if (!t) return;
    t.textContent = message;
    t.className = `toast show ${type}`;
    setTimeout(() => t.className = 'toast', 3000);
}

// ==================== MODALES ====================
function openModal(id) {
    const modal = $(id);
    if (modal) modal.classList.add('open');
}

function closeModal(id) {
    const modal = $(id);
    if (modal) modal.classList.remove('open');
}

// ==================== CONEXIÓN ====================
function updateConnectionStatus(connected) {
    state.connected = connected;
    const badge = $('connBadge');
    const text = $('connText');
    if (badge && text) {
        badge.className = connected ? 'badge success' : 'badge error';
        text.textContent = connected ? 'Conectado' : 'Sin conexión';
    }
}

// ==================== CAMIONES ====================
function renderTruckSelect() {
    const select = $('truckSelect');
    if (!select) return;
    
    select.innerHTML = '<option value="">— Selecciona —</option>' +
        state.trucks.map(t => 
            `<option value="${t.id}">${t.name} (${t.beds_count} camas)</option>`
        ).join('');
    
    if (state.truck) {
        select.value = state.truck.id;
    }
}

function updateTruckInfo() {
    const info = $('truckInfo');
    if (!info) return;
    
    if (state.truck) {
        const t = state.truck;
        const qty = state.truckQuantity || 1;
        const isDualPlatform = t.is_dual_platform || t.id === 'FULL' || t.id === 'TORTON_DOBLE';
        // Para dual-platform max_payload_kg es por plana; mostrar total × planas
        const totalPayload = isDualPlatform ? t.max_payload_kg * 2 : (qty > 1 ? t.max_payload_kg * qty : t.max_payload_kg);
        const qtyLabel = qty > 1 ? ` × ${qty} unidades` : '';
        const perPlanaLabel = isDualPlatform ? ` (${utils.formatNumber(t.max_payload_kg)} kg/plana)` : '';

        info.innerHTML = `<b>${utils.formatNumber(t.length_mm)} × ${utils.formatNumber(t.width_mm)} × ${utils.formatNumber(t.height_mm)} mm</b>${qtyLabel}<br/>
            ${t.beds_count} camas/plana · Planas: ${isDualPlatform ? 2 : qty} · Máx: ${utils.formatNumber(totalPayload)} kg${perPlanaLabel}`;
    } else {
        info.textContent = 'Selecciona un camión para ver sus dimensiones';
    }
}

// ==================== PRODUCTO ====================
function renderProductInfo() {
    const box = $('productBox');
    const tonsSection = $('tonsSection');
    const dimensionsSection = $('dimensionsSection');
    if (!box) return;
    
    if (!state.product) {
        box.style.display = 'none';
        if (tonsSection) tonsSection.style.display = 'none';
        if (dimensionsSection) dimensionsSection.style.display = 'none';
        return;
    }
    
    const p = state.product;
    box.style.display = 'block';
    if (tonsSection) tonsSection.style.display = 'block';
    if (dimensionsSection) dimensionsSection.style.display = 'block';
    
    // Color basado en calibre
    const color = getColorByCalibre(p.calibre);
    
    // Usar valores directos del Excel (ya vienen en cm y ton)
    const largoCm = p.largo_cm || (p.largo_mm / 10) || 600;
    const altoCm = p.alto_cm || (p.alto_mm / 10) || 15;
    const anchoCm = p.ancho_cm || (p.ancho_mm / 10) || 30;
    
    // NO mostrar dimensiones en el box de info (se muestran en campos editables)
    box.innerHTML = `
        <div class="product-header">
            <span class="product-type" style="background:${color.hex}20;color:${color.hex};border:1px solid ${color.hex}">${p.material_type || 'PRODUCTO'}</span>
            <span class="product-almacen">${p.almacen || '—'}</span>
        </div>
        <div class="product-name">${p.description}</div>
        <div class="product-grid">
            <div class="item"><span>Clave</span><b>${p.sap_code}</b></div>
            <div class="item"><span>Medida</span><b>${p.medida || '—'}</b></div>
            <div class="item"><span>Calibre</span><b>${p.calibre || '—'}</b></div>
            <div class="item"><span>Ancho paq</span><b>${anchoCm} cm</b></div>
        </div>`;
    
    // Pre-llenar dimensiones del paquete (editables)
    const pkgLargo = $('pkgLargo');
    const pkgAncho = $('pkgAncho');
    const pkgAlto = $('pkgAlto');
    
    if (pkgLargo) pkgLargo.value = largoCm.toFixed(1);
    if (pkgAncho) pkgAncho.value = anchoCm.toFixed(1);
    if (pkgAlto) pkgAlto.value = altoCm.toFixed(1);
    
    // Pre-llenar peso por paquete si está disponible en el Excel (como sugerencia)
    const pesoInput = $('pesoPaquete');
    if (pesoInput) {
        const pesoTon = p.peso_ton || (p.kg_por_paquete / 1000);
        if (pesoTon && pesoTon > 0) {
            pesoInput.value = pesoTon.toFixed(3);
        } else {
            pesoInput.value = '';
        }
    }
    
    // Focus en el primer campo de dimensión
    if (pkgLargo) pkgLargo.focus();
}

// Preview de cálculo de paquetes
function updateCalcPreview() {
    const preview = $('calcPreview');
    const tonsInput = $('tons');
    const pesoInput = $('pesoPaquete');
    if (!preview || !state.product) return;
    
    const tons = parseFloat(tonsInput?.value) || 0;
    const pesoTon = parseFloat(pesoInput?.value) || 0;
    
    if (tons <= 0 || pesoTon <= 0) {
        preview.style.display = 'none';
        return;
    }
    
    const kgPaq = pesoTon * 1000;  // Convertir ton a kg
    const kgTotal = tons * 1000;
    const numPaq = Math.floor(kgTotal / kgPaq);
    const kgEnPaquetes = numPaq * kgPaq;
    const kgSobrante = kgTotal - kgEnPaquetes;
    const tonsSobrante = kgSobrante / 1000;
    
    preview.style.display = 'block';
    preview.innerHTML = `
        <div class="calc-row">
            <span>Paquetes completos:</span>
            <b>${numPaq}</b>
        </div>
        <div class="calc-row">
            <span>Toneladas en paquetes:</span>
            <b>${(kgEnPaquetes/1000).toFixed(3)} t</b>
        </div>
        ${kgSobrante > 0 ? `
        <div class="calc-row sobrante">
            <span>⚠️ Sobrante (no completa paquete):</span>
            <b>${tonsSobrante.toFixed(3)} t (${kgSobrante.toFixed(1)} kg)</b>
        </div>
        ` : ''}
    `;
}

// ==================== MATERIALES ====================
function renderMaterialsTable() {
    const tbody = $('matTableBody');
    const count = $('matCountBadge');
    const summary = $('tonsSummary');
    if (!tbody) return;
    
    if (state.materials.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--muted);">Sin materiales</td></tr>';
        if (count) count.textContent = '0';
        if (summary) summary.style.display = 'none';
        return;
    }
    
    let totalSolicitadas = 0;
    let totalEnPaquetes = 0;
    let totalSobrantes = 0;
    let totalPaquetes = 0;
    
    tbody.innerHTML = state.materials.map((m, i) => {
        const tons = m.tons_solicitadas || m.tons || 0;
        const tonsPaq = m.tons_en_paquetes || tons;
        const tonsSobr = m.tons_sobrantes || 0;
        const numPaq = m.num_paquetes || 1;
        // Mostrar calibre solo si es un número válido mayor a 0
        const calibre = (m.calibre && m.calibre > 0) ? m.calibre : '—';
        const almacen = m.almacen || '—';
        
        totalSolicitadas += tons;
        totalEnPaquetes += tonsPaq;
        totalSobrantes += tonsSobr;
        totalPaquetes += numPaq;
        
        // Color basado en calibre
        const color = getColorByCalibre(m.calibre);
        
        return `
        <tr>
            <td><span class="sap-badge" style="border-left:3px solid ${color.hex}">${m.sap_code}</span></td>
            <td title="${m.description}">${(m.description || '').slice(0, 10)}${m.description?.length > 10 ? '...' : ''}</td>
            <td>${tons.toFixed(2)}</td>
            <td><b>${calibre}</b></td>
            <td>${almacen}</td>
            <td><button class="btn-del" onclick="removeMaterial(${i})">×</button></td>
        </tr>`;
    }).join('');
    
    if (count) count.textContent = state.materials.length;
    
    // Resumen de toneladas
    if (summary) {
        summary.style.display = 'block';
        summary.innerHTML = `
            <div class="summary-row">
                <span>Total solicitado:</span>
                <b>${totalSolicitadas.toFixed(2)} t</b>
            </div>
            <div class="summary-row">
                <span>En paquetes:</span>
                <b>${totalEnPaquetes.toFixed(2)} t</b>
            </div>
            ${totalSobrantes > 0 ? `
            <div class="summary-row sobrante">
                <span>⚠️ Total sobrante:</span>
                <b>${totalSobrantes.toFixed(3)} t</b>
            </div>
            ` : ''}
            <div class="summary-row">
                <span>Total paquetes:</span>
                <b>${totalPaquetes}</b>
            </div>
        `;
    }
}

// ==================== ADITAMENTOS ====================
function renderAditamentosTable() {
    const tbody = $('aditTableBody');
    const count = $('aditCountBadge');
    if (!tbody) return;
    
    if (state.aditamentos.length === 0) {
        tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;color:var(--muted);">Sin aditamentos</td></tr>';
        if (count) count.textContent = '0';
        return;
    }
    
    tbody.innerHTML = state.aditamentos.map((a, i) => `
        <tr>
            <td>${a.name}</td>
            <td>${a.peso_kg} kg</td>
            <td><button class="btn-del" onclick="removeAditamento(${i})">×</button></td>
        </tr>
    `).join('');
    
    if (count) count.textContent = state.aditamentos.length;
}

// ==================== HUD ====================
function updateHUD() {
    const setCont = (id, val) => { const el = $(id); if (el) el.textContent = val; };
    
    setCont('hudCarga', state.load?.numero_carga || '—');
    setCont('hudTruck', state.truck?.name || '—');
    setCont('hudStatus', state.load?.status || 'DRAFT');
    setCont('hudTons', utils.getTotalTons().toFixed(1) + ' t');
    setCont('hudPkgs', utils.getTotalPackages());
    setCont('loadIdBadge', state.loadId || '—');
}

// ==================== RESUMEN ====================
function updateSummary() {
    const setCont = (id, val) => { const el = $(id); if (el) el.textContent = val; };
    
    setCont('sumMats', state.materials.length);
    setCont('sumPkgs', utils.getTotalPackages());
    setCont('sumTons', utils.getTotalTons().toFixed(1));
    
    const bedsUsed = new Set(state.placements.filter(p => p.placed).map(p => p.bed_number)).size;
    setCont('sumBeds', bedsUsed);
    
    // Altura total - calcular desde placements si no está en state
    let totalHeight = state.totalHeight || 0;
    if (!totalHeight && state.placements.length > 0) {
        const placedPkgs = state.placements.filter(p => p.placed);
        if (placedPkgs.length > 0) {
            totalHeight = Math.max(...placedPkgs.map(p => (p.y || 0) + (p.height_used || 0)));
        }
    }
    const heightMeters = (totalHeight / 1000).toFixed(2);
    const maxAllowed = 3.10;
    const heightColor = totalHeight > 3100 ? 'color:#ef4444' : 'color:var(--green)';
    setCont('sumHeight', heightMeters + 'm');
    const sumHeightEl = $('sumHeight');
    if (sumHeightEl) sumHeightEl.style.cssText = heightColor;
    
    const notPlaced = state.placements.filter(p => !p.placed).length;
    setCont('sumNotPlaced', notPlaced);
}

// ==================== CAPACIDAD ====================
function updatePayloadInfo() {
    const t = state.truck;
    const qty = state.truckQuantity || 1;
    const isDualPlatform = t?.is_dual_platform || t?.id === 'FULL' || t?.id === 'TORTON_DOBLE';
    // Para dual-platform max_payload_kg es por plana; el total es × 2 planas
    const maxPay = t ? (isDualPlatform ? t.max_payload_kg * 2 : (qty > 1 ? t.max_payload_kg * qty : t.max_payload_kg)) : 0;
    const aditKg = utils.getTotalAditamentos();
    const matKg = utils.getTotalTons() * 1000;
    const available = Math.max(0, maxPay - aditKg - matKg);
    const usedPercent = maxPay > 0 ? ((aditKg + matKg) / maxPay * 100) : 0;
    
    const setCont = (id, val) => { const el = $(id); if (el) el.textContent = val; };
    
    setCont('maxPayload', utils.formatNumber(maxPay) + ' kg');
    setCont('aditWeight', utils.formatNumber(aditKg) + ' kg');
    setCont('matWeight', utils.formatNumber(Math.round(matKg)) + ' kg');
    setCont('availablePayload', utils.formatNumber(Math.round(available)) + ' kg');
    
    const availEl = $('availablePayload');
    if (availEl) {
        availEl.style.color = available < 0 ? 'var(--red)' : 'var(--green)';
    }
    
    const bar = $('payloadBar');
    if (bar) {
        bar.style.width = Math.min(100, usedPercent) + '%';
        bar.style.background = usedPercent > 100 ? 'var(--red)' : usedPercent > 80 ? 'var(--amber)' : 'var(--green)';
    }
}

// ==================== STATUS ====================
function updateLoadStatus() {
    const badge = $('loadStatusBadge');
    const text = $('loadStatusText');
    if (!badge || !text) return;
    
    if (!state.loadId) {
        badge.className = 'badge warning';
        text.textContent = 'Sin carga';
    } else if (state.load?.status === 'OPTIMIZED') {
        badge.className = 'badge success';
        text.textContent = 'Optimizado';
    } else {
        badge.className = 'badge warning';
        text.textContent = state.load?.status || 'Borrador';
    }
}

// ==================== CAMAS TABS ====================
function renderBedsTabs() {
    const container = $('bedsTabs');
    if (!container) return;
    
    const t = state.truck;
    const truckQuantity = state.truckQuantity || 1;
    const isDualBase = t?.is_dual_platform || t?.id === 'FULL' || t?.id === 'TORTON_DOBLE';
    
    let numPlatforms;
    if (truckQuantity > 1) {
        numPlatforms = truckQuantity;
    } else if (isDualBase) {
        numPlatforms = 2;
    } else {
        numPlatforms = 1;
    }
    
    const isDual = numPlatforms > 1;
    const isLongTruck = t && t.length_mm >= 11000;  // Tráiler o Full
    
    let html = '';
    
    for (let plat = 1; plat <= numPlatforms; plat++) {
        const platPlacements = state.placements.filter(p => (p.platform || 1) === plat && p.placed);
        
        if (isDual) {
            html += `<div class="platform-label">Plana ${plat}</div>`;
        }
        
        if (isLongTruck) {
            // Para tráiler/full: mostrar camas por zona (A y B)
            const zoneAPlacements = platPlacements.filter(p => {
                const zone = p.bed_zone || (p.x < 6025 ? 'A' : 'B');
                return zone === 'A';
            });
            const zoneBPlacements = platPlacements.filter(p => {
                const zone = p.bed_zone || (p.x < 6025 ? 'A' : 'B');
                return zone === 'B';
            });
            
            const bedsZoneA = [...new Set(zoneAPlacements.map(p => p.bed_number))].sort((a, b) => a - b);
            const bedsZoneB = [...new Set(zoneBPlacements.map(p => p.bed_number))].sort((a, b) => a - b);
            
            if (bedsZoneA.length === 0 && bedsZoneB.length === 0) {
                bedsZoneA.push(1);
            }
            
            // Camas zona A (azul)
            bedsZoneA.forEach((b, idx) => {
                const cnt = zoneAPlacements.filter(p => p.bed_number === b).length;
                const isActive = (plat === (state.selectedPlatform || 1)) && 
                                (b === state.selectedBed) && 
                                (state.selectedZone || 'A') === 'A';
                
                html += `<div class="bed-tab zone-a ${isActive ? 'active' : ''}"
                             onclick="selectBedWithZone(${plat}, ${b}, 'A')"
                             data-platform="${plat}" data-bed="${b}" data-zone="A">
                    ${isDual ? `P${plat}-` : ''}Cama ${idx + 1}<span class="count">(${cnt})</span>
                </div>`;
            });
            
            // Camas zona B (naranja)
            bedsZoneB.forEach((b, idx) => {
                const cnt = zoneBPlacements.filter(p => p.bed_number === b).length;
                const isActive = (plat === (state.selectedPlatform || 1)) && 
                                (b === state.selectedBed) && 
                                (state.selectedZone) === 'B';
                
                html += `<div class="bed-tab zone-b ${isActive ? 'active' : ''}"
                             onclick="selectBedWithZone(${plat}, ${b}, 'B')"
                             data-platform="${plat}" data-bed="${b}" data-zone="B">
                    ${isDual ? `P${plat}-` : ''}Cama ${idx + 1}<span class="count">(${cnt})</span>
                </div>`;
            });
        } else {
            // Para camiones cortos: nomenclatura simple
            const maxBed = Math.max(...platPlacements.map(p => p.bed_number), 0);
            const bedsInPlat = Math.max(maxBed, 1);
            
            for (let b = 1; b <= bedsInPlat; b++) {
                const cnt = platPlacements.filter(p => p.bed_number === b).length;
                const isActive = (plat === (state.selectedPlatform || 1)) && (b === state.selectedBed);
                
                html += `<div class="bed-tab ${isActive ? 'active' : ''}" 
                             onclick="selectBedPlatform(${plat}, ${b})"
                             data-platform="${plat}" data-bed="${b}">
                    ${isDual ? `P${plat}-` : ''}Cama ${b}<span class="count">(${cnt})</span>
                </div>`;
            }
        }
    }
    
    container.innerHTML = html || '<div class="bed-tab active" onclick="selectBed(1)">Cama 1<span class="count">(0)</span></div>';
}

// Seleccionar cama con zona
function selectBedWithZone(platform, bed, zone) {
    state.selectedPlatform = platform;
    state.selectedBed = bed;
    state.selectedZone = zone;
    renderBedsTabs();
    if (typeof draw2D === 'function') draw2D(bed);
    renderBedMaterialsList(bed, platform);
    if (typeof loadBedNote === 'function') loadBedNote();
}
window.selectBedWithZone = selectBedWithZone;

// Seleccionar cama con plana
function selectBedPlatform(platform, bed) {
    state.selectedPlatform = platform;
    state.selectedBed = bed;
    state.selectedZone = null;
    renderBedsTabs();
    draw2DWithPlatform(platform, bed);
    renderBedMaterialsList(bed, platform);
    if (typeof loadBedNote === 'function') loadBedNote();
}
window.selectBedPlatform = selectBedPlatform;

// ==================== DISTRIBUCIÓN ====================
function renderBedsDistribution() {
    const container = $('bedsDistribution');
    if (!container) return;
    
    if (state.placements.length === 0) {
        container.innerHTML = '<div style="color:var(--muted);text-align:center;padding:10px;">Ejecuta la optimización para ver la distribución</div>';
        return;
    }
    
    const t = state.truck;
    const truckQuantity = state.truckQuantity || 1;
    const isDualBase = t?.is_dual_platform || t?.id === 'FULL' || t?.id === 'TORTON_DOBLE';
    
    let numPlatforms;
    if (truckQuantity > 1) {
        numPlatforms = truckQuantity;
    } else if (isDualBase) {
        numPlatforms = 2;
    } else {
        numPlatforms = 1;
    }
    
    const isDual = numPlatforms > 1;
    
    // max_payload_kg ya es el límite por plataforma (para dual-platform) o total (para simples)
    const maxPayloadPerPlatform = t ? t.max_payload_kg : 0;
    
    let html = '';
    
    for (let plat = 1; plat <= numPlatforms; plat++) {
        // Filtrar placements de esta plana
        const platPlacements = state.placements.filter(p => 
            (p.platform || 1) === plat && p.placed
        );
        
        // Calcular estadísticas de esta plana
        const maxBed = platPlacements.length > 0 ? Math.max(...platPlacements.map(p => p.bed_number)) : 0;
        const maxY = platPlacements.length > 0 ? Math.max(...platPlacements.map(p => p.y + p.height_used)) : 0;
        const heightM = (maxY / 1000).toFixed(2);
        
        // Peso total de la plana
        let platWeightKg = 0;
        platPlacements.forEach(p => {
            const item = state.materials.find(m => m.id === p.load_item_id);
            if (item && item.kg_por_paquete) {
                platWeightKg += item.kg_por_paquete;
            }
        });
        
        // Calcular porcentaje de peso usado
        const weightPercent = maxPayloadPerPlatform > 0 ? (platWeightKg / maxPayloadPerPlatform * 100) : 0;
        const isOverweight = platWeightKg > maxPayloadPerPlatform;
        const weightColor = isOverweight ? 'var(--red)' : weightPercent > 90 ? 'var(--amber)' : 'var(--green)';
        
        if (isDual) {
            html += `<div class="platform-header" style="font-size:11px;color:var(--primary);font-weight:600;border-bottom:1px solid var(--border);padding:6px 0;margin-top:${plat > 1 ? '12px' : '0'};">
                Plana ${plat} <span style="color:var(--muted);font-weight:normal;">(${maxBed} camas · ${heightM}m altura)</span>
            </div>
            <div class="platform-weight-summary" style="display:flex;justify-content:space-between;align-items:center;padding:6px 8px;background:var(--surface);border-radius:4px;margin:4px 0 8px 0;font-size:11px;">
                <span style="color:var(--muted);">Peso total:</span>
                <span style="font-weight:600;color:${weightColor};">${utils.formatNumber(Math.round(platWeightKg))} kg / ${utils.formatNumber(maxPayloadPerPlatform)} kg</span>
            </div>
            <div class="platform-weight-bar" style="height:4px;background:var(--border);border-radius:2px;margin-bottom:8px;overflow:hidden;">
                <div style="height:100%;width:${Math.min(100, weightPercent)}%;background:${weightColor};transition:width 0.3s;"></div>
            </div>`;
        }
        
        // Agrupar por cama dentro de esta plana
        for (let b = 1; b <= maxBed; b++) {
            const bedP = platPlacements.filter(p => p.bed_number === b);
            if (bedP.length === 0) continue;
            
            // Calcular peso total de la cama
            let bedWeightKg = 0;
            bedP.forEach(p => {
                const item = state.materials.find(m => m.id === p.load_item_id);
                if (item && item.kg_por_paquete) {
                    bedWeightKg += item.kg_por_paquete;
                }
            });
            
            const stat = state.bedsStats?.find(s => s.bed_number === b && (!isDual || s.platform === plat));
            const fill = stat?.fill_percentage || 0;
            
            const bedLabel = isDual ? `P${plat}-Cama ${b}` : `Cama ${b}`;
            
            html += `<div class="dist-item">
                <div>
                    <div class="bed-name">${bedLabel}</div>
                    <div class="bed-stats">${bedP.length} paq · ${utils.formatNumber(Math.round(bedWeightKg))} kg</div>
                </div>
                <div class="fill-bar"><div class="fill-bar-inner" style="width:${fill}%"></div></div>
            </div>`;
        }
    }
    
    const notPlaced = state.placements.filter(p => !p.placed);
    if (notPlaced.length > 0) {
        html += `<div class="dist-item" style="border-left:3px solid var(--red);">
            <div>
                <div class="bed-name" style="color:var(--red);">Sin colocar</div>
                <div class="bed-stats">${notPlaced.length} paquetes</div>
            </div>
        </div>`;
    }
    
    container.innerHTML = html || '<div style="color:var(--muted);text-align:center;">Sin distribución</div>';
}

// ==================== BED MATERIALS LIST ====================
function renderBedMaterialsList(bedNum, platform) {
    const tbody = $('bedMaterialsBody');
    const countEl = $('bedMaterialsCount');
    
    if (!tbody) return;
    
    // Usar la plana proporcionada o la seleccionada
    const currentPlatform = platform || state.selectedPlatform || 1;
    
    // Obtener placements de esta cama y plana
    const bedPlacements = state.placements.filter(p => 
        p.bed_number === bedNum && 
        (p.platform || 1) === currentPlatform && 
        p.placed
    );
    
    if (countEl) {
        countEl.textContent = `${bedPlacements.length} paquetes`;
    }
    
    if (bedPlacements.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="bed-materials-empty">No hay paquetes en esta cama</td></tr>`;
        return;
    }
    
    // Agrupar por material y contar
    const materialGroups = {};
    bedPlacements.forEach((p, index) => {
        const item = state.materials.find(m => m.id === p.load_item_id);
        if (!item) return;
        
        const key = item.sap_code;
        if (!materialGroups[key]) {
            materialGroups[key] = {
                item: item,
                placements: []
            };
        }
        materialGroups[key].placements.push({
            ...p,
            displayIndex: index + 1
        });
    });
    
    // Generar filas
    let html = '';
    Object.values(materialGroups).forEach(group => {
        const item = group.item;
        // Color basado en calibre
        const color = getColorByCalibre(item.calibre);
        // Mostrar calibre solo si es un número válido mayor a 0
        const calibre = (item.calibre && item.calibre > 0) ? item.calibre : '—';
        const almacen = item.almacen || '—';
        
        group.placements.forEach(p => {
            const tons = ((item.kg_por_paquete || 1000) / 1000).toFixed(2);
            html += `
                <tr>
                    <td><span class="pkg-num" style="background:${color.hex}">${p.displayIndex}</span></td>
                    <td class="sap-code">${item.sap_code}</td>
                    <td title="${item.description || ''}">${item.description || '—'}</td>
                    <td>${tons}t</td>
                    <td><b>${calibre}</b></td>
                    <td>${almacen}</td>
                </tr>
            `;
        });
    });
    
    tbody.innerHTML = html;
}

// ==================== UPDATE ALL ====================
function updateAllUI() {
    updateHUD();
    updateSummary();
    updatePayloadInfo();
    updateTruckInfo();
    renderMaterialsTable();
    renderAditamentosTable();
    renderBedsTabs();
    renderBedsDistribution();
    updateLoadStatus();
    renderBedMaterialsList(state.selectedBed || 1);
}

// Exportar funciones globales
window.$ = $;
window.toast = toast;
window.openModal = openModal;
window.closeModal = closeModal;
window.updateConnectionStatus = updateConnectionStatus;
window.renderTruckSelect = renderTruckSelect;
window.updateTruckInfo = updateTruckInfo;
window.renderProductInfo = renderProductInfo;
window.updateCalcPreview = updateCalcPreview;
window.renderMaterialsTable = renderMaterialsTable;
window.renderAditamentosTable = renderAditamentosTable;
window.renderBedMaterialsList = renderBedMaterialsList;
window.updateAllUI = updateAllUI;