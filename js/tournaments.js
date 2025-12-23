import { db } from './firebase-config.js';
import { collection, getDocs, doc, getDoc, updateDoc, arrayUnion } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-auth.js";
import { calculateStatus, escapeCssUrl } from './utils.js';

let allTournaments = [];

// Helper functions
function qs(sel) { return document.querySelector(sel); }
function escapeHtml(str) { if (!str) return ''; return String(str).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }

// --- Fetch Data ---
async function fetchTournaments() {
    const grid = qs('#tournamentGrid');
    if (!grid) return; 

    grid.innerHTML = '<div class="col-span-full text-center text-gray-500 py-12">Loading tournaments...</div>';

    try {
        const querySnapshot = await getDocs(collection(db, "tournaments"));
        
        allTournaments = [];
        querySnapshot.forEach((doc) => {
            allTournaments.push({ id: doc.id, ...doc.data() });
        });

        renderTournaments();

        // Check for Deep Link (?id=...) after data loads
        const params = new URLSearchParams(window.location.search);
        const tourneyId = params.get('id');
        if (tourneyId) {
            const found = allTournaments.find(t => t.id === tourneyId);
            if (found) openModal(found);
        }

    } catch (error) {
        console.error("Error fetching tournaments:", error);
        grid.innerHTML = '<div class="col-span-full text-center text-red-500 py-12">Failed to load tournaments.</div>';
    }
}

// --- Render & Filter Logic ---
function renderTournaments() {
    const grid = qs('#tournamentGrid');
    if(!grid) return;
    
    const searchName = qs('#searchName').value.toLowerCase();
    const filterGame = qs('#filterGame').value;
    const filterStatus = qs('#filterStatus').value;
    const sortBy = qs('#sortBy').value;

    // Filter Logic
    let filtered = allTournaments.filter(t => {
        const matchesName = (t.name || '').toLowerCase().includes(searchName);
        const matchesGame = filterGame ? (t.game === filterGame) : true;
        const actualStatus = calculateStatus(t.date, t.endDate);
        const matchesStatus = filterStatus ? actualStatus.toLowerCase() === filterStatus.toLowerCase() : true;
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
        
        const actualStatus = calculateStatus(t.date, t.endDate);
        const statusColor = actualStatus === 'Ongoing' ? 'text-green-400' : (actualStatus === 'Completed' ? 'text-gray-400' : 'text-[var(--gold)]');
        const bannerUrl = t.banner || 'https://placehold.co/600x400/1a1a1f/FFD700?text=No+Image';
        const dateDisplay = formatDateRange(t.date, t.endDate);

        card.innerHTML = `
            <div class="h-48 bg-cover bg-center relative" style="background-image:url('${escapeCssUrl(bannerUrl)}')">
                <div class="absolute inset-0 bg-black/40 group-hover:bg-black/20 transition-colors"></div>
                <span class="absolute top-3 right-3 bg-black/60 backdrop-blur-md px-3 py-1 rounded-full text-xs font-bold text-white uppercase tracking-wide border border-white/10">
                    ${escapeHtml(t.game)}
                </span>
            </div>
            <div class="p-6 flex-1 flex flex-col">
                <h3 class="font-bold text-xl text-white mb-2 group-hover:text-[var(--gold)] transition-colors line-clamp-1">${escapeHtml(t.name)}</h3>
                
                <div class="flex justify-between items-center text-sm mb-4 border-b border-white/10 pb-4">
                    <span class="text-gray-400 flex items-center gap-2">📅 ${dateDisplay}</span>
                    <span class="font-bold ${statusColor}">${actualStatus}</span>
                </div>

                <div class="flex justify-between items-center mt-auto">
                    <div>
                        <p class="text-xs text-gray-500 uppercase font-bold">Prize Pool</p>
                        <p class="text-[var(--gold)] font-bold text-lg">₱${Number(t.prize || 0).toLocaleString()}</p>
                    </div>
                    <button class="details-btn px-4 py-2 bg-white/10 hover:bg-white/20 text-white text-sm font-semibold rounded-lg transition-colors">Details</button>
                </div>
            </div>
        `;
        
        card.querySelector('.details-btn').addEventListener('click', () => openModal(t));
        grid.appendChild(card);
    });
}

