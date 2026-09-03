// js/firebase-config.js
// Build-time injected Firebase loader. ZERO credentials hardcoded in source.

import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-storage.js";

// Global namespace setup
window.czFirebase = window.czFirebase || {
    app: null,
    auth: null,
    db: null,
    storage: null,
    ready: null
};

// Retrieve configuration injected at build time by scripts/build-config.js
let fbConfig = (window.__CZ_CONFIG__ && window.__CZ_CONFIG__.firebase) || null;

if (!fbConfig) {
    try {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', '/js/env-config.js', false);
        xhr.send(null);
        if (xhr.status === 200) {
            new Function(xhr.responseText)();
            fbConfig = (window.__CZ_CONFIG__ && window.__CZ_CONFIG__.firebase) || {};
        }
    } catch (e) {
        fbConfig = {};
    }
}

let app = null;
let auth = null;
let db = null;
let storage = null;

try {
    const existingApps = getApps();
    app = existingApps.length > 0 ? getApp() : initializeApp(fbConfig);
    auth = getAuth(app);
    db = getFirestore(app);

    try {
        storage = getStorage(app, fbConfig.storageBucket ? `gs://${fbConfig.storageBucket}` : undefined);
    } catch {
        storage = getStorage(app);
    }

    // Attach to window namespace for full backward compatibility across all pages
    window.czFirebase.app = app;
    window.czFirebase.auth = auth;
    window.czFirebase.db = db;
    window.czFirebase.storage = storage;

    window.auth = auth;
    window.db = db;
    window.storage = storage;

    window.dispatchEvent(new CustomEvent('cz:firebase:ready', {
        detail: { app, auth, db, storage }
    }));
} catch (err) {
    console.error('[Firebase Init Error]', err);
}

window.czFirebase.ready = Promise.resolve({ app, auth, db, storage });

export { app, auth, db, storage };
export default window.czFirebase;