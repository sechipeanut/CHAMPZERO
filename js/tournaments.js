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
// --- 1. REPLACE THIS FUNCTION: CSS INJECTION ---
function injectTreeStyles() {
    if (document.getElementById('tree-bracket-styles')) return;
    const style = document.createElement('style');
    style.id = 'tree-bracket-styles';
    style.textContent = `
        /* Variables converted to standard CSS */
        :root {
            --side-margin: 50px;
            --vertical-margin: 10px;
            --line-color: rgba(255, 255, 255, 0.5);
            --card-bg: #1A1A1F;
            --card-border: #FFD700;
        }

        .bracket-scroll-container {
            display: flex;
            justify-content: center; /* Center the whole tree */
            padding: 40px;
            overflow: auto;
            min-height: 600px;
        }

        /* WRAPPER */
        .wrapper {
            display: flex;
            align-items: center;
            justify-content: center;
        }

        /* ITEM STRUCTURE */
        .item {
            display: flex;
            flex-direction: row-reverse; /* Parent Right, Children Left */
            align-items: center;
        }

        /* PARENT (The Match Card) */
        .item-parent {
            position: relative;
            margin-left: var(--side-margin);
            display: flex;
            align-items: center;
            z-index: 10;
        }

        /* Line from Parent to Children Group */
        .item-parent:after {
            position: absolute;
            content: '';
            width: calc(var(--side-margin) / 2);
            height: 2px;
            left: 0;
            top: 50%;
            background-color: var(--line-color);
            transform: translateX(-100%);
        }

        /* Remove line for root (Grand Final) */
        .item-parent.root-node:after {
            display: none;
        }

        /* CHILDREN CONTAINER */
        .item-childrens {
            display: flex;
            flex-direction: column;
            justify-content: center;
        }

        /* CHILD WRAPPER */
        .item-child {
            display: flex;
            align-items: flex-start;
            justify-content: flex-end;
            margin-top: var(--vertical-margin);
            margin-bottom: var(--vertical-margin);
            position: relative;
            padding-right: 25px; /* Space for connector */
        }

        /* Horizontal Line: Child to Bracket Fork */
        .item-child:before {
            content: '';
            position: absolute;
            background-color: var(--line-color);
            right: 0;
            top: 50%;
            width: 25px;
            height: 2px;
        }

        /* Vertical Line: The Bracket Fork */
        .item-child:after {
            content: '';
            position: absolute;
            background-color: var(--line-color);
            right: 0;
            width: 2px;
            /* Dynamic height logic handled by CSS pseudo-classes */
        }

        /* Top Child: Line goes DOWN */
        .item-child:first-child:after {
            top: 50%;
            height: 50%; /* Connects to middle */
            bottom: auto;
        }

        /* Bottom Child: Line goes UP */
        .item-child:last-child:after {
            top: auto;
            bottom: 50%;
            height: 50%;
        }

        /* Middle Child (if ever needed) or Single Child handling */
        .item-child:only-child:after {
            display: none;
        }
        
        /* Remove connectors if there are no children (Leaf Nodes) */
        .item-childrens:empty + .item-parent:after {
            display: none;
        }

        /* MATCH CARD STYLING */
        .match-card {
            background-color: var(--card-bg);
            border: 1px solid var(--card-border);
            border-left: 3px solid var(--card-border);
            color: white;
            padding: 10px;
            border-radius: 4px;
            min-width: 180px;
            box-shadow: 0 4px 6px rgba(0,0,0,0.3);
            cursor: pointer;
            transition: transform 0.2s;
        }
        .match-card:hover {
            transform: scale(1.02);
            background-color: #2a2a2f;
        }
        .team-name {
            font-size: 12px;
            font-weight: bold;
            display: block;
        }
        .team-score {
            float: right;
            color: var(--card-border);
        }
        
        /* LEAF NODE (Team Name Only) */
        .leaf-node {
            background: #333;
            padding: 5px 10px;
            border-radius: 4px;
            font-size: 12px;
            color: #ccc;
            border: 1px solid #444;
        }
    `;
    document.head.appendChild(style);
}