// --- Modal Logic ---
function openModal(t) {
    const actualStatus = calculateStatus(t.date, t.endDate);
    const dateDisplay = formatDateRange(t.date, t.endDate);

    // 1. Fill basic data
    qs('#detailTitle').textContent = t.name;
    qs('#detailBanner').innerHTML = `<img src="${t.banner || 'https://placehold.co/600x400/1a1a1f/FFD700?text=No+Image'}" class="w-full h-64 object-cover rounded-lg">`;
    qs('#detailMeta').innerHTML = `
        <span class="bg-[var(--gold)] text-black px-2 py-1 rounded font-bold text-xs uppercase">${t.game}</span>
        <span class="bg-white/10 px-2 py-1 rounded text-xs text-white uppercase">${actualStatus}</span>
        <span class="text-gray-300">📅 ${dateDisplay}</span>
        <span class="text-[var(--gold)] font-bold">🏆 ₱${Number(t.prize).toLocaleString()}</span>
    `;
    qs('#detailDesc').textContent = t.description || "No specific details provided.";

    // 2. Participants
    const pList = qs('#participantsList');
    if (t.participants && t.participants.length > 0) {
        pList.innerHTML = t.participants.map(team => `
            <li class="flex items-center justify-between border-b border-white/5 py-2 last:border-0">
                <span class="font-medium text-white">${escapeHtml(team)}</span>
                <span class="text-xs text-gray-500">Registered</span>
            </li>
        `).join('');
    } else {
        pList.innerHTML = '<li class="text-gray-500 italic text-center py-4">No teams registered yet.</li>';
    }

    // 3. Action Area (Join Button)
    const actionArea = qs('#actionArea');
    const bracketSection = qs('#bracketSection');
    
    // Clear previous state
    if (actionArea) actionArea.innerHTML = '';
    if (bracketSection) bracketSection.classList.add('hidden');

    // -- LOGIC: IF Upcoming, show Join. IF Ongoing/Past, show Bracket --
    if (actualStatus === 'Upcoming' || actualStatus === 'Open') {
        if (actionArea) {
            const container = document.createElement('div');
            container.className = "p-4 bg-[var(--gold)]/10 border border-[var(--gold)]/30 rounded-lg flex flex-col sm:flex-row items-center justify-between gap-4";
            
            const txtDiv = document.createElement('div');
            txtDiv.innerHTML = `<h5 class="text-[var(--gold)] font-bold">Registration Open</h5><p class="text-xs text-gray-400">Slots available. Gather your team.</p>`;
            
            const joinBtn = document.createElement('button');
            joinBtn.textContent = "Join Tournament";
            joinBtn.className = "bg-[var(--gold)] hover:bg-[var(--gold-darker)] text-black font-bold px-6 py-2 rounded-md transition-colors shadow-lg shadow-[var(--gold)]/20";
            
            // Check if user is already in participants
            const auth = getAuth();
            const user = auth.currentUser;
            const userName = user ? (user.displayName || user.email) : null;
            
            if (userName && t.participants && t.participants.includes(userName)) {
                joinBtn.textContent = "Joined ✅";
                joinBtn.disabled = true;
                joinBtn.className = "bg-green-600 text-white font-bold px-6 py-2 rounded-md opacity-50 cursor-not-allowed";
            } else {
                joinBtn.addEventListener('click', () => handleJoinTournament(t.id));
            }

            container.appendChild(txtDiv);
            container.appendChild(joinBtn);
            actionArea.appendChild(container);
        }
    } else {
        // Show Status for Ongoing/Past
        if (actionArea) {
            actionArea.innerHTML = `
                <div class="p-4 bg-blue-500/10 border border-blue-500/30 rounded-lg text-center">
                    <h5 class="text-blue-400 font-bold">${actualStatus === 'Ongoing' ? 'Tournament in Progress' : 'Tournament Completed'}</h5>
                    <p class="text-xs text-gray-400">View the match brackets below.</p>
                </div>
            `;
        }
        // Show Bracket
        if (bracketSection) {
            bracketSection.classList.remove('hidden');
            renderBracket(t.participants || []);
        }
    }

    // Deep link support
    const newUrl = `${window.location.pathname}?id=${t.id}`;
    window.history.pushState({path: newUrl}, '', newUrl);
    
    document.getElementById('detailsModal').classList.remove('hidden');
    document.getElementById('detailsModal').classList.add('flex');
}

