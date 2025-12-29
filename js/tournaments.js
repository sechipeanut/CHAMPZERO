import { db } from './firebase-config.js';
import { collection, getDocs, doc, getDoc, updateDoc, addDoc, deleteDoc, arrayUnion, arrayRemove, serverTimestamp, query, where, writeBatch, onSnapshot } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-auth.js";
import { calculateStatus, escapeCssUrl } from './utils.js';

let allTournaments = [];
let currentJoiningId = null;
let currentEditingTournament = null;
let swapSourceIndex = null;
let userTeams = [];
let currentUserTeamIds = new Set();
let adminUnsubscribe = null;
let tournamentUnsubscribe = null;

function qs(sel) { return document.querySelector(sel); }
function escapeHtml(str) { if (!str) return ''; return String(str).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])); }

// --- CUSTOM MODAL HELPERS ---
function animateGenericOpen(modalId, backdropId, panelId) {
    const modal = document.getElementById(modalId);
    const backdrop = document.getElementById(backdropId);
    const panel = document.getElementById(panelId);
    if (!modal) return;
    modal.classList.remove('hidden');
    setTimeout(() => { backdrop.classList.remove('opacity-0'); panel.classList.remove('opacity-0', 'scale-95'); panel.classList.add('opacity-100', 'scale-100'); }, 10);
}

// --- INJECT RECURSIVE TREE CSS (Theme: Original ChampZero) ---
function injectTreeStyles() {
    if (document.getElementById('tree-bracket-styles')) return;
    const style = document.createElement('style');
    style.id = 'tree-bracket-styles';
    style.textContent = `
        /* --- RESPONSIVE VARIABLES --- */
        :root {
            --tree-card-width: 220px;
            --tree-gap-parent: 50px; /* The gap to the left of a parent */
            --tree-gap-child: 25px;  /* The gap to the right of a child */
            /* Total gap = parent + child (75px default) */
            
            --gf-connector-width: 48px; /* Width of line connecting UB to Grand Final */
            --gf-padding-left: 8px;     /* Padding before GF Card */
            --gf-header-offset: calc(var(--gf-connector-width) + var(--gf-padding-left));
        }

        /* MOBILE OVERRIDE (Screens smaller than 768px) */
        @media (max-width: 768px) {
            :root {
                --tree-card-width: 150px; /* Smaller cards */
                --tree-gap-parent: 20px;  /* Tighter structure */
                --tree-gap-child: 15px;
                --gf-connector-width: 24px;
                --gf-padding-left: 4px;
            }
            .tree-match-card {
                font-size: 0.75rem !important; /* Smaller text */
            }
            .header-item {
                font-size: 0.7rem !important;
            }
        }

        /* Main Container */
        .bracket-scroll-container {
            display: flex;
            flex-direction: column;
            align-items: flex-start;
            padding: 20px; /* Reduced padding for mobile */
            overflow: auto;
            -webkit-overflow-scrolling: touch; /* Smooth scroll on iOS */
            height: 100%;
            min-height: 500px;
        }

        /* HEADER STYLES */
        .bracket-header-row {
            display: flex;
            flex-direction: row;
            margin-bottom: 20px;
            padding-left: 50px; 
            min-width: max-content;
        }
        
        .header-item {
            width: var(--tree-card-width);
            display: flex;
            justify-content: center;
            align-items: center;
            font-weight: 800;
            color: var(--gold);
            text-transform: uppercase;
            letter-spacing: 0.1em;
            font-size: 0.85rem;
            /* Dynamic Margin based on gaps */
            margin-right: calc(var(--tree-gap-parent) + var(--tree-gap-child)); 
            flex-shrink: 0;
            position: relative;
            text-shadow: 0 0 10px rgba(255, 215, 0, 0.3);
        }

        /* Special Class for Grand Final Header Alignment */
        .header-item.gf-header {
            margin-left: var(--gf-header-offset) !important;
            margin-right: 0 !important;
        }
        
        .header-item::after {
            content: '';
            position: absolute;
            bottom: -8px;
            left: 50%;
            transform: translateX(-50%);
            width: 40%;
            height: 2px;
            background: var(--gold);
            box-shadow: 0 0 8px var(--gold);
        }

        /* BRACKET TREE WRAPPER */
        .wrapper {
            display: flex;
            align-items: center;
            padding: 0; 
            min-width: max-content;
        }

        .item { display: flex; flex-direction: row; align-items: center; }

        .item-parent {
            position: relative;
            margin-left: var(--tree-gap-parent); /* USE VARIABLE */
            display: flex;
            align-items: center;
            z-index: 10;
        }

        .item-parent::after {
            position: absolute;
            content: '';
            width: var(--tree-gap-parent); /* USE VARIABLE */
            height: 2px;
            left: 0;
            top: 50%;
            background-color: var(--line-color, rgba(255, 255, 255, 0.4));
            transform: translateX(-100%);
        }

        .item-childrens { display: flex; flex-direction: column; justify-content: center; }
        
        .item-child {
            display: flex;
            align-items: center;
            justify-content: flex-end;
            margin: 5px 0; /* Tighter vertical margin */
            position: relative;
            padding-right: var(--tree-gap-child); /* USE VARIABLE */
        }
        
        .item-child::before {
            content: '';
            position: absolute;
            background-color: var(--line-color, rgba(255, 255, 255, 0.4));
            right: 0;
            top: 50%;
            width: var(--tree-gap-child); /* USE VARIABLE */
            height: 2px;
        }
        
        .item-child::after {
            content: '';
            position: absolute;
            background-color: var(--line-color, rgba(255, 255, 255, 0.4));
            right: 0;
            width: 2px;
        }
        
        .item-child:first-child::after { top: 50%; height: calc(50% + 6px); }
        .item-child:last-child::after { top: auto; bottom: 50%; height: calc(50% + 6px); }
        .item-child:only-child::after { display: none; }
        .item-childrens:empty + .item-parent::after { display: none; }

        /* Grand Final Connector Line Class */
        .gf-connector-line {
            width: var(--gf-connector-width);
            height: 2px;
            background-color: #4b5563; /* gray-600 */
        }

        .gf-wrapper {
            padding-left: var(--gf-padding-left);
        }

        /* CARD STYLES */
        .tree-match-card {
            background: var(--dark-card, #1A1A1F);
            border: 1px solid var(--gold, #FFD700);
            border-left: 3px solid var(--gold, #FFD700);
            border-radius: 4px;
            padding: 8px 10px;
            width: var(--tree-card-width); /* USE VARIABLE */
            flex-shrink: 0;
            box-shadow: 0 4px 15px rgba(0, 0, 0, 0.5);
            display: flex;
            flex-direction: column;
            justify-content: center;
            position: relative;
            z-index: 20;
            transition: transform 0.2s;
        }
        .tree-match-card:hover { transform: translateY(-2px); }
        .tree-match-card.bye-card {
            border: 1px dashed rgba(255, 255, 255, 0.2);
            background: transparent;
            box-shadow: none;
        }
    `;
    document.head.appendChild(style);
}

// Call init
document.addEventListener('DOMContentLoaded', injectTreeStyles);

function animateGenericClose(modalId, backdropId, panelId, callback) {
    const modal = document.getElementById(modalId);
    const backdrop = document.getElementById(backdropId);
    const panel = document.getElementById(panelId);
    if (!modal) return;
    backdrop.classList.add('opacity-0'); panel.classList.remove('opacity-100', 'scale-100'); panel.classList.add('opacity-0', 'scale-95');
    setTimeout(() => { modal.classList.add('hidden'); if (callback) callback(); }, 300);
}

window.showCustomConfirm = (title, message) => {
    return new Promise((resolve) => {
        const titleEl = document.getElementById('alertTitle'); const msgEl = document.getElementById('alertMessage'); const btnContainer = document.getElementById('alertButtons');
        if (!document.getElementById('customAlertModal')) { resolve(confirm(message)); return; }
        titleEl.textContent = title; msgEl.innerHTML = message; btnContainer.innerHTML = '';
        const cancelBtn = document.createElement('button'); cancelBtn.className = "px-4 py-2 bg-white/5 border border-white/10 text-gray-300 rounded-lg text-sm hover:bg-white/10 transition-colors"; cancelBtn.textContent = "Cancel"; cancelBtn.onclick = () => { animateGenericClose('customAlertModal', 'alertBackdrop', 'alertBox'); resolve(false); };
        const confirmBtn = document.createElement('button'); confirmBtn.className = "px-4 py-2 bg-[var(--gold)] text-black rounded-lg text-sm font-bold hover:bg-yellow-400 transition-colors shadow-lg shadow-yellow-500/20"; confirmBtn.textContent = "Confirm"; confirmBtn.onclick = () => { animateGenericClose('customAlertModal', 'alertBackdrop', 'alertBox'); resolve(true); };
        btnContainer.appendChild(cancelBtn); btnContainer.appendChild(confirmBtn); animateGenericOpen('customAlertModal', 'alertBackdrop', 'alertBox');
    });
};

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    fetchTournaments();
    const auth = getAuth();
    onAuthStateChanged(auth, async (user) => {
        if (user) { checkCreatorPermissions(user); await fetchUserTeamIds(user); }
        else { currentUserTeamIds.clear(); }
    });
    if (qs('#searchName')) qs('#searchName').addEventListener('input', renderTournaments);
    if (qs('#filterGame')) qs('#filterGame').addEventListener('change', renderTournaments);
    if (qs('#filterStatus')) qs('#filterStatus').addEventListener('change', renderTournaments);
    if (qs('#sortBy')) qs('#sortBy').addEventListener('change', renderTournaments);
    const createForm = qs('#createForm');
    if (createForm) { createForm.addEventListener('submit', async (e) => { e.preventDefault(); await handleCreateTournament(); }); }
});

async function fetchUserTeamIds(user) {
    if (!user) return;
    currentUserTeamIds.clear();
    try {
        const teamsRef = collection(db, "recruitment");
        const snap = await getDocs(teamsRef);
        snap.forEach(doc => {
            const data = doc.data();
            const isAuthor = data.authorId === user.uid;
            const isMember = data.members && Array.isArray(data.members) && data.members.some(m => m.uid === user.uid);
            if (isAuthor || isMember) currentUserTeamIds.add(doc.id);
        });
    } catch (e) { console.error(e); }
}

async function checkCreatorPermissions(user) {
    try {
        const userRef = doc(db, "users", user.uid);
        const userSnap = await getDoc(userRef);
        if (userSnap.exists()) {
            const role = userSnap.data().role || 'user';
            if (['admin', 'org partner', 'tournament organizer'].includes(role) || ["admin@champzero.com"].includes(user.email)) {
                const controls = qs('#creator-controls');
                if (controls) controls.classList.remove('hidden');
            }
        }
    } catch (error) { console.error(error); }
}

function getTournamentStatus(t) {
    if (t.isStarted && t.status !== 'Completed') return 'Ongoing';
    if (t.status === 'Completed') return 'Completed';
    const calc = calculateStatus(t.date, t.endDate);
    return (calc === 'Ongoing') ? 'Ready to Start' : calc;
}

async function handleCreateTournament() {
    const submitBtn = qs('#createForm button[type="submit"]');
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = "Creating...";
    }

    try {
        const auth = getAuth();
        const user = auth.currentUser;
        if (!user) throw new Error("You must be logged in.");

        const gameSelect = qs('#c-game-select').value;
        const gameOther = qs('#c-game-other').value;
        const finalGameTitle = (gameSelect === 'Others' && gameOther.trim() !== "")
            ? gameOther.trim()
            : gameSelect;

        const name = qs('#c-name').value;
        const format = qs('#c-format').value;
        const maxTeams = parseInt(qs('#c-max-teams').value) || 8;
        const prize = qs('#c-prize').value || "0";
        const startDate = qs('#c-date').value;
        const endDate = qs('#c-end-date').value;
        const desc = qs('#c-desc').value || "";
        const banner = qs('#c-banner').value || "";

        const newTourney = {
            name: name,
            game: finalGameTitle,
            format: format,
            maxTeams: maxTeams,
            prize: prize,
            date: startDate,
            endDate: endDate,
            description: desc,
            banner: banner,
            createdBy: user.uid,
            createdAt: serverTimestamp(),
            status: 'Open',
            isStarted: false,
            participants: [],
            matches: []
        };

        await addDoc(collection(db, "tournaments"), newTourney);

        if (window.closeModal) window.closeModal('createModal');
        if (window.showSuccessToast) window.showSuccessToast("Success", "Tournament Created!");

        fetchTournaments();
        qs('#createForm').reset();
        qs('#c-game-select').value = "Valorant";
        qs('#c-game-other').classList.add('hidden');

    } catch (error) {
        console.error("Error creating tournament:", error);
        alert("Failed to create: " + error.message);
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = "Launch Tournament";
        }
    }
}

