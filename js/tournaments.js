import { db } from './firebase-config.js';
import { collection, getDocs, doc, getDoc, updateDoc, addDoc, arrayUnion, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-auth.js";
import { calculateStatus, escapeCssUrl } from './utils.js';

let allTournaments = [];
let currentJoiningId = null; 
let currentEditingTournament = null; 
let swapSourceIndex = null; 

function qs(sel) { return document.querySelector(sel); }
function escapeHtml(str) { if (!str) return ''; return String(str).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }

// --- Initialization & Auth Check ---
document.addEventListener('DOMContentLoaded', () => {
    fetchTournaments();
    
    // Auth Listener for Role Checking
    const auth = getAuth();
    onAuthStateChanged(auth, async (user) => {
        if (user) {
            checkCreatorPermissions(user);
        }
    });

    // Event Listeners
    if(qs('#searchName')) qs('#searchName').addEventListener('input', renderTournaments);
    if(qs('#filterGame')) qs('#filterGame').addEventListener('change', renderTournaments);
    if(qs('#filterStatus')) qs('#filterStatus').addEventListener('change', renderTournaments);
    if(qs('#sortBy')) qs('#sortBy').addEventListener('change', renderTournaments);
    
    // Create Form Listener
    const createForm = qs('#createForm');
    if(createForm) {
        createForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            await handleCreateTournament();
        });
    }
});

// --- Role Verification ---
async function checkCreatorPermissions(user) {
    try {
        const userRef = doc(db, "users", user.uid);
        const userSnap = await getDoc(userRef);
        
        if (userSnap.exists()) {
            const role = userSnap.data().role || 'user';
            const allowedRoles = ['admin', 'org partner', 'tournament organizer'];
            
            // Allow if role matches OR exact admin email (fallback)
            if (allowedRoles.includes(role) || ["admin@champzero.com"].includes(user.email)) {
                const controls = qs('#creator-controls');
                if (controls) controls.classList.remove('hidden');
            }
        }
    } catch (error) {
        console.error("Permission check failed:", error);
    }
}

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

    let filtered = allTournaments.filter(t => {
        const matchesName = (t.name || '').toLowerCase().includes(searchName);
        const matchesGame = filterGame ? (t.game === filterGame) : true;
        const actualStatus = calculateStatus(t.date, t.endDate);
        const matchesStatus = filterStatus ? actualStatus.toLowerCase() === filterStatus.toLowerCase() : true;
        return matchesName && matchesGame && matchesStatus;
    });

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

// --- Create Tournament Logic ---
window.openCreateModal = function() {
    document.getElementById('createModal').classList.remove('hidden');
    document.getElementById('createModal').classList.add('flex');
}

async function handleCreateTournament() {
    const auth = getAuth();
    const user = auth.currentUser;
    if(!user) return;

    const btn = qs('#createForm button[type="submit"]');
    btn.disabled = true;
    btn.textContent = "Creating...";

    try {
        const startDate = qs('#c-date').value;
        const endDate = qs('#c-end-date').value || startDate;
        
        const newTournament = {
            name: qs('#c-name').value,
            game: qs('#c-game').value,
            format: qs('#c-format').value,
            prize: Number(qs('#c-prize').value),
            date: startDate,
            endDate: endDate,
            description: qs('#c-desc').value,
            banner: qs('#c-banner').value || "pictures/cz_logo.png",
            status: calculateStatus(startDate, endDate),
            createdAt: serverTimestamp(),
            createdBy: user.uid,
            participants: []
        };

        await addDoc(collection(db, "tournaments"), newTournament);
        
        alert("Tournament Created Successfully!");
        window.location.reload();

    } catch (error) {
        console.error("Create Error:", error);
        alert("Failed to create tournament: " + error.message);
        btn.disabled = false;
        btn.textContent = "Launch Tournament";
    }
}

