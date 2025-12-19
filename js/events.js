import { db } from './firebase-config.js';
import { collection, getDocs, query, orderBy } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-auth.js";

// Helper Functions
function qs(sel) { return document.querySelector(sel); }
function escapeHtml(str) { if (!str) return ''; return String(str).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }

// --- Main Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    fetchEvents();
    checkAdminStatus(); // Check if the "Add Event" button should show
});

// --- 1. Fetch Events from Firebase ---
async function fetchEvents() {
    const grid = qs('#eventGrid');
    if (!grid) return;

    try {
        // Try to order by date if you have the index set up in Firebase Console.
        // If this errors, remove the `orderBy` part or create the index via the link in console error.
        const q = query(collection(db, "events")); 
        
        const querySnapshot = await getDocs(q);
        
        grid.innerHTML = ''; // Clear loading text

        if (querySnapshot.empty) {
            grid.innerHTML = `
                <div class="col-span-full flex flex-col items-center justify-center py-16 text-center border border-white/5 rounded-xl bg-white/5">
                    <h3 class="text-xl font-semibold text-white">No active events found</h3>
                    <p class="text-gray-400 mt-2 max-w-sm">Check back soon for community nights and watch parties.</p>
                </div>
            `;
            return;
        }

        querySnapshot.forEach((doc) => {
            const ev = { id: doc.id, ...doc.data() };
            const card = createEventCard(ev);
            grid.appendChild(card);
        });

    } catch (error) {
        console.error("Error fetching events:", error);
        grid.innerHTML = `
            <div class="col-span-full text-center py-12">
                <p class="text-red-400">Unable to load events.</p>
                <p class="text-xs text-gray-600 mt-1">${error.message}</p>
            </div>
        `;
    }
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
    }

    card.innerHTML = `
        <div class="h-48 bg-cover bg-center relative cursor-pointer event-trigger overflow-hidden">
            <div class="absolute inset-0 bg-cover bg-center transition-transform duration-500 group-hover:scale-110" style="background-image:url('${bannerUrl}')"></div>
            
            <div class="absolute inset-0 bg-black/40 group-hover:bg-black/20 transition-colors"></div>
            
            <div class="absolute top-3 left-3 bg-black/60 backdrop-blur-md px-3 py-1 rounded text-xs font-bold text-white border border-white/10">
                ${escapeHtml(ev.type || 'Event')}
            </div>
        </div>

        <div class="p-5 flex-1 flex flex-col relative">
            <div class="text-[var(--gold)] text-sm font-semibold mb-1 flex items-center gap-2">
                <span>📅 ${dateFormatted}</span>
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
    const dateStr = ev.date ? (ev.date.toDate ? ev.date.toDate().toDateString() : new Date(ev.date).toDateString()) : 'TBA';
    qs('#detailMeta').innerHTML = `
        <div class="flex items-center gap-2"><span class="text-[var(--gold)]">📅</span> ${dateStr}</div>
        ${ev.time ? `<div class="flex items-center gap-2"><span class="text-[var(--gold)]">⏰</span> ${escapeHtml(ev.time)}</div>` : ''}
        ${ev.location ? `<div class="flex items-center gap-2"><span class="text-[var(--gold)]">📍</span> ${escapeHtml(ev.location)}</div>` : ''}
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
            // Replace with your actual admin email
            const adminEmails = ["admin@champzero.com", "casalmeseanlloyd@gmail.com"]; 
            
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
        <a href="admin.html" class="bg-red-600 hover:bg-red-700 text-white px-6 py-2 rounded-full font-bold shadow-lg transition-transform hover:scale-105 flex items-center gap-2">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path></svg>
            Manage Events
        </a>
    `;
}