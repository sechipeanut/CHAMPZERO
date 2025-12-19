import { db } from './firebase-config.js';
import { collection, getDocs } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-firestore.js";

let allTournaments = [];

// Helper functions
function qs(sel) { return document.querySelector(sel); }
function escapeHtml(str) { if (!str) return ''; return String(str).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }

// --- Fetch Data ---
async function fetchTournaments() {
    const grid = qs('#tournamentGrid');
    if (!grid) return; // Guard clause in case page structure changes

    grid.innerHTML = '<div class="col-span-full text-center text-gray-500 py-12">Loading tournaments...</div>';

    try {
        const querySnapshot = await getDocs(collection(db, "tournaments"));
        
        allTournaments = [];
        querySnapshot.forEach((doc) => {
            allTournaments.push({ id: doc.id, ...doc.data() });
        });

        renderTournaments();

    } catch (error) {
        console.error("Error fetching tournaments:", error);
        grid.innerHTML = '<div class="col-span-full text-center text-red-500 py-12">Failed to load tournaments.</div>';
    }
}

// --- Render & Filter Logic ---
function renderTournaments() {
    const grid = qs('#tournamentGrid');
    const searchName = qs('#searchName').value.toLowerCase();
    const filterGame = qs('#filterGame').value;
    const filterStatus = qs('#filterStatus').value;
    const sortBy = qs('#sortBy').value;

    // Filter Logic
    let filtered = allTournaments.filter(t => {
        const matchesName = (t.name || '').toLowerCase().includes(searchName);
        const matchesGame = filterGame ? (t.game === filterGame) : true;
        // Check loosely against lowercase status
        const matchesStatus = filterStatus ? (t.status || '').toLowerCase() === filterStatus.toLowerCase() : true;
        
        return matchesName && matchesGame && matchesStatus;
    });

    // Sort Logic
    filtered.sort((a, b) => {
        if (sortBy === 'dateDesc') return new Date(b.date || 0) - new Date(a.date || 0);
        if (sortBy === 'dateAsc') return new Date(a.date || 0) - new Date(b.date || 0);
        if (sortBy === 'prizeDesc') return (b.prize || 0) - (a.prize || 0);
        return 0;
    });

    grid.innerHTML = '';

    if (filtered.length === 0) {
        grid.innerHTML = '<div class="col-span-full text-center text-gray-500 py-12">No tournaments found matching your criteria.</div>';
        return;
    }

    // Build Cards
    filtered.forEach(t => {
        const card = document.createElement('article');
        card.className = "bg-[var(--dark-card)] rounded-xl border border-white/10 overflow-hidden hover:border-[var(--gold)]/30 transition-all group relative flex flex-col h-full";
        
        const statusColor = t.status === 'Ongoing' ? 'text-green-400' : (t.status === 'Completed' ? 'text-gray-400' : 'text-[var(--gold)]');
        const bannerUrl = t.banner || 'https://placehold.co/600x400/1a1a1f/FFD700?text=No+Image';

        card.innerHTML = `
            <div class="h-48 bg-cover bg-center relative" style="background-image:url('${bannerUrl}')">
                <div class="absolute inset-0 bg-black/40 group-hover:bg-black/20 transition-colors"></div>
                <span class="absolute top-3 right-3 bg-black/60 backdrop-blur-md px-3 py-1 rounded-full text-xs font-bold text-white uppercase tracking-wide border border-white/10">
                    ${escapeHtml(t.game)}
                </span>
            </div>
            <div class="p-6 flex-1 flex flex-col">
                <h3 class="font-bold text-xl text-white mb-2 group-hover:text-[var(--gold)] transition-colors line-clamp-1">${escapeHtml(t.name)}</h3>
                
                <div class="flex justify-between items-center text-sm mb-4 border-b border-white/10 pb-4">
                    <span class="text-gray-400 flex items-center gap-2">
                        📅 ${t.date || 'TBA'}
                    </span>
                    <span class="font-bold ${statusColor}">${t.status}</span>
                </div>

                <div class="flex justify-between items-center mt-auto">
                    <div>
                        <p class="text-xs text-gray-500 uppercase font-bold">Prize Pool</p>
                        <p class="text-[var(--gold)] font-bold text-lg">₱${Number(t.prize || 0).toLocaleString()}</p>
                    </div>
                    <button class="details-btn px-4 py-2 bg-white/10 hover:bg-white/20 text-white text-sm font-semibold rounded-lg transition-colors">
                        Details
                    </button>
                </div>
            </div>
        `;
        
        // Attach click event to the details button
        card.querySelector('.details-btn').addEventListener('click', () => openModal(t));
        
        grid.appendChild(card);
    });
}

// --- Modal Logic ---
function openModal(t) {
    qs('#detailTitle').textContent = t.name;
    qs('#detailBanner').innerHTML = `<img src="${t.banner || 'https://placehold.co/600x400/1a1a1f/FFD700?text=No+Image'}" class="w-full h-64 object-cover rounded-lg">`;
    qs('#detailMeta').innerHTML = `
        <span class="bg-[var(--gold)] text-black px-2 py-1 rounded font-bold text-xs">${t.game}</span>
        <span class="bg-white/10 px-2 py-1 rounded text-xs text-white">${t.status}</span>
        <span class="text-gray-300">📅 ${t.date}</span>
        <span class="text-[var(--gold)] font-bold">🏆 ₱${Number(t.prize).toLocaleString()}</span>
    `;
    qs('#detailDesc').textContent = t.description || "No specific details provided for this tournament.";
    
    // Mock Participants List (can be connected to DB later)
    const pList = qs('#participantsList');
    pList.innerHTML = '<li class="text-gray-500 italic">Participant list is hidden or empty.</li>';
    
    document.getElementById('detailsModal').classList.remove('hidden');
}

// Make closeModal globally accessible for the HTML onclick
window.closeModal = function(id) {
    document.getElementById(id).classList.add('hidden');
}

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    fetchTournaments();
    
    // Attach live listeners for search/filter
    qs('#searchName').addEventListener('input', renderTournaments);
    qs('#filterGame').addEventListener('change', renderTournaments);
    qs('#filterStatus').addEventListener('change', renderTournaments);
    qs('#sortBy').addEventListener('change', renderTournaments);
});