// --- Modal Logic ---
async function openModal(t) {
    const actualStatus = calculateStatus(t.date, t.endDate);
    const dateDisplay = formatDateRange(t.date, t.endDate);
    const format = t.format || "Single Elimination"; 

    currentEditingTournament = JSON.parse(JSON.stringify(t));
    if (!currentEditingTournament.participants) currentEditingTournament.participants = [];

    qs('#detailTitle').textContent = t.name;
    qs('#detailFormatBadge').textContent = format; 
    qs('#detailBanner').innerHTML = `<img src="${t.banner || 'https://placehold.co/600x400/1a1a1f/FFD700?text=No+Image'}" class="w-full h-64 object-cover rounded-lg">`;
    qs('#detailMeta').innerHTML = `
        <span class="bg-[var(--gold)] text-black px-2 py-1 rounded font-bold text-xs uppercase">${t.game}</span>
        <span class="bg-white/10 px-2 py-1 rounded text-xs text-white uppercase">${actualStatus}</span>
        <span class="text-gray-300">📅 ${dateDisplay}</span>
        <span class="text-[var(--gold)] font-bold">🏆 ₱${Number(t.prize).toLocaleString()}</span>
    `;
    qs('#detailDesc').textContent = t.description || "No specific details provided.";

    renderParticipantsList(t.participants);

    const auth = getAuth();
    const user = auth.currentUser;
    let canEdit = false;
    
    if (user) {
        // Fetch fresh role again to be safe, or reuse checks
        // Simplified check: Creator or Hardcoded Admin
        if (t.createdBy === user.uid || ["admin@champzero.com"].includes(user.email)) {
            canEdit = true;
        }
        
        // Also allow if user role is in the allowed list (requires storing role globally or refetching)
        // Since we checked role for the CREATE button, we assume if they can create, they can edit their own.
    }

    const actionArea = qs('#actionArea');
    const bracketSection = qs('#bracketSection');
    const adminToolbar = qs('#adminBracketToolbar');
    
    if (actionArea) actionArea.innerHTML = '';
    bracketSection.classList.add('hidden');
    adminToolbar.classList.add('hidden');
    adminToolbar.innerHTML = '';

    let isJoined = user && t.participants && t.participants.some(p => {
        if (typeof p === 'string') return p === (user.displayName || user.email);
        return p.registeredBy === user.uid;
    });

    if (actualStatus === 'Upcoming' || actualStatus === 'Open') {
        if (actionArea) {
            const container = document.createElement('div');
            container.className = "p-4 bg-[var(--gold)]/10 border border-[var(--gold)]/30 rounded-lg flex flex-col sm:flex-row items-center justify-between gap-4";
            const txtDiv = document.createElement('div');
            txtDiv.innerHTML = `<h5 class="text-[var(--gold)] font-bold">Registration Open</h5><p class="text-xs text-gray-400">Slots available. Gather your team.</p>`;
            const joinBtn = document.createElement('button');
            
            if (isJoined) {
                joinBtn.textContent = "Team Registered ✅";
                joinBtn.className = "bg-green-600 text-white font-bold px-6 py-2 rounded-md opacity-80 cursor-default";
                joinBtn.disabled = true;
            } else {
                joinBtn.textContent = "Join Tournament";
                joinBtn.className = "bg-[var(--gold)] hover:bg-[var(--gold-darker)] text-black font-bold px-6 py-2 rounded-md transition-colors shadow-lg shadow-[var(--gold)]/20";
                joinBtn.addEventListener('click', () => openJoinForm(t.id));
            }
            container.appendChild(txtDiv);
            container.appendChild(joinBtn);
            actionArea.appendChild(container);
        }
    } else {
        if (actionArea) {
            actionArea.innerHTML = `
                <div class="p-4 bg-blue-500/10 border border-blue-500/30 rounded-lg text-center">
                    <h5 class="text-blue-400 font-bold">${actualStatus}</h5>
                    <p class="text-xs text-gray-400">View the match brackets below.</p>
                </div>
            `;
        }
        bracketSection.classList.remove('hidden');
    }

    if (canEdit) {
        bracketSection.classList.remove('hidden');
        adminToolbar.classList.remove('hidden');
        
        const select = document.createElement('select');
        select.className = "dark-select text-xs p-1 rounded bg-black/50";
        select.innerHTML = `
            <option value="Single Elimination" ${format === 'Single Elimination' ? 'selected' : ''}>Single Elim</option>
            <option value="Double Elimination" ${format === 'Double Elimination' ? 'selected' : ''}>Double Elim</option>
            <option value="Round Robin" ${format === 'Round Robin' ? 'selected' : ''}>Round Robin</option>
        `;
        select.onchange = (e) => {
            currentEditingTournament.format = e.target.value;
            renderBracket(currentEditingTournament.participants, currentEditingTournament.format, true);
        };

        const shuffleBtn = document.createElement('button');
        shuffleBtn.className = "bg-blue-600 hover:bg-blue-500 text-white px-3 py-1 rounded text-xs";
        shuffleBtn.innerHTML = "Shuffle";
        shuffleBtn.onclick = () => {
            let arr = currentEditingTournament.participants;
            for (let i = arr.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [arr[i], arr[j]] = [arr[j], arr[i]];
            }
            renderBracket(arr, currentEditingTournament.format, true);
            renderParticipantsList(arr);
        };

        const saveBtn = document.createElement('button');
        saveBtn.className = "bg-green-600 hover:bg-green-500 text-white px-3 py-1 rounded text-xs font-bold";
        saveBtn.innerHTML = "Save";
        saveBtn.onclick = saveBracketChanges;

        adminToolbar.appendChild(select);
        adminToolbar.appendChild(shuffleBtn);
        adminToolbar.appendChild(saveBtn);

        renderBracket(currentEditingTournament.participants, currentEditingTournament.format, true);
    } else {
        if(actualStatus !== 'Upcoming' && actualStatus !== 'Open') {
            renderBracket(t.participants || [], format, false);
        }
    }

    const newUrl = `${window.location.pathname}?id=${t.id}`;
    window.history.pushState({path: newUrl}, '', newUrl);
    
    document.getElementById('detailsModal').classList.remove('hidden');
    document.getElementById('detailsModal').classList.add('flex');
}

