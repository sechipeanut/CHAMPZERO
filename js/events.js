import { db } from './firebase-config.js';
import { collection, getDocs, query } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-auth.js";
import { calculateStatus, escapeCssUrl } from './utils.js';

// 1. Import the live scores engine
import { initLiveScores } from './live-scores.js';

function qs(sel) { return document.querySelector(sel); }

// 2. ADD 'export' here so live-scores.js can see it
export function escapeHtml(str) { 
    if (!str) return ''; 
    return String(str).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); 
}

export function initEvents() {
    fetchEvents();
    checkAdminStatus();
    initLiveScores();
}
window.initEvents = initEvents;

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initEvents);
} else {
    initEvents();
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

// --- 1. Fetch Events from Firebase ---
async function fetchEvents() {
    const grid = qs('#eventGrid');
    if (!grid) return;

    let firestoreEvents = [];
    let loaded = false;

    const fetchLocalApi = async () => {
        const res = await fetch('/api/events');
        const cType = res.headers.get('content-type') || '';
        if (!res.ok || !cType.includes('application/json')) throw new Error('API HTTP ' + res.status + ' (non-JSON content)');
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) return data;
        throw new Error('No items from API');
    };

    const fetchRest = async () => {
        const res = await fetch('https://firestore.googleapis.com/v1/projects/champzero-92951/databases/(default)/documents/events');
        if (!res.ok) throw new Error('REST HTTP ' + res.status);
        const data = await res.json();
        return (data.documents || []).map(parseFirestoreDoc);
    };

    const fetchSDK = async () => {
        const q = query(collection(db, "events")); 
        const querySnapshot = await getDocs(q);
        const items = [];
        querySnapshot.forEach((doc) => {
            items.push({ id: doc.id, ...doc.data() });
        });
        return items;
    };

    try {
        firestoreEvents = await Promise.any([fetchLocalApi(), fetchRest(), fetchSDK()]);
        loaded = true;
    } catch (allErrors) {
        try {
            firestoreEvents = await fetchRest();
            loaded = true;
        } catch (fallbackErr) {
            console.error("Events fetch failed:", fallbackErr);
        }
    }

    grid.innerHTML = '';
    if (!loaded) {
        grid.innerHTML = `
            <div class="col-span-full text-center py-16 font-mono-tag text-xs text-red-400">
                Failed to load events from database.
            </div>
        `;
        return;
    }

    if (firestoreEvents.length === 0) {
        grid.innerHTML = `
            <div class="col-span-full flex flex-col items-center justify-center py-16 text-center border border-white/5 rounded-xl bg-white/5">
                <h3 class="text-xl font-semibold text-white font-heading uppercase">No active events found</h3>
                <p class="text-neutral-400 mt-2 max-w-sm text-xs font-mono-tag">Check back soon for community nights, watch parties, and broadcasts.</p>
            </div>
        `;
        return;
    }

    firestoreEvents.forEach((ev) => {
        const card = createEventCard(ev);
        grid.appendChild(card);
    });
}

// --- 2. Create the Card (Visual Upgrade) ---
function createEventCard(ev) {
    const card = document.createElement('div');
    // Added 'group' and specific border/shadow classes for the Glow Effect
    card.className = "bg-[var(--dark-card)] rounded-xl border border-white/10 overflow-hidden hover:border-[var(--gold)]/50 hover:shadow-[0_0_15px_rgba(255,215,0,0.15)] transition-all duration-300 group flex flex-col h-full";
    
    // Default image if none provided
    const bannerUrl = ev.banner || 'pictures/cz_logo.png'; // Make sure this path exists or use a placeholder
    
    // Format Date
    let dateFormatted = 'TBA';
    if (ev.date) {
        // Check if date is a Timestamp object or string
        const dateObj = ev.date.toDate ? ev.date.toDate() : new Date(ev.date);
        dateFormatted = dateObj.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
        
        // Add end date if it exists
        if (ev.endDate) {
            const endDateObj = ev.endDate.toDate ? ev.endDate.toDate() : new Date(ev.endDate);
            const endDateFormatted = endDateObj.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
            dateFormatted = `${dateFormatted} - ${endDateFormatted}`;
        }
    }
    
    // Calculate actual status based on dates
    const actualStatus = calculateStatus(ev.date, ev.endDate);
    const statusColor = actualStatus === 'Ongoing' ? 'bg-green-500' : (actualStatus === 'Completed' ? 'bg-gray-500' : 'bg-[var(--gold)]');

    card.innerHTML = `
        <div class="h-48 bg-cover bg-center relative cursor-pointer event-trigger overflow-hidden">
            <div class="absolute inset-0 bg-cover bg-center transition-transform duration-500 group-hover:scale-110" style="background-image:url('${escapeCssUrl(bannerUrl)}')"></div>
            
            <div class="absolute inset-0 bg-black/40 group-hover:bg-black/20 transition-colors"></div>
            
            <div class="absolute top-3 left-3 bg-black/60 backdrop-blur-md px-3 py-1 rounded text-xs font-bold text-white border border-white/10">
                ${escapeHtml(ev.type || 'Event')}
            </div>
            
            <div class="absolute top-3 right-3 ${statusColor} text-white px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wide">
                ${actualStatus}
            </div>
        </div>

        <div class="p-5 flex-1 flex flex-col relative">
            <div class="text-[var(--gold)] text-sm font-semibold mb-1 flex items-center gap-2">
                <span>${dateFormatted}</span>
                ${ev.time ? `<span>• ${escapeHtml(ev.time)}</span>` : ''}
            </div>

            <h3 class="text-xl font-bold text-white mb-3 leading-tight group-hover:text-[var(--gold)] transition-colors">
                ${escapeHtml(ev.name)}
            </h3>

            <p class="text-gray-400 text-sm mb-4 line-clamp-2">
                ${escapeHtml(ev.description)}
            </p>
            
            <div class="mt-auto">
                <button class="details-btn w-full py-2 bg-white/5 hover:bg-[var(--gold)] hover:text-black border border-white/10 hover:border-[var(--gold)] rounded-lg text-sm font-semibold transition-all">
                    View Details
                </button>
            </div>
        </div>
    `;

    // Add click listeners
    const openFn = () => openModal(ev);
    card.querySelector('.event-trigger').addEventListener('click', openFn);
    card.querySelector('.details-btn').addEventListener('click', openFn);

    return card;
}

