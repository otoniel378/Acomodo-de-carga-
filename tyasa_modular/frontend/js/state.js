// state.js - Estado global de la aplicación

const state = {
    // Conexión
    connected: false,
    
    // Carga actual
    loadId: null,
    load: null,
    
    // Camiones
    trucks: [],
    truck: null,
    
    // Producto buscado
    product: null,
    
    // Materiales en la carga actual (no guardados aún)
    materials: [],
    
    // Aditamentos en la carga actual
    aditamentos: [],
    
    // Placements después de optimizar
    placements: [],
    
    // Notas por cama
    bedNotes: [],
    
    // Cama seleccionada para vista 2D
    selectedBed: 1,
    
    // Plana seleccionada (para Full con 2 planas)
    selectedPlatform: 1,
    
    // Modo de acomodo: 'OPT' o 'MAN'
    mode: 'OPT',
    
    // Modo manual activo (para click en paquetes)
    manualMode: false,
    
    // Estadísticas por cama
    bedsStats: [],
    
    // Modo de optimización: 'opt1' o 'opt2'
    optimizeMode: 'opt1',
    
    // Prioridades de almacén: [{almacen: "LARGOS-A1", priority: 1}, ...]
    almacenPriorities: [],
    
    // Altura total de la carga (desde piso hasta última cama)
    totalHeight: 0
};

// Colores por tipo de material
const MAT_COLORS = {
    'LARGOS': { hex: '#f59e0b', three: 0xf59e0b },
    'SBQ': { hex: '#8b5cf6', three: 0x8b5cf6 },
    'PLANOS': { hex: '#06b6d4', three: 0x06b6d4 },
    'GALV': { hex: '#10b981', three: 0x10b981 },
    'DEFAULT': { hex: '#3b82f6', three: 0x3b82f6 }
};

// Colores por calibre - distintos para fácil identificación visual
const CALIBRE_COLORS = {
    14: { hex: '#ef4444', three: 0xef4444, name: 'Rojo' },      // Rojo
    16: { hex: '#22c55e', three: 0x22c55e, name: 'Verde' },     // Verde
    18: { hex: '#3b82f6', three: 0x3b82f6, name: 'Azul' },      // Azul
    20: { hex: '#f59e0b', three: 0xf59e0b, name: 'Naranja' },   // Naranja
    0:  { hex: '#6b7280', three: 0x6b7280, name: 'Gris' }       // Sin calibre
};

// Función para obtener color por calibre
function getColorByCalibre(calibre) {
    const cal = parseInt(calibre) || 0;
    return CALIBRE_COLORS[cal] || CALIBRE_COLORS[0];
}

// Funciones de utilidad
const utils = {
    // Formatear número con comas
    formatNumber(n) {
        return n?.toLocaleString() || '0';
    },
    
    // Pad con ceros
    pad(n) {
        return String(n).padStart(2, '0');
    },
    
    // Obtener fecha actual formateada
    getToday() {
        const d = new Date();
        return `${d.getFullYear()}-${this.pad(d.getMonth() + 1)}-${this.pad(d.getDate())}`;
    },
    
    // Generar número de carga único
    generateLoadNumber() {
        const d = new Date();
        return `TY-${d.getFullYear()}-${String(Date.now()).slice(-5)}`;
    },
    
    // Calcular total de paquetes
    getTotalPackages() {
        return state.materials.reduce((sum, m) => sum + (m.num_paquetes || 1), 0);
    },
    
    // Calcular total de toneladas
    getTotalTons() {
        return state.materials.reduce((sum, m) => sum + (m.tons_en_paquetes || m.tons_solicitadas || m.tons || 0), 0);
    },
    
    // Calcular peso total de aditamentos
    getTotalAditamentos() {
        return state.aditamentos.reduce((sum, a) => sum + (a.peso_kg * (a.cantidad || 1)), 0);
    }
};

// Exportar
window.state = state;
window.MAT_COLORS = MAT_COLORS;
window.CALIBRE_COLORS = CALIBRE_COLORS;
window.getColorByCalibre = getColorByCalibre;
window.utils = utils;