// --- Bracket & Form Utilities ---
async function saveBracketChanges() {
    if (!currentEditingTournament || !currentEditingTournament.id) return;
    const ref = doc(db, "tournaments", currentEditingTournament.id);
    try {
        await updateDoc(ref, {
            format: currentEditingTournament.format,
            participants: currentEditingTournament.participants
        });
        alert("Bracket updated successfully!");
        qs('#detailFormatBadge').textContent = currentEditingTournament.format;
    } catch (e) {
        console.error("Save failed", e);
        alert("Failed to save: " + e.message);
    }
}

function selectTeamForSwap(index) {
    if (swapSourceIndex === null) {
        swapSourceIndex = index;
        renderBracket(currentEditingTournament.participants, currentEditingTournament.format, true);
    } else {
        if (swapSourceIndex !== index) {
            const arr = currentEditingTournament.participants;
            if(arr[swapSourceIndex] && arr[index]) {
                [arr[swapSourceIndex], arr[index]] = [arr[index], arr[swapSourceIndex]];
            }
        }
        swapSourceIndex = null;
        renderBracket(currentEditingTournament.participants, currentEditingTournament.format, true);
        renderParticipantsList(currentEditingTournament.participants);
    }
}

function openJoinForm(id) {
    const auth = getAuth();
    if (!auth.currentUser) {
        alert("Please log in to register a team.");
        window.location.href = 'login.html';
        return;
    }
    currentJoiningId = id;
    document.getElementById('joinModal').classList.remove('hidden');
    document.getElementById('joinModal').classList.add('flex');
}

const joinForm = qs('#joinForm');
if (joinForm) {
    joinForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        await submitJoinRequest();
    });
}

async function submitJoinRequest() {
    if (!currentJoiningId) return;
    const teamName = qs('#joinTeamName').value;
    const captain = qs('#joinCaptain').value;
    const contact = qs('#joinContact').value;
    const auth = getAuth();
    const user = auth.currentUser;

    const newTeam = {
        name: teamName,
        captain: captain,
        contact: contact,
        registeredAt: new Date(),
        registeredBy: user.uid
    };

    const joinModal = document.getElementById('joinModal');
    const tourneyRef = doc(db, "tournaments", currentJoiningId);

    try {
        await updateDoc(tourneyRef, {
            participants: arrayUnion(newTeam)
        });
        alert("Success! Your team has been registered.");
        joinModal.classList.add('hidden');
        window.location.reload();
    } catch (error) {
        console.error("Error joining:", error);
        alert("Failed to join: " + error.message);
    }
}

// --- Bracket Rendering ---
function renderBracket(participants, format, isEditable) {
    const container = qs('#bracketContainer');
    if (!container) return;
    container.innerHTML = '';
    
    let teams = participants.map(p => typeof p === 'object' ? p.name : p);

    if (format === 'Round Robin') {
        renderRoundRobin(container, teams);
    } else if (format === 'Double Elimination') {
        renderDoubleElimination(container, teams);
    } else {
        renderSingleElimination(container, teams, isEditable);
    }
}