// --- 3. Modal Logic ---
function openModal(ev) {
    const bannerUrl = ev.banner || 'pictures/cz_logo.png';
    
    qs('#detailTitle').textContent = ev.name;
    
    // Handle Banner
    const bannerDiv = qs('#detailBanner');
    bannerDiv.classList.remove('hidden');
    bannerDiv.innerHTML = `<img src="${bannerUrl}" class="w-full h-full object-cover rounded-lg shadow-lg">`;
    
    // Handle Description with line breaks
    qs('#detailDesc').innerHTML = escapeHtml(ev.description).replace(/\n/g, '<br>'); 
    
    // Metadata
    let dateStr = ev.date ? (ev.date.toDate ? ev.date.toDate().toDateString() : new Date(ev.date).toDateString()) : 'TBA';
    if (ev.endDate) {
        const endDateStr = ev.endDate.toDate ? ev.endDate.toDate().toDateString() : new Date(ev.endDate).toDateString();
        dateStr = `${dateStr} - ${endDateStr}`;
    }
    qs('#detailMeta').innerHTML = `
        <div class="flex items-center gap-2"><span class="text-[var(--gold)] font-bold text-xs uppercase">Date:</span> ${dateStr}</div>
        ${ev.time ? `<div class="flex items-center gap-2"><span class="text-[var(--gold)] font-bold text-xs uppercase">Time:</span> ${escapeHtml(ev.time)}</div>` : ''}
        ${ev.location ? `<div class="flex items-center gap-2"><span class="text-[var(--gold)] font-bold text-xs uppercase">Location:</span> ${escapeHtml(ev.location)}</div>` : ''}
    `;

    // External Link Button
    const actionsContainer = qs('#detailActions');
    actionsContainer.innerHTML = '';
    
    if (ev.externalUrl) {
        const linkBtn = document.createElement('a');
        linkBtn.href = ev.externalUrl;
        linkBtn.target = "_blank";
        linkBtn.className = "bg-gradient-to-r from-[var(--gold-darker)] to-[var(--gold)] text-black px-6 py-2 rounded-lg font-bold transition-transform hover:scale-105 shadow-lg";
        linkBtn.textContent = "Register / Join Now";
        actionsContainer.appendChild(linkBtn);
    }

    document.getElementById('detailsModal').classList.remove('hidden');
}

// Make closeModal global
window.closeModal = function(id) {
    document.getElementById(id).classList.add('hidden');
}

// --- 4. Admin Check Logic ---
function checkAdminStatus() {
    const auth = getAuth();
    const adminArea = qs('#admin-action-area');
    
    if(!adminArea) return;

    onAuthStateChanged(auth, (user) => {
        if (user) {
            // OPTION A: Simple Email Check (Easiest for now)
            const adminEmails = ["admin@champzero.com"]; 
            
            if (adminEmails.includes(user.email)) {
                renderAdminButton(adminArea);
            }
            
            // OPTION B: If you use Custom Claims (Advanced)
            /* user.getIdTokenResult().then((idTokenResult) => {
                if (!!idTokenResult.claims.admin) {
                    renderAdminButton(adminArea);
                }
            });
            */
        }
    });
}

function renderAdminButton(container) {
    container.innerHTML = `
        <a href="/admin" class="bg-red-600 hover:bg-red-700 text-white px-6 py-2 rounded-full font-bold shadow-lg transition-transform hover:scale-105 flex items-center gap-2">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path></svg>
            Manage Events
        </a>
    `;
}