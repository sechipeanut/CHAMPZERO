/**
 * js/api-client.js
 * CHAMPZERO Secure Backend-For-Frontend (BFF) Client
 * 
 * Strict Zero-Vendor Architecture:
 * - NO Firebase Client SDKs or CDNs
 * - NO exposed API keys, project IDs, or database URLs
 * - Authenticated via HTTP-only, Secure, SameSite=Strict cookies
 */

class ApiClient {
    constructor(baseUrl = '') {
        this.baseUrl = baseUrl;
    }

    /**
     * Base HTTP request wrapper ensuring credentials (HTTP-only cookies)
     * are automatically dispatched with same-origin requests.
     */
    async request(endpoint, options = {}) {
        const url = `${this.baseUrl}${endpoint}`;
        const headers = {
            'Accept': 'application/json',
            ...(options.body ? { 'Content-Type': 'application/json' } : {}),
            ...(options.headers || {})
        };

        const config = {
            ...options,
            headers,
            credentials: 'same-origin' // Transmits HTTP-only __session cookie
        };

        if (options.body && typeof options.body === 'object') {
            config.body = JSON.stringify(options.body);
        }

        try {
            const response = await fetch(url, config);
            const contentType = response.headers.get('content-type') || '';
            let data = null;

            if (contentType.includes('application/json')) {
                data = await response.json();
            } else {
                data = await response.text();
            }

            if (!response.ok) {
                const error = new Error(data?.error || `HTTP request failed with status ${response.status}`);
                error.status = response.status;
                error.data = data;
                throw error;
            }

            return data;
        } catch (err) {
            console.error(`[ApiClient Error] ${options.method || 'GET'} ${endpoint}:`, err.message);
            throw err;
        }
    }

    get(endpoint, headers = {}) {
        return this.request(endpoint, { method: 'GET', headers });
    }

    post(endpoint, body, headers = {}) {
        return this.request(endpoint, { method: 'POST', body, headers });
    }

    put(endpoint, body, headers = {}) {
        return this.request(endpoint, { method: 'PUT', body, headers });
    }

    patch(endpoint, body, headers = {}) {
        return this.request(endpoint, { method: 'PATCH', body, headers });
    }

    delete(endpoint, headers = {}) {
        return this.request(endpoint, { method: 'DELETE', headers });
    }
}

const api = new ApiClient();

// =============================================================================
// AUTHENTICATION SERVICE (Session Cookie Based - No Vendor Tokens in JS)
// =============================================================================
export const authService = {
    /**
     * Authenticate with email/password or existing token.
     * The server responds with Set-Cookie: __session=...; HttpOnly; Secure
     */
    async login({ email, password, idToken }) {
        return await api.post('/api/auth/login', { email, password, idToken });
    },

    /**
     * Create a new user account through backend gateway.
     */
    async signup({ email, password, username }) {
        return await api.post('/api/auth/signup', { email, password, username });
    },

    /**
     * Fetch active authenticated session from the server.
     * Returns null if unauthenticated or session is expired.
     */
    async getSession() {
        try {
            return await api.get('/api/auth/session');
        } catch (err) {
            if (err.status === 401) return null;
            throw err;
        }
    },

    /**
     * Invalidate session on server and clear HTTP-only cookie.
     */
    async logout() {
        return await api.post('/api/auth/logout', {});
    }
};

// =============================================================================
// DATA PROXY SERVICES (Replaces direct Firestore access)
// =============================================================================
export const tournamentsService = {
    async getAll() {
        return await api.get('/api/data/tournaments');
    },

    async getById(id) {
        return await api.get(`/api/data/tournaments/${encodeURIComponent(id)}`);
    },

    async register(tournamentId, payload) {
        return await api.post(`/api/data/tournaments/${encodeURIComponent(tournamentId)}/register`, payload);
    }
};

export const teamsService = {
    async getAll() {
        return await api.get('/api/data/teams');
    },

    async create(payload) {
        return await api.post('/api/data/teams', payload);
    }
};

export const profileService = {
    async getProfile() {
        return await api.get('/api/data/user/profile');
    },

    async updateProfile(updates) {
        return await api.patch('/api/data/user/profile', updates);
    }
};

export const chatService = {
    async getMessages(limit = 50) {
        return await api.get(`/api/data/chat/messages?limit=${limit}`);
    },

    async sendMessage(text) {
        return await api.post('/api/chat/send', { text });
    }
};

export const checkoutService = {
    async createSession(checkoutData) {
        return await api.post('/api/payrex/create-checkout-session', checkoutData);
    },

    async verifySession(sessionId) {
        return await api.get(`/api/payrex/verify-session/${encodeURIComponent(sessionId)}`);
    }
};

export default api;