async function fetchTournaments() {
    const grid = qs('#tournamentGrid');
    if (!grid) return;
    grid.innerHTML = '<div class="col-span-full text-center text-gray-500 py-12">Loading tournaments...</div>';
    try {
        const querySnapshot = await getDocs(collection(db, "tournaments"));
        allTournaments = [];
        querySnapshot.forEach((doc) => { allTournaments.push({ id: doc.id, ...doc.data() }); });
        renderTournaments();
        const params = new URLSearchParams(window.location.search);
        const tourneyId = params.get('id');
        if (tourneyId) {
            const found = allTournaments.find(t => t.id === tourneyId);
            if (found) openModal(found);
        }
    } catch (error) { console.error(error); grid.innerHTML = '<div class="col-span-full text-center text-red-500 py-12">Failed to load tournaments.</div>'; }
}

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
        const actualStatus = getTournamentStatus(t);
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
    if (filtered.length === 0) { grid.innerHTML = '<div class="col-span-full text-center text-gray-500 py-12">No tournaments found.</div>'; return; }

    filtered.forEach(t => {
        const actualStatus = getTournamentStatus(t);
        const statusColor = actualStatus === 'Ongoing' ? 'text-green-400' : (actualStatus === 'Completed' ? 'text-gray-400' : 'text-[var(--gold)]');

        const card = document.createElement('article');
        card.className = "bg-[var(--dark-card)] rounded-xl border border-white/10 overflow-hidden hover:border-[var(--gold)]/30 transition-all group relative flex flex-col h-full";
        card.innerHTML = `
            <div class="h-48 bg-cover bg-center relative" style="background-image:url('${escapeCssUrl(t.banner || 'pictures/cz_logo.png')}')">
                <div class="absolute inset-0 bg-black/40 group-hover:bg-black/20 transition-colors"></div>
                <span class="absolute top-3 right-3 bg-black/60 backdrop-blur-md px-3 py-1 rounded-full text-xs font-bold text-white uppercase tracking-wide border border-white/10">${escapeHtml(t.game)}</span>
            </div>
            <div class="p-6 flex-1 flex flex-col">
                <h3 class="font-bold text-xl text-white mb-2 group-hover:text-[var(--gold)] transition-colors line-clamp-1">${escapeHtml(t.name)}</h3>
                <div class="flex justify-between items-center text-sm mb-4 border-b border-white/10 pb-4">
                    <span class="text-gray-400 flex items-center gap-2">📅 ${formatDateRange(t.date, t.endDate)}</span>
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

function selectTeamForSwap(index) {
    if (!currentEditingTournament || !currentEditingTournament.participants) return;
    if (swapSourceIndex === null) {
        swapSourceIndex = index;
    } else {
        const p = currentEditingTournament.participants;
        const temp = p[swapSourceIndex];
        p[swapSourceIndex] = p[index];
        p[index] = temp;
        swapSourceIndex = null;
    }
    renderTournamentView(currentEditingTournament);
}

// --- START TOURNAMENT LOGIC ---
async function startTournament() {
    const confirmStart = await window.showCustomConfirm("Start Tournament?", "This will close registration and generate the official bracket.");
    if (!confirmStart) return;

    try {
        const ref = doc(db, "tournaments", currentEditingTournament.id);
        const participants = currentEditingTournament.participants || [];
        if (participants.length < 2) { alert("Need at least 2 teams to start."); return; }

        let matches;
        // CHECK FORMAT HERE
        if (currentEditingTournament.format === 'Double Elimination') {
            matches = generateDoubleEliminationMatches(participants);
        } else {
            matches = generateInitialMatches(participants, currentEditingTournament.format);
        }

        await updateDoc(ref, { isStarted: true, status: 'Ongoing', matches: matches });
        if (window.showSuccessToast) window.showSuccessToast("Success", "Tournament Started!");
    } catch (e) { console.error("Start error:", e); alert("Failed to start: " + e.message); }
}

// --- DELETE TOURNAMENT LOGIC ---
async function deleteTournament(id) {
    const confirmed = await window.showCustomConfirm(
        "Delete Tournament?",
        "Are you sure? This will permanently remove the tournament, bracket, and all records. This cannot be undone."
    );
    if (!confirmed) return;

    try {
        await deleteDoc(doc(db, "tournaments", id));
        if (window.showSuccessToast) window.showSuccessToast("Deleted", "Tournament successfully removed.");
        window.closeModal('detailsModal');
        fetchTournaments();
    } catch (e) {
        console.error("Delete failed:", e);
        alert("Failed to delete tournament: " + e.message);
    }
}

// --- RESET TOURNAMENT LOGIC ---
window.resetTournament = async (id) => {
    const confirmed = await window.showCustomConfirm(
        "Reset Tournament?",
        "Are you sure? This will <b>permanently delete the current bracket and match history</b>. <br><br>Registered teams will remain, but the tournament will return to the 'Upcoming' state."
    );

    if (!confirmed) return;

    try {
        // Reset specific fields to return to "Upcoming" state
        await updateDoc(doc(db, "tournaments", id), {
            isStarted: false,
            status: 'Open', // Force status back to Open/Upcoming
            matches: []     // Wipe the generated matches
        });

        if (window.showSuccessToast) window.showSuccessToast("Success", "Tournament reset successfully.");

        // Refresh the view if the modal is open
        if (currentEditingTournament && currentEditingTournament.id === id) {
            // The onSnapshot listener in openModal will handle the UI update automatically
        }
    } catch (e) {
        console.error("Reset failed:", e);
        alert("Failed to reset tournament: " + e.message);
    }
};

// --- HELPER: Standard Seeding Logic ---
function getStandardSeeding(numTeams) {
    let rounds = Math.log2(numTeams);
    if (rounds % 1 !== 0) rounds = Math.floor(rounds) + 1;
    let bracketSize = Math.pow(2, rounds);
    let seeds = [1];
    for (let r = 0; r < rounds; r++) {
        let nextSeeds = [];
        let sum = Math.pow(2, r + 1) + 1;
        for (let i = 0; i < seeds.length; i++) {
            nextSeeds.push(seeds[i]);
            nextSeeds.push(sum - seeds[i]);
        }
        seeds = nextSeeds;
    }
    return seeds;
}

// --- UPDATED: GENERATE MATCHES WITH PROPER SEEDING ---
function generateInitialMatches(participants, format) {
    let teamNames = participants.map(p => typeof p === 'object' ? p.name : p);

    let size = 2;
    while (size < teamNames.length) size *= 2;

    // Use standard seeding to place BYEs correctly
    const seedOrder = getStandardSeeding(size);
    let orderedTeams = new Array(size).fill("BYE");

    for (let i = 0; i < teamNames.length; i++) {
        let slotIndex = seedOrder.indexOf(i + 1);
        if (slotIndex === -1) orderedTeams[i] = teamNames[i];
        else orderedTeams[slotIndex] = teamNames[i];
    }

    let matches = [];
    let matchIdCounter = 1;
    let roundCount = Math.log2(size);

    // Round 1
    for (let i = 0; i < size / 2; i++) {
        matches.push({
            id: `1-${i + 1}`,
            round: 1,
            matchNumber: matchIdCounter++,
            team1: orderedTeams[i * 2],
            team2: orderedTeams[i * 2 + 1],
            score1: null,
            score2: null,
            winner: null,
            nextMatchId: `2-${Math.floor(i / 2) + 1}`
        });
    }

    // Subsequent Rounds
    for (let r = 2; r <= roundCount; r++) {
        let matchesInRound = size / Math.pow(2, r);
        for (let i = 0; i < matchesInRound; i++) {
            let nextId = (r === roundCount) ? null : `${r + 1}-${Math.floor(i / 2) + 1}`;
            matches.push({
                id: `${r}-${i + 1}`,
                round: r,
                matchNumber: matchIdCounter++,
                team1: "TBD",
                team2: "TBD",
                score1: null,
                score2: null,
                winner: null,
                nextMatchId: nextId
            });
        }
    }

    // --- AUTO-ADVANCE LOGIC ---
    matches.forEach(m => {
        let advanced = false;
        let winnerName = null;

        if (m.team2 === 'BYE' && m.team1 !== 'BYE') {
            m.winner = m.team1;
            m.score1 = 1; m.score2 = 0;
            winnerName = m.team1;
            advanced = true;
        } else if (m.team1 === 'BYE' && m.team2 !== 'BYE') {
            m.winner = m.team2;
            m.score1 = 0; m.score2 = 1;
            winnerName = m.team2;
            advanced = true;
        } else if (m.team1 === 'BYE' && m.team2 === 'BYE') {
            m.winner = 'BYE';
            winnerName = 'BYE';
            advanced = true;
        }

        if (advanced && m.nextMatchId && winnerName) {
            const nextMatch = matches.find(nm => nm.id === m.nextMatchId);
            if (nextMatch) {
                const currentMatchNum = parseInt(m.id.split('-')[1]);
                if (currentMatchNum % 2 !== 0) nextMatch.team1 = winnerName;
                else nextMatch.team2 = winnerName;
            }
        }
    });

    return matches;
}

// --- SCORE EDITING ---
window.openScoreModal = function (matchId) {
    const t = currentEditingTournament;
    const match = t.matches.find(m => m.id === matchId);
    if (!match) return;

    if (match.team1 === 'TBD' || match.team2 === 'TBD' || match.team1 === 'BYE' || match.team2 === 'BYE') return;

    document.getElementById('scoreMatchId').value = matchId;
    document.getElementById('scoreTeam1Name').textContent = match.team1;
    document.getElementById('scoreTeam2Name').textContent = match.team2;
    document.getElementById('scoreTeam1').value = match.score1 || 0;
    document.getElementById('scoreTeam2').value = match.score2 || 0;
    document.getElementById('lblTeam1').textContent = match.team1;
    document.getElementById('lblTeam2').textContent = match.team2;

    document.querySelectorAll('input[name="matchWinner"]').forEach(r => r.checked = false);
    if (match.winner === match.team1) document.querySelector('input[value="1"]').checked = true;
    if (match.winner === match.team2) document.querySelector('input[value="2"]').checked = true;

    document.getElementById('scoreModal').classList.remove('hidden');
    document.getElementById('scoreModal').classList.add('flex');
}

function generateDoubleEliminationMatches(participants) {
    let teamNames = participants.map(p => typeof p === 'object' ? p.name : p);

    // Normalize to power of 2
    let size = 2;
    while (size < teamNames.length) size *= 2;

    // Seed
    const seedOrder = getStandardSeeding(size);
    let orderedTeams = new Array(size).fill("BYE");
    for (let i = 0; i < teamNames.length; i++) {
        let slotIndex = seedOrder.indexOf(i + 1);
        if (slotIndex === -1) orderedTeams[i] = teamNames[i];
        else orderedTeams[slotIndex] = teamNames[i];
    }

    let matches = [];
    let matchIdCounter = 1;

    // --- UPPER BRACKET GENERATION ---
    let wbMatches = [];
    let wbRounds = Math.log2(size);

    for (let r = 1; r <= wbRounds; r++) {
        let count = size / Math.pow(2, r);
        for (let i = 0; i < count; i++) {
            let id = `WB-R${r}-M${i + 1}`;
            let nextId = (r < wbRounds) ? `WB-R${r + 1}-M${Math.floor(i / 2) + 1}` : `GF-1`;

            // Initial Drop Prediction (Refined below)
            let loserId = null;
            if (r === 1) {
                loserId = `LB-R1-M${Math.floor(i / 2) + 1}`;
            } else {
                loserId = `LB-R${(r - 1) * 2}-M${i + 1}`;
            }

            let m = {
                id: id,
                round: r,
                bracket: 'upper',
                matchNumber: matchIdCounter++,
                team1: (r === 1) ? orderedTeams[i * 2] : 'TBD',
                team2: (r === 1) ? orderedTeams[i * 2 + 1] : 'TBD',
                score1: null, score2: null, winner: null,
                nextMatchId: nextId,
                loserMatchId: loserId
            };
            wbMatches.push(m);
            matches.push(m);
        }
    }

    // --- LOWER BRACKET GENERATION ---
    let lbRounds = (wbRounds - 1) * 2;

    for (let r = 1; r <= lbRounds; r++) {
        let power = Math.ceil(r / 2);
        let count = (size / 2) / Math.pow(2, power);

        for (let i = 0; i < count; i++) {
            let id = `LB-R${r}-M${i + 1}`;
            let nextId;

            if (r === lbRounds) {
                nextId = 'GF-1';
            } else if (r % 2 !== 0) {
                // Odd rounds move straight across
                nextId = `LB-R${r + 1}-M${i + 1}`;
            } else {
                // Even rounds merge (halve matches)
                nextId = `LB-R${r + 1}-M${Math.floor(i / 2) + 1}`;
            }

            let m = {
                id: id,
                round: r,
                bracket: 'lower',
                matchNumber: matchIdCounter++,
                team1: 'TBD',
                team2: 'TBD',
                score1: null, score2: null, winner: null,
                nextMatchId: nextId
            };
            matches.push(m);
        }
    }

    // --- FIX WB DROP TARGETS ---
    matches.forEach(m => {
        if (m.bracket === 'upper') {
            if (m.round === 1) {
                let lbMatchNum = Math.ceil(parseInt(m.id.split('-M')[1]) / 2);
                m.loserMatchId = `LB-R1-M${lbMatchNum}`;
            } else {
                let targetLBRound = (m.round - 1) * 2;
                m.loserMatchId = `LB-R${targetLBRound}-M${m.id.split('-M')[1]}`;
            }
        }
    });

    // --- NEW: AUTO-ADVANCE BYES (Fixes the Bug) ---
    // We sort by round so R1 processes first, propagating BYEs correctly
    matches.sort((a, b) => {
        if (a.bracket === 'upper' && b.bracket === 'lower') return -1;
        if (a.bracket === 'lower' && b.bracket === 'upper') return 1;
        return a.round - b.round;
    });

    matches.forEach(m => {
        let advanced = false;
        let winnerName = null;
        let loserName = null;

        // Check if one team is BYE
        if (m.team2 === 'BYE' && m.team1 !== 'BYE') {
            m.winner = m.team1;
            m.score1 = 1; m.score2 = 0;
            winnerName = m.team1;
            loserName = 'BYE';
            advanced = true;
        } else if (m.team1 === 'BYE' && m.team2 !== 'BYE') {
            m.winner = m.team2;
            m.score1 = 0; m.score2 = 1;
            winnerName = m.team2;
            loserName = 'BYE';
            advanced = true;
        } else if (m.team1 === 'BYE' && m.team2 === 'BYE') {
            // Double BYE (Rare but possible in weird seedings)
            m.winner = 'BYE';
            winnerName = 'BYE';
            loserName = 'BYE';
            advanced = true;
        }

        if (advanced) {
            // 1. Advance Winner to Next Match
            if (m.nextMatchId && winnerName) {
                const nextMatch = matches.find(nm => nm.id === m.nextMatchId);
                if (nextMatch) {
                    // Place winner in first available TBD slot or specific slot logic
                    if (nextMatch.team1 === 'TBD' || nextMatch.team1 === 'BYE') nextMatch.team1 = winnerName;
                    else nextMatch.team2 = winnerName;
                }
            }

            // 2. Drop Loser to Lower Bracket (If applicable)
            if (m.bracket === 'upper' && m.loserMatchId && loserName) {
                const loserMatch = matches.find(lm => lm.id === m.loserMatchId);
                if (loserMatch) {
                    if (loserMatch.team1 === 'TBD') loserMatch.team1 = loserName;
                    else loserMatch.team2 = loserName;
                }
            }
        }
    });

    // --- GRAND FINAL ---
    matches.push({
        id: 'GF-1',
        round: wbRounds + 1,
        bracket: 'final',
        matchNumber: matchIdCounter++,
        team1: 'Winner Upper',
        team2: 'Winner Lower',
        score1: null, score2: null, winner: null,
        nextMatchId: null
    });

    resolveByes(matches);

    return matches;
}

// --- UPDATED: CLEANING & SELF-HEALING AUTO-ADVANCE ---
function resolveByes(matches) {
    let globalChange = false;
    let loopChange = true;
    let loopCount = 0;

    console.log("⚡ Starting Deep Bracket Scan & Cleaning...");

    // Helper: Checks for Empty/TBD slots (Robust)
    const isTbd = (name) => {
        if (!name) return true;
        const s = String(name).trim().toUpperCase();
        return s === 'TBD' || s === '' || s === 'BYE';
    };

    const isBye = (name) => name && String(name).trim().toUpperCase() === 'BYE';

    while (loopChange && loopCount < 10) {
        loopChange = false;
        loopCount++;

        matches.forEach(m => {
            // --- STEP 0: SANITIZE (Fix the TBD Winner Bug) ---
            // If the database thinks "TBD" is the winner, wipe it immediately.
            if (m.winner === 'TBD' || m.winner === 'BYE') {
                 // Only allow 'BYE' as winner if it's actually a Double Bye match
                 const isDoubleBye = isBye(m.team1) && isBye(m.team2);
                 if (!isDoubleBye && m.winner === 'TBD') {
                     console.log(`   🧹 Cleaning Match [${m.id}]: Removing false winner 'TBD'`);
                     m.winner = null;
                     m.score1 = null;
                     m.score2 = null;
                     loopChange = true; 
                     globalChange = true;
                 }
            }

            let winnerName = m.winner;
            let loserName = null;

            // --- STEP 1: AUTO-WIN BYES ---
            if (!winnerName) {
                let realTeam = null;
                let winnerSide = 0;

                // Check 1: Team 1 vs BYE (Team 1 must NOT be TBD)
                if (isBye(m.team2) && !isBye(m.team1) && !isTbd(m.team1)) {
                    realTeam = m.team1; winnerSide = 1;
                } 
                // Check 2: BYE vs Team 2 (Team 2 must NOT be TBD)
                else if (isBye(m.team1) && !isBye(m.team2) && !isTbd(m.team2)) {
                    realTeam = m.team2; winnerSide = 2;
                } 
                // Check 3: Double BYE
                else if (isBye(m.team1) && isBye(m.team2)) {
                    realTeam = 'BYE'; winnerSide = 1;
                }

                if (realTeam) {
                    console.log(`   [${m.id}] BYE Detected. Auto-Winning: ${realTeam}`);
                    m.winner = realTeam;
                    m.score1 = (winnerSide === 1) ? 1 : 0;
                    m.score2 = (winnerSide === 2) ? 1 : 0;
                    winnerName = realTeam;
                    loopChange = true; globalChange = true;
                }
            }

            // Determine Loser Name
            if (winnerName) {
                if (winnerName === m.team1) loserName = m.team2;
                else if (winnerName === m.team2) loserName = m.team1;
            }

            // --- STEP 2: PROPAGATE WINNER ---
            // GUARD: Never propagate "TBD" as a winner
            if (winnerName && !isTbd(winnerName)) {
                let nextMatch = null;

                // A. Try finding by ID
                if (m.nextMatchId) {
                    nextMatch = matches.find(nm => nm.id === m.nextMatchId);
                }

                // B. SELF-HEAL: Broken Link Logic
                if (!nextMatch && m.bracket === 'lower') {
                    const parts = m.id.split('-'); 
                    if (parts.length === 3) {
                        const r = parseInt(parts[1].replace('R', ''));
                        const matchNum = parseInt(parts[2].replace('M', ''));
                        
                        let nextIdCandidate = null;
                        if (r % 2 !== 0) {
                            nextIdCandidate = `LB-R${r+1}-M${matchNum}`;
                        } else {
                            nextIdCandidate = `LB-R${r+1}-M${Math.ceil(matchNum/2)}`;
                        }
                        
                        nextMatch = matches.find(nm => nm.id === nextIdCandidate);
                        if (nextMatch) {
                            m.nextMatchId = nextIdCandidate; 
                            globalChange = true; 
                        }
                    }
                }

                if (nextMatch) {
                    const alreadyIn = (String(nextMatch.team1) === String(winnerName) || String(nextMatch.team2) === String(winnerName));
                    
                    if (!alreadyIn) {
                        if (isTbd(nextMatch.team1)) {
                            console.log(`   🚀 Moving ${winnerName} to ${nextMatch.id} (Slot 1)`);
                            nextMatch.team1 = winnerName;
                            nextMatch.winner = null; nextMatch.score1 = null; nextMatch.score2 = null;
                            loopChange = true; globalChange = true;
                        } else if (isTbd(nextMatch.team2)) {
                            console.log(`   🚀 Moving ${winnerName} to ${nextMatch.id} (Slot 2)`);
                            nextMatch.team2 = winnerName;
                            nextMatch.winner = null; nextMatch.score1 = null; nextMatch.score2 = null;
                            loopChange = true; globalChange = true;
                        }
                    }
                }
            }

            // --- STEP 3: PROPAGATE LOSER (WB -> LB) ---
            if (m.bracket === 'upper' && m.loserMatchId && loserName && !isTbd(loserName)) {
                const loserMatch = matches.find(lm => lm.id === m.loserMatchId);
                if (loserMatch) {
                    const alreadyIn = (String(loserMatch.team1) === String(loserName) || String(loserMatch.team2) === String(loserName));
                    if (!alreadyIn) {
                        if (isTbd(loserMatch.team1)) {
                            console.log(`   ⬇️ Dropping Loser ${loserName} to ${loserMatch.id}`);
                            loserMatch.team1 = loserName;
                            loserMatch.winner = null; 
                            loopChange = true; globalChange = true;
                        } else if (isTbd(loserMatch.team2)) {
                            console.log(`   ⬇️ Dropping Loser ${loserName} to ${loserMatch.id}`);
                            loserMatch.team2 = loserName;
                            loserMatch.winner = null;
                            loopChange = true; globalChange = true;
                        }
                    }
                }
            }
        });
    }

    if (globalChange) console.log("✅ Bracket updated & cleaned. Saving...");
    else console.log("✓ Bracket stable.");

    return globalChange;
}

window.saveMatchScore = async function () {
    const matchId = document.getElementById('scoreMatchId').value;
    const s1 = parseInt(document.getElementById('scoreTeam1').value) || 0;
    const s2 = parseInt(document.getElementById('scoreTeam2').value) || 0;
    const winnerVal = document.querySelector('input[name="matchWinner"]:checked')?.value;

    try {
        const tourneyRef = doc(db, "tournaments", currentEditingTournament.id);
        const tSnap = await getDoc(tourneyRef);
        let matches = tSnap.data().matches;

        let matchIndex = matches.findIndex(m => m.id === matchId);
        if (matchIndex === -1) return;

        let match = matches[matchIndex];
        match.score1 = s1;
        match.score2 = s2;

        if (winnerVal) {
            const winnerName = (winnerVal === "1") ? match.team1 : match.team2;
            const loserName = (winnerVal === "1") ? match.team2 : match.team1;

            match.winner = winnerName;

            // 1. ADVANCE WINNER
            if (match.nextMatchId) {
                let nextIndex = matches.findIndex(m => m.id === match.nextMatchId);
                if (nextIndex !== -1) {
                    let nextMatch = matches[nextIndex];

                    // --- FIX START: ENFORCE GRAND FINAL SLOTS ---
                    // This block ensures Upper Bracket Winner -> Team 1, Lower Bracket Winner -> Team 2
                    if (nextMatch.id === 'GF-1') {
                        if (match.bracket === 'upper') {
                            nextMatch.team1 = winnerName;
                        } else if (match.bracket === 'lower') {
                            nextMatch.team2 = winnerName;
                        }
                    } 
                    // --- STANDARD LOGIC FOR ALL OTHER MATCHES ---
                    else {
                        // Standard logic: fill first available TBD slot
                        if (nextMatch.team1 === 'TBD' || nextMatch.team1 === 'BYE' || 
                            nextMatch.team1 === match.team1 || nextMatch.team1 === match.team2) {
                            nextMatch.team1 = winnerName;
                        } else {
                            nextMatch.team2 = winnerName;
                        }
                    }
                    // --- FIX END ---
                    
                    matches[nextIndex] = nextMatch;
                }
            } else {
                // Handle Champion Logic (Grand Final has no nextMatchId)
                matches.status = 'Completed';
            }

            // 2. MOVE LOSER (Double Elimination Logic)
            if (match.loserMatchId) {
                let loserIndex = matches.findIndex(m => m.id === match.loserMatchId);
                if (loserIndex !== -1) {
                    let loserMatch = matches[loserIndex];
                    // Check slot 1, if taken check slot 2 (simplified logic)
                    if (loserMatch.team1 === 'TBD' || loserMatch.team1 === match.team1 || loserMatch.team1 === match.team2) {
                        loserMatch.team1 = loserName;
                    } else {
                        loserMatch.team2 = loserName;
                    }
                    matches[loserIndex] = loserMatch;
                }
            }

            // 3. RUN AUTO-ADVANCE FOR CHAIN REACTIONS
            // This ensures that if the loser drops into a BYE, they immediately advance.
            resolveByes(matches);
        }

        let updatePayload = { matches: matches };
        if (matches.status) updatePayload.status = matches.status; 

        await updateDoc(tourneyRef, updatePayload);
        document.getElementById('scoreModal').classList.add('hidden');
        if (window.showSuccessToast) window.showSuccessToast("Updated", "Match Score Saved!");

    } catch (e) {
        console.error(e);
        alert("Error saving score: " + e.message);
    }
}

// --- MODAL & LOGIC ---
async function openModal(t) {
    if (tournamentUnsubscribe) { tournamentUnsubscribe(); tournamentUnsubscribe = null; }

    // Start Live Listener
    tournamentUnsubscribe = onSnapshot(doc(db, "tournaments", t.id), async (docSnap) => {
        if (!docSnap.exists()) return;
        
        const latestData = { id: docSnap.id, ...docSnap.data() };
        currentEditingTournament = latestData;
        
        // 1. Render the View
        await renderTournamentView(latestData);

        // --- NEW: LIVE AUTO-ADVANCE LISTENER ---
        // This checks if any teams are stuck in a BYE match and advances them automatically.
        const auth = getAuth();
        const user = auth.currentUser;
        
        // Security: Only the creator/admin should trigger the database write
        const isCreator = (user && (latestData.createdBy === user.uid || ["admin@champzero.com"].includes(user.email)));

        if (isCreator && latestData.isStarted && latestData.matches) {
            // Create a deep copy to simulate the advance logic
            let matchesClone = JSON.parse(JSON.stringify(latestData.matches));
            
            // Run our updated resolveByes. If it returns TRUE, it means it found something to fix.
            const needsUpdate = resolveByes(matchesClone);
            
            if (needsUpdate) {
                console.log("⚡ Auto-advancing participant in BYE match...");
                // Save the fixed bracket back to Firebase
                await updateDoc(doc(db, "tournaments", t.id), { matches: matchesClone });
            }
        }
    });

    const newUrl = `${window.location.pathname}?id=${t.id}`;
    window.history.pushState({ path: newUrl }, '', newUrl);
    document.getElementById('detailsModal').classList.remove('hidden');
    document.getElementById('detailsModal').classList.add('flex');
}

async function renderTournamentView(t) {
    const actualStatus = getTournamentStatus(t);
    const format = t.format || "Single Elimination";
    if (!t.participants) t.participants = [];

    // 1. Basic Info Rendering
    qs('#detailTitle').textContent = t.name;
    qs('#detailFormatBadge').textContent = format;
    qs('#detailBanner').innerHTML = `<img src="${t.banner || 'pictures/cz_logo.png'}" class="w-full h-64 object-cover rounded-lg">`;
    qs('#detailMeta').innerHTML = `<span class="bg-[var(--gold)] text-black px-2 py-1 rounded font-bold text-xs uppercase">${t.game}</span> <span class="bg-white/10 px-2 py-1 rounded text-xs text-white uppercase">${actualStatus}</span> <span class="text-[var(--gold)] font-bold">🏆 ₱${Number(t.prize).toLocaleString()}</span>`;
    qs('#detailDesc').textContent = t.description || "No specific details provided.";

    const auth = getAuth();
    const user = auth.currentUser;
    if (user && !currentUserTeamIds.size) await fetchUserTeamIds(user);

    renderParticipantsList(t.participants);

    // 2. Determine Permissions
    let isCreator = (user && (t.createdBy === user.uid || ["admin@champzero.com"].includes(user.email)));

    const adminDash = qs('#adminDashboard');
    const adminToolbar = qs('#adminBracketToolbar');
    const actionArea = qs('#actionArea');
    const bracketSection = qs('#bracketSection');
    const champSection = qs('#championSection');

    // Bracket Visibility
    if (t.isStarted || isCreator) {
        bracketSection.classList.remove('hidden');
        renderBracket(t.participants || [], format, isCreator, t.isStarted);

        // Show Champion if completed
        const finalMatch = t.matches ? t.matches.find(m => m.id === 'GF-1' || !m.nextMatchId) : null;
        if (finalMatch && finalMatch.winner) {
            champSection.classList.remove('hidden');
            qs('#champName').textContent = finalMatch.winner;
            const winningTeam = t.participants.find(p => (typeof p === 'object' ? p.name : p) === finalMatch.winner);
            if (winningTeam && typeof winningTeam === 'object' && winningTeam.members) {
                qs('#champRoster').innerHTML = winningTeam.members.map(m => `<span class="bg-black/30 px-3 py-1 rounded text-sm border border-white/10">${escapeHtml(m)}</span>`).join('');
            } else {
                qs('#champRoster').innerHTML = '<span class="text-gray-400 text-sm">Champion</span>';
            }
        } else {
            champSection.classList.add('hidden');
        }
    } else {
        bracketSection.classList.add('hidden');
        champSection.classList.add('hidden');
    }

    // 3. Admin Dashboard Logic
    if (isCreator) {
        adminDash.classList.remove('hidden');
        adminDash.innerHTML = `
            <div class="flex justify-between items-start mb-3">
                <h4 class="text-indigo-300 font-bold flex items-center gap-2">
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                    Organizer Dashboard
                </h4>
                <div class="flex gap-2">
                    <button onclick="window.resetTournament('${t.id}')" class="bg-orange-900/50 hover:bg-orange-800 text-orange-200 text-xs px-3 py-1.5 rounded border border-orange-500/30 transition-colors flex items-center gap-1" title="Reset Bracket & Status">
                        <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                        Reset
                    </button>

                    <button onclick="window.deleteTournament('${t.id}')" class="bg-red-900/50 hover:bg-red-800 text-red-200 text-xs px-3 py-1.5 rounded border border-red-500/30 transition-colors flex items-center gap-1">
                        <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                        Delete
                    </button>
                </div>
            </div>
            <div id="adminAppList" class="space-y-2 max-h-60 overflow-y-auto custom-scrollbar">
                <div class="text-gray-500 text-sm">Loading applications...</div>
            </div>
        `;

        initAdminDashboard(t.id);

        // --- RESTORED TOOLBAR LOGIC (Start, Format, Shuffle) ---
        adminToolbar.classList.remove('hidden');
        adminToolbar.innerHTML = '';

        if (!t.isStarted) {
            // 1. Start Button (MOVED TO LEFT)
            const startBtn = document.createElement('button');
            startBtn.className = "bg-green-600 hover:bg-green-500 text-white px-4 py-1.5 rounded text-xs font-bold transition-colors shadow-lg flex items-center gap-2";
            startBtn.innerHTML = `
                <svg class="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path d="M6.3 2.841A1.5 1.5 0 004 4.11V15.89a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z" /></svg>
                Start Tournament
            `;
            startBtn.onclick = startTournament;
            adminToolbar.appendChild(startBtn);

            // 2. Max Teams Controls (+/-)
            const teamControlDiv = document.createElement('div');
            teamControlDiv.className = "flex items-center gap-2 ml-4 bg-black/40 rounded px-2 py-1 border border-white/10";
            
            const currentMax = t.maxTeams || 8;

            // Decrease Button
            const btnDec = document.createElement('button');
            btnDec.className = "text-gray-400 hover:text-white px-1.5 transition-colors font-bold text-lg leading-none";
            btnDec.innerHTML = "−";
            btnDec.onclick = async () => {
                if (currentMax > 2) {
                    await updateDoc(doc(db, "tournaments", t.id), { maxTeams: currentMax - 1 });
                }
            };

            // Display Label
            const sizeLabel = document.createElement('span');
            sizeLabel.className = "text-xs font-mono text-[var(--gold)] font-bold min-w-[60px] text-center";
            sizeLabel.textContent = `${currentMax} Teams`;

            // Increase Button
            const btnInc = document.createElement('button');
            btnInc.className = "text-gray-400 hover:text-white px-1.5 transition-colors font-bold text-lg leading-none";
            btnInc.innerHTML = "+";
            btnInc.onclick = async () => {
                await updateDoc(doc(db, "tournaments", t.id), { maxTeams: currentMax + 1 });
            };

            teamControlDiv.appendChild(btnDec);
            teamControlDiv.appendChild(sizeLabel);
            teamControlDiv.appendChild(btnInc);
            adminToolbar.appendChild(teamControlDiv);

            // 3. Spacer (Pushes remaining buttons to the right)
            const spacer = document.createElement('div');
            spacer.className = "flex-grow";
            adminToolbar.appendChild(spacer);

            // 4. Format Selector
            const select = document.createElement('select');
            select.className = "dark-select text-xs p-1.5 rounded bg-black/50 border border-white/10 ml-2 text-white outline-none focus:border-[var(--gold)]";
            select.innerHTML = `
                <option value="Single Elimination" ${format === 'Single Elimination' ? 'selected' : ''}>Single Elim</option>
                <option value="Double Elimination" ${format === 'Double Elimination' ? 'selected' : ''}>Double Elim</option>
                <option value="Round Robin" ${format === 'Round Robin' ? 'selected' : ''}>Round Robin</option>
            `;
            select.onchange = async (e) => {
                await updateDoc(doc(db, "tournaments", t.id), { format: e.target.value });
            };

            // 5. Shuffle Button
            const shuffleBtn = document.createElement('button');
            shuffleBtn.className = "bg-blue-600/80 hover:bg-blue-500 text-white px-3 py-1.5 rounded text-xs ml-2 flex items-center gap-1";
            shuffleBtn.innerHTML = `
                <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                Shuffle
            `;
            shuffleBtn.onclick = async () => {
                let arr = [...t.participants];
                for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[arr[i], arr[j]] = [arr[j], arr[i]]; }
                await updateDoc(doc(db, "tournaments", t.id), { participants: arr });
            };

            // 6. Save Button
            const saveBtn = document.createElement('button');
            saveBtn.className = "bg-yellow-600/80 hover:bg-yellow-500 text-white px-3 py-1.5 rounded text-xs font-bold ml-2";
            saveBtn.textContent = "Save Changes";
            saveBtn.onclick = saveBracketChanges;

            adminToolbar.appendChild(select);
            adminToolbar.appendChild(shuffleBtn);
            adminToolbar.appendChild(saveBtn);
        } else {
            adminToolbar.innerHTML = '<span class="text-green-400 text-xs font-bold uppercase border border-green-500/30 px-3 py-1 rounded bg-green-500/10 w-full text-center">Tournament Live - Click Matches to Score</span>';
        }
    } else {
        adminDash.classList.add('hidden');
        if (adminUnsubscribe) { adminUnsubscribe(); adminUnsubscribe = null; }
        adminToolbar.classList.add('hidden');
    }

    // 4. Action Area (Join/Withdraw Buttons)
    actionArea.innerHTML = '';
    if (t.isStarted || t.status === 'Completed') {
        actionArea.innerHTML = `<div class="w-full bg-gray-800/50 border border-white/10 text-gray-400 font-bold py-3 rounded-lg text-center cursor-not-allowed">Registration Closed - Tournament Ongoing</div>`;
    } else {
        let userStatus = 'none'; let userAppId = null;
        if (user) {
            const appsRef = collection(db, "tournaments", t.id, "applications");
            const q = query(appsRef, where("registeredBy", "==", user.uid));
            const appSnap = await getDocs(q);
            if (!appSnap.empty) { const app = appSnap.docs[0].data(); userStatus = app.status; userAppId = appSnap.docs[0].id; }
        }

        if (userStatus === 'approved') {
            actionArea.innerHTML = `
                <div class="w-full bg-green-900/20 border border-green-500/30 text-green-400 font-bold py-3 rounded-lg text-center">
                    ✅ Registration Confirmed
                </div>
                <p class="text-xs text-center text-gray-500 mt-2">Manage your team in the Registered Teams list.</p>
            `;
        } else if (userStatus === 'pending' || userStatus === 'pending_update') {
            actionArea.innerHTML = `<button disabled class="w-full bg-yellow-600/50 text-white font-bold py-3 rounded-lg">Pending Approval</button><button onclick="window.withdrawApplication('${t.id}', '${userAppId}')" class="w-full mt-2 text-xs text-red-400 hover:underline">Cancel Application</button>`;
        } else {
            if (actualStatus === 'Upcoming' || actualStatus === 'Open' || actualStatus === 'Ready to Start') {
                actionArea.innerHTML = `<button onclick="window.openJoinForm('${t.id}', false)" class="w-full bg-[var(--gold)] hover:bg-[var(--gold-darker)] text-black font-bold py-3 rounded-lg shadow-lg hover:scale-105">Submit Team Application</button>`;
            } else {
                actionArea.innerHTML = `<div class="p-4 bg-white/5 rounded text-center text-gray-400">Registration Closed</div>`;
            }
        }
    }
}

// --- SAVE BRACKET (For manual edits before start) ---
async function saveBracketChanges() {
    if (!currentEditingTournament || !currentEditingTournament.id) return;
    const confirmSave = await window.showCustomConfirm("Save Changes?", "Update bracket layout?");
    if (!confirmSave) return;
    try {
        await updateDoc(doc(db, "tournaments", currentEditingTournament.id), {
            format: currentEditingTournament.format,
            participants: currentEditingTournament.participants
        });
        if (window.showSuccessToast) window.showSuccessToast('Success', 'Bracket updated!');
        qs('#detailFormatBadge').textContent = currentEditingTournament.format;
    } catch (e) { console.error(e); }
}

// ----------------------------------------------------
// JOIN & APPLICATION LOGIC
// ----------------------------------------------------
async function openJoinForm(id, isEdit = false, specificAppId = null) {
    const auth = getAuth();
    const user = auth.currentUser;
    if (!user) { if (window.showErrorToast) window.showErrorToast('Login Required', 'Please log in.'); window.location.href = 'login.html'; return; }

    currentJoiningId = id;
    userTeams = [];

    const modalTitle = qs('#joinModal h3');
    const submitBtn = qs('#joinForm button[type="submit"]');
    const form = qs('#joinForm');

    form.dataset.mode = isEdit ? 'edit' : 'new';
    form.dataset.appId = specificAppId || '';
    modalTitle.textContent = isEdit ? "Edit Registration" : "Join Tournament";
    submitBtn.textContent = isEdit ? "Request Update" : "Submit Application";

    const select = qs('#joinTeamSelect');
    select.innerHTML = '<option value="custom">Loading teams...</option>';

    try {
        const teamsRef = collection(db, "recruitment");
        const snap = await getDocs(teamsRef);
        userTeams = [];
        snap.forEach(doc => {
            const data = doc.data();
            const isAuthor = data.authorId === user.uid;
            const isMember = data.members && Array.isArray(data.members) && data.members.some(m => m.uid === user.uid);
            if (isAuthor || isMember) userTeams.push({ id: doc.id, ...data });
        });

        select.innerHTML = '<option value="custom">Create Custom Team</option>';
        userTeams.forEach(team => {
            const option = document.createElement('option');
            option.value = team.id;
            option.textContent = team.name || "Unnamed Team";
            select.appendChild(option);
        });
    } catch (e) { console.error("Error fetching teams", e); }

    if (isEdit && specificAppId) {
        try {
            const appRef = doc(db, "tournaments", id, "applications", specificAppId);
            const appSnap = await getDoc(appRef);
            if (appSnap.exists()) {
                const data = appSnap.data();
                const matchingTeam = userTeams.find(t => t.name === data.name);
                if (matchingTeam) { select.value = matchingTeam.id; if (window.toggleTeamInput) window.toggleTeamInput(select); }
                else { select.value = 'custom'; if (window.toggleTeamInput) window.toggleTeamInput(select); qs('#joinTeamName').value = data.name; }

                qs('#joinCaptain').value = data.captain || '';
                qs('#joinContact').value = data.contact || '';
                const membersContainer = qs('#membersContainer');
                membersContainer.innerHTML = '';
                if (data.members && data.members.length > 0) {
                    data.members.forEach(member => {
                        const div = document.createElement('div');
                        div.className = 'flex gap-2';
                        div.innerHTML = `<input type="text" name="memberIgn[]" value="${escapeHtml(member)}" class="dark-input w-full p-2 rounded text-sm bg-black/30" required><button type="button" onclick="this.parentElement.remove()" class="text-red-400 hover:text-red-300 px-2">&times;</button>`;
                        membersContainer.appendChild(div);
                    });
                } else { membersContainer.innerHTML = `<div class="flex gap-2"><input type="text" name="memberIgn[]" placeholder="Member IGN" class="dark-input w-full p-2 rounded text-sm bg-black/30" required></div>`; }
            }
        } catch (e) { console.error(e); }
    } else {
        qs('#joinTeamName').value = ''; qs('#joinCaptain').value = user.displayName || ''; qs('#joinContact').value = user.email || '';
        qs('#membersContainer').innerHTML = `<div class="flex gap-2"><input type="text" name="memberIgn[]" placeholder="Member IGN" class="dark-input w-full p-2 rounded text-sm bg-black/30" required></div>`;
        if (window.toggleTeamInput) window.toggleTeamInput(select);
    }
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
    const auth = getAuth();
    const user = auth.currentUser;
    const isEdit = qs('#joinForm').dataset.mode === 'edit';
    const specificAppId = qs('#joinForm').dataset.appId;

    const teamSelectId = qs('#joinTeamSelect').value;
    const isCustom = teamSelectId === 'custom';
    let teamName = isCustom ? qs('#joinTeamName').value.trim() : userTeams.find(t => t.id === teamSelectId)?.name || "Unknown";
    let dbTeamId = isCustom ? null : teamSelectId;

    if (!isEdit) {
        try {
            const tourneyRef = doc(db, "tournaments", currentJoiningId);
            const tourneySnap = await getDoc(tourneyRef);
            if (tourneySnap.exists()) {
                const tData = tourneySnap.data();
                if (tData.participants && tData.participants.some(p => (p.name || '').toLowerCase() === teamName.toLowerCase())) {
                    const confirmRegister = await window.showCustomConfirm("Duplicate Team", `The team "${teamName}" is already registered. Continue?`);
                    if (!confirmRegister) return;
                }
            }
        } catch (e) { console.error(e); }
    }

    const captain = qs('#joinCaptain').value;
    const contact = qs('#joinContact').value;
    const memberInputs = document.querySelectorAll('input[name="memberIgn[]"]');
    const membersList = [];
    memberInputs.forEach(input => { if (input.value.trim()) membersList.push(input.value.trim()); });

    const appData = {
        name: teamName, captain: captain, contact: contact, members: membersList,
        teamId: dbTeamId, registeredBy: user.uid, status: isEdit ? 'pending_update' : 'pending', submittedAt: serverTimestamp()
    };

    const submitBtn = qs('#joinForm button[type="submit"]');
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Submitting...'; }

    try {
        const appsRef = collection(db, "tournaments", currentJoiningId, "applications");
        if (isEdit && specificAppId) { await updateDoc(doc(appsRef, specificAppId), appData); }
        else { await addDoc(appsRef, appData); }

        const msg = isEdit ? 'Update request sent!' : 'Application submitted!';
        if (window.showSuccessToast) window.showSuccessToast('Success', msg);
        document.getElementById('joinModal').classList.add('hidden');
    } catch (error) { console.error("Error joining:", error); if (window.showErrorToast) window.showErrorToast('Error', 'Failed: ' + error.message); }
    finally { if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = isEdit ? 'Request Update' : 'Confirm Registration'; } }
}

async function withdrawApplication(tourneyId, appId) {
    const confirmWithdraw = await window.showCustomConfirm("Withdraw Team?", "Are you sure? This cannot be undone.");
    if (!confirmWithdraw) return;
    try {
        const tourneyRef = doc(db, "tournaments", tourneyId);
        const tSnap = await getDoc(tourneyRef);
        const auth = getAuth();
        if (tSnap.exists()) {
            const parts = tSnap.data().participants || [];
            const myEntry = parts.find(p => p.applicationId === appId || p.registeredBy === auth.currentUser.uid);
            if (myEntry) await updateDoc(tourneyRef, { participants: arrayRemove(myEntry) });
        }
        await deleteDoc(doc(db, "tournaments", tourneyId, "applications", appId));
        if (window.showSuccessToast) window.showSuccessToast('Success', 'Withdrawn.');
    } catch (e) { console.error(e); alert("Error withdrawing: " + e.message); }
}

async function sendTournamentNotification(targetUid, tournamentId, type, message) {
    try { await addDoc(collection(db, "notifications"), { title: "Tournament Update", type: 'tournament', message: message, tournamentId: tournamentId, targetUserId: targetUid, createdAt: serverTimestamp() }); }
    catch (error) { console.error("Error sending notification:", error); }
}

// ----------------------------------------------------
// VIEW MEMBERS LOGIC
// ----------------------------------------------------
function renderParticipantsList(participants) {
    const pList = qs('#participantsList');
    if (!pList) return;
    const auth = getAuth();
    const currentUser = auth.currentUser;

    if (participants && participants.length > 0) {
        pList.innerHTML = participants.map((team, index) => {
            const teamName = typeof team === 'object' ? team.name : team;
            const captain = typeof team === 'object' ? `(Cap: ${team.captain})` : '';
            let nameClass = "text-white";
            let actionButtons = "";

            if (currentUser && typeof team === 'object') {
                if (team.registeredBy === currentUser.uid) {
                    nameClass = "text-green-400";
                    if (team.applicationId) {
                        actionButtons = `<div class="flex gap-2 mr-3"><button onclick="event.stopPropagation(); window.openJoinForm('${currentEditingTournament.id}', true, '${team.applicationId}')" class="text-gray-400 hover:text-[var(--gold)] transition-colors p-1" title="Edit Team"><svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg></button><button onclick="event.stopPropagation(); window.withdrawApplication('${currentEditingTournament.id}', '${team.applicationId}')" class="text-gray-400 hover:text-red-500 transition-colors p-1" title="Withdraw Team"><svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg></button></div>`;
                    }
                } else if (team.teamId && currentUserTeamIds.has(team.teamId)) {
                    nameClass = "text-blue-400";
                }
            }

            return `<li class="flex items-center justify-between border-b border-white/5 py-3 last:border-0 hover:bg-white/5 transition-colors px-2 rounded-lg -mx-2"><div class="flex-1 min-w-0 mr-2 flex items-center">${actionButtons}<div class="overflow-hidden"><span class="font-bold text-sm ${nameClass} block truncate">${escapeHtml(teamName)}</span><span class="text-[10px] text-gray-500 block truncate">${escapeHtml(captain)}</span></div></div><div class="flex gap-2"><button onclick="window.viewTeamMembers(${index})" class="text-xs bg-white/10 hover:bg-white/20 text-[var(--gold)] px-3 py-1 rounded-md transition-colors border border-white/5">View</button></div></li>`;
        }).join('');
    } else { pList.innerHTML = '<li class="text-gray-500 italic text-center py-4">No teams registered yet.</li>'; }
}

function viewTeamMembers(index) {
    if (!currentEditingTournament || !currentEditingTournament.participants) return;
    const team = currentEditingTournament.participants[index];
    if (!team || typeof team !== 'object') { if (window.showErrorToast) window.showErrorToast("Info", "No member details available."); return; }
    const list = document.getElementById('vm-list');
    const title = document.getElementById('vm-teamName');
    title.textContent = team.name;

    if (team.members && team.members.length > 0) {
        list.innerHTML = team.members.map(m => `<li class="p-2 bg-white/5 rounded border border-white/5 flex items-center gap-2"><span class="text-[var(--gold)]">➜</span> ${escapeHtml(m)}</li>`).join('');
    } else { list.innerHTML = '<li class="text-center text-gray-500 italic">No specific members listed.</li>'; }
    document.getElementById('viewMembersModal').classList.remove('hidden');
    document.getElementById('viewMembersModal').classList.add('flex');
}

// ----------------------------------------------------
// ADMIN DASHBOARD
// ----------------------------------------------------
function initAdminDashboard(tournamentId) {
    const list = qs('#adminAppList');
    if (!list) return;
    list.innerHTML = '<div class="text-gray-500 text-sm">Loading...</div>';
    if (adminUnsubscribe) adminUnsubscribe();

    const q = query(collection(db, "tournaments", tournamentId, "applications"), where("status", "in", ["pending", "pending_update"]));
    adminUnsubscribe = onSnapshot(q, (snap) => {
        if (snap.empty) { list.innerHTML = '<div class="text-gray-500 text-sm italic">No pending applications.</div>'; return; }
        list.innerHTML = '';
        snap.forEach(docSnap => {
            const app = docSnap.data();
            const isUpdate = app.status === 'pending_update';
            const item = document.createElement('div');
            item.className = "flex items-center justify-between bg-black/30 p-3 rounded border border-white/10";
            item.innerHTML = `<div><div class="font-bold text-white text-sm flex items-center gap-2">${escapeHtml(app.name)} ${isUpdate ? '<span class="text-[10px] bg-yellow-600 px-1 rounded text-white">UPDATE REQ</span>' : '<span class="text-[10px] bg-blue-600 px-1 rounded text-white">NEW</span>'}</div><div class="text-xs text-gray-400">Cap: ${escapeHtml(app.captain)}</div></div><div class="flex gap-2"><button onclick="window.processApplication('${tournamentId}', '${docSnap.id}', true)" class="bg-green-600 hover:bg-green-500 text-white text-xs px-3 py-1 rounded">Approve</button><button onclick="window.processApplication('${tournamentId}', '${docSnap.id}', false)" class="bg-red-600 hover:bg-red-500 text-white text-xs px-3 py-1 rounded">Reject</button></div>`;
            list.appendChild(item);
        });
    });
}

async function processApplication(tourneyId, appId, isApproved) {
    const confirmAction = await window.showCustomConfirm(isApproved ? "Approve Application" : "Reject Application", isApproved ? "Approve this team?" : "Reject this application?");
    if (!confirmAction) return;

    try {
        const appRef = doc(db, "tournaments", tourneyId, "applications", appId);
        const tourneyRef = doc(db, "tournaments", tourneyId);
        const appSnap = await getDoc(appRef);
        if (!appSnap.exists()) return;
        const appData = appSnap.data();

        if (isApproved) {
            const newParticipantData = { name: appData.name, captain: appData.captain, contact: appData.contact, members: appData.members, teamId: appData.teamId, registeredBy: appData.registeredBy, applicationId: appId };
            if (appData.status === 'pending_update') {
                const tSnap = await getDoc(tourneyRef);
                const participants = tSnap.data().participants || [];
                const oldEntry = participants.find(p => p.applicationId === appId || p.registeredBy === appData.registeredBy);
                if (oldEntry) await updateDoc(tourneyRef, { participants: arrayRemove(oldEntry) });
            }
            await updateDoc(tourneyRef, { participants: arrayUnion(newParticipantData) });
            await updateDoc(appRef, { status: 'approved' });
            await sendTournamentNotification(appData.registeredBy, tourneyId, 'alert', `Your team "${appData.name}" has been accepted!`);
        } else {
            await updateDoc(appRef, { status: 'rejected' });
            await sendTournamentNotification(appData.registeredBy, tourneyId, 'alert', `Your application for "${appData.name}" was declined.`);
        }
    } catch (e) { console.error(e); alert("Action failed: " + e.message); }
}

// --- BRACKET RENDERER (Updated) ---
function renderBracket(participants, format, isAdmin, isStarted) {
    const container = qs('#bracketContainer');
    if (!container) return;
    container.innerHTML = '';

    // FIX: If Double Elimination and Started, use the specialized Live renderer
    if (isStarted && format === 'Double Elimination' && currentEditingTournament.matches) {
        renderDoubleEliminationLive(container, currentEditingTournament.matches, isAdmin);
        return;
    }

    // Existing Single Elim Logic
    if (isStarted && currentEditingTournament.matches && currentEditingTournament.matches.length > 0) {
        renderMatchesFromDatabase(container, currentEditingTournament.matches, format, isAdmin);
        return;
    }

    let teams = participants.map(p => typeof p === 'object' ? p.name : p);
    if (format === 'Round Robin') renderRoundRobin(container, teams);
    else if (format === 'Double Elimination') renderDoubleEliminationPlaceholder(container, teams);
    else renderSingleEliminationPlaceholder(container, teams, isAdmin);
}

// --- NEW RECURSIVE BRACKET LOGIC ---

// 1. Convert Flat Matches to Tree
function buildMatchTree(matches, rootMatchId = null) {
    // If no specific root is asked for, find the global final (Standard Single Elim)
    let finalMatch;
    if (rootMatchId) {
        finalMatch = matches.find(m => m.id === rootMatchId);
    } else {
        // Fallback: Find match with no nextMatchId (Grand Final)
        finalMatch = matches.find(m => !m.nextMatchId) || matches.sort((a, b) => b.round - a.round)[0];
    }

    if (!finalMatch) return null;

    function getSources(targetMatch) {
        // Find matches that feed into this match
        const sources = matches.filter(m => m.nextMatchId === targetMatch.id);

        // Sort sources: Top slot (Odd) first, Bottom slot (Even) second
        sources.sort((a, b) => {
            const numA = parseInt(a.matchNumber || a.id.split('-')[1] || 0);
            const numB = parseInt(b.matchNumber || b.id.split('-')[1] || 0);
            return numA - numB;
        });

        return {
            match: targetMatch,
            children: sources.map(source => getSources(source))
        };
    }

    return getSources(finalMatch);
}

// 2. Render the Tree (Visuals: Old Design, Logic: New Recursive)
function renderRecursiveBracket(container, treeNode, isAdmin) {
    if (!treeNode) return;

    // Create the wrapper for this node
    const item = document.createElement('div');
    item.className = 'item';

    // 1. CHILDREN (Left Side)
    const childrenContainer = document.createElement('div');
    childrenContainer.className = 'item-childrens';

    if (treeNode.children && treeNode.children.length > 0) {
        treeNode.children.forEach(childNode => {
            const childWrapper = document.createElement('div');
            childWrapper.className = 'item-child';

            // Logic: Skip Double Byes to collapse the tree
            const isDoubleBye = childNode.match.team1 === 'BYE' && childNode.match.team2 === 'BYE';

            if (!isDoubleBye) {
                renderRecursiveBracket(childWrapper, childNode, isAdmin);
                childrenContainer.appendChild(childWrapper);
            }
        });
    }

    // 2. PARENT (Right Side)
    const parentContainer = document.createElement('div');
    parentContainer.className = 'item-parent';

    const m = treeNode.match;
    const isCompleted = !!m.winner;
    const isByeMatch = (m.team1 === 'BYE' || m.team2 === 'BYE');

    const card = document.createElement('div');
    // Combine new structure class with your original styles
    let baseClass = `tree-match-card`;
    if (isCompleted) baseClass += ` completed`;
    if (isAdmin && !isByeMatch) baseClass += ` admin-editable cursor-pointer`;

    card.className = baseClass;
    if (isAdmin && !isByeMatch) card.onclick = () => window.openScoreModal(m.id);

    if (isByeMatch) {
        // Simple "Advance" Card
        const realTeam = m.team1 !== 'BYE' ? m.team1 : m.team2;
        card.className += " bye-card";
        card.innerHTML = `
            <div class="flex justify-between items-center text-[10px] text-gray-500 mb-1">
                <span>R${m.round} • Auto Advance</span>
            </div>
            <div class="flex items-center text-[var(--gold)] font-bold">
                <span>${escapeHtml(realTeam)}</span>
            </div>
        `;
    } else {
        // Standard Match Card (Original Design)
        card.innerHTML = `
            <div class="flex justify-between items-center mb-2 text-[10px] text-gray-500 uppercase tracking-wider">
                <span>M${m.matchNumber} • R${m.round}</span>
                ${isCompleted ? '<span class="text-green-400">✔</span>' : ''}
            </div>
            <div class="space-y-1 w-full">
                <div class="flex justify-between items-center ${m.winner === m.team1 ? 'text-[var(--gold)] font-bold' : 'text-gray-300'}">
                    <span class="text-sm truncate pr-2">${escapeHtml(m.team1)}</span>
                    <span class="bg-white/10 px-1.5 rounded text-xs font-mono ${m.winner === m.team1 ? 'text-[var(--gold)]' : 'text-gray-400'}">${m.score1 !== null ? m.score1 : '-'}</span>
                </div>
                <div class="flex justify-between items-center ${m.winner === m.team2 ? 'text-[var(--gold)] font-bold' : 'text-gray-300'}">
                    <span class="text-sm truncate pr-2">${escapeHtml(m.team2)}</span>
                    <span class="bg-white/10 px-1.5 rounded text-xs font-mono ${m.winner === m.team2 ? 'text-[var(--gold)]' : 'text-gray-400'}">${m.score2 !== null ? m.score2 : '-'}</span>
                </div>
            </div>
        `;
    }

    parentContainer.appendChild(card);

    // DOM Order: Children First (Left), Parent Second (Right) for flex-row
    item.appendChild(childrenContainer);
    item.appendChild(parentContainer);

    container.appendChild(item);
}

// 3. Main Render Function (With Headers & Recursive Logic)
function renderMatchesFromDatabase(container, matches, format, isAdmin) {
    container.innerHTML = '';
    injectTreeStyles();

    // 1. Calculate Tree Depth to generate headers
    const rootNode = buildMatchTree(matches);
    let maxDepth = 0;

    function getDepth(node, currentDepth) {
        if (!node) return;
        if (currentDepth > maxDepth) maxDepth = currentDepth;
        if (node.children) {
            node.children.forEach(child => getDepth(child, currentDepth + 1));
        }
    }
    getDepth(rootNode, 1);

    // 2. Build Headers HTML
    const headersDiv = document.createElement('div');
    headersDiv.className = 'bracket-header-row';

    // Generate headers from Left (Round 1) to Right (Grand Final)
    // maxDepth is R1, 1 is Final
    for (let i = maxDepth; i >= 1; i--) {
        const hItem = document.createElement('div');
        hItem.className = 'header-item';

        if (i === 1) hItem.textContent = "Grand Final";
        else if (i === 2) hItem.textContent = "Semi Finals";
        else hItem.textContent = `Round ${maxDepth - i + 1}`;

        headersDiv.appendChild(hItem);
    }

    // 3. Build Main Scroll Wrapper
    const bracketScrollWrapper = document.createElement('div');
    bracketScrollWrapper.className = "bracket-scroll-container custom-scrollbar";

    // Add Headers
    bracketScrollWrapper.appendChild(headersDiv);

    // Add Bracket Tree
    if (rootNode) {
        const rootWrapper = document.createElement('div');
        rootWrapper.className = 'wrapper';
        renderRecursiveBracket(rootWrapper, rootNode, isAdmin);
        bracketScrollWrapper.appendChild(rootWrapper);
    } else {
        bracketScrollWrapper.innerHTML = '<div class="text-gray-500 w-full text-center mt-10">No bracket data available.</div>';
    }

    container.appendChild(bracketScrollWrapper);
}

function renderSingleEliminationPlaceholder(container, participants, isEditable) {
    // --- STEP 1: CALCULATE BRACKET SIZE ---
    let targetSize = currentEditingTournament.maxTeams || 8;
    // Ensure bracket is large enough for current participants
    let bracketSize = 2;
    while (bracketSize < participants.length) bracketSize *= 2;
    // Or if maxTeams is set and larger, use that (up to a reasonable limit for preview)
    if (targetSize > bracketSize) bracketSize = targetSize;
    
    // Ensure power of 2
    let s = 1; while (s < bracketSize) s *= 2;
    bracketSize = s;

    // --- STEP 2: PREPARE TEAMS & BYES ---
    // We strictly use "BYE" for empty slots in the preview to force correct visuals
    let teamNames = [...participants.map(p => typeof p === 'object' ? p.name : p)];
    const totalSlots = bracketSize;
    
    // Pad with "BYE" until full
    while (teamNames.length < totalSlots) teamNames.push('BYE');

    // --- STEP 3: STANDARD SEEDING ORDER ---
    // This distributes BYEs to the top seeds (1 vs 8, 2 vs 7, etc.)
    // We use the helper function 'getStandardSeeding' if available, or inline logic
    let seedOrder = [];
    if (typeof getStandardSeeding === 'function') {
        seedOrder = getStandardSeeding(totalSlots);
    } else {
        // Fallback simple seeding for 4, 8, 16
        if (totalSlots === 4) seedOrder = [1, 4, 2, 3];
        else if (totalSlots === 8) seedOrder = [1, 8, 4, 5, 2, 7, 3, 6];
        else if (totalSlots === 16) seedOrder = [1, 16, 8, 9, 4, 13, 5, 12, 2, 15, 7, 10, 3, 14, 6, 11];
        else {
             // Linear fallback
             for(let i=1; i<=totalSlots; i++) seedOrder.push(i);
        }
    }

    // Reorder teams based on seed
    let seeds = new Array(totalSlots);
    for (let i = 0; i < totalSlots; i++) {
        // seedOrder values are 1-based (1..8)
        let originalIndex = seedOrder[i] - 1; 
        // If originalIndex is within actual participants, use name. Else it's a BYE.
        // Since we padded teamNames with BYE, we can just grab from teamNames? 
        // No, teamNames is [1, 2, 3, 4, 5, 6, BYE, BYE]. 
        // seedOrder maps bracket slot -> seed rank.
        // We want Slot 0 (Match 1 Team 1) to be Seed 1.
        
        // Actually, seedOrder tells us: Index 0 is Seed 1, Index 1 is Seed 8...
        // So we take the team at (SeedValue - 1) from our sorted input list.
        seeds[i] = teamNames[seedOrder[i] - 1];
    }

    let rounds = Math.log2(bracketSize);
    const bracketWrapper = document.createElement('div');
    bracketWrapper.className = "bracket-wrapper";

    for (let r = 0; r < rounds; r++) {
        const roundDiv = document.createElement('div');
        roundDiv.className = 'bracket-round';
        
        // Round Headers
        let roundName = `Round ${r + 1}`;
        if (r === rounds - 1) roundName = "Grand Final";
        else if (r === rounds - 2) roundName = "Semi Finals";
        
        roundDiv.innerHTML = `<div class="text-center text-sm text-[var(--gold)] mb-4 font-bold uppercase tracking-widest border-b border-white/10 pb-2">${roundName}</div>`;
        
        const matchesInRound = bracketSize / Math.pow(2, r + 1);
        const isFinalRound = (r === rounds - 1);

        for (let m = 0; m < matchesInRound; m += 2) {
            const pairWrapper = document.createElement('div');
            pairWrapper.className = isFinalRound ? 'match-pair straight-mode' : 'match-pair';
            
            let subLoopLimit = isFinalRound ? 1 : 2;
            let renderedMatches = 0;

            for (let i = 0; i < subLoopLimit; i++) {
                let currentM = m + i;
                let team1 = "TBD", team2 = "TBD";
                let isSingleBye = false;

                if (r === 0) {
                    const idx1 = currentM * 2;
                    const idx2 = currentM * 2 + 1;
                    team1 = seeds[idx1] || "TBD";
                    team2 = seeds[idx2] || "TBD";
                    if (team1 === 'BYE' || team2 === 'BYE') isSingleBye = true;
                } else {
                    team1 = isFinalRound ? "Winner Semis 1" : `Winner R${r}-M${currentM * 2 + 1}`;
                    team2 = isFinalRound ? "Winner Semis 2" : `Winner R${r}-M${currentM * 2 + 2}`;
                }

                const isDoubleBye = (team1 === 'BYE' && team2 === 'BYE');
                let matchHTML = '';

                if (isDoubleBye) {
                    // Render "Waiting..." Placeholder (Invisible/Dimmed)
                    // With proper seeding, this should rarely appear in Round 1 unless very few teams.
                    matchHTML = `
                        <div class="match-card border border-white/10 my-2 opacity-30">
                             <div class="team-slot text-gray-700 text-xs"><span>Waiting...</span></div>
                             <div class="team-slot text-gray-700 text-xs"><span>Waiting...</span></div>
                        </div>`;
                } 
                else if (isSingleBye) {
                    // --- FIX: USE DOUBLE ELIM VISUAL STYLE ---
                    // Dashed border, Gold Name, Green "Advances"
                    const realTeam = (team1 !== 'BYE') ? team1 : team2;
                    matchHTML = `
                        <div class="match-card opacity-50 border-dashed border-gray-600 my-2">
                            <div class="team-slot">
                                <span class="text-[var(--gold)]">${escapeHtml(realTeam)}</span>
                                <span class="text-xs text-green-400 font-bold ml-2">Advances</span>
                            </div>
                            <div class="team-slot text-gray-600 text-xs italic"><span>BYE</span></div>
                        </div>`;
                } 
                else {
                    // Normal Match Card
                    const idx1 = (r === 0) ? currentM * 2 : -1;
                    const idx2 = (r === 0) ? currentM * 2 + 1 : -1;
                    const click1 = (isEditable && r === 0 && team1 !== 'TBD') ? `onclick="window.selectTeam(${idx1})"` : '';
                    const click2 = (isEditable && r === 0 && team2 !== 'TBD') ? `onclick="window.selectTeam(${idx2})"` : '';
                    const sel1 = (swapSourceIndex === idx1 && r === 0) ? 'selected-for-swap' : '';
                    const sel2 = (swapSourceIndex === idx2 && r === 0) ? 'selected-for-swap' : '';
                    const extraClasses = isFinalRound ? 'champ-card h-[100px] justify-center' : '';
                    const scoreDisplay = isFinalRound ? '' : '<span class="team-score">-</span>';
                    const nameClass = isFinalRound ? 'text-lg font-bold' : '';

                    matchHTML = `
                        <div class="match-card ${extraClasses} ${isEditable && r === 0 ? 'editable-mode' : ''} my-2">
                            <div class="team-slot ${sel1} ${nameClass}" ${click1}><span>${escapeHtml(team1)}</span>${scoreDisplay}</div>
                            <div class="team-slot ${sel2} ${nameClass}" ${click2}><span>${escapeHtml(team2)}</span>${scoreDisplay}</div>
                        </div>`;
                }

                pairWrapper.innerHTML += matchHTML;
                renderedMatches++;
            }

            if (renderedMatches > 0) {
                if (renderedMatches === 1) pairWrapper.classList.add('single-child');
                roundDiv.appendChild(pairWrapper);
            }
        }
        bracketWrapper.appendChild(roundDiv);
    }
    container.appendChild(bracketWrapper);
}

function renderDoubleEliminationPlaceholder(container, participants, isEditable) {
    container.innerHTML = '';
    const controlsDiv = document.createElement('div');
    controlsDiv.className = "flex gap-3 mb-4 border-b border-white/10 pb-4";
    controlsDiv.innerHTML = `
        <button id="btn-ub" onclick="window.switchBracketTab('upper')" class="px-6 py-2 rounded-md font-bold text-sm transition-all bg-[var(--gold)] text-black shadow-lg shadow-[var(--gold)]/20 hover:scale-105">Upper Bracket</button>
        <button id="btn-lb" onclick="window.switchBracketTab('lower')" class="px-6 py-2 rounded-md font-bold text-sm transition-all bg-white/5 text-gray-400 hover:text-white hover:bg-white/10 border border-white/10">Lower Bracket</button>
    `;
    container.appendChild(controlsDiv);

    const bracketScrollWrapper = document.createElement('div');
    bracketScrollWrapper.className = "bracket-wrapper overflow-x-auto custom-scrollbar";
    bracketScrollWrapper.style.width = "100%";

    let targetSize = currentEditingTournament.maxTeams || 8;
    let bracketSize = 2;
    while (bracketSize < targetSize) bracketSize *= 2;

    let seeds = [...participants.map(p => typeof p === 'object' ? p.name : p)];
    while (seeds.length < targetSize) seeds.push('TBD');
    const totalSlots = bracketSize;
    const numByes = totalSlots - seeds.length;
    for (let i = 0; i < numByes; i++) seeds.push('BYE');

    const ubContainer = document.createElement('div');
    ubContainer.id = 'ub-container';
    ubContainer.className = "flex";

    let wbRounds = Math.log2(bracketSize);
    for (let r = 0; r < wbRounds; r++) {
        const roundDiv = document.createElement('div');
        roundDiv.className = 'bracket-round';
        roundDiv.innerHTML = `<div class="text-center text-sm text-[var(--gold)] mb-4 font-bold uppercase tracking-widest border-b border-white/10 pb-2">WB Round ${r + 1}</div>`;

        const matchesInRound = bracketSize / Math.pow(2, r + 1);

        for (let m = 0; m < matchesInRound; m += 2) {
            const pairWrapper = document.createElement('div');
            const isUBFinal = (r === wbRounds - 1);
            pairWrapper.className = isUBFinal ? 'match-pair straight-mode' : 'match-pair';
            let subLoopLimit = (r === wbRounds - 1) ? 1 : 2;

            for (let i = 0; i < subLoopLimit; i++) {
                let currentM = m + i;
                let team1 = "TBD", team2 = "TBD";
                let isBye = false;

                if (r === 0) {
                    const idx1 = currentM * 2;
                    const idx2 = currentM * 2 + 1;
                    team1 = seeds[idx1] || "TBD";
                    team2 = seeds[idx2] || "TBD";
                    if (team1 === 'BYE' || team2 === 'BYE') isBye = true;
                } else {
                    team1 = `W-R${r}-M${currentM * 2 + 1}`;
                    team2 = `W-R${r}-M${currentM * 2 + 2}`;
                }

                const straightLineClass = isUBFinal ? 'straight-line' : '';

                if (isBye) {
                    const real = (team1 !== 'BYE') ? team1 : team2;
                    pairWrapper.innerHTML += `
                        <div class="match-card opacity-50 border-dashed border-gray-600">
                            <div class="team-slot"><span class="text-[var(--gold)]">${escapeHtml(real)}</span><span class="text-xs text-green-400">Advances</span></div>
                            <div class="team-slot text-gray-600"><span>BYE</span></div>
                        </div>`;
                } else {
                    const idx1 = r === 0 ? currentM * 2 : -1;
                    const idx2 = r === 0 ? currentM * 2 + 1 : -1;
                    const click1 = (isEditable && r === 0 && team1 !== 'TBD') ? `onclick="window.selectTeam(${idx1})"` : '';
                    const click2 = (isEditable && r === 0 && team2 !== 'TBD') ? `onclick="window.selectTeam(${idx2})"` : '';
                    const sel1 = (swapSourceIndex === idx1 && r === 0) ? 'selected-for-swap' : '';
                    const sel2 = (swapSourceIndex === idx2 && r === 0) ? 'selected-for-swap' : '';

                    pairWrapper.innerHTML += `
                        <div class="match-card ${straightLineClass} ${isEditable && r === 0 ? 'editable-mode' : ''}">
                            <div class="team-slot ${sel1}" ${click1}><span>${escapeHtml(team1)}</span><span class="team-score">-</span></div>
                            <div class="team-slot ${sel2}" ${click2}><span>${escapeHtml(team2)}</span><span class="team-score">-</span></div>
                        </div>`;
                }
            }
            roundDiv.appendChild(pairWrapper);
        }
        ubContainer.appendChild(roundDiv);
    }

    const finalDiv = document.createElement('div');
    finalDiv.className = 'bracket-round flex flex-col justify-center';
    finalDiv.innerHTML = `
        <div class="text-center text-sm text-[var(--gold)] mb-4 font-bold uppercase tracking-widest border-b border-white/10 pb-2">Grand Final</div>
        <div class="match-pair straight-mode">
            <div class="match-card border-[var(--gold)] shadow-[0_0_20px_rgba(255,215,0,0.15)] h-[100px]">
                 <div class="team-slot"><span class="text-[var(--gold)] font-bold text-lg">Winner UB</span></div>
                 <div class="team-slot"><span class="text-red-400 font-bold text-lg">Winner LB</span></div>
            </div>
        </div>`;
    ubContainer.appendChild(finalDiv);
    bracketScrollWrapper.appendChild(ubContainer);

    const lbContainer = document.createElement('div');
    lbContainer.id = 'lb-container';
    lbContainer.className = "flex hidden";
    const lbRoundsCount = (wbRounds - 1) * 2;

    for (let r = 0; r < lbRoundsCount; r++) {
        const roundDiv = document.createElement('div');
        roundDiv.className = 'bracket-round';
        roundDiv.innerHTML = `<div class="text-center text-sm text-red-400 mb-4 font-bold uppercase tracking-widest border-b border-white/10 pb-2">LB Round ${r + 1}</div>`;
        const powerDrop = Math.floor(r / 2);
        const matchesInThisRound = Math.max(1, (bracketSize / 4) / Math.pow(2, powerDrop));
        const nextPowerDrop = Math.floor((r + 1) / 2);
        const matchesInNextRound = Math.max(1, (bracketSize / 4) / Math.pow(2, nextPowerDrop));
        const isStraightRound = matchesInThisRound === matchesInNextRound;

        if (isStraightRound) {
            for (let m = 0; m < matchesInThisRound; m++) {
                const pairWrapper = document.createElement('div');
                pairWrapper.className = 'match-pair straight-mode';
                pairWrapper.innerHTML = `
                    <div class="match-card border-red-500/20 straight-line">
                        <div class="team-slot text-gray-400"><span>Waiting...</span></div>
                        <div class="team-slot text-gray-400"><span>Waiting...</span></div>
                    </div>`;
                roundDiv.appendChild(pairWrapper);
            }
        } else {
            for (let m = 0; m < matchesInThisRound; m += 2) {
                const pairWrapper = document.createElement('div');
                pairWrapper.className = 'match-pair';
                pairWrapper.innerHTML = `
                    <div class="match-card border-red-500/20">
                        <div class="team-slot text-gray-400"><span>Waiting...</span></div>
                        <div class="team-slot text-gray-400"><span>Waiting...</span></div>
                    </div>
                    <div class="match-card border-red-500/20">
                        <div class="team-slot text-gray-400"><span>Waiting...</span></div>
                        <div class="team-slot text-gray-400"><span>Waiting...</span></div>
                    </div>`;
                roundDiv.appendChild(pairWrapper);
            }
        }
        lbContainer.appendChild(roundDiv);
    }

    bracketScrollWrapper.appendChild(lbContainer);
    container.appendChild(bracketScrollWrapper);
}

function renderDoubleEliminationLive(container, matches, isAdmin) {
    // 1. CLEAR & SETUP CONTAINER
    container.innerHTML = '';

    // Create Main Scroll Wrapper
    const scrollWrapper = document.createElement('div');
    // Added gap-12 to create distinct spacing between the two brackets
    scrollWrapper.className = "overflow-auto custom-scrollbar pb-10 h-full flex flex-col gap-12";
    scrollWrapper.style.minHeight = "600px";

    // ==========================================
    // UPPER BRACKET SECTION
    // ==========================================
    const ubSection = document.createElement('div');
    ubSection.className = "flex flex-col items-start";

    // UB Title
    const ubTitle = document.createElement('div');
    ubTitle.className = "text-[var(--gold)] font-bold text-lg mb-6 uppercase tracking-widest pl-10 border-l-4 border-[var(--gold)] ml-10 mt-4 w-full border-t border-t-white/10 pt-4";
    ubTitle.textContent = "Upper Bracket";
    ubSection.appendChild(ubTitle);

    const ubContainer = document.createElement('div');
    ubContainer.className = "flex flex-col items-start";

    // Find Root of UB (UB Final)
    const wbMatches = matches.filter(m => m.bracket === 'upper');
    // Sort descending by round to find the latest round
    const finalWBMatch = wbMatches.sort((a, b) => b.round - a.round)[0];
    const maxRound = finalWBMatch ? finalWBMatch.round : 0;

    // --- UB HEADERS ---
    if (wbMatches.length > 0) {
        const headersDiv = document.createElement('div');
        headersDiv.className = 'bracket-header-row';
        headersDiv.style.marginBottom = "20px";
        headersDiv.style.paddingLeft = "50px";

        for (let i = 1; i <= maxRound; i++) {
            const hItem = document.createElement('div');
            hItem.className = 'header-item';
            if (i === maxRound) hItem.textContent = "UB Final";
            else hItem.textContent = `Round ${i}`;
            headersDiv.appendChild(hItem);
        }

        // Add Grand Final Header aligned with UB
        const gfHeader = document.createElement('div');
        gfHeader.className = 'header-item gf-header';
        gfHeader.textContent = "Grand Final";
        if (headersDiv.lastChild) headersDiv.lastChild.style.marginRight = "0";

        headersDiv.appendChild(gfHeader);
        ubContainer.appendChild(headersDiv);
    }

    // --- UB TREE + GRAND FINAL ---
    const treeRowWrapper = document.createElement('div');
    treeRowWrapper.className = "flex items-center";

    if (finalWBMatch) {
        const ubTree = buildMatchTree(matches, finalWBMatch.id);
        const treeWrapper = document.createElement('div');
        treeWrapper.className = 'wrapper';
        treeWrapper.style.padding = "0";

        renderRecursiveBracket(treeWrapper, ubTree, isAdmin);
        treeRowWrapper.appendChild(treeWrapper);

        // Append Grand Final to the right of UB
        const gfMatch = matches.find(m => m.bracket === 'final');
        if (gfMatch) {
            const connector = document.createElement('div');
            connector.className = "gf-connector-line";
            treeRowWrapper.appendChild(connector);

            const finalWrapper = document.createElement('div');
            finalWrapper.className = "gf-wrapper flex flex-col justify-center";
            finalWrapper.style.paddingLeft = "0px";
            finalWrapper.style.marginLeft = "-2px";

            finalWrapper.innerHTML = `<div class="text-center text-red-500 font-bold mb-2 text-[10px] uppercase tracking-widest"></div>`;

            const card = createLiveMatchCard(gfMatch, isAdmin);
            // Distinct style for Grand Final
            card.style.border = "2px solid var(--gold)";
            card.style.boxShadow = "0 0 20px rgba(255, 215, 0, 0.2)";

            finalWrapper.appendChild(card);
            treeRowWrapper.appendChild(finalWrapper);
        }
    }

    ubContainer.appendChild(treeRowWrapper);
    ubSection.appendChild(ubContainer);
    scrollWrapper.appendChild(ubSection); // Append UB Section to Main Scroll

    // ==========================================
    // LOWER BRACKET SECTION
    // ==========================================
    const lbSection = document.createElement('div');
    lbSection.className = "flex flex-col items-start mt-8";

    // LB Title
    const lbTitle = document.createElement('div');
    lbTitle.className = "text-red-400 font-bold text-lg mb-6 uppercase tracking-widest pl-10 border-l-4 border-red-500 ml-10 pt-2 w-full border-t border-t-white/10 mt-8";
    lbTitle.textContent = "Lower Bracket";
    lbSection.appendChild(lbTitle);

    // Find Root of LB (The match with highest round in 'lower' bracket)
    const lbMatches = matches.filter(m => m.bracket === 'lower');

    if (lbMatches.length > 0) {
        const finalLBMatch = lbMatches.sort((a, b) => b.round - a.round)[0];
        const maxLBRound = finalLBMatch ? finalLBMatch.round : 0;

        // --- LB HEADERS ---
        const lbContainer = document.createElement('div');
        lbContainer.className = "flex flex-col items-start";

        const lbHeadersDiv = document.createElement('div');
        lbHeadersDiv.className = 'bracket-header-row';
        lbHeadersDiv.style.marginBottom = "20px";
        lbHeadersDiv.style.paddingLeft = "50px";

        for (let i = 1; i <= maxLBRound; i++) {
            const hItem = document.createElement('div');
            hItem.className = 'header-item';
            if (i === maxLBRound) hItem.textContent = "LB Final";
            else hItem.textContent = `LB Round ${i}`;
            lbHeadersDiv.appendChild(hItem);
        }
        lbContainer.appendChild(lbHeadersDiv);

        // --- LB TREE (Using Recursive Renderer for Lines) ---
        const lbTreeRowWrapper = document.createElement('div');
        lbTreeRowWrapper.className = "flex items-center";

        if (finalLBMatch) {
            const lbTree = buildMatchTree(matches, finalLBMatch.id);
            const lbTreeWrapper = document.createElement('div');
            lbTreeWrapper.className = 'wrapper';
            lbTreeWrapper.style.padding = "0";

            // This generates the bracket lines automatically!
            renderRecursiveBracket(lbTreeWrapper, lbTree, isAdmin);
            lbTreeRowWrapper.appendChild(lbTreeWrapper);
        }

        lbContainer.appendChild(lbTreeRowWrapper);
        lbSection.appendChild(lbContainer);
        scrollWrapper.appendChild(lbSection); // Append LB Section to Main Scroll
    } else {
        // Fallback if no LB matches yet
        const emptyLB = document.createElement('div');
        emptyLB.className = "pl-10 ml-10 text-gray-500 italic text-sm";
        emptyLB.textContent = "Lower bracket matches will appear here once the tournament progresses.";
        lbSection.appendChild(emptyLB);
        scrollWrapper.appendChild(lbSection);
    }

    container.appendChild(scrollWrapper);
    injectTreeStyles();
}

function createLiveMatchCard(m, isAdmin) {
    const card = document.createElement('div');
    // Apply your Gold Styles here
    card.className = "tree-match-card relative flex flex-col justify-center";

    // Admin click to score
    if (isAdmin && m.team1 !== 'BYE' && m.team2 !== 'BYE') {
        card.classList.add('cursor-pointer', 'hover:brightness-110');
        card.onclick = () => window.openScoreModal(m.id);
    }

    const isWinner1 = m.winner === m.team1;
    const isWinner2 = m.winner === m.team2;
    const score1 = m.score1 !== null ? m.score1 : '-';
    const score2 = m.score2 !== null ? m.score2 : '-';

    card.innerHTML = `
        <div class="flex justify-between items-center mb-2 text-[10px] text-gray-500 uppercase tracking-wider">
            <span>M${m.matchNumber}</span>
            ${m.winner ? '<span class="text-green-400">✔</span>' : ''}
        </div>
        <div class="space-y-2 w-full">
            <div class="flex justify-between items-center ${isWinner1 ? 'text-[var(--gold)] font-bold' : 'text-gray-300'}">
                <span class="text-sm truncate w-24">${escapeHtml(m.team1)}</span>
                <span class="bg-black/40 px-2 py-0.5 rounded text-xs font-mono">${score1}</span>
            </div>
            <div class="flex justify-between items-center ${isWinner2 ? 'text-[var(--gold)] font-bold' : 'text-gray-300'}">
                <span class="text-sm truncate w-24">${escapeHtml(m.team2)}</span>
                <span class="bg-black/40 px-2 py-0.5 rounded text-xs font-mono">${score2}</span>
            </div>
        </div>
    `;
    return card;
}

window.switchBracketTab = function (tabName) {
    const ubContainer = document.getElementById('ub-container');
    const lbContainer = document.getElementById('lb-container');
    const btnUb = document.getElementById('btn-ub');
    const btnLb = document.getElementById('btn-lb');

    if (!ubContainer || !lbContainer) return;

    if (tabName === 'upper') {
        ubContainer.classList.remove('hidden');
        lbContainer.classList.add('hidden');

        // Active Style UB
        btnUb.classList.add('bg-[var(--gold)]', 'text-black');
        btnUb.classList.remove('bg-white/5', 'text-gray-400');

        // Inactive Style LB
        btnLb.classList.remove('bg-[var(--gold)]', 'text-black');
        btnLb.classList.add('bg-white/5', 'text-gray-400');
    } else {
        ubContainer.classList.add('hidden');
        lbContainer.classList.remove('hidden');

        // Active Style LB
        btnLb.classList.add('bg-[var(--gold)]', 'text-black');
        btnLb.classList.remove('bg-white/5', 'text-gray-400');

        // Inactive Style UB
        btnUb.classList.remove('bg-[var(--gold)]', 'text-black');
        btnUb.classList.add('bg-white/5', 'text-gray-400');
    }
}

function renderRoundRobin(container, participants) {
    let targetSize = currentEditingTournament ? (currentEditingTournament.maxTeams || 8) : participants.length;
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

    let html = `
    <div class="overflow-x-auto">
        <table class="rr-table min-w-full">
            <thead>
                <tr>
                    <th class="w-32 bg-black/20 border-white/10">Team</th>`;
    teamNames.forEach((_, i) => {
        html += `<th class="w-16 bg-black/20 border-white/10">${i + 1}</th>`;
    });

    html += `       <th class="w-16 bg-[var(--gold)]/10 text-[var(--gold)] border-white/10">W-L</th>
                </tr>
            </thead>
            <tbody>`;
    teamNames.forEach((teamA, i) => {
        html += `<tr>
            <td class="font-bold text-white text-left px-3 border-white/10 truncate max-w-[150px]" title="${escapeHtml(teamA)}">
                <span class="text-[var(--gold)] mr-2">${i + 1}</span>${escapeHtml(teamA)}
            </td>`;
        teamNames.forEach((teamB, j) => {
            if (i === j) html += `<td class="bg-white/5 border-white/10"></td>`;
            else html += `<td class="border-white/10 text-xs text-gray-500 hover:bg-white/5 cursor-pointer" title="${escapeHtml(teamA)} vs ${escapeHtml(teamB)}">vs</td>`;
        });
        html += `<td class="font-bold text-[var(--gold)] border-white/10">0-0</td></tr>`;
    });
    html += '</tbody></table></div>';
    container.innerHTML = html;
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

// --- CHAT LOGIC ---
let matchChatUnsubscribe = null;
let currentMatchId = null;

window.openMatchChat = function (matchId) {
    currentMatchId = matchId;
    const match = currentEditingTournament?.matches?.find(m => m.id === matchId);

    if (!match) {
        if (window.showErrorToast) window.showErrorToast('Error', 'Match not found.');
        return;
    }

    qs('#chat-match-title').textContent = `${match.team1} vs ${match.team2}`;
    qs('#chat-match-info').textContent = `Match ${match.matchNumber} - Round ${match.round || 1}`;
    startMatchChatListener(currentEditingTournament.id, matchId);
    document.getElementById('matchChatModal').classList.remove('hidden');
    document.getElementById('matchChatModal').classList.add('flex');
}

function startMatchChatListener(tournamentId, matchId) {
    const chatContainer = qs('#match-chat-container');
    if (!chatContainer) return;
    chatContainer.innerHTML = '<p class="text-center text-gray-500 mt-4">Loading messages...</p>';
    if (matchChatUnsubscribe) matchChatUnsubscribe();

    import("https://www.gstatic.com/firebasejs/11.1.0/firebase-firestore.js").then(({ collection, query, orderBy, onSnapshot }) => {
        const messagesRef = collection(db, "tournaments", tournamentId, "matchChats", matchId, "messages");
        const q = query(messagesRef, orderBy("createdAt", "asc"));

        matchChatUnsubscribe = onSnapshot(q, (snapshot) => {
            chatContainer.innerHTML = '';
            if (snapshot.empty) {
                chatContainer.innerHTML = '<p class="text-center text-gray-500 mt-10">No messages yet.</p>';
                return;
            }
            const auth = getAuth();
            const currentUser = auth.currentUser;
            snapshot.forEach((doc) => {
                const msg = doc.data();
                const isAdmin = msg.senderRole === 'admin';
                const isMe = currentUser && msg.senderId === currentUser.uid;
                const bubble = document.createElement('div');
                bubble.className = `mb-3 ${isMe ? 'text-right' : 'text-left'}`;
                bubble.innerHTML = `
                    <div class="inline-block max-w-[80%] ${isMe ? 'bg-[var(--gold)]/20 border-[var(--gold)]' : isAdmin ? 'bg-red-500/20 border-red-500' : 'bg-white/5 border-white/10'} border rounded-lg p-3">
                        <div class="font-bold text-[10px] mb-1 ${isAdmin ? 'text-red-400' : 'text-gray-400'}">${escapeHtml(msg.senderName)}${isAdmin ? ' (Admin)' : ''}</div>
                        <div class="text-sm text-white">${escapeHtml(msg.text)}</div>
                    </div>
                `;
                chatContainer.appendChild(bubble);
            });
            chatContainer.scrollTop = chatContainer.scrollHeight;
        });
    });
}

window.sendMatchChatMessage = async function () {
    const input = qs('#match-chat-input');
    const text = input.value.trim();
    if (!text || !currentMatchId || !currentEditingTournament) return;
    const auth = getAuth();
    const user = auth.currentUser;
    if (!user) {
        if (window.showErrorToast) window.showErrorToast('Login Required', 'Please sign in.');
        return;
    }
    input.value = '';
    try {
        const { collection, addDoc, serverTimestamp } = await import("https://www.gstatic.com/firebasejs/11.1.0/firebase-firestore.js");
        const messagesRef = collection(db, "tournaments", currentEditingTournament.id, "matchChats", currentMatchId, "messages");
        await addDoc(messagesRef, {
            text: text,
            senderId: user.uid,
            senderName: user.displayName || user.email.split('@')[0],
            senderRole: 'user',
            createdAt: serverTimestamp()
        });
    } catch (err) {
        console.error("Chat error:", err);
    }
}

window.closeMatchChat = function () {
    document.getElementById('matchChatModal').classList.remove('flex');
    document.getElementById('matchChatModal').classList.add('hidden');
    if (matchChatUnsubscribe) {
        matchChatUnsubscribe();
        matchChatUnsubscribe = null;
    }
    currentMatchId = null;
}

// --- Window Exposure ---
window.openJoinForm = openJoinForm;
window.processApplication = processApplication;
window.withdrawApplication = withdrawApplication;
window.viewTeamMembers = viewTeamMembers;
window.selectTeam = selectTeamForSwap;
window.openMatchChat = openMatchChat;
window.sendMatchChatMessage = sendMatchChatMessage;
window.closeMatchChat = closeMatchChat;
window.startTournament = startTournament;
window.openScoreModal = openScoreModal;
window.saveMatchScore = saveMatchScore;
window.deleteTournament = deleteTournament;
window.closeModal = (id) => {
    document.getElementById(id).classList.add('hidden');
    if (id === 'detailsModal' && tournamentUnsubscribe) {
        tournamentUnsubscribe();
        tournamentUnsubscribe = null;
    }
};