// --- Join Logic (Approves Automatically) ---
async function handleJoinTournament(tournamentId) {
    const auth = getAuth();
    const user = auth.currentUser;

    if (!user) {
        alert("Please log in to join tournaments.");
        window.location.href = 'login.html';
        return;
    }

    const userName = user.displayName || user.email || "Anonymous Player";

    // 1. Get Reference
    const tourneyRef = doc(db, "tournaments", tournamentId);

    try {
        // 2. Update Database (Instant Approval)
        await updateDoc(tourneyRef, {
            participants: arrayUnion(userName)
        });

        alert("Success! You have joined the tournament.");
        
        // 3. Reload to show updated data
        window.location.reload();
        
    } catch (error) {
        console.error("Error joining tournament:", error);
        alert("Failed to join: " + error.message);
    }
}

// --- Bracket Generator ---
function renderBracket(participants) {
    const container = qs('#bracketContainer');
    if (!container) return;
    container.innerHTML = '';
    
    let teams = [...participants];
    // Pad with "TBD" if fewer than 8 players
    while(teams.length < 8) { teams.push('TBD'); }
    teams = teams.slice(0, 8);

    // QF
    const round1 = document.createElement('div');
    round1.className = 'bracket-round';
    round1.innerHTML = '<div class="text-center text-xs text-gray-500 mb-2">Quarter Finals</div>';
    for(let i=0; i<4; i++) {
        round1.innerHTML += `
            <div class="match-card">
                <div class="team-slot"><span>${escapeHtml(teams[i*2])}</span><span class="team-score">-</span></div>
                <div class="team-slot"><span>${escapeHtml(teams[i*2+1])}</span><span class="team-score">-</span></div>
            </div>`;
    }

    // SF
    const round2 = document.createElement('div');
    round2.className = 'bracket-round';
    round2.innerHTML = '<div class="text-center text-xs text-gray-500 mb-2">Semi Finals</div>';
    for(let i=0; i<2; i++) {
         round2.innerHTML += `
            <div class="match-card">
                <div class="team-slot"><span>Winner Q${i*2+1}</span><span class="team-score">-</span></div>
                <div class="team-slot"><span>Winner Q${i*2+2}</span><span class="team-score">-</span></div>
            </div>`;
    }

    // Finals
    const round3 = document.createElement('div');
    round3.className = 'bracket-round';
    round3.innerHTML = '<div class="text-center text-xs text-[var(--gold)] mb-2 font-bold">Grand Final</div>';
    round3.innerHTML += `
        <div class="match-card border-[var(--gold)]">
            <div class="team-slot"><span>Winner S1</span><span class="team-score">-</span></div>
            <div class="team-slot"><span>Winner S2</span><span class="team-score">-</span></div>
        </div>`;

    container.appendChild(round1);
    container.appendChild(round2);
    container.appendChild(round3);
}

// --- Utils ---
function formatDateRange(start, end) {
    if (!start) return 'TBA';
    const startDateObj = start.toDate ? start.toDate() : new Date(start);
    let display = startDateObj.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    if (end) {
        const endDateObj = end.toDate ? end.toDate() : new Date(end);
        display = `${display} - ${endDateObj.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
    }
    return display;
}

window.closeModal = function(id) {
    document.getElementById(id).classList.remove('flex');
    document.getElementById(id).classList.add('hidden');
    const newUrl = window.location.pathname;
    window.history.pushState({path: newUrl}, '', newUrl);
}

document.addEventListener('DOMContentLoaded', () => {
    fetchTournaments();
    if(qs('#searchName')) qs('#searchName').addEventListener('input', renderTournaments);
    if(qs('#filterGame')) qs('#filterGame').addEventListener('change', renderTournaments);
    if(qs('#filterStatus')) qs('#filterStatus').addEventListener('change', renderTournaments);
    if(qs('#sortBy')) qs('#sortBy').addEventListener('change', renderTournaments);
});