// --- 2. REPLACE THIS FUNCTION: NEW RECURSIVE RENDERER ---
function renderRecursiveBracket(container, treeNode, isAdmin, isRoot = false) {
    if (!treeNode) return;

    // Outer Wrapper (item)
    const item = document.createElement('div');
    item.className = 'item';

    // 1. CHILDREN CONTAINER (item-childrens) - Left side visually
    const childrenContainer = document.createElement('div');
    childrenContainer.className = 'item-childrens';

    // Logic: Do we recurse? 
    // If a child match contains a "BYE", we treat it as a leaf (don't draw a bracket),
    // UNLESS both teams are real (Play-in match).
    if (treeNode.children && treeNode.children.length > 0) {
        treeNode.children.forEach(childNode => {
            const childWrapper = document.createElement('div');
            childWrapper.className = 'item-child';

            const m = childNode.match;
            // CHECK: Is this a "Bye Match" (Team vs BYE)?
            const isByeMatch = (m.team1 === 'BYE' || m.team2 === 'BYE');
            
            // CHECK: Is it a Double Bye? (Shouldn't happen often but good safety)
            const isDoubleBye = (m.team1 === 'BYE' && m.team2 === 'BYE');

            if (isDoubleBye) {
                // Don't render anything for double byes
                childWrapper.innerHTML = '';
            } 
            else if (isByeMatch) {
                // LEAF NODE LOGIC:
                // Instead of drawing a bracket, just draw the name of the real team.
                // This creates the "Play-in" effect where standard teams sit waiting.
                const realTeam = (m.team1 !== 'BYE') ? m.team1 : m.team2;
                const leafDiv = document.createElement('div');
                leafDiv.className = 'leaf-node';
                leafDiv.textContent = realTeam;
                
                // Note: We put this leaf inside an 'item' structure so lines align? 
                // Actually, CSS expects item-child -> content. 
                childWrapper.appendChild(leafDiv);
                childrenContainer.appendChild(childWrapper);
            } 
            else {
                // REAL MATCH (Branch): Recurse!
                // This will draw the bracket for 8 vs 9, etc.
                renderRecursiveBracket(childWrapper, childNode, isAdmin, false);
                childrenContainer.appendChild(childWrapper);
            }
        });
    }

    // 2. PARENT CONTAINER (item-parent) - Right side visually
    const parentContainer = document.createElement('div');
    parentContainer.className = 'item-parent';
    if (isRoot) parentContainer.classList.add('root-node');

    // Build the Match Card
    const m = treeNode.match;
    const card = document.createElement('div');
    card.className = 'match-card';
    if (isAdmin) card.onclick = () => window.openScoreModal(m.id);

    const winnerClass = "text-[var(--gold)]";
    const normalClass = "text-gray-300";

    card.innerHTML = `
        <div class="mb-1 border-b border-white/10 pb-1 flex justify-between">
            <span class="text-[10px] text-gray-500">M${m.matchNumber}</span>
        </div>
        <div>
            <span class="team-name ${m.winner === m.team1 ? winnerClass : normalClass}">
                ${escapeHtml(m.team1)} <span class="team-score">${m.score1 ?? '-'}</span>
            </span>
            <span class="team-name ${m.winner === m.team2 ? winnerClass : normalClass}">
                ${escapeHtml(m.team2)} <span class="team-score">${m.score2 ?? '-'}</span>
            </span>
        </div>
    `;

    parentContainer.appendChild(card);

    // Append to Item (Flex Row Reverse handles the order: Children Left, Parent Right)
    item.appendChild(parentContainer);
    item.appendChild(childrenContainer);

    container.appendChild(item);
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

    // 1. Normalize Size to Power of 2 (2, 4, 8, 16...)
    let size = 2;
    while (size < teamNames.length) size *= 2;

    // 2. Apply Seeding
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

    // 3. Generate Round 1
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

    // 4. Generate Subsequent Rounds
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

    // 5. Auto-Advance BYEs
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

    let size = 2;
    while (size < teamNames.length) size *= 2;

    const seedOrder = getStandardSeeding(size);
    let orderedTeams = new Array(size).fill("BYE");
    for (let i = 0; i < teamNames.length; i++) {
        let slotIndex = seedOrder.indexOf(i + 1);
        if (slotIndex === -1) orderedTeams[i] = teamNames[i];
        else orderedTeams[slotIndex] = teamNames[i];
    }

    let matches = [];
    let matchIdCounter = 1;
    let wbMatches = [];
    let wbRounds = Math.log2(size);

    // --- UPPER BRACKET ---
    for (let r = 1; r <= wbRounds; r++) {
        let count = size / Math.pow(2, r);
        for (let i = 0; i < count; i++) {
            let id = `WB-R${r}-M${i + 1}`;
            // Last WB winner goes to Grand Final (GF-1)
            let nextId = (r < wbRounds) ? `WB-R${r + 1}-M${Math.floor(i / 2) + 1}` : `GF-1`; 

            // Calculate Loser Drops
            let loserId = null;
            if (r === 1) {
                loserId = `LB-R1-M${Math.floor(i / 2) + 1}`;
            } else {
                // Formula to drop losers into alternating LB rounds
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

    // --- LOWER BRACKET ---
    let lbRounds = (wbRounds - 1) * 2;
    
    for (let r = 1; r <= lbRounds; r++) {
        let power = Math.ceil(r / 2);
        let count = (size / 2) / Math.pow(2, power);

        for (let i = 0; i < count; i++) {
            let id = `LB-R${r}-M${i + 1}`;
            let nextId;
            
            // Logic for LB progression
            if (r === lbRounds) nextId = 'GF-1';
            else if (r % 2 !== 0) nextId = `LB-R${r + 1}-M${i + 1}`;
            else nextId = `LB-R${r + 1}-M${Math.floor(i / 2) + 1}`;

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

    // --- FIX SPECIFIC DROP TARGETS ---
    // Ensure losers drop to specific matches in LB
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

    return matches;
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

        let updatePayload = { matches: matches };

        if (winnerVal) {
            const winnerName = (winnerVal === "1") ? match.team1 : match.team2;
            const loserName = (winnerVal === "1") ? match.team2 : match.team1;

            match.winner = winnerName;

            // 1. ADVANCE WINNER
            if (match.nextMatchId) {
                let nextIndex = matches.findIndex(m => m.id === match.nextMatchId);
                if (nextIndex !== -1) {
                    let nextMatch = matches[nextIndex];

                    // --- NEW LOGIC START: Strict Slot Assignment ---
                    let targetSlot = 'team2'; // Default to team 2

                    // STRICT DOUBLE ELIMINATION LOGIC
                    if (match.bracket === 'upper' && nextMatch.bracket === 'final') {
                        // Upper Bracket Winner -> ALWAYS Top Slot (Team 1)
                        targetSlot = 'team1';
                    } else if (match.bracket === 'lower' && nextMatch.bracket === 'final') {
                        // Lower Bracket Winner -> ALWAYS Bottom Slot (Team 2)
                        targetSlot = 'team2';
                    }
                    // STANDARD LOGIC (Single Elim or internal bracket moves)
                    else {
                        // If team1 is TBD, or a Placeholder, or currently holds this team's name -> take Team 1
                        if (nextMatch.team1 === 'TBD' ||
                            nextMatch.team1 === 'Winner Upper' ||
                            nextMatch.team1 === match.team1 ||
                            nextMatch.team1 === match.team2) {
                            targetSlot = 'team1';
                        } else {
                            targetSlot = 'team2';
                        }
                    }

                    // Apply the winner name to the determined slot
                    if (targetSlot === 'team1') nextMatch.team1 = winnerName;
                    else nextMatch.team2 = winnerName;
                    // --- NEW LOGIC END ---

                    matches[nextIndex] = nextMatch;
                }
            } else {
                // If no next match, this might be the Grand Final or just the end
                updatePayload.status = 'Completed';
                updatePayload.champion = winnerName;
                if (window.showSuccessToast) window.showSuccessToast("Tournament Complete!", `Champion: ${winnerName}`);
            }

            // 2. MOVE LOSER (Double Elimination Logic)
            if (match.loserMatchId) {
                let loserIndex = matches.findIndex(m => m.id === match.loserMatchId);
                if (loserIndex !== -1) {
                    let loserMatch = matches[loserIndex];
                    if (loserMatch.team1 === 'TBD' || loserMatch.team1 === match.team1 || loserMatch.team1 === match.team2) loserMatch.team1 = loserName;
                    else loserMatch.team2 = loserName;
                    matches[loserIndex] = loserMatch;
                }
            }
        }

        await updateDoc(tourneyRef, updatePayload);
        document.getElementById('scoreModal').classList.add('hidden');
        if (!updatePayload.status && window.showSuccessToast) window.showSuccessToast("Updated", "Match Score Saved!");

    } catch (e) {
        console.error(e);
        alert("Error saving score: " + e.message);
    }
}

// --- MODAL & LOGIC ---
async function openModal(t) {
    if (tournamentUnsubscribe) { tournamentUnsubscribe(); tournamentUnsubscribe = null; }

    tournamentUnsubscribe = onSnapshot(doc(db, "tournaments", t.id), async (docSnap) => {
        if (!docSnap.exists()) return;
        const latestData = { id: docSnap.id, ...docSnap.data() };
        currentEditingTournament = latestData;
        await renderTournamentView(latestData);
    });

    const newUrl = `${window.location.pathname}?id=${t.id}`;
    window.history.pushState({ path: newUrl }, '', newUrl);
    document.getElementById('detailsModal').classList.remove('hidden');
    document.getElementById('detailsModal').classList.add('flex');
}

async function saveMatchScoreLogic(matchId, s1, s2, winnerVal, allMatches) {
    let matchIndex = allMatches.findIndex(m => m.id === matchId);
    if (matchIndex === -1) return allMatches;

    let match = allMatches[matchIndex];
    match.score1 = s1;
    match.score2 = s2;

    if (winnerVal) {
        const winnerName = (winnerVal === "1") ? match.team1 : match.team2;
        const loserName = (winnerVal === "1") ? match.team2 : match.team1;

        match.winner = winnerName;

        // 1. ADVANCE WINNER
        if (match.nextMatchId) {
            let nextIndex = allMatches.findIndex(m => m.id === match.nextMatchId);
            if (nextIndex !== -1) {
                let nextMatch = allMatches[nextIndex];
                let targetSlot = 'team2'; 

                // --- GRAND FINAL SLOT LOGIC ---
                if (match.bracket === 'upper' && nextMatch.bracket === 'final') {
                    targetSlot = 'team1'; // WB Winner always Top
                } else if (match.bracket === 'lower' && nextMatch.bracket === 'final') {
                    targetSlot = 'team2'; // LB Winner always Bottom
                } else {
                    // Standard Progression: Fill first available slot
                    if (nextMatch.team1 === 'TBD' || 
                        nextMatch.team1 === 'Winner Upper' || 
                        nextMatch.team1 === match.team1 || 
                        nextMatch.team1 === match.team2) {
                        targetSlot = 'team1';
                    } else {
                        targetSlot = 'team2';
                    }
                }

                if (targetSlot === 'team1') nextMatch.team1 = winnerName;
                else nextMatch.team2 = winnerName;
                allMatches[nextIndex] = nextMatch;
            }
        }

        // 2. MOVE LOSER (For Double Elim)
        if (match.loserMatchId) {
            let loserIndex = allMatches.findIndex(m => m.id === match.loserMatchId);
            if (loserIndex !== -1) {
                let loserMatch = allMatches[loserIndex];
                
                // Simple fill logic for Loser Bracket drops
                if (loserMatch.team1 === 'TBD' || loserMatch.team1 === match.team1 || loserMatch.team1 === match.team2) {
                    loserMatch.team1 = loserName;
                } else {
                    loserMatch.team2 = loserName;
                }
                allMatches[loserIndex] = loserMatch;
            }
        }
    }
    
    return allMatches;
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
        const finalMatch = t.matches ? t.matches[t.matches.length - 1] : null;
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
                <button onclick="window.deleteTournament('${t.id}')" class="bg-red-900/50 hover:bg-red-800 text-red-200 text-xs px-3 py-1.5 rounded border border-red-500/30 transition-colors flex items-center gap-1">
                    <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                    Delete Tournament
                </button>
            </div>
            <div id="adminAppList" class="space-y-2 max-h-60 overflow-y-auto custom-scrollbar">
                <div class="text-gray-500 text-sm">Loading applications...</div>
            </div>
        `;

        initAdminDashboard(t.id);

        adminToolbar.classList.remove('hidden');
        adminToolbar.innerHTML = '';

        if (!t.isStarted) {
            const startBtn = document.createElement('button');
            startBtn.className = "bg-green-600 hover:bg-green-500 text-white px-4 py-1.5 rounded text-xs font-bold transition-colors shadow-lg";
            startBtn.textContent = "▶ Start Tournament";
            startBtn.onclick = startTournament;
            adminToolbar.appendChild(startBtn);

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

            const shuffleBtn = document.createElement('button');
            shuffleBtn.className = "bg-blue-600/80 hover:bg-blue-500 text-white px-3 py-1.5 rounded text-xs ml-2";
            shuffleBtn.textContent = "Shuffle";
            shuffleBtn.onclick = async () => {
                let arr = [...t.participants];
                for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[arr[i], arr[j]] = [arr[j], arr[i]]; }
                await updateDoc(doc(db, "tournaments", t.id), { participants: arr });
            };

            const saveBtn = document.createElement('button');
            saveBtn.className = "bg-yellow-600/80 hover:bg-yellow-500 text-white px-3 py-1.5 rounded text-xs font-bold ml-2";
            saveBtn.textContent = "Save Changes";
            saveBtn.onclick = saveBracketChanges;

            adminToolbar.appendChild(select);
            adminToolbar.appendChild(shuffleBtn);
            adminToolbar.appendChild(saveBtn);
        } else {
            adminToolbar.innerHTML = '<span class="text-green-400 text-xs font-bold uppercase border border-green-500/30 px-3 py-1 rounded bg-green-500/10">Tournament Live - Click Matches to Score</span>';
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

    // FIX: specific handler for Active Double Elim
    if (isStarted && currentEditingTournament.matches && currentEditingTournament.matches.length > 0) {
        if (format === 'Double Elimination') {
            renderLiveDoubleElimination(container, currentEditingTournament.matches, isAdmin);
        } else {
            // Default to recursive tree for Single Elim
            renderMatchesFromDatabase(container, currentEditingTournament.matches, format, isAdmin);
        }
        return;
    }

    let teams = participants.map(p => typeof p === 'object' ? p.name : p);
    if (format === 'Round Robin') renderRoundRobin(container, teams);
    else if (format === 'Double Elimination') renderDoubleEliminationPlaceholder(container, teams);
    else renderSingleEliminationPlaceholder(container, teams, isAdmin);
}

// --- NEW RECURSIVE BRACKET LOGIC ---

// 1. Convert Flat Matches to Tree
function buildMatchTree(matches) {
    // Find the Grand Final (The match with no nextMatchId)
    // Note: We sort by round desc to find the last one if nextMatchId logic fails
    const finalMatch = matches.find(m => !m.nextMatchId) || matches.sort((a, b) => b.round - a.round)[0];

    if (!finalMatch) return null;

    function getSources(targetMatch) {
        // Find matches that feed into this match
        // Logic: Matches where nextMatchId === targetMatch.id
        const sources = matches.filter(m => m.nextMatchId === targetMatch.id);

        // Sort sources: Odd match numbers (Top/Team1 slot) first, Even (Bottom/Team2 slot) second
        // This ensures the bracket order is correct vertically
        sources.sort((a, b) => {
            const numA = parseInt(a.matchNumber || a.id.split('-')[1]);
            const numB = parseInt(b.matchNumber || b.id.split('-')[1]);
            return numA - numB;
        });

        return {
            match: targetMatch,
            children: sources.map(source => getSources(source)) // Recursion
        };
    }

    return getSources(finalMatch);
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

    if (rootNode) {
        const rootWrapper = document.createElement('div');
        rootWrapper.className = 'wrapper'; // Uses the user's .wrapper class
        
        // Pass 'true' as the 4th argument to indicate this is the Grand Final (Root)
        renderRecursiveBracket(rootWrapper, rootNode, isAdmin, true);
        
        bracketScrollWrapper.appendChild(rootWrapper);
    }
    
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
    // Inject styles if not present
    // injectBracketStyles(); // Disabled old style injection to prefer Tree Style if active

    let targetSize = currentEditingTournament.maxTeams || 8;
    let bracketSize = 2;
    while (bracketSize < targetSize) bracketSize *= 2;
    let seeds = [...participants.map(p => typeof p === 'object' ? p.name : p)];
    while (seeds.length < targetSize) seeds.push('TBD');
    const totalSlots = bracketSize;
    const numByes = totalSlots - seeds.length;
    for (let i = 0; i < numByes; i++) seeds.push('BYE');
    let rounds = Math.log2(bracketSize);
    const bracketWrapper = document.createElement('div');
    bracketWrapper.className = "bracket-wrapper";

    for (let r = 0; r < rounds; r++) {
        const roundDiv = document.createElement('div');
        roundDiv.className = 'bracket-round';
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
            let visibleMatches = 0;

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

                // SKIP DOUBLE BYE
                if (team1 === 'BYE' && team2 === 'BYE') continue;

                visibleMatches++;
                let matchHTML = '';

                if (isSingleBye) {
                    // RENDER SINGLE BYE (Clean seed look)
                    const realTeam = (team1 !== 'BYE') ? team1 : team2;
                    matchHTML = `
                        <div class="match-card bye-card my-2 py-3">
                            <div class="team-slot"><span class="text-[var(--gold)] font-bold">${escapeHtml(realTeam)}</span></div>
                        </div>`;
                } else {
                    // NORMAL RENDER
                    const idx1 = (r === 0) ? currentM * 2 : -1;
                    const idx2 = (r === 0) ? currentM * 2 + 1 : -1;
                    const click1 = (isEditable && r === 0 && team1 !== 'TBD') ? `onclick="window.selectTeam(${idx1})"` : '';
                    const click2 = (isEditable && r === 0 && team2 !== 'TBD') ? `onclick="window.selectTeam(${idx2})"` : '';
                    const sel1 = (swapSourceIndex === idx1 && r === 0) ? 'selected-for-swap' : '';
                    const sel2 = (swapSourceIndex === idx2 && r === 0) ? 'selected-for-swap' : '';
                    const extraClasses = isFinalRound ? 'champ-card h-[100px] justify-center' : '';
                    const scoreDisplay = isFinalRound ? '' : '<span class="team-score">-</span>';
                    const nameClass = isFinalRound ? 'text-lg font-bold' : '';

                    matchHTML = `<div class="match-card ${extraClasses} ${isEditable && r === 0 ? 'editable-mode' : ''} my-2"><div class="team-slot ${sel1} ${nameClass}" ${click1}><span>${escapeHtml(team1)}</span>${scoreDisplay}</div><div class="team-slot ${sel2} ${nameClass}" ${click2}><span>${escapeHtml(team2)}</span>${scoreDisplay}</div></div>`;
                }
                pairWrapper.innerHTML += matchHTML;
            }

            if (visibleMatches === 0) continue;
            if (visibleMatches === 1) pairWrapper.classList.add('single-child');

            roundDiv.appendChild(pairWrapper);
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

function renderLiveDoubleElimination(container, matches, isAdmin) {
    // 1. Setup Controls (Tabs)
    const controlsDiv = document.createElement('div');
    controlsDiv.className = "flex gap-3 mb-4 border-b border-white/10 pb-4";
    controlsDiv.innerHTML = `
        <button id="btn-ub" onclick="window.switchBracketTab('upper')" class="px-6 py-2 rounded-md font-bold text-sm transition-all bg-[var(--gold)] text-black shadow-lg shadow-[var(--gold)]/20 hover:scale-105">Upper Bracket</button>
        <button id="btn-lb" onclick="window.switchBracketTab('lower')" class="px-6 py-2 rounded-md font-bold text-sm transition-all bg-white/5 text-gray-400 hover:text-white hover:bg-white/10 border border-white/10">Lower Bracket</button>
    `;
    container.appendChild(controlsDiv);

    // 2. Main Wrapper
    const bracketScrollWrapper = document.createElement('div');
    bracketScrollWrapper.className = "bracket-wrapper overflow-x-auto custom-scrollbar relative";
    bracketScrollWrapper.style.width = "100%";
    bracketScrollWrapper.style.minHeight = "600px";

    // 3. SVG Layer
    const svgLayer = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svgLayer.id = "bracket-lines-layer";
    svgLayer.style.cssText = "position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; z-index: 0;";
    bracketScrollWrapper.appendChild(svgLayer);

    // 4. Card Helper
    const createCardHTML = (m) => {
        const isCompleted = !!m.winner;
        const score1 = m.score1 !== null ? m.score1 : '-';
        const score2 = m.score2 !== null ? m.score2 : '-';

        // Admin logic
        const onClickAttr = (isAdmin && m.team1 !== 'BYE' && m.team2 !== 'BYE') ? `onclick="window.openScoreModal('${m.id}')"` : '';
        const cursorClass = (isAdmin && m.team1 !== 'BYE' && m.team2 !== 'BYE') ? 'cursor-pointer hover:border-[var(--gold)]' : '';

        let baseClass = `tree-match-card ${cursorClass}`;
        if (isCompleted) baseClass += ` completed`;

        // We add 'final-card' class if it is the grand final for easier CSS/JS targeting
        if (m.bracket === 'final') baseClass += ' border-2 border-[var(--gold)] shadow-lg shadow-[var(--gold)]/20';

        return `
            <div id="match-card-${m.id}" class="${baseClass} my-4 relative z-10 bg-[var(--dark-card)]" ${onClickAttr} data-bracket="${m.bracket}" data-next="${m.nextMatchId || ''}">
                <div class="flex justify-between items-center mb-2 text-[10px] text-gray-500 uppercase tracking-wider">
                    <span>M${m.matchNumber} • ${m.bracket === 'final' ? 'Grand Final' : 'R' + m.round}</span>
                    ${isCompleted ? '<span class="text-green-400">✔</span>' : ''}
                </div>
                <div class="space-y-1 w-full">
                    <div class="flex justify-between items-center ${m.winner === m.team1 ? 'text-[var(--gold)] font-bold' : 'text-gray-300'}">
                        <span class="text-sm truncate pr-2">${escapeHtml(m.team1)}</span>
                        <span class="bg-white/10 px-1.5 rounded text-xs font-mono ${m.winner === m.team1 ? 'text-[var(--gold)]' : 'text-gray-400'}">${score1}</span>
                    </div>
                    <div class="flex justify-between items-center ${m.winner === m.team2 ? 'text-[var(--gold)] font-bold' : 'text-gray-300'}">
                        <span class="text-sm truncate pr-2">${escapeHtml(m.team2)}</span>
                        <span class="bg-white/10 px-1.5 rounded text-xs font-mono ${m.winner === m.team2 ? 'text-[var(--gold)]' : 'text-gray-400'}">${score2}</span>
                    </div>
                </div>
            </div>`;
    };

    // Filter Matches
    const upperMatches = matches.filter(m => m.bracket === 'upper');
    const lowerMatches = matches.filter(m => m.bracket === 'lower');
    const finalMatches = matches.filter(m => m.bracket === 'final');

    // --- RENDER UPPER BRACKET TAB ---
    const ubContainer = document.createElement('div');
    ubContainer.id = 'ub-container';
    ubContainer.className = "flex gap-12 p-8 min-w-max items-center"; // items-center helps align the final

    const maxUBRound = Math.max(...upperMatches.map(m => m.round), 0);
    for (let r = 1; r <= maxUBRound; r++) {
        const roundDiv = document.createElement('div');
        roundDiv.className = 'flex flex-col justify-around gap-6';
        roundDiv.innerHTML = `<div class="text-center text-xs text-[var(--gold)] font-bold uppercase mb-2">WB Round ${r}</div>`;

        const roundsMatches = upperMatches.filter(m => m.round === r).sort((a, b) => a.matchNumber - b.matchNumber);
        roundsMatches.forEach(m => roundDiv.innerHTML += createCardHTML(m));
        ubContainer.appendChild(roundDiv);
    }

    // Append Grand Final to Upper Tab
    if (finalMatches.length > 0) {
        const gfDiv = document.createElement('div');
        gfDiv.className = 'flex flex-col justify-center gap-6 ml-8 pl-8 border-l border-white/10 border-dashed';
        gfDiv.innerHTML = `<div class="text-center text-xs text-[var(--gold)] font-bold uppercase mb-2">Championship</div>`;
        finalMatches.forEach(m => gfDiv.innerHTML += createCardHTML(m));
        ubContainer.appendChild(gfDiv);
    }

    // --- RENDER LOWER BRACKET TAB ---
    const lbContainer = document.createElement('div');
    lbContainer.id = 'lb-container';
    lbContainer.className = "flex gap-12 p-8 min-w-max hidden items-center";

    const maxLBRound = Math.max(...lowerMatches.map(m => m.round), 0);
    for (let r = 1; r <= maxLBRound; r++) {
        const roundDiv = document.createElement('div');
        roundDiv.className = 'flex flex-col justify-center gap-6';
        roundDiv.innerHTML = `<div class="text-center text-xs text-red-400 font-bold uppercase mb-2">LB Round ${r}</div>`;

        const roundsMatches = lowerMatches.filter(m => m.round === r).sort((a, b) => a.matchNumber - b.matchNumber);
        roundsMatches.forEach(m => roundDiv.innerHTML += createCardHTML(m));
        lbContainer.appendChild(roundDiv);
    }

    // Append Grand Final to Lower Tab as well (So visual flow is complete)
    if (finalMatches.length > 0) {
        const gfDivLB = document.createElement('div');
        gfDivLB.className = 'flex flex-col justify-center gap-6 ml-8 pl-8 border-l border-white/10 border-dashed';
        gfDivLB.innerHTML = `<div class="text-center text-xs text-[var(--gold)] font-bold uppercase mb-2">Championship</div>`;
        // Note: We need unique IDs for the logic, but since only one tab is shown at a time, 
        // the duplicate IDs won't break the CSS query if we are careful, 
        // BUT for getElementById to work for lines, we should render the GF only once or handle IDs carefully.
        // TRICK: We will clone the node for display, OR rely on the fact that we only draw lines for visible elements.

        // Actually, simpler approach: Don't duplicate ID.
        // We will just let the "Upper Bracket" tab show the GF. 
        // But the user wants the LB winner to flow into it. 
        // Let's use a specific Class for the LB Final Container to duplicate the view manually.
        finalMatches.forEach(m => {
            // We create a visual clone for LB tab with a suffix ID so lines can find it if we want
            let html = createCardHTML(m);
            html = html.replace(`id="match-card-${m.id}"`, `id="match-card-${m.id}-LB"`);
            gfDivLB.innerHTML += html;
        });
        lbContainer.appendChild(gfDivLB);
    }

    bracketScrollWrapper.appendChild(ubContainer);
    bracketScrollWrapper.appendChild(lbContainer);
    container.appendChild(bracketScrollWrapper);

    // 7. Draw Lines
    setTimeout(() => drawBracketLines(matches), 100);
    window.addEventListener('resize', () => drawBracketLines(matches));
}

function drawBracketLines(matches) {
    const svg = document.getElementById('bracket-lines-layer');
    const wrapper = document.querySelector('.bracket-wrapper');
    // Check which container is visible to know which lines to draw
    const ubVisible = !document.getElementById('ub-container').classList.contains('hidden');

    if (!svg || !wrapper) return;

    svg.innerHTML = '';
    svg.style.width = wrapper.scrollWidth + 'px';
    svg.style.height = wrapper.scrollHeight + 'px';

    const getCoords = (id) => {
        const el = document.getElementById(id);
        if (!el || el.offsetParent === null) return null;
        const rect = el.getBoundingClientRect();
        const wrapperRect = wrapper.getBoundingClientRect();
        return {
            x: rect.right - wrapperRect.left + wrapper.scrollLeft,
            xLeft: rect.left - wrapperRect.left + wrapper.scrollLeft,
            y: rect.top + (rect.height / 2) - wrapperRect.top + wrapper.scrollTop,
            height: rect.height,
            top: rect.top - wrapperRect.top + wrapper.scrollTop
        };
    };

    matches.forEach(m => {
        if (m.nextMatchId) {
            let startId = `match-card-${m.id}`;
            let endId = `match-card-${m.nextMatchId}`;

            // Handle Grand Final visibility logic
            if (!ubVisible && m.bracket === 'final') return;
            if (!ubVisible && document.getElementById(endId + '-LB')) {
                endId = endId + '-LB';
            }

            // Logic: Is this the connection to the Grand Final?
            let isTargetGrandFinal = false;
            const targetMatch = matches.find(tm => tm.id === m.nextMatchId);
            if (targetMatch && targetMatch.bracket === 'final') {
                isTargetGrandFinal = true;
            }

            const start = getCoords(startId);
            const end = getCoords(endId);

            if (start && end) {
                // DEFAULT: Center to Center
                let targetY = end.y;
                let startY = start.y;

                // CUSTOM: If targeting Grand Final
                if (isTargetGrandFinal) {
                    if (m.bracket === 'upper') {
                        // Upper Bracket Winner -> Goes to Top Slot
                        targetY = end.top + (end.height * 0.25);
                    } else if (m.bracket === 'lower') {
                        // Lower Bracket Winner -> Goes to Bottom Slot
                        targetY = end.top + (end.height * 0.75);
                    }
                }

                // --- CHANGED LOGIC HERE FOR "BRACKET STYLE" LINES ---
                const path = document.createElementNS("http://www.w3.org/2000/svg", "path");

                // Calculate the midpoint between the columns
                const midpointX = (start.x + end.xLeft) / 2;

                // Path: 
                // 1. Move to Start (Right side of source card)
                // 2. Line Horizontal to Midpoint
                // 3. Line Vertical to Target Y level
                // 4. Line Horizontal to End (Left side of target card)
                const d = `M ${start.x} ${startY} 
                           H ${midpointX} 
                           V ${targetY} 
                           H ${end.xLeft}`;

                path.setAttribute("d", d);
                path.setAttribute("stroke", "rgba(255, 255, 255, 0.4)"); // Slightly brighter for sharpness
                path.setAttribute("stroke-width", "2");
                path.setAttribute("fill", "none");
                // Optional: Add rounded corners to the bracket joints
                path.setAttribute("stroke-linejoin", "round");

                svg.appendChild(path);
            }
        }
    });
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
        // Style Buttons
        btnUb.classList.add('bg-[var(--gold)]', 'text-black', 'border-[var(--gold)]');
        btnUb.classList.remove('bg-transparent', 'text-gray-400', 'border-gray-600');
        btnLb.classList.remove('bg-[var(--gold)]', 'text-black', 'border-[var(--gold)]');
        btnLb.classList.add('bg-transparent', 'text-gray-400', 'border-gray-600');
    } else {
        ubContainer.classList.add('hidden');
        lbContainer.classList.remove('hidden');
        // Style Buttons
        btnLb.classList.add('bg-[var(--gold)]', 'text-black', 'border-[var(--gold)]');
        btnLb.classList.remove('bg-transparent', 'text-gray-400', 'border-gray-600');
        btnUb.classList.remove('bg-[var(--gold)]', 'text-black', 'border-[var(--gold)]');
        btnUb.classList.add('bg-transparent', 'text-gray-400', 'border-gray-600');
    }

    // Redraw lines after the DOM updates visibility
    if (currentEditingTournament && currentEditingTournament.matches) {
        setTimeout(() => drawBracketLines(currentEditingTournament.matches), 50);
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