function renderSingleElimination(container, teams, isEditable) {
    const displayTeams = [...teams];
    while(displayTeams.length < 8) { displayTeams.push('TBD'); }
    
    const round1 = document.createElement('div');
    round1.className = 'bracket-round';
    round1.innerHTML = '<div class="text-center text-xs text-gray-500 mb-2">Quarter Finals</div>';
    
    for(let i=0; i<4; i++) {
        const idx1 = i*2;
        const idx2 = i*2+1;
        const team1 = displayTeams[idx1];
        const team2 = displayTeams[idx2];
        const canClick1 = isEditable && idx1 < teams.length;
        const canClick2 = isEditable && idx2 < teams.length;
        const sel1 = (swapSourceIndex === idx1) ? 'selected-for-swap' : '';
        const sel2 = (swapSourceIndex === idx2) ? 'selected-for-swap' : '';
        const click1 = canClick1 ? `onclick="window.selectTeam(${idx1})"` : '';
        const click2 = canClick2 ? `onclick="window.selectTeam(${idx2})"` : '';

        round1.innerHTML += `
            <div class="match-card ${isEditable ? 'editable-mode' : ''}">
                <div class="team-slot ${sel1}" ${click1} title="${isEditable ? 'Click to swap' : ''}"><span>${escapeHtml(team1)}</span><span class="team-score">-</span></div>
                <div class="team-slot ${sel2}" ${click2} title="${isEditable ? 'Click to swap' : ''}"><span>${escapeHtml(team2)}</span><span class="team-score">-</span></div>
            </div>`;
    }

    const round2 = document.createElement('div');
    round2.className = 'bracket-round';
    round2.innerHTML = '<div class="text-center text-xs text-gray-500 mb-2">Semi Finals</div>';
    for(let i=0; i<2; i++) round2.innerHTML += `<div class="match-card"><div class="team-slot"><span>Winner Q${i*2+1}</span></div><div class="team-slot"><span>Winner Q${i*2+2}</span></div></div>`;

    const round3 = document.createElement('div');
    round3.className = 'bracket-round';
    round3.innerHTML = '<div class="text-center text-xs text-[var(--gold)] mb-2 font-bold">Grand Final</div>';
    round3.innerHTML += `<div class="match-card border-[var(--gold)]"><div class="team-slot"><span>Winner S1</span></div><div class="team-slot"><span>Winner S2</span></div></div>`;

    container.appendChild(round1);
    container.appendChild(round2);
    container.appendChild(round3);
}

function renderDoubleElimination(container, teams) {
    container.innerHTML = '<div class="text-gray-400 italic p-4 text-center border border-white/10 rounded">Double Elimination Bracket <br>(Switch to Single Elim to edit matchups)</div>';
}

function renderRoundRobin(container, teams) {
    if (teams.length === 0) {
        container.innerHTML = '<div class="text-gray-500 p-4">No teams to display.</div>';
        return;
    }
    let html = '<table class="rr-table"><thead><tr><th>Team</th>';
    teams.forEach((t, i) => html += `<th>${i+1}</th>`);
    html += '<th>Pts</th></tr></thead><tbody>';
    teams.forEach((t, i) => {
        html += `<tr><td class="font-bold text-white text-left">${escapeHtml(t)}</td>`;
        teams.forEach((_, j) => {
            if (i === j) html += `<td class="bg-white/5">-</td>`;
            else html += `<td>vs</td>`;
        });
        html += `<td>0</td></tr>`;
    });
    html += '</tbody></table>';
    container.innerHTML = html;
}

function renderParticipantsList(participants) {
    const pList = qs('#participantsList');
    if (!pList) return;
    if (participants && participants.length > 0) {
        pList.innerHTML = participants.map(team => {
            const teamName = typeof team === 'object' ? team.name : team;
            const captain = typeof team === 'object' ? `(Cap: ${team.captain})` : '';
            return `
                <li class="flex items-center justify-between border-b border-white/5 py-2 last:border-0">
                    <span class="font-medium text-white">${escapeHtml(teamName)} <span class="text-[10px] text-gray-500">${escapeHtml(captain)}</span></span>
                    <span class="text-xs text-gray-500">Registered</span>
                </li>
            `;
        }).join('');
    } else {
        pList.innerHTML = '<li class="text-gray-500 italic text-center py-4">No teams registered yet.</li>';
    }
}

// Expose to window
window.selectTeam = selectTeamForSwap;
window.closeModal = function(id) {
    document.getElementById(id).classList.remove('flex');
    document.getElementById(id).classList.add('hidden');
    if (id === 'detailsModal') {
        const newUrl = window.location.pathname;
        window.history.pushState({path: newUrl}, '', newUrl);
        swapSourceIndex = null;
        currentEditingTournament = null;
    }
}

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