import { db } from './firebase-config.js';
import { collection, getDocs, doc, getDoc, updateDoc, addDoc, arrayUnion, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-auth.js";
import { calculateStatus, escapeCssUrl } from './utils.js';

let allTournaments = [];
let currentJoiningId = null;
let currentEditingTournament = null;
let swapSourceIndex = null;

function qs(sel) { return document.querySelector(sel); }
function escapeHtml(str) { if (!str) return ''; return String(str).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])); }

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
    if (qs('#searchName')) qs('#searchName').addEventListener('input', renderTournaments);
    if (qs('#filterGame')) qs('#filterGame').addEventListener('change', renderTournaments);
    if (qs('#filterStatus')) qs('#filterStatus').addEventListener('change', renderTournaments);
    if (qs('#sortBy')) qs('#sortBy').addEventListener('change', renderTournaments);

    // Create Form Listener
    const createForm = qs('#createForm');
    if (createForm) {
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
    if (!grid) return;

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
window.openCreateModal = function () {
    document.getElementById('createModal').classList.remove('hidden');
    document.getElementById('createModal').classList.add('flex');
}

async function handleCreateTournament() {
    const auth = getAuth();
    const user = auth.currentUser;
    if (!user) return;

    const btn = qs('#createForm button[type="submit"]');
    btn.disabled = true;
    btn.textContent = "Creating...";

    try {
        const startDate = qs('#c-date').value;
        const endDate = qs('#c-end-date').value || startDate;

        // Handle Game Title Logic
        const gameSelect = qs('#c-game-select').value;
        const gameOther = qs('#c-game-other').value;
        const finalGameTitle = (gameSelect === 'Others') ? gameOther : gameSelect;

        // Handle Max Teams
        const maxTeams = parseInt(qs('#c-max-teams').value) || 8;

        const newTournament = {
            name: qs('#c-name').value,
            game: finalGameTitle,
            format: qs('#c-format').value,
            maxTeams: maxTeams, // Saved to DB
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
        if (actualStatus !== 'Upcoming' && actualStatus !== 'Open') {
            renderBracket(t.participants || [], format, false);
        }
    }

    const newUrl = `${window.location.pathname}?id=${t.id}`;
    window.history.pushState({ path: newUrl }, '', newUrl);

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
            if (arr[swapSourceIndex] && arr[index]) {
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

function renderSingleElimination(container, participants, isEditable) {
    // 1. Setup Bracket Data
    let targetSize = currentEditingTournament.maxTeams || 8;
    let bracketSize = 2;
    while (bracketSize < targetSize) bracketSize *= 2;

    let seeds = [...participants.map(p => typeof p === 'object' ? p.name : p)];
    while(seeds.length < targetSize) seeds.push('TBD');
    
    // Calculate Byes
    const totalSlots = bracketSize;
    const numByes = totalSlots - seeds.length;
    for(let i=0; i<numByes; i++) seeds.push('BYE');

    let rounds = Math.log2(bracketSize);

    // 2. Render Rounds
    for (let r = 0; r < rounds; r++) {
        const roundDiv = document.createElement('div');
        roundDiv.className = 'bracket-round';
        
        // Round Title
        let roundName = `Round ${r + 1}`;
        if (r === rounds - 1) roundName = "Grand Final";
        else if (r === rounds - 2) roundName = "Semi Finals";
        
        roundDiv.innerHTML = `<div class="text-center text-xs text-gray-500 mb-4 font-bold uppercase tracking-wider h-6">${roundName}</div>`;

        const matchesInRound = bracketSize / Math.pow(2, r + 1);

        // --- KEY CHANGE: Loop by 2 to create PAIRS ---
        for (let m = 0; m < matchesInRound; m += 2) {
            
            // Create the container that holds TWO matches (The "Fork")
            const pairWrapper = document.createElement('div');
            pairWrapper.className = 'match-pair'; 

            // Logic to handle the Final Round (which has only 1 match, not a pair)
            let subLoopLimit = (r === rounds - 1) ? 1 : 2;

            for(let i = 0; i < subLoopLimit; i++) {
                let currentM = m + i;
                let team1 = "TBD", team2 = "TBD";
                let isByeMatch = false;

                // Determine Teams
                if (r === 0) {
                    const idx1 = currentM * 2;
                    const idx2 = currentM * 2 + 1;
                    team1 = seeds[idx1] || "TBD";
                    team2 = seeds[idx2] || "TBD";
                    if (team1 === 'BYE' || team2 === 'BYE') isByeMatch = true;
                } else {
                    team1 = (r === rounds - 1) ? "Winner S1" : `Winner R${r}-M${currentM*2+1}`;
                    team2 = (r === rounds - 1) ? "Winner S2" : `Winner R${r}-M${currentM*2+2}`;
                }

                // Render Individual Match Card
                let matchHTML = '';
                if (isByeMatch) {
                    const realTeam = (team1 !== 'BYE') ? team1 : team2;
                    matchHTML = `
                        <div class="match-card opacity-70 border-dashed border-gray-600">
                            <div class="team-slot"><span class="text-[var(--gold)]">${escapeHtml(realTeam)}</span><span class="text-xs text-green-400">Advances</span></div>
                            <div class="team-slot text-gray-600"><span>BYE</span></div>
                        </div>`;
                } else {
                    const idx1 = (r===0) ? currentM*2 : -1;
                    const idx2 = (r===0) ? currentM*2+1 : -1;
                    const click1 = (isEditable && r===0 && team1 !== 'TBD') ? `onclick="window.selectTeam(${idx1})"` : '';
                    const click2 = (isEditable && r===0 && team2 !== 'TBD') ? `onclick="window.selectTeam(${idx2})"` : '';
                    const sel1 = (swapSourceIndex === idx1 && r===0) ? 'selected-for-swap' : '';
                    const sel2 = (swapSourceIndex === idx2 && r===0) ? 'selected-for-swap' : '';
                    
                    const isFinal = (r === rounds - 1);
                    const borderClass = isFinal ? 'border-[var(--gold)] shadow-[0_0_15px_rgba(255,215,0,0.2)]' : '';

                    matchHTML = `
                        <div class="match-card ${borderClass} ${isEditable && r===0 ? 'editable-mode' : ''}">
                            <div class="team-slot ${sel1}" ${click1}><span>${escapeHtml(team1)}</span><span class="team-score">-</span></div>
                            <div class="team-slot ${sel2}" ${click2}><span>${escapeHtml(team2)}</span><span class="team-score">-</span></div>
                        </div>`;
                }
                pairWrapper.innerHTML += matchHTML;
            }
            roundDiv.appendChild(pairWrapper);
        }
        container.appendChild(roundDiv);
    }
}

function renderDoubleElimination(container, participants, isEditable) {
    container.innerHTML = '';

    // --- 1. Setup Data & Sizing ---
    let targetSize = currentEditingTournament.maxTeams || 8;
    let bracketSize = 2;
    while (bracketSize < targetSize) bracketSize *= 2;

    // Prepare seeds similar to Single Elim
    let seeds = [...participants.map(p => typeof p === 'object' ? p.name : p)];
    while (seeds.length < targetSize) seeds.push('TBD');
    const totalSlots = bracketSize;
    const numByes = totalSlots - seeds.length;
    for (let i = 0; i < numByes; i++) seeds.push('BYE');

    // =========================================
    // 2. Render UPPER BRACKET (Winner's)
    // =========================================

    const upperWrapper = document.createElement('div');
    upperWrapper.className = "mb-12 border-b border-white/10 pb-8";
    upperWrapper.innerHTML = '<h4 class="text-[var(--gold)] font-bold uppercase tracking-widest mb-4 border-l-4 border-[var(--gold)] pl-3">Upper Bracket</h4>';

    const ubContainer = document.createElement('div');
    ubContainer.className = "bracket-wrapper overflow-x-auto custom-scrollbar";

    let wbRounds = Math.log2(bracketSize);

    for (let r = 0; r < wbRounds; r++) {
        const roundDiv = document.createElement('div');
        roundDiv.className = 'bracket-round';
        roundDiv.innerHTML = `<div class="text-center text-xs text-gray-500 mb-2 font-bold uppercase">WB Round ${r + 1}</div>`;

        const matchesInRound = bracketSize / Math.pow(2, r + 1);

        // --- FIX: Loop by 2 to create PAIRS (just like Single Elim) ---
        for (let m = 0; m < matchesInRound; m += 2) {
            
            // Create the container that holds TWO matches (The "Fork" for the lines)
            const pairWrapper = document.createElement('div');
            pairWrapper.className = 'match-pair';

            // Determine if this is the last round of WB (which is the WB Final, effectively 1 match)
            // If it is the WB Final, we only render 1 match in the pair, otherwise 2.
            let subLoopLimit = (r === wbRounds - 1) ? 1 : 2;

            for (let i = 0; i < subLoopLimit; i++) {
                let currentM = m + i;
                let team1 = "TBD", team2 = "TBD";
                let isBye = false;

                if (r === 0) {
                    // Initial Seeding
                    const idx1 = currentM * 2;
                    const idx2 = currentM * 2 + 1;
                    team1 = seeds[idx1] || "TBD";
                    team2 = seeds[idx2] || "TBD";
                    if (team1 === 'BYE' || team2 === 'BYE') isBye = true;
                } else {
                    // Standard advancement logic
                    team1 = `W-R${r}-M${currentM * 2 + 1}`;
                    team2 = `W-R${r}-M${currentM * 2 + 2}`;
                }

                if (isBye) {
                    const real = (team1 !== 'BYE') ? team1 : team2;
                    pairWrapper.innerHTML += `
                        <div class="match-card opacity-50 border-dashed border-gray-600">
                            <div class="team-slot"><span class="text-[var(--gold)]">${escapeHtml(real)}</span><span class="text-xs text-green-400">Advances</span></div>
                            <div class="team-slot text-gray-600"><span>BYE</span></div>
                        </div>`;
                } else {
                    // Interactive swapping only allowed in Round 1
                    const idx1 = r === 0 ? currentM * 2 : -1;
                    const idx2 = r === 0 ? currentM * 2 + 1 : -1;
                    const click1 = (isEditable && r === 0 && team1 !== 'TBD') ? `onclick="window.selectTeam(${idx1})"` : '';
                    const click2 = (isEditable && r === 0 && team2 !== 'TBD') ? `onclick="window.selectTeam(${idx2})"` : '';
                    const sel1 = (swapSourceIndex === idx1 && r === 0) ? 'selected-for-swap' : '';
                    const sel2 = (swapSourceIndex === idx2 && r === 0) ? 'selected-for-swap' : '';

                    pairWrapper.innerHTML += `
                        <div class="match-card ${isEditable && r === 0 ? 'editable-mode' : ''}">
                            <div class="team-slot ${sel1}" ${click1}><span>${escapeHtml(team1)}</span><span class="team-score">-</span></div>
                            <div class="team-slot ${sel2}" ${click2}><span>${escapeHtml(team2)}</span><span class="team-score">-</span></div>
                        </div>`;
                }
            }
            roundDiv.appendChild(pairWrapper);
        }
        ubContainer.appendChild(roundDiv);
    }
    upperWrapper.appendChild(ubContainer);
    container.appendChild(upperWrapper);

    // =========================================
    // 3. Render LOWER BRACKET (Loser's)
    // =========================================
    // Note: LB lines are tricky because they don't always merge perfectly in binary pairs.
    // For now, we will render them simply to keep the layout clean without broken connectors.

    const lowerWrapper = document.createElement('div');
    lowerWrapper.innerHTML = '<h4 class="text-red-400 font-bold uppercase tracking-widest mb-4 border-l-4 border-red-500 pl-3">Lower Bracket</h4>';

    const lbContainer = document.createElement('div');
    lbContainer.className = "bracket-wrapper overflow-x-auto custom-scrollbar";

    // Calculate Lower Bracket Rounds: (WB_Rounds - 1) * 2
    const lbRoundsCount = (wbRounds - 1) * 2;

    for (let r = 0; r < lbRoundsCount; r++) {
        const roundDiv = document.createElement('div');
        roundDiv.className = 'bracket-round';
        roundDiv.innerHTML = `<div class="text-center text-xs text-gray-500 mb-2 font-bold uppercase">LB Round ${r + 1}</div>`;

        // Calculate matches in this LB round
        const powerDrop = Math.floor(r / 2);
        const matchesInThisRound = Math.max(1, (bracketSize / 4) / Math.pow(2, powerDrop));

        // Grouping LB into "Pairs" visually helps alignment, even if lines aren't perfect binary trees
        for (let m = 0; m < matchesInThisRound; m++) {
            // We wrap individual matches in a 'match-pair' logic just to keep height consistent
            // effectively acting as a single items container here
            const pairWrapper = document.createElement('div');
            pairWrapper.className = 'match-pair'; 
            
            // Note: In CSS, a 'match-pair' with only 1 child might not draw the fork correctly
            // because the fork connects child 1 and child 2. 
            // However, this keeps the vertical spacing consistent with the Upper Bracket.
            
            pairWrapper.innerHTML = `
                <div class="match-card border-red-500/20">
                    <div class="team-slot text-gray-400"><span>Waiting...</span></div>
                    <div class="team-slot text-gray-400"><span>Waiting...</span></div>
                </div>`;
                
            roundDiv.appendChild(pairWrapper);
        }
        lbContainer.appendChild(roundDiv);
    }

    // Add Grand Final
    const finalDiv = document.createElement('div');
    finalDiv.className = 'bracket-round flex flex-col justify-center';
    
    // Determine winner of UB and LB
    finalDiv.innerHTML = `
        <div class="text-center text-xs text-[var(--gold)] mb-2 font-bold uppercase">Grand Final</div>
        <div class="match-pair">
            <div class="match-card border-[var(--gold)] shadow-[0_0_20px_rgba(255,215,0,0.15)]">
                 <div class="team-slot"><span class="text-[var(--gold)]">Winner UB</span></div>
                 <div class="team-slot"><span class="text-red-400">Winner LB</span></div>
            </div>
        </div>`;

    lbContainer.appendChild(finalDiv);

    lowerWrapper.appendChild(lbContainer);
    container.appendChild(lowerWrapper);
}

function renderRoundRobin(container, participants) {
    // 1. Determine size: use registered teams or fallback to Max Teams
    // If we are in "Edit Mode" (creator), we might want to show empty slots up to Max Teams.
    // If in "View Mode", we usually just show registered teams.
    // For this implementation, we will show all slots up to Max Teams to let organizers see the full grid.

    let targetSize = currentEditingTournament ? (currentEditingTournament.maxTeams || 8) : participants.length;
    // Minimum 2 for display
    if (targetSize < 2) targetSize = 2;

    const teamNames = [];
    for (let i = 0; i < targetSize; i++) {
        const p = participants[i];
        if (p) {
            teamNames.push(typeof p === 'object' ? p.name : p);
        } else {
            teamNames.push(`Slot ${i + 1}`);
        }
    }

    // 2. Build the Table
    let html = `
    <div class="overflow-x-auto">
        <table class="rr-table min-w-full">
            <thead>
                <tr>
                    <th class="w-32 bg-black/20 border-white/10">Team</th>`;

    // Header Row (1, 2, 3...)
    teamNames.forEach((_, i) => {
        html += `<th class="w-16 bg-black/20 border-white/10">${i + 1}</th>`;
    });

    html += `       <th class="w-16 bg-[var(--gold)]/10 text-[var(--gold)] border-white/10">W-L</th>
                </tr>
            </thead>
            <tbody>`;

    // Rows
    teamNames.forEach((teamA, i) => {
        html += `<tr>
            <td class="font-bold text-white text-left px-3 border-white/10 truncate max-w-[150px]" title="${escapeHtml(teamA)}">
                <span class="text-[var(--gold)] mr-2">${i + 1}</span>${escapeHtml(teamA)}
            </td>`;

        teamNames.forEach((teamB, j) => {
            if (i === j) {
                // Diagonal (Self vs Self)
                html += `<td class="bg-white/5 border-white/10"></td>`;
            } else {
                // Match Slot
                // In a real app, you'd fetch the score from DB here.
                html += `<td class="border-white/10 text-xs text-gray-500 hover:bg-white/5 cursor-pointer" title="${escapeHtml(teamA)} vs ${escapeHtml(teamB)}">vs</td>`;
            }
        });

        // Stats Column (Placeholder)
        html += `<td class="font-bold text-[var(--gold)] border-white/10">0-0</td></tr>`;
    });

    html += '</tbody></table></div>';

    // Optional: Add a "Matches List" below for clarity if needed, 
    // but the table is the standard Round Robin view.
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
window.closeModal = function (id) {
    document.getElementById(id).classList.remove('flex');
    document.getElementById(id).classList.add('hidden');
    if (id === 'detailsModal') {
        const newUrl = window.location.pathname;
        window.history.pushState({ path: newUrl }, '', newUrl);
        swapSourceIndex = null;
        currentEditingTournament = null;
    }
}

window.toggleOtherGameInput = function () {
    const select = document.getElementById('c-game-select');
    const otherInput = document.getElementById('c-game-other');
    if (select.value === 'Others') {
        otherInput.classList.remove('hidden');
        otherInput.required = true;
    } else {
        otherInput.classList.add('hidden');
        otherInput.required = false;
        otherInput.value = '';
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