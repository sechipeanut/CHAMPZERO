import { db } from './firebase-config.js';
import { collection, getDocs, addDoc, query } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-auth.js";

function qs(sel) { return document.querySelector(sel); }
function escapeHtml(str) { if (!str) return ''; return String(str).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }

let allTalents = [];

export function initRising() {
    fetchTalents();
    setupApplicationForm();
    checkAdminStatus();
}
window.initRising = initRising;

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initRising);
} else {
    initRising();
}

function parseFirestoreValue(val) {
    if (!val) return null;
    if (val.stringValue !== undefined) return val.stringValue;
    if (val.integerValue !== undefined) return parseInt(val.integerValue, 10);
    if (val.doubleValue !== undefined) return parseFloat(val.doubleValue);
    if (val.booleanValue !== undefined) return val.booleanValue;
    if (val.timestampValue !== undefined) return val.timestampValue;
    if (val.nullValue !== undefined) return null;
    if (val.arrayValue !== undefined) return (val.arrayValue.values || []).map(v => parseFirestoreValue(v));
    if (val.mapValue !== undefined) {
        const out = {};
        const fields = val.mapValue.fields || {};
        for (const k in fields) out[k] = parseFirestoreValue(fields[k]);
        return out;
    }
    return val;
}

function parseFirestoreDoc(doc) {
    const id = doc.name ? doc.name.split('/').pop() : '';
    const data = { id };
    const fields = doc.fields || {};
    for (const key in fields) data[key] = parseFirestoreValue(fields[key]);
    return data;
}

// 1. FETCH TALENTS
async function fetchTalents() {
    const grid = qs('#talents-grid');
    if (!grid) return;

    let loaded = false;

    const fetchLocalApi = async () => {
        const res = await fetch('/api/talents');
        const cType = res.headers.get('content-type') || '';
        if (!res.ok || !cType.includes('application/json')) throw new Error('API HTTP ' + res.status + ' (non-JSON content)');
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) return data;
        throw new Error('No items from API');
    };

    const fetchRest = async () => {
        const res = await fetch('https://firestore.googleapis.com/v1/projects/champzero-92951/databases/(default)/documents/talents');
        if (!res.ok) throw new Error('REST HTTP ' + res.status);
        const data = await res.json();
        return (data.documents || []).map(parseFirestoreDoc);
    };

    const fetchSDK = async () => {
        const q = query(collection(db, "talents"));
        const snapshot = await getDocs(q);
        const items = [];
        snapshot.forEach(doc => {
            items.push({ id: doc.id, ...doc.data() });
        });
        return items;
    };

    try {
        allTalents = await Promise.any([fetchLocalApi(), fetchRest(), fetchSDK()]);
        loaded = true;
    } catch (allErrors) {
        try {
            allTalents = await fetchRest();
            loaded = true;
        } catch (fallbackErr) {
            console.error("Talents fetch failed:", fallbackErr);
        }
    }

    if (loaded) {
        renderTalents(allTalents);
    } else {
        grid.innerHTML = '<p class="col-span-full text-center text-red-500 py-16 font-mono-tag text-xs">Unable to load talents from database.</p>';
    }
}

// 2. RENDER & FILTER
window.filterTalents = function(category, btnElement) {
    // Visual update for buttons
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.className = "filter-btn font-heading text-xs uppercase font-bold tracking-wider px-5 py-2.5 rounded-lg border border-white/10 bg-white/5 text-neutral-300 hover:border-[#FFD700]/40 hover:text-white transition-all cursor-pointer";
    });
    
    // Highlight active button
    const activeBtn = btnElement || (typeof event !== 'undefined' && event?.target ? event.target.closest('.filter-btn') : null) || document.querySelector('.filter-btn');
    if (activeBtn) {
        activeBtn.className = "filter-btn active font-heading text-xs uppercase font-bold tracking-wider px-5 py-2.5 rounded-lg border border-[#FFD700] bg-[#FFD700] text-black transition-all cursor-pointer shadow-md";
    }

    // Filter logic
    if (category === 'all') {
        renderTalents(allTalents);
    } else {
        const filtered = allTalents.filter(t => (t.role && t.role.toLowerCase() === category.toLowerCase()) || (t.category && t.category.toLowerCase() === category.toLowerCase()));
        renderTalents(filtered);
    }
}

function renderTalents(talents) {
    const grid = qs('#talents-grid');
    grid.innerHTML = '';

    if (talents.length === 0) {
        grid.innerHTML = '<p class="col-span-full text-center text-gray-500 py-12">No talents found in this category.</p>';
        return;
    }

    talents.forEach(t => {
        const image = t.image || 'pictures/cz_logo.png';
        grid.innerHTML += `
            <div class="talent-card bg-[var(--dark-card)] rounded-xl overflow-hidden border border-white/10 group relative">
                <div class="h-64 overflow-hidden relative">
                    <img src="${image}" class="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110" alt="${escapeHtml(t.name)}">
                    <div class="absolute inset-0 bg-gradient-to-t from-black via-transparent to-transparent opacity-80"></div>
                    <div class="absolute bottom-4 left-4">
                        <span class="bg-[var(--gold)] text-black text-xs font-bold px-2 py-1 rounded mb-2 inline-block">${escapeHtml(t.role)}</span>
                        <h3 class="text-white font-bold text-xl">${escapeHtml(t.name)}</h3>
                    </div>
                </div>
                <div class="p-6">
                    <p class="text-gray-400 text-sm line-clamp-3 mb-4">${escapeHtml(t.bio || 'No bio available.')}</p>
                    <div class="flex gap-3 mt-auto pt-4 border-t border-white/10">
                         ${t.socialLink ? `<a href="${t.socialLink}" target="_blank" class="text-[var(--gold)] text-sm font-semibold hover:underline">Visit Profile &rarr;</a>` : ''}
                    </div>
                </div>
            </div>
        `;
    });
}

// 3. APPLICATION FORM
function setupApplicationForm() {
    const form = qs('#talentForm');
    if(!form) return;

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = form.querySelector('button');
        const originalText = btn.textContent;
        btn.disabled = true;
        btn.textContent = 'Sending...';

        try {
            await addDoc(collection(db, "messages"), {
                type: "Talent Application",
                name: qs('#app-name').value,
                category: qs('#app-category').value,
                link: qs('#app-link').value,
                message: qs('#app-msg').value,
                sentAt: new Date().toISOString()
            });
            alert("Application Sent! We will review your portfolio.");
            form.reset();
        } catch (err) {
            console.error(err);
            alert("Error sending application.");
        } finally {
            btn.disabled = false;
            btn.textContent = originalText;
        }
    });
}

// 4. ADMIN BUTTON (Shows "Manage Talents" if logged in as admin)
function checkAdminStatus() {
    const auth = getAuth();
    const adminArea = qs('#admin-action-area');
    if(!adminArea) return;

    onAuthStateChanged(auth, (user) => {
        if (user) {
            const adminEmails = ["admin@champzero.com", "owner@champzero.com"];
            if (adminEmails.includes(user.email)) {
                adminArea.innerHTML = `<a href="/admin" class="bg-red-600 hover:bg-red-700 text-white px-6 py-2 rounded-full font-bold shadow-lg">Manage Talents</a>`;
            }
        }
    });
}