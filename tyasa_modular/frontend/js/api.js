// api.js - Conexión con el backend
// En producción usa URL relativa (mismo servidor); en local usa localhost
const API_URL = (window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost')
    ? 'http://127.0.0.1:8000'
    : '';

const api = {
    // Realizar petición
    async request(endpoint, options = {}) {
        try {
            const response = await fetch(`${API_URL}${endpoint}`, {
                headers: { 'Content-Type': 'application/json' },
                ...options
            });
            
            if (!response.ok) {
                const error = await response.json().catch(() => ({ detail: response.statusText }));
                throw new Error(error.detail || 'Error en la petición');
            }
            
            const contentType = response.headers.get('content-type');
            if (contentType?.includes('application/json')) {
                return response.json();
            }
            return response;
        } catch (error) {
            console.error('API Error:', endpoint, error);
            throw error;
        }
    },

    // Health check
    async health() {
        return this.request('/api/health');
    },

    // === TRUCKS ===
    async getTrucks() {
        return this.request('/api/trucks');
    },
    
    async getTruck(id) {
        return this.request(`/api/trucks/${id}`);
    },
    
    async createTruck(data) {
        return this.request('/api/trucks', {
            method: 'POST',
            body: JSON.stringify(data)
        });
    },

    async updateTruck(truckId, data) {
        return this.request(`/api/trucks/${truckId}`, {
            method: 'PUT',
            body: JSON.stringify(data)
        });
    },

    // === PRODUCTS ===
    async getProducts(materialType = null) {
        const query = materialType ? `?material_type=${materialType}` : '';
        return this.request(`/api/products${query}`);
    },
    
    async getProduct(sapCode) {
        // Usar endpoint de búsqueda para permitir búsqueda parcial
        return this.request(`/api/products/search/${sapCode}`);
    },
    
    async createProduct(data) {
        return this.request('/api/products', {
            method: 'POST',
            body: JSON.stringify(data)
        });
    },
    
    async updateProduct(sapCode, data) {
        return this.request(`/api/products/${sapCode}`, {
            method: 'PUT',
            body: JSON.stringify(data)
        });
    },

    // === LOADS ===
    async getNextLoadNumber() {
        return this.request('/api/loads/next-number');
    },
    
    async getLoads(fecha = null) {
        const query = fecha ? `?fecha=${fecha}` : '';
        return this.request(`/api/loads${query}`);
    },
    
    async searchLoads(params = {}) {
        const queryParts = [];
        if (params.fecha) queryParts.push(`fecha=${encodeURIComponent(params.fecha)}`);
        if (params.numero_viaje) queryParts.push(`numero_viaje=${encodeURIComponent(params.numero_viaje)}`);
        if (params.numero_embarque) queryParts.push(`numero_embarque=${encodeURIComponent(params.numero_embarque)}`);
        if (params.cliente) queryParts.push(`cliente=${encodeURIComponent(params.cliente)}`);
        
        const query = queryParts.length > 0 ? `?${queryParts.join('&')}` : '';
        return this.request(`/api/loads${query}`);
    },
    
    async getLoad(id) {
        return this.request(`/api/loads/${id}`);
    },
    
    async createLoad(data) {
        return this.request('/api/loads', {
            method: 'POST',
            body: JSON.stringify(data)
        });
    },
    
    async updateLoad(id, data) {
        return this.request(`/api/loads/${id}`, {
            method: 'PUT',
            body: JSON.stringify(data)
        });
    },
    
    async deleteLoad(id) {
        return this.request(`/api/loads/${id}`, {
            method: 'DELETE'
        });
    },

    async deleteLoadItem(loadId, itemId) {
        return this.request(`/api/loads/${loadId}/items/${itemId}`, {
            method: 'DELETE'
        });
    },

    // === OPTIMIZE ===
    async optimize(loadId, mode = 'opt1', almacenPriorities = [], truckQuantity = 1, gapFloorToBed = 0, gapBetweenBeds = 100, centerPackages = true, heightDiffMode = 'strict') {
        return this.request('/api/optimize', {
            method: 'POST',
            body: JSON.stringify({
                load_id: loadId,
                mode: mode,
                almacen_priorities: almacenPriorities,
                truck_quantity: truckQuantity,
                gap_floor_to_bed: gapFloorToBed,
                gap_between_beds: gapBetweenBeds,
                center_packages: centerPackages,
                height_diff_mode: heightDiffMode
            })
        });
    },
    
    async updatePlacement(placementId, data) {
        return this.request(`/api/placements/${placementId}`, {
            method: 'PUT',
            body: JSON.stringify(data)
        });
    },

    // === BED NOTES ===
    async saveBedNote(loadId, bedNumber, note) {
        return this.request(`/api/loads/${loadId}/notes?bed_number=${bedNumber}&note=${encodeURIComponent(note)}`, {
            method: 'POST'
        });
    },
    
    async getBedNote(loadId, bedNumber) {
        return this.request(`/api/loads/${loadId}/notes/${bedNumber}`);
    },
    
    async deleteBedNote(loadId, bedNumber) {
        return this.request(`/api/loads/${loadId}/notes/${bedNumber}`, {
            method: 'DELETE'
        });
    },

    // === PDF ===
    getPdfUrl(loadId) {
        return `${API_URL}/api/loads/${loadId}/pdf`;
    },

    // === LEARNING ===
    async verifyLoad(loadId) {
        return this.request(`/api/loads/${loadId}/verify`, { method: 'POST' });
    },

    async getLearningStats() {
        return this.request('/api/learning/stats');
    },

    async getLearningPatterns(truckTypeId = null) {
        const query = truckTypeId ? `?truck_type_id=${truckTypeId}` : '';
        return this.request(`/api/learning/patterns${query}`);
    },

    async autoLearn(loadId) {
        return this.request(`/api/loads/${loadId}/auto-learn`, { method: 'POST' });
    },

    async rebuildPatterns() {
        return this.request('/api/learning/rebuild', { method: 'POST' });
    },

    async getLearningDiagnostics(truckTypeId = null) {
        const q = truckTypeId ? `?truck_type_id=${truckTypeId}` : '';
        return this.request(`/api/learning/diagnostics${q}`);
    }
};

// Exportar para uso global
window.api = api;