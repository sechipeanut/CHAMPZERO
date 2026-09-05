import { auth, db, storage } from './firebase-config.js';
import { collection, getDocs, doc, getDoc, updateDoc, addDoc, deleteDoc, arrayUnion, arrayRemove, serverTimestamp, query, where, writeBatch, onSnapshot, increment } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-auth.js";
import { ref as storageRef, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-storage.js";
import { calculateStatus, escapeCssUrl } from './utils.js';
import { checkEmailVerification, isEmailVerified } from './auth-guard.js';

let allTournaments = [];
let currentJoiningId = null;
let currentEditingTournament = null;
let swapSourceIndex = null;
let userTeams = [];
let currentUserTeamIds = new Set();
let adminUnsubscribe = null;
let tournamentUnsubscribe = null;
let pendingApplicationsMap = new Map();

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
        const titleEl = document.getElementById('alertTitle'); 
        const msgEl = document.getElementById('alertMessage'); 
        const btnContainer = document.getElementById('alertButtons');
        if (!document.getElementById('customAlertModal')) { resolve(confirm(message)); return; }
        titleEl.textContent = title; 
        msgEl.innerHTML = message; 
        btnContainer.innerHTML = '';
        
        const cancelBtn = document.createElement('button'); 
        cancelBtn.className = "px-4 py-2 bg-white/5 border border-white/10 text-neutral-300 rounded-lg text-xs font-mono-tag hover:bg-white/10 transition-colors uppercase"; 
        cancelBtn.textContent = "Cancel"; 
        cancelBtn.onclick = () => { animateGenericClose('customAlertModal', 'alertBackdrop', 'alertBox'); resolve(false); };
        
        const confirmBtn = document.createElement('button'); 
        confirmBtn.className = "px-4 py-2 bg-[var(--gold)] text-black rounded-lg text-xs font-heading font-bold hover:bg-yellow-400 transition-colors uppercase"; 
        confirmBtn.textContent = "Confirm"; 
        confirmBtn.onclick = () => { animateGenericClose('customAlertModal', 'alertBackdrop', 'alertBox'); resolve(true); };
        
        btnContainer.appendChild(cancelBtn); 
        btnContainer.appendChild(confirmBtn); 
        animateGenericOpen('customAlertModal', 'alertBackdrop', 'alertBox');
    });
};
window.customConfirm = window.showCustomConfirm;

// --- TOURNAMENT STAFF & PERMISSIONS HELPER ---
export function isTournamentStaff(t, user) {
    if (!t || !user) return false;
    const cachedRole = String(sessionStorage.getItem('cz_user_role') || window.currentUserRole || '').toLowerCase();
    if (cachedRole === 'admin' || user.email === 'admin@champzero.com') return true;
    if (t.createdBy === user.uid) return true;
    
    // Check co-organizers & marshals list
    if (Array.isArray(t.coOrganizers)) {
        if (t.coOrganizers.some(c => (c.uid && c.uid === user.uid) || (c.email && c.email.toLowerCase() === user.email?.toLowerCase()) || (c.name && c.name.toLowerCase() === user.displayName?.toLowerCase()))) {
            return true;
        }
    }
    if (Array.isArray(t.coOrganizerUids) && t.coOrganizerUids.includes(user.uid)) {
        return true;
    }
    if (Array.isArray(t.marshals)) {
        if (t.marshals.some(m => (m.uid && m.uid === user.uid) || (m.email && m.email.toLowerCase() === user.email?.toLowerCase()) || (m.name && m.name.toLowerCase() === user.displayName?.toLowerCase()))) {
            return true;
        }
    }
    return false;
}
window.isTournamentStaff = isTournamentStaff;

// --- TREE STYLES INJECTION ---
function injectTreeStyles() {
    if (document.getElementById('tree-bracket-styles')) return;
    const style = document.createElement('style');
    style.id = 'tree-bracket-styles';
    style.textContent = `
        :root {
            --tree-card-width: 210px;
            --tree-gap-parent: 40px;
            --tree-gap-child: 20px;
            --gf-connector-width: 36px;
            --gf-padding-left: 8px;
            --gf-header-offset: calc(var(--gf-connector-width) + var(--gf-padding-left));
        }
        @media (max-width: 768px) {
            :root {
                --tree-card-width: 150px;
                --tree-gap-parent: 20px;
                --tree-gap-child: 15px;
                --gf-connector-width: 20px;
                --gf-padding-left: 4px;
            }
            .tree-match-card { font-size: 0.75rem !important; }
            .header-item { font-size: 0.7rem !important; }
        }
        .bracket-scroll-container {
            display: flex;
            flex-direction: column;
            align-items: flex-start;
            padding: 12px;
            overflow: auto;
            -webkit-overflow-scrolling: touch;
            height: 100%;
            min-height: 340px;
        }
        .bracket-header-row {
            display: flex;
            flex-direction: row;
            margin-bottom: 16px;
            padding-left: 40px;
            min-width: max-content;
        }
        .header-item {
            width: var(--tree-card-width);
            display: flex;
            flex-direction: row;
            justify-content: center;
            align-items: center;
            gap: 6px;
            font-weight: 800;
            color: var(--gold);
            text-transform: uppercase;
            letter-spacing: 0.06em;
            font-size: 0.75rem;
            margin-right: calc(var(--tree-gap-parent) + var(--tree-gap-child));
            flex-shrink: 0;
            position: relative;
            font-family: 'Space Mono', monospace;
            white-space: nowrap;
        }
        .header-item.gf-header {
            margin-left: var(--gf-header-offset) !important;
            margin-right: 0 !important;
        }
        .header-item::after {
            content: '';
            position: absolute;
            bottom: -6px;
            left: 50%;
            transform: translateX(-50%);
            width: 35%;
            height: 1.5px;
            background: var(--gold);
        }
        .wrapper {
            display: flex;
            align-items: center;
            padding: 0;
            min-width: max-content;
        }
        .item { display: flex; flex-direction: row; align-items: center; }
        .item-parent {
            position: relative;
            margin-left: var(--tree-gap-parent);
            display: flex;
            align-items: center;
            z-index: 10;
        }
        .item-parent::after {
            position: absolute;
            content: '';
            width: var(--tree-gap-parent);
            height: 1.5px;
            left: 0;
            top: 50%;
            background-color: var(--line-color, rgba(255, 255, 255, 0.2));
            transform: translateX(-100%);
        }
        .item-childrens { display: flex; flex-direction: column; justify-content: center; }
        .item-child {
            display: flex;
            align-items: center;
            justify-content: flex-end;
            margin: 4px 0;
            position: relative;
            padding-right: var(--tree-gap-child);
        }
        .item-child::before {
            content: '';
            position: absolute;
            background-color: var(--line-color, rgba(255, 255, 255, 0.2));
            right: 0;
            top: 50%;
            width: var(--tree-gap-child);
            height: 1.5px;
        }
        .item-child::after {
            content: '';
            position: absolute;
            background-color: var(--line-color, rgba(255, 255, 255, 0.2));
            right: 0;
            width: 1.5px;
        }
        .item-child:first-child::after { top: 50%; height: calc(50% + 5px); }
        .item-child:last-child::after { top: auto; bottom: 50%; height: calc(50% + 5px); }
        .item-child:only-child::after { display: none; }
        .item-childrens:empty + .item-parent::after { display: none; }
        .gf-connector-line {
            width: var(--gf-connector-width);
            height: 1.5px;
            background-color: rgba(255, 255, 255, 0.2);
        }
        .gf-wrapper { padding-left: var(--gf-padding-left); }
        .tree-match-card {
            background: var(--dark-card, #111116);
            border: 1px solid rgba(255, 255, 255, 0.08);
            border-left: 3px solid var(--gold, #FFD700);
            border-radius: 6px;
            padding: 8px 10px;
            width: var(--tree-card-width);
            flex-shrink: 0;
            box-shadow: 0 4px 15px rgba(0, 0, 0, 0.6);
            display: flex;
            flex-direction: column;
            justify-content: center;
            position: relative;
            z-index: 20;
            transition: transform 0.2s;
        }
        .tree-match-card:hover { transform: translateY(-2px); border-color: rgba(255, 215, 0, 0.3); }
        .tree-match-card.bye-card {
            border: 1px dashed rgba(255, 255, 255, 0.15);
            background: transparent;
            box-shadow: none;
        }
        .bracket-fullscreen-mode {
            position: fixed !important;
            inset: 0 !important;
            width: 100vw !important;
            height: 100vh !important;
            max-width: 100vw !important;
            max-height: 100vh !important;
            z-index: 9999 !important;
            border-radius: 0 !important;
            padding: 16px 20px !important;
            background: #0A0A0E !important;
            border: none !important;
            margin: 0 !important;
        }
        .bracket-fullscreen-mode #bracketViewport {
            min-height: calc(100vh - 80px) !important;
            height: calc(100vh - 80px) !important;
        }
    `;
    document.head.appendChild(style);
}

// --- INITIALIZATION ---
function initTournaments() {
    injectTreeStyles();
    fetchTournaments();

    if (qs('#searchName')) qs('#searchName').addEventListener('input', renderTournaments);
    if (qs('#filterGame')) qs('#filterGame').addEventListener('change', renderTournaments);
    if (qs('#filterStatus')) qs('#filterStatus').addEventListener('change', renderTournaments);
    if (qs('#sortBy')) qs('#sortBy').addEventListener('change', renderTournaments);

    const createForm = qs('#createForm');
    if (createForm) { 
        createForm.addEventListener('submit', async (e) => { 
            e.preventDefault(); 
            await handleCreateTournament(); 
        }); 
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initTournaments);
} else {
    initTournaments();
}

onAuthStateChanged(auth, async (user) => {
    if (user) { 
        if (user.email === 'admin@champzero.com') {
            window.currentUserRole = 'admin';
            try { sessionStorage.setItem('cz_user_role', 'admin'); } catch (e) {}
        }
        await checkCreatorPermissions(user); 
        fetchUserTeamIds(user); 
        renderTournaments();
        if (window.currentEditingTournament) {
            renderTournamentView(window.currentEditingTournament);
            if (typeof window.updateOrganizerPermissions === 'function') {
                window.updateOrganizerPermissions(window.currentEditingTournament);
            }
        }
    } else { 
        currentUserTeamIds.clear(); 
        window.currentUserRole = 'guest';
        try { sessionStorage.removeItem('cz_user_role'); } catch (e) {}
        renderTournaments();
        if (window.currentEditingTournament) {
            renderTournamentView(window.currentEditingTournament);
            if (typeof window.updateOrganizerPermissions === 'function') {
                window.updateOrganizerPermissions(window.currentEditingTournament);
            }
        }
    }
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
        if (window.currentEditingTournament && window.currentEditingTournament.participants) {
            renderParticipantsList(window.currentEditingTournament.participants);
        }
    } catch (e) { console.error(e); }
}

async function checkCreatorPermissions(user) {
    if (!user) return;
    try {
        if (user.email === 'admin@champzero.com') {
            window.currentUserRole = 'admin';
            try { sessionStorage.setItem('cz_user_role', 'admin'); } catch (e) {}
        }
        const userRef = doc(db, "users", user.uid);
        const userSnap = await getDoc(userRef);
        if (userSnap.exists()) {
            const role = userSnap.data().role || 'user';
            window.currentUserRole = role;
            try { sessionStorage.setItem('cz_user_role', role); } catch (e) {}
        }
        const controls = qs('#creator-controls');
        if (controls) controls.classList.remove('hidden');
        if (window.currentEditingTournament && typeof window.updateOrganizerPermissions === 'function') {
            window.updateOrganizerPermissions(window.currentEditingTournament);
        }
    } catch (error) { console.error(error); }
}

function getGrandFinalMatch(matches) {
    if (!matches || !Array.isArray(matches) || !matches.length) return null;
    let gf = matches.find(m => m.id === 'GF-1');
    if (gf) return gf;
    const nonBronze = matches.filter(m => !m.isBronzeMatch && m.id !== 'M-3RD' && m.id !== 'BM-1' && m.id !== '3RD-1');
    if (!nonBronze.length) return null;
    gf = nonBronze.find(m => !m.nextMatchId || !matches.some(other => other.id === m.nextMatchId));
    if (gf) return gf;
    return nonBronze.reduce((prev, curr) => (curr.round > prev.round) ? curr : prev, nonBronze[0]);
}
window.getGrandFinalMatch = getGrandFinalMatch;

function isTournamentCompleteCheck(t) {
    if (!t) return false;
    if (t.status === 'Completed' || t.isCompleted === true) return true;
    if (!t.isStarted || !t.matches || !Array.isArray(t.matches) || !t.matches.length) return false;

    if (t.format === 'Round Robin') {
        return t.matches.every(m => m.winner !== null && m.winner !== undefined && m.winner !== '');
    }

    const gfMatch = getGrandFinalMatch(t.matches);
    if (!gfMatch || !gfMatch.winner) return false;

    const bronzeMatch = t.matches.find(m => m.id === 'M-3RD' || m.id === 'BM-1' || m.id === '3RD-1' || m.isBronzeMatch);
    if (bronzeMatch && bronzeMatch.team1 && bronzeMatch.team2 && bronzeMatch.team1 !== 'TBD' && bronzeMatch.team2 !== 'TBD' && bronzeMatch.team1 !== 'BYE' && bronzeMatch.team2 !== 'BYE') {
        if (!bronzeMatch.winner) return false;
    }

    return true;
}
window.isTournamentCompleteCheck = isTournamentCompleteCheck;

function getTournamentStatus(t) {
    if (!t) return 'Unknown';
    if (t.archived === true || t.isArchived === true || t.status === 'Archived') return 'Archived';
    if (t.status === 'Cancelled' || t.isCancelled) return 'Cancelled';
    if (t.status === 'Completed' || isTournamentCompleteCheck(t)) return 'Completed';
    if (t.isStarted) return 'Ongoing';
    const calc = calculateStatus(t.date, t.endDate);
    return (calc === 'Ongoing') ? 'Ready to Start' : calc;
}

// --- TOURNAMENT CREATION 4-STEP WIZARD CONTROLLER ---
let currentCreateStep = 1;
const TOTAL_CREATE_STEPS = 4;

function syncCreateWizardSummary() {
    const gameSelect = qs('#c-game-select')?.value;
    const gameOther = qs('#c-game-other')?.value?.trim();
    const game = (gameSelect === 'Others' && gameOther) ? gameOther : (gameSelect || 'Valorant');
    
    const format = qs('#c-format')?.value || 'Single Elimination';
    const teams = qs('#c-max-teams')?.value || '8';
    const prize = qs('#c-prize')?.value || '0';
    const pType = qs('#c-payment-type')?.value || 'free';
    const fee = qs('#c-entry-fee')?.value || '0';
    const curr = qs('#c-entry-currency')?.value || 'PHP';

    const gameEl = qs('#createSummaryGame');
    const formatEl = qs('#createSummaryFormat');
    const prizeEl = qs('#createSummaryPrize');
    const feeEl = qs('#createSummaryFee');

    if (gameEl) gameEl.textContent = game;
    if (formatEl) formatEl.textContent = `${format} (${teams} Teams)`;
    if (prizeEl) prizeEl.textContent = `₱${parseFloat(prize || 0).toLocaleString()}`;
    if (feeEl) feeEl.textContent = pType === 'free' ? 'Free Entry' : `${curr} ${parseFloat(fee || 0).toLocaleString()}`;
}
window.syncCreateWizardSummary = syncCreateWizardSummary;

function validateCurrentCreateStep(step) {
    if (step === 1) {
        const name = qs('#c-name')?.value?.trim();
        if (!name) {
            if (window.showToast) window.showToast("Required Field", "Please enter a Tournament Name.", "error");
            qs('#c-name')?.focus();
            return false;
        }
        const gameSelect = qs('#c-game-select')?.value;
        const gameOther = qs('#c-game-other')?.value?.trim();
        if (gameSelect === 'Others' && !gameOther) {
            if (window.showToast) window.showToast("Required Field", "Please specify the custom game title.", "error");
            qs('#c-game-other')?.focus();
            return false;
        }
    } else if (step === 2) {
        const maxTeams = parseInt(qs('#c-max-teams')?.value);
        if (isNaN(maxTeams) || maxTeams < 2) {
            if (window.showToast) window.showToast("Validation Error", "Max teams must be at least 2.", "error");
            qs('#c-max-teams')?.focus();
            return false;
        }
        const date = qs('#c-date')?.value;
        if (!date) {
            if (window.showToast) window.showToast("Required Field", "Please select a Start Date.", "error");
            qs('#c-date')?.focus();
            return false;
        }
    } else if (step === 3) {
        const prize = qs('#c-prize')?.value;
        if (prize === '' || isNaN(parseFloat(prize)) || parseFloat(prize) < 0) {
            if (window.showToast) window.showToast("Required Field", "Please set the Total Prize Pool (enter 0 if no cash prize).", "error");
            qs('#c-prize')?.focus();
            return false;
        }
        const pType = qs('#c-payment-type')?.value;
        if (pType !== 'free') {
            const fee = parseFloat(qs('#c-entry-fee')?.value);
            if (isNaN(fee) || fee <= 0) {
                if (window.showToast) window.showToast("Required Field", "Please specify an Entry Fee amount for paid tournaments.", "error");
                qs('#c-entry-fee')?.focus();
                return false;
            }
        }
    }
    return true;
}
window.validateCurrentCreateStep = validateCurrentCreateStep;

function goToCreateStep(step) {
    if (step < 1) step = 1;
    if (step > TOTAL_CREATE_STEPS) step = TOTAL_CREATE_STEPS;

    // Validate if trying to move forward
    if (step > currentCreateStep) {
        for (let s = currentCreateStep; s < step; s++) {
            if (!validateCurrentCreateStep(s)) return;
        }
    }

    currentCreateStep = step;

    // Update Step Panes
    for (let i = 1; i <= TOTAL_CREATE_STEPS; i++) {
        const pane = qs(`#createStepPane-${i}`);
        if (pane) {
            pane.classList.toggle('hidden', i !== currentCreateStep);
        }
    }

    // Update Step Nodes
    document.querySelectorAll('.create-step-node').forEach(node => {
        const nodeStep = parseInt(node.dataset.step);
        const circle = node.querySelector('.step-circle');
        const label = node.querySelector('.step-label');

        if (nodeStep === currentCreateStep) {
            // Active Step
            if (circle) {
                circle.className = "step-circle w-8 h-8 rounded-full flex items-center justify-center font-heading font-extrabold text-xs transition-all bg-[#FFD700] text-black shadow-[0_0_15px_rgba(255,215,0,0.35)] ring-4 ring-[#FFD700]/20";
                circle.textContent = nodeStep;
            }
            if (label) label.className = "step-label text-[10px] font-mono-tag font-bold text-[#FFD700] uppercase tracking-wider";
        } else if (nodeStep < currentCreateStep) {
            // Completed Step
            if (circle) {
                circle.className = "step-circle w-8 h-8 rounded-full flex items-center justify-center font-heading font-bold text-xs transition-all bg-[#1c1a0e] text-[#FFD700] border border-[#FFD700]/40";
                circle.innerHTML = `<svg class="w-4 h-4 text-[#FFD700]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"/></svg>`;
            }
            if (label) label.className = "step-label text-[10px] font-mono-tag font-bold text-neutral-300 uppercase tracking-wider";
        } else {
            // Upcoming Step
            if (circle) {
                circle.className = "step-circle w-8 h-8 rounded-full flex items-center justify-center font-heading font-bold text-xs transition-all bg-[#14141A] text-neutral-400 border border-white/15";
                circle.textContent = nodeStep;
            }
            if (label) label.className = "step-label text-[10px] font-mono-tag font-bold text-neutral-400 uppercase tracking-wider";
        }
    });

    // Update Progress Bar
    const progressBar = qs('#createWizardProgressBar');
    if (progressBar) {
        const percent = ((currentCreateStep - 1) / (TOTAL_CREATE_STEPS - 1)) * 100;
        progressBar.style.width = `${percent}%`;
    }

    // Update Navigation Buttons
    const prevBtn = qs('#createWizardPrevBtn');
    const nextBtn = qs('#createWizardNextBtn');
    const submitBtn = qs('#createWizardSubmitBtn');

    if (prevBtn) prevBtn.classList.toggle('hidden', currentCreateStep === 1);
    
    if (nextBtn) {
        nextBtn.classList.toggle('hidden', currentCreateStep === TOTAL_CREATE_STEPS);
        const nextLabels = ["", "Next: Format →", "Next: Prize & Fee →", "Next: Rules & Launch →"];
        nextBtn.innerHTML = nextLabels[currentCreateStep] || "Next →";
    }

    if (submitBtn) {
        submitBtn.classList.toggle('hidden', currentCreateStep !== TOTAL_CREATE_STEPS);
        const form = qs('#createForm');
        const isEditing = form && form.dataset && form.dataset.editId;
        submitBtn.innerHTML = isEditing ? "Update Tournament" : "Launch Tournament";
    }

    if (currentCreateStep === 4) {
        syncCreateWizardSummary();
    }
}
window.goToCreateStep = goToCreateStep;

function nextCreateStep() {
    if (validateCurrentCreateStep(currentCreateStep)) {
        goToCreateStep(currentCreateStep + 1);
    }
}
window.nextCreateStep = nextCreateStep;

function prevCreateStep() {
    goToCreateStep(currentCreateStep - 1);
}
window.prevCreateStep = prevCreateStep;

// --- CREATE & EDIT TOURNAMENT (IN-PAGE ORGANIZER ACCESS) ---
let isSubmittingTournament = false;
async function handleCreateTournament() {
    if (isSubmittingTournament) return;
    isSubmittingTournament = true;

    const submitBtn = qs('#createWizardSubmitBtn') || qs('#createForm button[type="submit"]');
    const form = qs('#createForm');
    const editId = form?.dataset?.editId;

    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = editId ? "Updating..." : "Creating...";
    }

    try {
        const auth = getAuth();
        const user = auth.currentUser;
        if (!user) throw new Error("You must be logged in.");

        if (!await checkEmailVerification(editId ? "update a tournament" : "create and host a tournament")) {
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.textContent = editId ? "Update Tournament" : "Create Tournament";
            }
            isSubmittingTournament = false;
            return;
        }

        const gameSelect = qs('#c-game-select').value;
        const gameOther = qs('#c-game-other').value;
        const finalGameTitle = (gameSelect === 'Others' && gameOther.trim() !== "")
            ? gameOther.trim()
            : gameSelect;

        const name = qs('#c-name').value;
        const venueType = qs('#c-venue-type')?.value || 'Online';
        const venueLoc = qs('#c-venue-location')?.value?.trim() || '';
        const venue = venueType === 'LAN' && venueLoc ? `LAN: ${venueLoc}` : venueType;
        const discordLink = qs('#c-discord')?.value?.trim() || '';

        const format = qs('#c-format').value;
        const maxTeams = parseInt(qs('#c-max-teams').value) || 8;
        const prize = qs('#c-prize').value || "0";

        // DYNAMIC PRIZE SPLIT
        const s1 = parseInt(qs('#c-prize-1st')?.value);
        const is2ndVisible = qs('#prizeInputWrap-2nd') && !qs('#prizeInputWrap-2nd').classList.contains('hidden');
        const is3rdVisible = qs('#prizeInputWrap-3rd') && !qs('#prizeInputWrap-3rd').classList.contains('hidden');
        const s2 = is2ndVisible ? (parseInt(qs('#c-prize-2nd')?.value) || 0) : 0;
        const s3 = is3rdVisible ? (parseInt(qs('#c-prize-3rd')?.value) || 0) : 0;

        const prizeSplit = {
            first: isNaN(s1) ? 100 : s1,
            second: s2,
            third: s3
        };

        const startDate = qs('#c-date').value;
        const startTime = qs('#c-time')?.value || '19:00';
        const endDate = qs('#c-end-date')?.value || '';
        const endTime = qs('#c-end-time')?.value || '';
        const desc = qs('#c-desc').value || "";
        const rules = qs('#c-rules')?.value?.trim() || "";
        
        let bannerURL = qs('#c-banner')?.value || "";
        if (window._tournamentBannerFile) {
            const tourneyFolder = (name || 'tournament').trim().replace(/[^a-zA-Z0-9_-]/g, '_');
            const fileRef = storageRef(storage, `tournament-banners/${tourneyFolder}/${Date.now()}_${window._tournamentBannerFile.name}`);
            const snapshot = await uploadBytes(fileRef, window._tournamentBannerFile);
            bannerURL = await getDownloadURL(snapshot.ref);
            window._tournamentBannerFile = null;
        } else if (!bannerURL) {
            bannerURL = "pictures/cz_logo.png";
        }

        let proofURL = "";
        const paymentType = qs('#c-payment-type')?.value || 'free';
        const isPaid = (paymentType === 'manual' || paymentType === 'automatic');
        const entryType = isPaid ? 'Paid' : 'Free';
        const entryFee = isPaid ? (parseFloat(qs('#c-entry-fee')?.value) || 0) : 0;
        const entryCurrency = isPaid ? (qs('#c-entry-currency')?.value || 'PHP') : null;

        if (paymentType === 'manual' && window._proofFile) {
            const tournamentName = qs('#c-name').value.trim().replace(/\s+/g, '_');
            const fileRef = storageRef(storage, `payment-proofs/${tournamentName}/${window._proofFile.name}`);
            const snapshot = await uploadBytes(fileRef, window._proofFile);
            proofURL = await getDownloadURL(snapshot.ref);
        }

        const bannerPosY = qs('#c-banner-pos-y')?.value || 50;
        const bannerPosition = `50% ${bannerPosY}%`;
        const bannerFit = qs('#c-banner-fit')?.value || 'cover';

        const registrationType = qs('#c-registration-type')?.value || 'team';
        const teamSize = parseInt(qs('#c-team-size')?.value) || 5;
        const feeType = qs('#c-fee-type')?.value || (teamSize === 1 || registrationType === 'solo' ? 'solo' : 'team');

        const tourneyData = {
            name: name,
            game: finalGameTitle,
            venue: venue,
            venueType: venueType,
            venueLocation: venueLoc,
            discordLink: discordLink,
            format: format,
            maxTeams: maxTeams,
            registrationType: registrationType,
            teamSize: teamSize,
            prize: prize,
            prizeSplit: prizeSplit,
            date: startDate,
            time: startTime,
            startTime: startTime,
            endDate: endDate,
            endTime: endTime,
            description: desc,
            rules: rules,
            banner: bannerURL,
            bannerPosition: bannerPosition,
            bannerFit: bannerFit,
            entryType: entryType,
            paymentType: paymentType,
            entryFee: entryFee,
            feeType: feeType,        
            entryCurrency: entryCurrency, 
            paymentQrUrl: proofURL,
            ...(proofURL && { paymentProofURL: proofURL }),
            createdBy: user.uid,
            createdAt: serverTimestamp(),
            organizerVerified: true,
            isVerified: true,
            status: 'Open',
            isStarted: false,
            participants: [],
            matches: []
        };

        if (editId) {
            if (qs('#c-status')) {
                tourneyData.status = qs('#c-status').value || 'Open';
                tourneyData.isCancelled = (tourneyData.status === 'Cancelled');
            }
            tourneyData.updatedAt = serverTimestamp();
            await updateDoc(doc(db, "tournaments", editId), tourneyData);
            if (window.showSuccessToast) window.showSuccessToast("Success", "Tournament updated successfully!");
        } else {
            tourneyData.createdBy = user.uid;
            tourneyData.createdAt = serverTimestamp();
            tourneyData.status = 'Open';
            tourneyData.isCancelled = false;
            tourneyData.isStarted = false;
            tourneyData.participants = [];
            tourneyData.soloQueue = [];
            tourneyData.matches = [];
            await addDoc(collection(db, "tournaments"), tourneyData);
            if (window.showSuccessToast) window.showSuccessToast("Success", "Tournament Created!");
        }

        window._proofFile = null;
        window._proofPreviewURL = null;
        window._tournamentBannerFile = null;

        if (window.closeModal) window.closeModal('createModal');

        fetchTournaments();
        form.reset();
        delete form.dataset.editId;
        qs('#c-game-select').value = "Valorant";
        qs('#c-game-other').classList.add('hidden');
        if (qs('#c-rules')) qs('#c-rules').value = '';
        if (qs('#c-banner')) qs('#c-banner').value = '';
        if (qs('#c-banner-file')) qs('#c-banner-file').value = '';
        if (qs('#c-banner-filename')) qs('#c-banner-filename').textContent = 'Click or drag banner image here';
        if (qs('#c-banner-preview-img')) qs('#c-banner-preview-img').src = 'pictures/cz_logo.png';
        const bannerDropzone = qs('#c-banner-dropzone');
        if (bannerDropzone) {
            bannerDropzone.classList.remove('border-emerald-500/50', 'bg-emerald-500/5');
            bannerDropzone.classList.add('border-white/15');
        }
        if (qs('#c-registration-type')) qs('#c-registration-type').value = "team";
        if (qs('#c-team-size')) qs('#c-team-size').value = "5";
        if (qs('#c-status-wrap')) qs('#c-status-wrap').classList.add('hidden');
        if (qs('#c-payment-type')) qs('#c-payment-type').value = "free";
        if (window.toggleEntryType) window.toggleEntryType();
        if (window.setPrizeTierPreset) window.setPrizeTierPreset('winner_takes_all');
        if (window.goToCreateStep) window.goToCreateStep(1);

    } catch (error) {
        console.error("Error saving tournament:", error);
        alert("Failed to save tournament: " + error.message);
    } finally {
        isSubmittingTournament = false;
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = editId ? "Update Tournament" : "Launch Tournament";
        }
    }
}

function openEditTournamentModal(t) {
    if (typeof t === 'string') {
        t = (allTournaments && allTournaments.find(item => item.id === t)) || currentEditingTournament || window.currentEditingTournament;
    } else if (!t) {
        t = currentEditingTournament || window.currentEditingTournament || (allTournaments && allTournaments.find(item => item.id === window._currentTournamentId));
    }
    if (!t) return;

    const modal = document.getElementById('createModal');
    if (!modal) return;

    const title = document.getElementById('createModalTitle');
    const submitBtn = document.querySelector('#createForm button[type="submit"]');
    const form = document.getElementById('createForm');

    if (title) title.textContent = "Edit Tournament";
    if (submitBtn) submitBtn.textContent = "Update Tournament";
    if (form) form.dataset.editId = t.id;

    if (qs('#c-name')) qs('#c-name').value = t.name || '';
    
    const standardGames = ['Valorant', 'Mobile Legends: Bang Bang', 'Honor of Kings'];
    if (standardGames.includes(t.game)) {
        if (qs('#c-game-select')) qs('#c-game-select').value = t.game;
        if (qs('#c-game-other')) { qs('#c-game-other').classList.add('hidden'); qs('#c-game-other').value = ''; }
    } else {
        if (qs('#c-game-select')) qs('#c-game-select').value = 'Others';
        if (qs('#c-game-other')) { qs('#c-game-other').classList.remove('hidden'); qs('#c-game-other').value = t.game || ''; }
    }

    if (qs('#c-venue-type')) qs('#c-venue-type').value = t.venueType || 'Online';
    if (qs('#c-venue-location')) {
        qs('#c-venue-location').value = t.venueLocation || '';
        if (t.venueType === 'LAN') qs('#c-venue-location').classList.remove('hidden');
        else qs('#c-venue-location').classList.add('hidden');
    }

    if (qs('#c-discord')) qs('#c-discord').value = t.discordLink || '';
    if (qs('#c-format')) qs('#c-format').value = t.format || 'Single Elimination';
    if (qs('#c-max-teams')) qs('#c-max-teams').value = t.maxTeams || 8;
    if (qs('#c-registration-type')) qs('#c-registration-type').value = t.registrationType || 'team';
    if (qs('#c-team-size')) qs('#c-team-size').value = t.teamSize || 5;
    
    const statusWrap = document.getElementById('c-status-wrap');
    if (statusWrap) statusWrap.classList.remove('hidden');
    if (qs('#c-status')) qs('#c-status').value = t.status || 'Open';

    if (qs('#c-prize')) qs('#c-prize').value = t.prize || '';

    const split = t.prizeSplit || { first: 100, second: 0, third: 0 };
    const s1 = split.first !== undefined ? Number(split.first) : 100;
    const s2 = split.second !== undefined ? Number(split.second) : 0;
    const s3 = split.third !== undefined ? Number(split.third) : 0;

    const wrap2 = document.getElementById('prizeInputWrap-2nd');
    const wrap3 = document.getElementById('prizeInputWrap-3rd');
    const addBtnWrap = document.getElementById('addPrizeTierWrap');

    if (qs('#c-prize-1st')) qs('#c-prize-1st').value = s1;
    if (qs('#c-prize-2nd')) qs('#c-prize-2nd').value = s2;
    if (qs('#c-prize-3rd')) qs('#c-prize-3rd').value = s3;

    if (wrap2) wrap2.classList.toggle('hidden', s2 <= 0);
    if (wrap3) wrap3.classList.toggle('hidden', s3 <= 0);
    if (addBtnWrap) addBtnWrap.classList.toggle('hidden', s2 > 0 && s3 > 0);

    if (s1 === 100 && s2 === 0 && s3 === 0) {
        if (window.updatePresetButtonsState) window.updatePresetButtonsState('winner_takes_all');
    } else if (s1 === 70 && s2 === 30 && s3 === 0) {
        if (window.updatePresetButtonsState) window.updatePresetButtonsState('top_2');
    } else if (s1 === 60 && s2 === 30 && s3 === 10) {
        if (window.updatePresetButtonsState) window.updatePresetButtonsState('top_3');
    } else {
        if (window.updatePresetButtonsState) window.updatePresetButtonsState('custom');
    }
    if (window.handlePrizeSplitInput) window.handlePrizeSplitInput();

    const paymentType = t.paymentType || (t.entryType === 'Paid' ? 'manual' : (t.entryType ? String(t.entryType).toLowerCase() : 'free'));
    if (qs('#c-payment-type')) qs('#c-payment-type').value = paymentType;
    if (window.toggleEntryType) window.toggleEntryType();

    if (paymentType !== 'free') {
        if (qs('#c-entry-fee')) qs('#c-entry-fee').value = t.entryFee || '';
        if (qs('#c-entry-currency')) qs('#c-entry-currency').value = t.entryCurrency || 'PHP';
        if (qs('#c-fee-type')) qs('#c-fee-type').value = t.feeType || (Number(t.teamSize) === 1 || t.registrationType === 'solo' ? 'solo' : 'team');
        if (window.updatePlatformFeePreview) window.updatePlatformFeePreview();
        if (paymentType === 'manual' && t.paymentProofURL) {
            window._proofPreviewURL = t.paymentProofURL;
            const proofFilename = document.getElementById('proof-filename');
            if (proofFilename) proofFilename.textContent = 'Existing QR loaded';
            const proofPreview = document.getElementById('proof-preview-btn-wrap');
            if (proofPreview) proofPreview.classList.remove('hidden');
        }
    }

    if (qs('#c-date')) qs('#c-date').value = t.date ? (t.date.toDate ? t.date.toDate().toISOString().split('T')[0] : t.date) : '';
    if (qs('#c-time')) qs('#c-time').value = t.startTime || t.time || '19:00';
    if (qs('#c-end-date')) qs('#c-end-date').value = t.endDate ? (t.endDate.toDate ? t.endDate.toDate().toISOString().split('T')[0] : t.endDate) : '';
    if (qs('#c-end-time')) qs('#c-end-time').value = t.endTime || '';
    if (qs('#c-desc')) qs('#c-desc').value = t.description || '';
    if (qs('#c-rules')) qs('#c-rules').value = t.rules || '';
    if (qs('#c-banner')) qs('#c-banner').value = t.banner || '';

    window._tournamentBannerFile = null;
    const bannerFilenameEl = qs('#c-banner-filename');
    const bannerDropzoneEl = qs('#c-banner-dropzone');
    const bannerFileInput = qs('#c-banner-file');
    if (bannerFileInput) bannerFileInput.value = '';

    if (t.banner) {
        if (qs('#c-banner-preview-img')) qs('#c-banner-preview-img').src = t.banner;
        if (bannerFilenameEl) bannerFilenameEl.textContent = 'Existing Banner (Click or drag to replace)';
        if (bannerDropzoneEl) {
            bannerDropzoneEl.classList.remove('border-emerald-500/50', 'bg-emerald-500/5');
            bannerDropzoneEl.classList.add('border-white/15');
        }
    } else {
        if (qs('#c-banner-preview-img')) qs('#c-banner-preview-img').src = 'pictures/cz_logo.png';
        if (bannerFilenameEl) bannerFilenameEl.textContent = 'Click or drag banner image here';
    }

    if (qs('#c-banner-pos-y')) {
        let posY = 50;
        if (t.bannerPosition) {
            const matches = t.bannerPosition.match(/(\d+)%/g);
            if (matches && matches.length >= 2) posY = parseInt(matches[1]);
            else if (matches && matches[0]) posY = parseInt(matches[0]);
        }
        qs('#c-banner-pos-y').value = posY;
    }
    if (qs('#c-banner-fit')) qs('#c-banner-fit').value = t.bannerFit || 'cover';
    if (window.updateCreateModalBannerPreview) window.updateCreateModalBannerPreview();
    if (window.goToCreateStep) window.goToCreateStep(1);

    modal.classList.remove('hidden');
    modal.classList.add('flex');
};

function parseFirestoreValue(val) {
    if (!val) return null;
    if (val.stringValue !== undefined) return val.stringValue;
    if (val.integerValue !== undefined) return parseInt(val.integerValue, 10);
    if (val.doubleValue !== undefined) return parseFloat(val.doubleValue);
    if (val.booleanValue !== undefined) return val.booleanValue;
    if (val.timestampValue !== undefined) return val.timestampValue;
    if (val.nullValue !== undefined) return null;
    if (val.arrayValue !== undefined) {
        return (val.arrayValue.values || []).map(v => parseFirestoreValue(v));
    }
    if (val.mapValue !== undefined) {
        const out = {};
        const fields = val.mapValue.fields || {};
        for (const k in fields) {
            out[k] = parseFirestoreValue(fields[k]);
        }
        return out;
    }
    return val;
}

function parseFirestoreDoc(doc) {
    const id = doc.name ? doc.name.split('/').pop() : (doc.id || '');
    const data = { id };
    const fields = doc.fields || {};
    for (const key in fields) {
        data[key] = parseFirestoreValue(fields[key]);
    }
    return data;
}

async function fetchTournaments() {
    const grid = qs('#tournamentGrid');
    if (!grid) return;
    grid.innerHTML = '<div class="col-span-full text-center text-neutral-500 py-16 font-mono-tag text-xs">Loading tournaments...</div>';

    let loaded = false;

    // 1. Fast Local Backend API
    const fetchLocalApi = async () => {
        const res = await fetch('/api/tournaments');
        const cType = res.headers.get('content-type') || '';
        if (!res.ok || !cType.includes('application/json')) {
            throw new Error('API HTTP ' + res.status + ' (non-JSON content)');
        }
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) return data;
        throw new Error('No items from API');
    };

    // 2. Direct Firestore REST endpoint
    const fetchRest = async () => {
        const res = await fetch('https://firestore.googleapis.com/v1/projects/champzero-92951/databases/(default)/documents/tournaments');
        if (!res.ok) throw new Error('REST HTTP ' + res.status);
        const data = await res.json();
        const items = (data.documents || []).map(parseFirestoreDoc);
        if (items.length > 0) return items;
        throw new Error('No documents from REST');
    };

    // 3. Firestore Client SDK
    const fetchSDK = async () => {
        const querySnapshot = await getDocs(collection(db, "tournaments"));
        const items = [];
        querySnapshot.forEach((doc) => { 
            items.push({ id: doc.id, ...doc.data() }); 
        });
        if (items.length > 0) return items;
        return items;
    };

    try {
        allTournaments = await Promise.any([fetchLocalApi(), fetchRest(), fetchSDK()]);
        loaded = true;
    } catch (allErrors) {
        console.warn("Parallel fetch attempts failed, trying individual fallbacks:", allErrors);
        try {
            allTournaments = await fetchRest();
            loaded = true;
        } catch (restErr) {
            try {
                allTournaments = await fetchSDK();
                loaded = true;
            } catch (sdkErr) {
                console.error("All tournament fetch attempts failed:", { restErr, sdkErr, allErrors });
            }
        }
    }

    if (loaded && Array.isArray(allTournaments)) {
        console.log(`[Tournaments] Successfully loaded ${allTournaments.length} tournament(s):`, allTournaments);
        renderTournaments();

        const params = new URLSearchParams(window.location.search);
        const tourneyId = params.get('id') || params.get('t');

        if (params.get('saved') === 'pending_payment') {
            if (window.showInfoToast) window.showInfoToast('Registration Saved! 📝', 'Your registration is saved. Complete your payment anytime before the tournament begins.');
            else if (window.showToast) window.showToast('Registration Saved', 'Your registration is saved. Complete payment anytime before tournament starts.');
        } else if (params.get('cancelled') === 'registration') {
            if (window.showWarningToast) window.showWarningToast('Registration Cancelled', 'Your tournament application has been withdrawn.');
            else if (window.showToast) window.showToast('Cancelled', 'Your application has been withdrawn.');
        } else if (params.get('payment') === 'success') {
            if (window.showSuccessToast) window.showSuccessToast('Payment Confirmed! 🏆', 'Your entry fee has been paid and your roster is confirmed.');
        }

        if (tourneyId && !window._currentTournamentId) {
            const found = allTournaments.find(t => t.id === tourneyId);
            if (found) openModal(found);
        }
    } else {
        grid.innerHTML = '<div class="col-span-full text-center text-red-500 py-16 font-mono-tag text-xs">Failed to load tournaments from database.</div>';
    }
}

function getTournamentTime(dateVal) {
    if (!dateVal) return 0;
    if (typeof dateVal.toMillis === 'function') return dateVal.toMillis();
    if (typeof dateVal.toDate === 'function') return dateVal.toDate().getTime();
    if (dateVal.seconds) return dateVal.seconds * 1000;
    const parsed = new Date(dateVal).getTime();
    return isNaN(parsed) ? 0 : parsed;
}

// --- TOURNAMENT SCOPE NAVIGATION (ALL, HOSTED BY ME, JOINED) ---
let currentTournamentScope = 'all'; // 'all' | 'hosted' | 'joined'
window.currentTournamentScope = currentTournamentScope;

function setTournamentScope(scope) {
    currentTournamentScope = scope;
    window.currentTournamentScope = scope;

    const tabs = [
        { id: 'tabAllTournaments', scope: 'all' },
        { id: 'tabMyTournaments', scope: 'hosted' },
        { id: 'tabJoinedTournaments', scope: 'joined' }
    ];

    tabs.forEach(tab => {
        const btn = document.getElementById(tab.id);
        if (!btn) return;
        const isActive = (tab.scope === currentTournamentScope);
        if (isActive) {
            btn.className = "px-3.5 py-1.5 rounded-lg bg-[#FFD700] text-black font-extrabold shadow-sm transition-all cursor-pointer flex items-center gap-1.5";
            const badge = btn.querySelector('span:last-child');
            if (badge) badge.className = "text-[10px] bg-black/20 text-black px-1.5 py-0.2 rounded-full font-mono-tag font-bold";
        } else {
            btn.className = "px-3.5 py-1.5 rounded-lg text-neutral-400 hover:text-white font-bold transition-all cursor-pointer flex items-center gap-1.5";
            const badge = btn.querySelector('span:last-child');
            if (badge) badge.className = "text-[10px] bg-white/10 text-neutral-300 px-1.5 py-0.2 rounded-full font-mono-tag font-bold";
        }
    });

    renderTournaments();
}
window.setTournamentScope = setTournamentScope;

function renderTournaments() {
    const grid = qs('#tournamentGrid');
    if (!grid) return;
    const searchName = (qs('#searchName')?.value || '').toLowerCase().trim();
    const filterGame = qs('#filterGame')?.value || '';
    const filterStatus = (qs('#filterStatus')?.value || '').toLowerCase();
    const sortBy = qs('#sortBy')?.value || 'dateDesc';

    const auth = getAuth();
    const currentUser = auth.currentUser;
    const currentRole = String(window.currentUserRole || '').toLowerCase();
    const isAdmin = (currentRole === 'admin' || (currentUser && currentUser.email === 'admin@champzero.com'));

    // Count statistics across all categories
    let totalAll = 0;
    let totalHosted = 0;
    let totalJoined = 0;

    allTournaments.forEach(t => {
        if (!t) return;
        const actualStatus = getTournamentStatus(t);
        const statusLower = (actualStatus || '').toLowerCase();
        const isArchived = (t.archived === true || t.isArchived === true || statusLower === 'archived');
        
        const isHost = currentUser && (
            t.createdBy === currentUser.uid ||
            (Array.isArray(t.coOrganizerUids) && t.coOrganizerUids.includes(currentUser.uid)) ||
            (Array.isArray(t.marshals) && t.marshals.includes(currentUser.uid)) ||
            isAdmin
        );

        const isParticipant = currentUser && (
            (Array.isArray(t.participants) && t.participants.some(p => {
                if (!p) return false;
                if (p.captainId === currentUser.uid || p.userId === currentUser.uid || p.uid === currentUser.uid || p.id === currentUser.uid) return true;
                if (p.captainEmail && p.captainEmail.toLowerCase() === currentUser.email?.toLowerCase()) return true;
                if (p.teamId && currentUserTeamIds && currentUserTeamIds.has(p.teamId)) return true;
                if (Array.isArray(p.members) && p.members.some(m => (m && (m.uid === currentUser.uid || m.id === currentUser.uid || (m.email && m.email.toLowerCase() === currentUser.email?.toLowerCase()))))) return true;
                return false;
            })) ||
            (Array.isArray(t.soloQueue) && t.soloQueue.some(s => s && (s.userId === currentUser.uid || s.uid === currentUser.uid || (s.email && s.email.toLowerCase() === currentUser.email?.toLowerCase()))))
        );

        if (!isArchived || isHost) totalAll++;
        if (isHost) totalHosted++;
        if (isParticipant) totalJoined++;
    });

    const cntAll = qs('#countAllTournaments');
    const cntHosted = qs('#countMyTournaments');
    const cntJoined = qs('#countJoinedTournaments');
    if (cntAll) cntAll.textContent = totalAll;
    if (cntHosted) cntHosted.textContent = totalHosted;
    if (cntJoined) cntJoined.textContent = totalJoined;

    let filtered = allTournaments.filter(t => {
        if (!t) return false;
        const matchesName = (t.name || '').toLowerCase().includes(searchName);
        const matchesGame = filterGame ? (t.game === filterGame) : true;
        const actualStatus = getTournamentStatus(t);
        const statusLower = (actualStatus || '').toLowerCase();
        const isArchived = (t.archived === true || t.isArchived === true || statusLower === 'archived');
        
        const isHost = currentUser && (
            t.createdBy === currentUser.uid ||
            (Array.isArray(t.coOrganizerUids) && t.coOrganizerUids.includes(currentUser.uid)) ||
            (Array.isArray(t.marshals) && t.marshals.includes(currentUser.uid)) ||
            isAdmin
        );

        const isParticipant = currentUser && (
            (Array.isArray(t.participants) && t.participants.some(p => {
                if (!p) return false;
                if (p.captainId === currentUser.uid || p.userId === currentUser.uid || p.uid === currentUser.uid || p.id === currentUser.uid) return true;
                if (p.captainEmail && p.captainEmail.toLowerCase() === currentUser.email?.toLowerCase()) return true;
                if (p.teamId && currentUserTeamIds && currentUserTeamIds.has(p.teamId)) return true;
                if (Array.isArray(p.members) && p.members.some(m => (m && (m.uid === currentUser.uid || m.id === currentUser.uid || (m.email && m.email.toLowerCase() === currentUser.email?.toLowerCase()))))) return true;
                return false;
            })) ||
            (Array.isArray(t.soloQueue) && t.soloQueue.some(s => s && (s.userId === currentUser.uid || s.uid === currentUser.uid || (s.email && s.email.toLowerCase() === currentUser.email?.toLowerCase()))))
        );

        // Filter based on Scope tab
        if (currentTournamentScope === 'hosted' && !isHost) return false;
        if (currentTournamentScope === 'joined' && !isParticipant) return false;

        // ARCHIVE PRIVACY ENFORCEMENT:
        // Once archived, ONLY organizers who host it or admins can view it
        if (isArchived) {
            if (!isHost) return false;
            if (filterStatus === 'archived' || currentTournamentScope === 'hosted') {
                return matchesName && matchesGame;
            }
            return false;
        }

        // If user specifically filtered for "archived" but this tournament is active:
        if (filterStatus === 'archived') {
            return false;
        }

        let matchesStatus = true;
        if (filterStatus) {
            if (filterStatus === 'cancelled') {
                matchesStatus = (statusLower === 'cancelled');
            } else if (filterStatus === 'past' && (statusLower === 'completed' || statusLower === 'past')) {
                matchesStatus = true;
            } else if (filterStatus === 'upcoming' && (statusLower === 'upcoming' || statusLower === 'ready to start')) {
                matchesStatus = true;
            } else {
                matchesStatus = (statusLower === filterStatus);
            }
        }
        return matchesName && matchesGame && matchesStatus;
    });

    filtered.sort((a, b) => {
        if (sortBy === 'dateDesc') return getTournamentTime(b.date) - getTournamentTime(a.date);
        if (sortBy === 'dateAsc') return getTournamentTime(a.date) - getTournamentTime(b.date);
        if (sortBy === 'prizeDesc') return (parseFloat(b.prize) || 0) - (parseFloat(a.prize) || 0);
        return 0;
    });

    grid.innerHTML = '';
    if (filtered.length === 0) { 
        if (currentTournamentScope === 'hosted') {
            grid.innerHTML = `
                <div class="col-span-full text-center text-neutral-400 py-16 font-mono-tag text-xs space-y-3 bg-[#0A0A0E] border border-white/10 rounded-2xl p-8">
                    <div class="w-12 h-12 rounded-full bg-[#FFD700]/10 border border-[#FFD700]/30 mx-auto flex items-center justify-center text-[#FFD700]">
                        <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"/></svg>
                    </div>
                    <div class="font-heading font-bold text-sm text-white uppercase tracking-wider">No Hosted Tournaments Found</div>
                    <p class="text-neutral-400 text-xs max-w-sm mx-auto">You haven't created or co-organized any tournaments matching this filter yet.</p>
                    <div class="pt-2">
                        <button type="button" onclick="openCreateModal()" class="px-5 py-2.5 bg-[#FFD700] text-black font-heading font-extrabold uppercase text-xs rounded-xl hover:bg-[#FFF099] transition-all shadow-[0_0_20px_rgba(255,215,0,0.3)] cursor-pointer">
                            + Host A Tournament Now
                        </button>
                    </div>
                </div>
            `;
        } else if (currentTournamentScope === 'joined') {
            grid.innerHTML = `
                <div class="col-span-full text-center text-neutral-400 py-16 font-mono-tag text-xs space-y-3 bg-[#0A0A0E] border border-white/10 rounded-2xl p-8">
                    <div class="w-12 h-12 rounded-full bg-emerald-500/10 border border-emerald-500/30 mx-auto flex items-center justify-center text-emerald-400">
                        <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
                    </div>
                    <div class="font-heading font-bold text-sm text-white uppercase tracking-wider">No Competing Tournaments Found</div>
                    <p class="text-neutral-400 text-xs max-w-sm mx-auto">You haven't registered in any tournaments matching this filter yet.</p>
                    <div class="pt-2">
                        <button type="button" onclick="window.setTournamentScope('all')" class="px-5 py-2.5 bg-white/10 text-white font-mono-tag uppercase text-xs rounded-xl hover:bg-white/20 transition-all border border-white/10 cursor-pointer">
                            Browse All Tournaments &rarr;
                        </button>
                    </div>
                </div>
            `;
        } else {
            grid.innerHTML = '<div class="col-span-full text-center text-neutral-500 py-12 font-mono-tag text-xs">No tournaments found.</div>'; 
        }
        return; 
    }

    console.log(`[Tournaments] Rendering ${filtered.length} active card(s) to #tournamentGrid.`);

    filtered.forEach(t => {
        try {
            const actualStatus = getTournamentStatus(t);
            const venueText = t.venue || (t.venueType === 'LAN' && t.venueLocation ? `LAN: ${t.venueLocation}` : (t.venueType || 'Online'));
            const pCount = (t.participants || []).length;
            const maxTeams = Number(t.maxTeams) || 8;
            const isSolo = (t.registrationType === 'solo' || Number(t.teamSize) === 1);
            const teamSize = Number(t.teamSize) || 5;
            const modePill = isSolo ? '1v1 SOLO' : `${teamSize}v${teamSize} SQUAD`;
            
            const isPaid = (t.paymentType === 'manual' || t.paymentType === 'automatic' || t.entryType === 'Paid');
            const entryFee = Number(t.entryFee) || 0;
            const feeType = t.feeType || (isSolo ? 'solo' : 'team');
            const feeSuffix = isSolo ? 'PLAYER' : (feeType === 'solo' ? 'PLAYER' : 'TEAM');
            const entryBadgeText = isPaid ? (entryFee > 0 ? `₱${entryFee.toLocaleString()} / ${feeSuffix}` : 'PAID ENTRY') : 'FREE ENTRY';
            const entryColor = isPaid ? 'text-amber-400' : 'text-emerald-400';

            const isHost = currentUser && (
                t.createdBy === currentUser.uid ||
                (Array.isArray(t.coOrganizerUids) && t.coOrganizerUids.includes(currentUser.uid)) ||
                (Array.isArray(t.marshals) && t.marshals.includes(currentUser.uid)) ||
                isAdmin
            );

            const isParticipant = currentUser && (
                (Array.isArray(t.participants) && t.participants.some(p => {
                    if (!p) return false;
                    if (p.captainId === currentUser.uid || p.userId === currentUser.uid || p.uid === currentUser.uid || p.id === currentUser.uid) return true;
                    if (p.captainEmail && p.captainEmail.toLowerCase() === currentUser.email?.toLowerCase()) return true;
                    if (p.teamId && currentUserTeamIds && currentUserTeamIds.has(p.teamId)) return true;
                    if (Array.isArray(p.members) && p.members.some(m => (m && (m.uid === currentUser.uid || m.id === currentUser.uid || (m.email && m.email.toLowerCase() === currentUser.email?.toLowerCase()))))) return true;
                    return false;
                })) ||
                (Array.isArray(t.soloQueue) && t.soloQueue.some(s => s && (s.userId === currentUser.uid || s.uid === currentUser.uid || (s.email && s.email.toLowerCase() === currentUser.email?.toLowerCase()))))
            );

            let roleBadgeHtml = '';
            if (currentUser && t.createdBy === currentUser.uid) {
                roleBadgeHtml = `<span class="bg-[#FFD700]/25 border border-[#FFD700]/60 text-[#FFD700] font-mono-tag text-[9px] font-extrabold px-2 py-0.5 rounded-md uppercase tracking-wider flex items-center gap-1.5 shadow-[0_0_10px_rgba(255,215,0,0.3)]"><span class="w-1.5 h-1.5 rounded-full bg-[#FFD700]"></span>YOUR TOURNAMENT</span>`;
            } else if (currentUser && Array.isArray(t.coOrganizerUids) && t.coOrganizerUids.includes(currentUser.uid)) {
                roleBadgeHtml = `<span class="bg-indigo-500/25 border border-indigo-400/60 text-indigo-300 font-mono-tag text-[9px] font-bold px-2 py-0.5 rounded-md uppercase tracking-wider flex items-center gap-1.5 shadow-[0_0_10px_rgba(99,102,241,0.25)]"><span class="w-1.5 h-1.5 rounded-full bg-indigo-400"></span>CO-HOST</span>`;
            } else if (currentUser && Array.isArray(t.marshals) && t.marshals.includes(currentUser.uid)) {
                roleBadgeHtml = `<span class="bg-purple-500/25 border border-purple-400/60 text-purple-300 font-mono-tag text-[9px] font-bold px-2 py-0.5 rounded-md uppercase tracking-wider flex items-center gap-1.5"><span class="w-1.5 h-1.5 rounded-full bg-purple-400"></span>MARSHAL</span>`;
            } else if (isParticipant) {
                roleBadgeHtml = `<span class="bg-emerald-500/25 border border-emerald-400/60 text-emerald-300 font-mono-tag text-[9px] font-bold px-2 py-0.5 rounded-md uppercase tracking-wider flex items-center gap-1.5"><span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>REGISTERED</span>`;
            }

            let statusBadgeHtml = '';
            if (actualStatus === 'Archived') {
                statusBadgeHtml = `<span class="bg-neutral-800/90 border border-neutral-600 text-neutral-300 font-mono-tag text-[9px] font-bold px-2.5 py-1 rounded-md uppercase tracking-wider flex items-center gap-1 shadow-sm">ARCHIVED</span>`;
            } else if (actualStatus === 'Cancelled') {
                statusBadgeHtml = `<span class="bg-red-950/80 border border-red-500/50 text-red-400 font-mono-tag text-[9px] font-bold px-2.5 py-1 rounded-md uppercase tracking-wider flex items-center gap-1 shadow-[0_0_10px_rgba(239,68,68,0.25)]">CANCELLED</span>`;
            } else if (actualStatus === 'Ongoing') {
                statusBadgeHtml = `<span class="bg-emerald-950/85 border border-emerald-500/60 text-emerald-300 font-mono-tag text-[9px] font-extrabold px-2.5 py-1 rounded-md uppercase tracking-wider flex items-center gap-1.5 shadow-[0_0_15px_rgba(16,185,129,0.35)]"><span class="relative flex h-2 w-2"><span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span><span class="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span></span>LIVE MATCH</span>`;
            } else if (actualStatus === 'Completed') {
                statusBadgeHtml = `<span class="bg-neutral-900/85 border border-neutral-700 text-neutral-400 font-mono-tag text-[9px] font-bold px-2.5 py-1 rounded-md uppercase tracking-wider flex items-center gap-1">CONCLUDED</span>`;
            } else {
                statusBadgeHtml = `<span class="bg-amber-950/70 border border-[#FFD700]/50 text-[#FFD700] font-mono-tag text-[9px] font-bold px-2.5 py-1 rounded-md uppercase tracking-wider flex items-center gap-1 shadow-[0_0_10px_rgba(255,215,0,0.2)]">${escapeHtml(actualStatus.toUpperCase())}</span>`;
            }

            const fillPercent = Math.min(100, Math.round((pCount / maxTeams) * 100));

            const card = document.createElement('article');
            card.className = `gamer-tournament-card group relative flex flex-col justify-between h-[430px] w-full rounded-2xl bg-[#090A0F] border ${isHost ? 'border-[#FFD700]/40 shadow-[0_0_20px_rgba(255,215,0,0.1)]' : 'border-white/10'} hover:border-[#FFD700]/70 transition-all duration-300 overflow-hidden cursor-pointer shadow-[0_10px_30px_rgba(0,0,0,0.8)] hover:shadow-[0_0_30px_rgba(255,215,0,0.2)]`;
            
            const actionBtnText = isHost ? "MANAGE TOURNAMENT" : "ENTER TOURNAMENT";
            const actionBtnIcon = "&rarr;";

            card.innerHTML = `
                <!-- Background Banner with Zoom & Cyber Vignette -->
                <div class="absolute inset-0 bg-cover bg-center transition-transform duration-700 group-hover:scale-110 group-hover:filter group-hover:brightness-110" 
                     style="background-image:url('${escapeCssUrl(t.banner || 'pictures/cz_logo.png')}'); background-position: ${t.bannerPosition || 'center 50%'};">
                </div>

                <!-- Multi-tier Cyber Gradients (Dark HUD floor & top header shadow) -->
                <div class="absolute inset-0 bg-gradient-to-t from-[#06070A] via-[#06070A]/85 via-50% to-black/50 group-hover:via-[#06070A]/90 transition-all duration-300"></div>
                
                <!-- Cyber Scanline / Mesh Texture Overlay -->
                <div class="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-white/[0.03] via-transparent to-black/60"></div>
                
                <!-- Sci-Fi Corner Brackets -->
                <div class="pointer-events-none absolute top-2.5 left-2.5 w-3 h-3 border-t-2 border-l-2 ${isHost ? 'border-[#FFD700]' : 'border-white/20'} group-hover:border-[#FFD700] transition-colors duration-300 z-20"></div>
                <div class="pointer-events-none absolute top-2.5 right-2.5 w-3 h-3 border-t-2 border-r-2 ${isHost ? 'border-[#FFD700]' : 'border-white/20'} group-hover:border-[#FFD700] transition-colors duration-300 z-20"></div>
                <div class="pointer-events-none absolute bottom-2.5 left-2.5 w-3 h-3 border-b-2 border-l-2 ${isHost ? 'border-[#FFD700]' : 'border-white/20'} group-hover:border-[#FFD700] transition-colors duration-300 z-20"></div>
                <div class="pointer-events-none absolute bottom-2.5 right-2.5 w-3 h-3 border-b-2 border-r-2 ${isHost ? 'border-[#FFD700]' : 'border-white/20'} group-hover:border-[#FFD700] transition-colors duration-300 z-20"></div>

                <!-- TOP HEADER: Game & Format Badges with Role Badge Underneath | Status on Right -->
                <div class="relative z-10 p-4 flex justify-between items-start gap-2">
                    <div class="flex flex-col items-start gap-1.5 min-w-0">
                        <div class="flex items-center gap-1.5 flex-wrap">
                            <span class="bg-black/80 backdrop-blur-md px-2.5 py-1 rounded-md text-[10px] font-mono-tag font-bold text-white uppercase tracking-wider border border-white/15 flex items-center gap-1.5 shadow-md">
                                <span class="w-1.5 h-1.5 rounded-full bg-[#FFD700] shadow-[0_0_6px_#FFD700]"></span>
                                ${escapeHtml(t.game || 'Esports')}
                            </span>
                            <span class="bg-white/10 backdrop-blur-md px-2 py-1 rounded-md text-[9px] font-mono-tag font-bold text-neutral-300 uppercase tracking-wider border border-white/10">
                                ${escapeHtml(modePill)}
                            </span>
                            ${(t.organizerVerified || t.isVerified) ? `
                            <span class="bg-emerald-950/80 backdrop-blur-md px-2 py-1 rounded-md text-[9px] font-mono-tag font-bold text-emerald-400 border border-emerald-500/40 flex items-center gap-1 shadow-[0_0_8px_rgba(16,185,129,0.2)]" title="Verified Host">
                                <svg class="w-2.5 h-2.5 text-emerald-400" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/></svg>
                                VERIFIED HOST
                            </span>` : ''}
                        </div>
                        ${roleBadgeHtml ? `<div>${roleBadgeHtml}</div>` : ''}
                    </div>

                    <div class="shrink-0">
                        ${statusBadgeHtml}
                    </div>
                </div>

                <!-- BOTTOM CONTENT: Hero Esports HUD -->
                <div class="relative z-10 p-4 mt-auto flex flex-col gap-2.5">
                    
                    <!-- Tournament Name, Venue & Date -->
                    <div>
                        <div class="flex items-center gap-1.5 text-[9px] font-mono-tag text-neutral-400 mb-1">
                            <span class="flex items-center gap-1 text-[#FFF099] font-bold">
                                <svg class="w-3 h-3 text-[#FFD700]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/></svg>
                                ${escapeHtml(venueText)}
                            </span>
                            <span class="text-neutral-600">&bull;</span>
                            <span class="truncate text-neutral-300 flex items-center gap-1">
                                <svg class="w-3 h-3 text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>
                                ${formatDateRange(t.date, t.endDate)}
                            </span>
                        </div>

                        <h3 class="font-heading font-black text-lg sm:text-xl text-white uppercase tracking-tight line-clamp-1 group-hover:text-[#FFD700] transition-colors drop-shadow-md">
                            ${escapeHtml(t.name || 'Untitled Tournament')}
                        </h3>
                    </div>

                    <!-- GAMER METRICS HUD BAR -->
                    <div class="bg-black/60 backdrop-blur-md p-2.5 rounded-xl border border-white/10 font-mono-tag space-y-2 group-hover:border-[#FFD700]/30 transition-colors">
                        <div class="flex items-center justify-between">
                            <!-- Prize Pool -->
                            <div>
                                <div class="text-[8px] uppercase tracking-widest text-neutral-400 font-bold flex items-center gap-1">
                                    <svg class="w-3 h-3 text-[#FFD700]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z"/></svg>
                                    PRIZE POOL
                                </div>
                                <div class="font-heading font-black text-base sm:text-lg text-transparent bg-clip-text bg-gradient-to-r from-[#FFF5C0] via-[#FFD700] to-[#E6B800] leading-tight">
                                    ₱${Number(t.prize || 0).toLocaleString()}
                                </div>
                            </div>

                            <!-- Entry & Slot Capacity -->
                            <div class="text-right flex flex-col justify-center items-end">
                                <div class="text-[9px] font-bold ${entryColor} uppercase flex items-center gap-1">
                                    <span class="w-1.5 h-1.5 rounded-full ${isPaid ? 'bg-amber-400' : 'bg-emerald-400'}"></span>
                                    ${escapeHtml(entryBadgeText)}
                                </div>
                                <div class="text-[10px] text-neutral-200 font-bold">
                                    ${pCount} / ${maxTeams} <span class="text-[8px] text-neutral-400 font-normal uppercase">${isSolo ? 'Players' : 'Squads'}</span>
                                </div>
                            </div>
                        </div>

                        <!-- Mini Segmented Capacity Bar -->
                        <div class="w-full bg-white/10 rounded-full h-1.5 overflow-hidden flex">
                            <div class="bg-gradient-to-r from-[#FFD700] to-amber-500 h-full rounded-full transition-all duration-500 shadow-[0_0_8px_rgba(255,215,0,0.5)]" style="width: ${Math.max(5, fillPercent)}%"></div>
                        </div>
                    </div>

                    <!-- ACTION BUTTON -->
                    <div class="pt-0.5">
                        <button class="details-btn w-full py-2.5 px-4 ${isHost ? 'bg-gradient-to-r from-[#FFD700] via-[#FFE566] to-[#E6B800] text-black font-extrabold ring-2 ring-[#FFD700]/40' : 'bg-gradient-to-r from-[#FFD700] via-[#FFE566] to-[#E6B800] text-black font-black'} hover:brightness-110 active:scale-[0.98] font-heading text-xs uppercase tracking-widest rounded-xl transition-all shadow-[0_0_15px_rgba(255,215,0,0.25)] flex items-center justify-center gap-2 cursor-pointer border border-[#FFF099]/40">
                            <span>${escapeHtml(actionBtnText)}</span>
                            <span class="text-sm font-sans transition-transform group-hover:translate-x-1">${actionBtnIcon}</span>
                        </button>
                    </div>

                </div>
            `;

            const detailsBtn = card.querySelector('.details-btn');
            if (detailsBtn) {
                detailsBtn.addEventListener('click', (e) => {
                    e.stopPropagation(); 
                    openModal(t);
                });
            }

            card.addEventListener('click', () => openModal(t));
            grid.appendChild(card);
        } catch (cardErr) {
            console.error("Error rendering tournament card:", cardErr, t);
        }
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

// --- HELPER RENDERERS FOR PRIZE, SCHEDULE & RANKINGS ---
function renderPrizeBreakdown(prizePoolOrDoc, maybeSplit) {
    const container = document.getElementById('prizeBreakdownContainer') || document.getElementById('prizePodiumContainer');
    const totalDisplay = document.getElementById('prizeTotalDisplay');
    const tierBadge = document.getElementById('prizeTierCountBadge');

    let pool = 0;
    let split = { first: 60, second: 30, third: 10 };

    if (typeof prizePoolOrDoc === 'object' && prizePoolOrDoc !== null) {
        pool = Number(prizePoolOrDoc.prize) || 0;
        split = prizePoolOrDoc.prizeSplit || split;
    } else {
        pool = Number(prizePoolOrDoc) || 0;
        split = maybeSplit || split;
    }

    if (totalDisplay) {
        totalDisplay.textContent = `₱${pool.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }

    if (!container) return;

    const s1 = Number(split.first) || 0;
    const s2 = Number(split.second) || 0;
    const s3 = Number(split.third) || 0;

    let activeTiers = 0;
    if (s1 > 0) activeTiers++;
    if (s2 > 0) activeTiers++;
    if (s3 > 0) activeTiers++;

    if (tierBadge) {
        tierBadge.textContent = `${activeTiers} TIER${activeTiers === 1 ? '' : 'S'}`;
    }

    const p1 = (pool * (s1 / 100)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const p2 = (pool * (s2 / 100)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const p3 = (pool * (s3 / 100)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    let html = '';

    // 1st Place Champion Card
    if (s1 > 0) {
        html += `
            <div class="relative overflow-hidden p-3 sm:p-3.5 rounded-xl bg-gradient-to-r from-[#FFD700]/15 via-[#FFD700]/5 to-transparent border border-[#FFD700]/40 shadow-[0_0_20px_rgba(255,215,0,0.12)] hover:border-[#FFD700] transition-all group">
                <div class="flex items-center justify-between gap-2.5 sm:gap-3">
                    <div class="flex items-center gap-2.5 sm:gap-3 min-w-0">
                        <div class="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-[#FFD700]/20 border border-[#FFD700]/50 flex items-center justify-center font-heading font-black text-xs sm:text-sm text-[#FFD700] shadow-[0_0_15px_rgba(255,215,0,0.3)] shrink-0 group-hover:scale-105 transition-transform font-mono-tag">
                            1ST
                        </div>
                        <div class="min-w-0">
                            <div class="flex items-center gap-1.5 flex-wrap">
                                <span class="font-heading font-black text-white text-xs sm:text-sm uppercase tracking-wider truncate">1st Place</span>
                                <span class="bg-[#FFD700] text-black text-[8px] sm:text-[9px] font-mono-tag font-extrabold px-1.5 py-0.5 rounded shadow-sm shrink-0">${activeTiers === 1 ? 'WINNER TAKES ALL' : 'CHAMPION'}</span>
                            </div>
                            <div class="text-[9px] sm:text-[10px] text-[#FFD700]/80 font-mono-tag mt-0.5 font-semibold truncate">${s1}% of Prize Pool</div>
                        </div>
                    </div>
                    <div class="text-right shrink-0">
                        <div class="text-sm sm:text-base md:text-lg font-heading font-extrabold text-[#FFD700] tracking-tight drop-shadow-sm whitespace-nowrap">₱${p1}</div>
                        <span class="text-[8px] sm:text-[9px] text-neutral-400 uppercase font-mono-tag block">Guaranteed</span>
                    </div>
                </div>
            </div>
        `;
    }

    // 2nd Place Runner-Up Card
    if (s2 > 0) {
        html += `
            <div class="relative overflow-hidden p-3 sm:p-3.5 rounded-xl bg-gradient-to-r from-slate-300/10 via-slate-400/5 to-transparent border border-slate-300/30 shadow-[0_0_15px_rgba(255,255,255,0.05)] hover:border-slate-200 transition-all group">
                <div class="flex items-center justify-between gap-2.5 sm:gap-3">
                    <div class="flex items-center gap-2.5 sm:gap-3 min-w-0">
                        <div class="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-slate-300/20 border border-slate-300/40 flex items-center justify-center font-heading font-black text-xs sm:text-sm text-slate-200 shrink-0 group-hover:scale-105 transition-transform font-mono-tag">
                            2ND
                        </div>
                        <div class="min-w-0">
                            <div class="flex items-center gap-1.5 flex-wrap">
                                <span class="font-heading font-black text-white text-xs sm:text-sm uppercase tracking-wider truncate">2nd Place</span>
                                <span class="bg-slate-300 text-black text-[8px] sm:text-[9px] font-mono-tag font-extrabold px-1.5 py-0.5 rounded shadow-sm shrink-0">RUNNER UP</span>
                            </div>
                            <div class="text-[9px] sm:text-[10px] text-neutral-400 font-mono-tag mt-0.5 font-semibold truncate">${s2}% of Prize Pool</div>
                        </div>
                    </div>
                    <div class="text-right shrink-0">
                        <div class="text-sm sm:text-base md:text-lg font-heading font-extrabold text-neutral-100 tracking-tight whitespace-nowrap">₱${p2}</div>
                        <span class="text-[8px] sm:text-[9px] text-neutral-400 uppercase font-mono-tag block">Payout</span>
                    </div>
                </div>
            </div>
        `;
    }

    // 3rd Place Bronze Card
    if (s3 > 0) {
        html += `
            <div class="relative overflow-hidden p-3 sm:p-3.5 rounded-xl bg-gradient-to-r from-amber-600/10 via-amber-700/5 to-transparent border border-amber-600/30 shadow-[0_0_15px_rgba(217,119,6,0.05)] hover:border-amber-500 transition-all group">
                <div class="flex items-center justify-between gap-2.5 sm:gap-3">
                    <div class="flex items-center gap-2.5 sm:gap-3 min-w-0">
                        <div class="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-amber-600/20 border border-amber-600/40 flex items-center justify-center font-heading font-black text-xs sm:text-sm text-amber-400 shrink-0 group-hover:scale-105 transition-transform font-mono-tag">
                            3RD
                        </div>
                        <div class="min-w-0">
                            <div class="flex items-center gap-1.5 flex-wrap">
                                <span class="font-heading font-black text-white text-xs sm:text-sm uppercase tracking-wider truncate">3rd Place</span>
                                <span class="bg-amber-600 text-black text-[8px] sm:text-[9px] font-mono-tag font-extrabold px-1.5 py-0.5 rounded shadow-sm shrink-0">BRONZE</span>
                            </div>
                            <div class="text-[9px] sm:text-[10px] text-neutral-400 font-mono-tag mt-0.5 font-semibold truncate">${s3}% of Prize Pool</div>
                        </div>
                    </div>
                    <div class="text-right shrink-0">
                        <div class="text-sm sm:text-base md:text-lg font-heading font-extrabold text-amber-400 tracking-tight whitespace-nowrap">₱${p3}</div>
                        <span class="text-[8px] sm:text-[9px] text-neutral-400 uppercase font-mono-tag block">Payout</span>
                    </div>
                </div>
            </div>
        `;
    }

    if (activeTiers === 0) {
        html = '<div class="text-center text-neutral-500 py-4 font-mono-tag text-xs">No placement prize split defined for this tournament.</div>';
    }

    container.innerHTML = html;
}

function getDefaultSchedule(startDate, endDate) {
    const start = startDate ? (startDate.toDate ? startDate.toDate() : new Date(startDate)).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'TBD';
    const end = endDate ? (endDate.toDate ? endDate.toDate() : new Date(endDate)).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'TBD';

    return [
        { title: 'Stage 1: Registration Phase', subtitle: 'Open until bracket seeding starts', color: 'gold', tag: 'STAGE' },
        { title: 'Stage 2: Tournament Kickoff', subtitle: `${start}`, color: 'blue', tag: 'LIVE' },
        { title: 'Stage 3: Grand Finals & Awards', subtitle: `${end}`, color: 'green', tag: 'FINALS' }
    ];
}

function getStageTheme(color) {
    const themes = {
        gold: {
            dot: 'bg-[#FFD700] ring-4 ring-[#FFD700]/20 shadow-[0_0_15px_#FFD700]',
            badge: 'bg-[#FFD700]/15 text-[#FFD700] border-[#FFD700]/40',
            cardBorder: 'border-l-4 border-l-[#FFD700] hover:border-white/20',
            tag: 'STAGE'
        },
        yellow: {
            dot: 'bg-[#FFD700] ring-4 ring-[#FFD700]/20 shadow-[0_0_15px_#FFD700]',
            badge: 'bg-[#FFD700]/15 text-[#FFD700] border-[#FFD700]/40',
            cardBorder: 'border-l-4 border-l-[#FFD700] hover:border-white/20',
            tag: 'STAGE'
        },
        blue: {
            dot: 'bg-blue-400 ring-4 ring-blue-400/20 shadow-[0_0_15px_#60A5FA]',
            badge: 'bg-blue-500/15 text-blue-400 border-blue-500/40',
            cardBorder: 'border-l-4 border-l-blue-400 hover:border-white/20',
            tag: 'LIVE'
        },
        green: {
            dot: 'bg-emerald-400 ring-4 ring-emerald-400/20 shadow-[0_0_15px_#34D399]',
            badge: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/40',
            cardBorder: 'border-l-4 border-l-emerald-400 hover:border-white/20',
            tag: 'FINALS'
        },
        red: {
            dot: 'bg-rose-500 ring-4 ring-rose-500/20 shadow-[0_0_15px_#F43F5E]',
            badge: 'bg-rose-500/15 text-rose-400 border-rose-500/40',
            cardBorder: 'border-l-4 border-l-rose-500 hover:border-white/20',
            tag: 'ELIMINATION'
        },
        purple: {
            dot: 'bg-purple-400 ring-4 ring-purple-400/20 shadow-[0_0_15px_#C084FC]',
            badge: 'bg-purple-500/15 text-purple-400 border-purple-500/40',
            cardBorder: 'border-l-4 border-l-purple-400 hover:border-white/20',
            tag: 'PLAYOFFS'
        },
        cyan: {
            dot: 'bg-cyan-400 ring-4 ring-cyan-400/20 shadow-[0_0_15px_#22D3EE]',
            badge: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/40',
            cardBorder: 'border-l-4 border-l-cyan-400 hover:border-white/20',
            tag: 'QUALIFIERS'
        },
        amber: {
            dot: 'bg-amber-400 ring-4 ring-amber-400/20 shadow-[0_0_15px_#FBBF24]',
            badge: 'bg-amber-500/15 text-amber-400 border-amber-500/40',
            cardBorder: 'border-l-4 border-l-amber-400 hover:border-white/20',
            tag: 'CHECK-IN'
        }
    };
    return themes[color] || themes.gold;
}

function renderScheduleRundown(tournDoc) {
    const container = document.getElementById('scheduleTimelineContainer');
    if (!container) return;
    
    let items = tournDoc?.scheduleRundown;
    if (!items || !Array.isArray(items) || items.length === 0) {
        items = getDefaultSchedule(tournDoc?.date, tournDoc?.endDate);
    }

    container.innerHTML = `
        <div class="relative pl-6 space-y-4 before:absolute before:left-2 before:top-3 before:bottom-3 before:w-0.5 before:bg-gradient-to-b before:from-[#FFD700] before:via-blue-500 before:to-emerald-500">
            ${items.map((stage, index) => {
                const theme = getStageTheme(stage.color || 'gold');
                const stageNum = String(index + 1).padStart(2, '0');
                const displayTag = stage.tag || theme.tag || 'STAGE';
                return `
                    <div class="relative group">
                        <!-- Glowing Node on Timeline -->
                        <div class="absolute -left-[27px] top-3 w-3.5 h-3.5 rounded-full ${theme.dot} flex items-center justify-center transition-transform duration-300 group-hover:scale-125 z-10"></div>
                        
                        <!-- Timeline Cyber Card -->
                        <div class="bg-[#111116] border border-white/10 ${theme.cardBorder} rounded-xl p-3.5 shadow-lg hover:bg-[#15151c] transition-all group-hover:shadow-[0_4px_20px_rgba(0,0,0,0.6)]">
                            <div class="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                                <div class="flex items-center gap-2">
                                    <span class="font-mono-tag font-bold text-[10px] text-neutral-500 tracking-wider">PHASE ${stageNum}</span>
                                    <span class="text-[9px] font-mono-tag font-bold px-2 py-0.5 rounded-full border ${theme.badge} uppercase tracking-wider">${escapeHtml(displayTag)}</span>
                                </div>
                            </div>
                            <h5 class="font-heading font-bold text-white text-sm uppercase tracking-wide group-hover:text-[#FFD700] transition-colors">${escapeHtml(stage.title || `Stage ${index + 1}`)}</h5>
                            ${stage.subtitle ? `
                                <div class="mt-1.5 flex items-center gap-1.5 text-xs text-neutral-300 font-mono-tag bg-white/5 border border-white/5 px-2.5 py-1.5 rounded-lg">
                                    <svg class="w-3.5 h-3.5 text-[#FFD700] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>
                                    <span class="leading-tight">${escapeHtml(stage.subtitle)}</span>
                                </div>
                            ` : ''}
                        </div>
                    </div>
                `;
            }).join('')}
        </div>
    `;
}

function openEditScheduleModal() {
    if (!currentEditingTournament) return;
    const modal = document.getElementById('editScheduleModal');
    const list = document.getElementById('scheduleEditorList');
    if (!modal || !list) return;

    let items = currentEditingTournament.scheduleRundown;
    if (!items || !Array.isArray(items) || items.length === 0) {
        items = getDefaultSchedule(currentEditingTournament.date, currentEditingTournament.endDate);
    }

    list.innerHTML = '';
    items.forEach(item => {
        addScheduleStageRow(item);
    });

    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

function formatStageScheduleSubtitle(dateVal, startVal, endVal, customNote) {
    const parts = [];
    if (dateVal) {
        try {
            const [y, m, d] = dateVal.split('-').map(Number);
            const dt = new Date(y, m - 1, d);
            parts.push(dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
        } catch (e) {
            parts.push(dateVal);
        }
    }
    if (startVal) {
        try {
            const [h, min] = startVal.split(':').map(Number);
            const dt = new Date(2000, 0, 1, h, min);
            const startFormatted = dt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
            if (endVal) {
                const [eh, emin] = endVal.split(':').map(Number);
                const edt = new Date(2000, 0, 1, eh, emin);
                const endFormatted = edt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
                parts.push(`${startFormatted} - ${endFormatted}`);
            } else {
                parts.push(startFormatted);
            }
        } catch (e) {
            parts.push(startVal);
        }
    }
    if (customNote) {
        parts.push(customNote);
    }
    return parts.join(' • ');
}

function addScheduleStageRow(item = { title: '', subtitle: '', date: '', startTime: '', endTime: '', color: 'gold', tag: '' }) {
    const list = document.getElementById('scheduleEditorList');
    if (!list) return;

    const row = document.createElement('div');
    row.className = 'schedule-stage-row bg-[#111116] border border-white/10 rounded-xl p-3.5 space-y-2.5 relative transition-all shadow-md';
    
    const selectedColor = item.color || 'gold';
    const colorTheme = getStageTheme(selectedColor);
    const initialTag = item.tag || colorTheme.tag || 'STAGE';

    const colorOptions = [
        { value: 'gold', label: 'Gold (Stage / Open)', defaultTag: 'STAGE' },
        { value: 'blue', label: 'Blue (Live / Ongoing)', defaultTag: 'LIVE' },
        { value: 'green', label: 'Green (Finals / Awards)', defaultTag: 'FINALS' },
        { value: 'amber', label: 'Amber (Check-In / Ready)', defaultTag: 'CHECK-IN' },
        { value: 'cyan', label: 'Cyan (Qualifiers / Heats)', defaultTag: 'QUALIFIERS' },
        { value: 'purple', label: 'Purple (Playoffs / Bracket)', defaultTag: 'PLAYOFFS' },
        { value: 'red', label: 'Red (Elimination / Knockout)', defaultTag: 'ELIMINATION' }
    ];

    const tagPresets = ['STAGE', 'LIVE', 'FINALS', 'CHECK-IN', 'QUALIFIERS', 'PLAYOFFS', 'ELIMINATION', 'REGISTRATION', 'DAY 1', 'DAY 2', 'CUSTOM'];

    row.innerHTML = `
        <div class="flex items-center justify-between gap-2 border-b border-white/5 pb-2">
            <div class="flex items-center gap-2.5 flex-wrap flex-1 min-w-0">
                <!-- Color Theme Selector -->
                <div>
                    <label class="block text-[9px] font-mono-tag text-neutral-400 font-bold uppercase mb-0.5">Color Theme</label>
                    <select class="schedule-stage-color bg-[#1a1a20] border border-white/15 rounded-lg text-xs font-mono-tag text-white px-2 py-1.5 cursor-pointer">
                        ${colorOptions.map(opt => `<option value="${opt.value}" data-default-tag="${opt.defaultTag}" ${opt.value === selectedColor ? 'selected' : ''}>${opt.label}</option>`).join('')}
                    </select>
                </div>

                <!-- Status / Badge Tag Preset -->
                <div>
                    <label class="block text-[9px] font-mono-tag text-neutral-400 font-bold uppercase mb-0.5">Badge / Status Label</label>
                    <div class="flex items-center gap-1.5">
                        <select class="schedule-stage-tag-preset bg-[#1a1a20] border border-white/15 rounded-lg text-xs font-mono-tag text-white px-2 py-1.5 cursor-pointer">
                            ${tagPresets.map(tag => `<option value="${tag}" ${tag === initialTag ? 'selected' : ''}>${tag}</option>`).join('')}
                            ${!tagPresets.includes(initialTag) ? `<option value="${escapeHtml(initialTag)}" selected>${escapeHtml(initialTag)}</option>` : ''}
                        </select>
                        <input type="text" class="schedule-stage-tag dark-input w-24 sm:w-28 p-1.5 rounded-lg text-xs font-mono-tag uppercase font-bold text-center" value="${escapeHtml(initialTag)}">
                    </div>
                </div>

                <!-- Live Tag Preview Pill -->
                <div class="ml-auto flex flex-col items-end shrink-0">
                    <span class="text-[9px] font-mono-tag text-neutral-500 font-bold uppercase mb-0.5">Badge Preview</span>
                    <span class="schedule-stage-preview-pill text-[9px] font-mono-tag font-bold px-2 py-0.5 rounded-full border ${colorTheme.badge} uppercase tracking-wider">${escapeHtml(initialTag)}</span>
                </div>
            </div>

            <button type="button" onclick="this.closest('.schedule-stage-row').remove()" class="text-neutral-400 hover:text-red-400 p-1 transition-colors text-xl font-bold leading-none cursor-pointer self-start" title="Delete Stage">&times;</button>
        </div>

        <div>
            <label class="block text-[9px] font-mono-tag text-neutral-400 font-bold uppercase mb-1">Stage Title <span class="text-red-500">*</span></label>
            <input type="text" class="schedule-stage-title dark-input w-full p-2.5 rounded-lg text-xs font-mono-tag text-white" value="${escapeHtml(item.title || '')}" required>
        </div>

        <div>
            <label class="block text-[9px] font-mono-tag text-neutral-400 font-bold uppercase mb-1">Stage Schedule (Adjustable Date &amp; Time)</label>
            <div class="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div>
                    <label class="block text-[8px] font-mono-tag text-neutral-500 uppercase mb-0.5">Date</label>
                    <input type="date" class="schedule-stage-date dark-input w-full p-2 rounded-lg text-xs font-mono-tag text-white" value="${escapeHtml(item.date || '')}">
                </div>
                <div>
                    <label class="block text-[8px] font-mono-tag text-neutral-500 uppercase mb-0.5">Start Time</label>
                    <input type="time" class="schedule-stage-start-time dark-input w-full p-2 rounded-lg text-xs font-mono-tag text-white" value="${escapeHtml(item.startTime || '')}">
                </div>
                <div>
                    <label class="block text-[8px] font-mono-tag text-neutral-500 uppercase mb-0.5">End Time</label>
                    <input type="time" class="schedule-stage-end-time dark-input w-full p-2 rounded-lg text-xs font-mono-tag text-white" value="${escapeHtml(item.endTime || '')}">
                </div>
            </div>
        </div>

        <div>
            <label class="block text-[9px] font-mono-tag text-neutral-400 font-bold uppercase mb-1">Timeline Subtitle / Notes</label>
            <input type="text" class="schedule-stage-subtitle dark-input w-full p-2 rounded-lg text-xs font-mono-tag text-neutral-300" value="${escapeHtml(item.subtitle || '')}">
        </div>
    `;

    const colorEl = row.querySelector('.schedule-stage-color');
    const presetEl = row.querySelector('.schedule-stage-tag-preset');
    const tagInputEl = row.querySelector('.schedule-stage-tag');
    const previewPill = row.querySelector('.schedule-stage-preview-pill');
    const dateInput = row.querySelector('.schedule-stage-date');
    const startTimeInput = row.querySelector('.schedule-stage-start-time');
    const endTimeInput = row.querySelector('.schedule-stage-end-time');
    const subtitleInput = row.querySelector('.schedule-stage-subtitle');

    function updatePill() {
        const theme = getStageTheme(colorEl.value);
        const tagText = tagInputEl.value.trim() || theme.tag;
        previewPill.className = `schedule-stage-preview-pill text-[9px] font-mono-tag font-bold px-2 py-0.5 rounded-full border ${theme.badge} uppercase tracking-wider`;
        previewPill.textContent = tagText;
    }

    function syncScheduleSubtitle() {
        const d = dateInput.value;
        const st = startTimeInput.value;
        const et = endTimeInput.value;
        if (d || st) {
            const formatted = formatStageScheduleSubtitle(d, st, et);
            if (formatted) subtitleInput.value = formatted;
        }
    }

    dateInput.addEventListener('input', syncScheduleSubtitle);
    startTimeInput.addEventListener('input', syncScheduleSubtitle);
    endTimeInput.addEventListener('input', syncScheduleSubtitle);

    colorEl.addEventListener('change', () => {
        const selectedOpt = colorEl.selectedOptions[0];
        const defaultTag = selectedOpt?.dataset?.defaultTag;
        if (defaultTag && (!tagInputEl.value || tagPresets.includes(tagInputEl.value))) {
            tagInputEl.value = defaultTag;
            presetEl.value = defaultTag;
        }
        updatePill();
    });

    presetEl.addEventListener('change', () => {
        if (presetEl.value !== 'CUSTOM') {
            tagInputEl.value = presetEl.value;
        }
        updatePill();
    });

    tagInputEl.addEventListener('input', () => {
        updatePill();
    });

    list.appendChild(row);
}

async function saveTournamentSchedule() {
    if (!currentEditingTournament) return;
    const saveBtn = document.getElementById('saveScheduleBtn');
    const list = document.getElementById('scheduleEditorList');
    if (!list) return;

    const rows = list.querySelectorAll('.schedule-stage-row');
    const items = [];

    rows.forEach(row => {
        const title = row.querySelector('.schedule-stage-title')?.value?.trim();
        const date = row.querySelector('.schedule-stage-date')?.value || '';
        const startTime = row.querySelector('.schedule-stage-start-time')?.value || '';
        const endTime = row.querySelector('.schedule-stage-end-time')?.value || '';
        let subtitle = row.querySelector('.schedule-stage-subtitle')?.value?.trim() || '';
        const color = row.querySelector('.schedule-stage-color')?.value || 'gold';
        const tag = row.querySelector('.schedule-stage-tag')?.value?.trim() || getStageTheme(color).tag;

        if (!subtitle && (date || startTime)) {
            subtitle = formatStageScheduleSubtitle(date, startTime, endTime);
        }

        if (title) {
            items.push({ title, subtitle, date, startTime, endTime, color, tag });
        }
    });

    if (items.length === 0) {
        if (window.showErrorToast) window.showErrorToast("Validation Error", "Please add at least one schedule stage.");
        return;
    }

    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.textContent = "Saving...";
    }

    try {
        const tourneyRef = doc(db, "tournaments", currentEditingTournament.id);
        await updateDoc(tourneyRef, {
            scheduleRundown: items,
            updatedAt: serverTimestamp()
        });

        currentEditingTournament.scheduleRundown = items;
        renderScheduleRundown(currentEditingTournament);

        if (window.closeModal) window.closeModal('editScheduleModal');
        if (window.showSuccessToast) window.showSuccessToast("Schedule Saved", "Timeline schedule updated successfully!");

    } catch (e) {
        console.error("Error saving schedule rundown:", e);
        if (window.showErrorToast) window.showErrorToast("Error", "Failed to update schedule: " + e.message);
    } finally {
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.textContent = "Save Schedule";
        }
    }
}

function getTeamInitials(name) {
    if (!name || name === 'TBD' || name === 'BYE') return '—';
    const words = name.trim().split(/\s+/);
    if (words.length >= 2) {
        return (words[0][0] + words[1][0]).toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
}
window.getTeamInitials = getTeamInitials;

function renderPodiumShowcase(t, containerId) {
    const container = typeof containerId === 'string' ? document.getElementById(containerId) : containerId;
    if (!container) return;

    const isCompleted = t && (t.status === 'Completed' || isTournamentCompleteCheck(t));
    if (!isCompleted) {
        container.classList.add('hidden');
        container.innerHTML = '';
        return;
    }

    const { firstTeam, secondTeam, thirdTeam } = determinePodiumTeams(t);
    const totalPrize = Number(t.prize) || 0;
    const split = t.prizeSplit || { first: 60, second: 30, third: 10 };
    const split1 = Number(split.first) || 0;
    const split2 = Number(split.second) || 0;
    const split3 = Number(split.third) || 0;

    const prize1 = Math.round(totalPrize * (split1 / 100));
    const prize2 = Math.round(totalPrize * (split2 / 100));
    const prize3 = Math.round(totalPrize * (split3 / 100));

    const firstInitials = getTeamInitials(firstTeam);
    const secondInitials = getTeamInitials(secondTeam);
    const thirdInitials = getTeamInitials(thirdTeam);

    const hasThird = thirdTeam && thirdTeam !== 'TBD' && thirdTeam !== 'BYE';

    container.classList.remove('hidden');
    container.innerHTML = `
        <div class="relative w-full pt-4 pb-2 px-1 sm:px-4">
            <!-- Ambient Stage Lighting (Dark Esports Onyx) -->
            <div class="absolute inset-0 bg-gradient-to-b from-[#FFD700]/5 via-transparent to-black/60 pointer-events-none rounded-2xl"></div>
            
            <!-- 3D Podium Pillars Grid -->
            <div class="relative z-10 grid ${hasThird ? 'grid-cols-3' : 'grid-cols-2 max-w-sm'} gap-2 sm:gap-4 items-end max-w-md sm:max-w-lg mx-auto">
                
                <!-- 2ND PLACE (SILVER) -->
                <div class="flex flex-col items-center">
                    <div class="flex flex-col items-center mb-2 text-center w-full px-1">
                        <div class="relative mb-1.5">
                            <div class="w-12 h-12 sm:w-14 sm:h-14 rounded-full bg-gradient-to-b from-slate-200 via-slate-400 to-slate-700 p-0.5 shadow-[0_0_15px_rgba(203,213,225,0.35)] flex items-center justify-center">
                                <div class="w-full h-full rounded-full bg-[#101116] flex items-center justify-center overflow-hidden">
                                    <span class="font-heading font-black text-xs sm:text-sm text-slate-200 uppercase">${firstInitials === secondInitials ? '2ND' : secondInitials}</span>
                                </div>
                            </div>
                            <span class="absolute -bottom-1.5 left-1/2 -translate-x-1/2 px-1.5 py-0.2 rounded-full bg-slate-300 text-black text-[8px] font-mono-tag font-black uppercase tracking-wider shadow">2ND</span>
                        </div>
                        <h4 class="font-heading font-black text-[11px] sm:text-xs text-white uppercase truncate max-w-full" title="${escapeHtml(secondTeam)}">${escapeHtml(secondTeam)}</h4>
                        <div class="text-[10px] font-mono-tag font-bold text-slate-300 mt-0.5">${prize2 > 0 ? `₱${prize2.toLocaleString()}` : 'Runner-Up'}</div>
                    </div>

                    <!-- 2nd Place 3D Pillar (Medium Height) -->
                    <div class="w-full h-24 sm:h-28 bg-gradient-to-b from-[#1C1D24] via-[#111216] to-[#08080A] border-t-4 border-t-slate-300 border-x border-b border-white/10 rounded-t-xl flex flex-col items-center justify-center shadow-[0_10px_25px_rgba(0,0,0,0.6)] relative overflow-hidden">
                        <div class="absolute inset-0 bg-gradient-to-r from-white/5 via-transparent to-black/20 pointer-events-none"></div>
                        <span class="font-heading font-black text-3xl sm:text-4xl text-slate-300/80 drop-shadow-[0_2px_8px_rgba(203,213,225,0.3)]">2</span>
                        <span class="text-[7px] sm:text-[8px] font-mono-tag font-bold text-slate-400 uppercase tracking-widest mt-0.5">RUNNER-UP</span>
                    </div>
                </div>

                <!-- 1ST PLACE (GOLD CHAMPION) -->
                <div class="flex flex-col items-center -translate-y-2">
                    <div class="flex flex-col items-center mb-2 text-center w-full px-1">
                        <!-- Floating Golden Crown Icon -->
                        <div class="text-[#FFD700] mb-0.5 animate-bounce drop-shadow-[0_0_10px_rgba(255,215,0,0.6)]">
                            <svg class="w-5 h-5 sm:w-6 sm:h-6" fill="currentColor" viewBox="0 0 24 24"><path d="M5 16L3 5l5.5 5L12 4l3.5 6L21 5l-2 11H5zm14 3c0 .6-.4 1-1 1H6c-.6 0-1-.4-1-1v-1h14v1z"/></svg>
                        </div>
                        <div class="relative mb-1.5">
                            <div class="w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-gradient-to-b from-[#FFF5C0] via-[#FFD700] to-[#B8860B] p-0.5 shadow-[0_0_25px_rgba(255,215,0,0.55)] flex items-center justify-center">
                                <div class="w-full h-full rounded-full bg-[#141004] flex items-center justify-center overflow-hidden">
                                    <span class="font-heading font-black text-sm sm:text-base text-[#FFD700] uppercase">${firstInitials}</span>
                                </div>
                            </div>
                            <span class="absolute -bottom-1.5 left-1/2 -translate-x-1/2 px-2 py-0.2 rounded-full bg-[#FFD700] text-black text-[9px] font-mono-tag font-black uppercase tracking-wider shadow">1ST</span>
                        </div>
                        <h4 class="font-heading font-black text-xs sm:text-sm text-[#FFD700] uppercase truncate max-w-full drop-shadow-[0_0_10px_rgba(255,215,0,0.4)]" title="${escapeHtml(firstTeam)}">${escapeHtml(firstTeam)}</h4>
                        <div class="text-[11px] font-mono-tag font-black text-white mt-0.5">${prize1 > 0 ? `₱${prize1.toLocaleString()}` : 'Champion'}</div>
                    </div>

                    <!-- 1st Place 3D Pillar (Tallest) -->
                    <div class="w-full h-32 sm:h-38 bg-gradient-to-b from-[#2A2105] via-[#161202] to-[#080601] border-t-4 border-t-[#FFD700] border-x border-b border-[#FFD700]/40 rounded-t-xl flex flex-col items-center justify-center shadow-[0_15px_35px_rgba(255,215,0,0.25)] relative overflow-hidden">
                        <div class="absolute inset-0 bg-gradient-to-r from-[#FFD700]/10 via-transparent to-black/30 pointer-events-none"></div>
                        <span class="font-heading font-black text-4xl sm:text-5xl text-[#FFD700] drop-shadow-[0_2px_12px_rgba(255,215,0,0.6)]">1</span>
                        <span class="text-[7px] sm:text-[8px] font-mono-tag font-black text-[#FFD700]/80 uppercase tracking-widest mt-0.5">CHAMPION</span>
                    </div>
                </div>

                ${hasThird ? `
                <!-- 3RD PLACE (BRONZE) -->
                <div class="flex flex-col items-center">
                    <div class="flex flex-col items-center mb-2 text-center w-full px-1">
                        <div class="relative mb-1.5">
                            <div class="w-11 h-11 sm:w-13 sm:h-13 rounded-full bg-gradient-to-b from-amber-600 via-amber-800 to-amber-950 p-0.5 shadow-[0_0_12px_rgba(217,119,6,0.3)] flex items-center justify-center">
                                <div class="w-full h-full rounded-full bg-[#120B07] flex items-center justify-center overflow-hidden">
                                    <span class="font-heading font-black text-xs sm:text-sm text-amber-500 uppercase">${thirdInitials}</span>
                                </div>
                            </div>
                            <span class="absolute -bottom-1.5 left-1/2 -translate-x-1/2 px-1.5 py-0.2 rounded-full bg-amber-700 text-white text-[8px] font-mono-tag font-black uppercase tracking-wider shadow">3RD</span>
                        </div>
                        <h4 class="font-heading font-black text-[11px] sm:text-xs text-white uppercase truncate max-w-full" title="${escapeHtml(thirdTeam)}">${escapeHtml(thirdTeam)}</h4>
                        <div class="text-[10px] font-mono-tag font-bold text-amber-500 mt-0.5">${prize3 > 0 ? `₱${prize3.toLocaleString()}` : '3rd Place'}</div>
                    </div>

                    <!-- 3rd Place 3D Pillar (Shorter Height) -->
                    <div class="w-full h-18 sm:h-22 bg-gradient-to-b from-[#201107] via-[#120904] to-[#060301] border-t-4 border-t-amber-600 border-x border-b border-white/10 rounded-t-xl flex flex-col items-center justify-center shadow-[0_10px_25px_rgba(0,0,0,0.6)] relative overflow-hidden">
                        <div class="absolute inset-0 bg-gradient-to-r from-white/5 via-transparent to-black/20 pointer-events-none"></div>
                        <span class="font-heading font-black text-2xl sm:text-3xl text-amber-600/80 drop-shadow-[0_2px_8px_rgba(217,119,6,0.3)]">3</span>
                        <span class="text-[7px] sm:text-[8px] font-mono-tag font-bold text-amber-700 uppercase tracking-widest mt-0.5">3RD PLACE</span>
                    </div>
                </div>
                ` : ''}

            </div>
        </div>
    `;
}
window.renderPodiumShowcase = renderPodiumShowcase;

function isUserWinnerOrStaff(t, user) {
    if (!t) return false;
    if (!user) return false;
    if (typeof isTournamentStaff === 'function' && isTournamentStaff(t, user)) return true;

    const { firstTeam, secondTeam, thirdTeam } = determinePodiumTeams(t);
    const winningTeams = [firstTeam, secondTeam, thirdTeam].filter(name => name && name !== 'TBD' && name !== 'BYE');
    if (winningTeams.length === 0) return false;

    const participants = t.participants || [];
    return participants.some(pt => {
        const ptName = typeof pt === 'object' ? (pt.name || pt.teamName) : pt;
        if (!winningTeams.includes(ptName)) return false;

        if (pt.registeredBy === user.uid || pt.captainUid === user.uid) return true;
        if (pt.captain && user.displayName && pt.captain.toLowerCase() === user.displayName.toLowerCase()) return true;
        if (user.email && pt.captainEmail && pt.captainEmail.toLowerCase() === user.email.toLowerCase()) return true;
        if (Array.isArray(pt.members)) {
            return pt.members.some(m => {
                const mName = typeof m === 'object' ? (m.name || m.ign) : m;
                return mName && user.displayName && mName.toLowerCase() === user.displayName.toLowerCase();
            });
        }
        if (ptName && user.displayName && ptName.toLowerCase() === user.displayName.toLowerCase()) return true;
        return false;
    });
}
window.isUserWinnerOrStaff = isUserWinnerOrStaff;

function renderTournamentRankings(participants, prizePool, matches, prizeSplit, tourn) {
    const tbody = document.getElementById('rankingsTableBody');
    if (!tbody) return;

    const t = tourn || currentEditingTournament;
    const isCancelled = t && (t.status === 'Cancelled' || t.isCancelled);
    const isStarted = t && !!t.isStarted;
    const isCompleted = t && (t.status === 'Completed' || isTournamentCompleteCheck(t));

    // Render 3D Podium in Rankings Tab if Completed
    renderPodiumShowcase(t, 'standingsPodiumContainer');

    if (!participants || participants.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="py-10 text-center text-neutral-500 font-mono-tag text-xs italic">No teams registered yet.</td></tr>`;
        return;
    }

    if (isCancelled) {
        tbody.innerHTML = `
            <tr>
                <td colspan="6" class="py-3 px-4 text-center text-red-400 font-mono-tag text-xs font-bold bg-red-500/10 border-b border-red-500/20">
                    ⚠️ Tournament Cancelled &bull; Registered Rosters Preserved
                </td>
            </tr>
        ` + participants.map((p) => {
            const name = typeof p === 'object' ? (p.name || 'Unnamed') : p;
            return `
                <tr class="hover:bg-white/5 transition-colors text-xs font-mono-tag">
                    <td class="py-3 px-4 text-center text-red-400/80 font-bold">-</td>
                    <td class="py-3 px-4 text-neutral-200 font-bold uppercase tracking-wide truncate max-w-[180px] sm:max-w-xs">${escapeHtml(name)}</td>
                    <td class="py-3 px-4 text-center text-neutral-500">-</td>
                    <td class="py-3 px-4 text-center text-neutral-500">-</td>
                    <td class="py-3 px-4 text-center text-neutral-500">-</td>
                    <td class="py-3 px-4 text-right text-red-400 font-mono-tag text-[10px] font-bold">CANCELLED</td>
                </tr>
            `;
        }).join('');
        return;
    }

    if (!isStarted && !isCompleted) {
        // Tournament has NOT started yet: show registered roster with "-" placeholders
        tbody.innerHTML = participants.map((p) => {
            const name = typeof p === 'object' ? (p.name || 'Unnamed') : p;
            return `
                <tr class="hover:bg-white/5 transition-colors text-xs font-mono-tag">
                    <td class="py-3 px-4 text-center text-neutral-500 font-bold">-</td>
                    <td class="py-3 px-4 text-neutral-300 font-medium uppercase tracking-wide truncate max-w-[180px] sm:max-w-xs">${escapeHtml(name)}</td>
                    <td class="py-3 px-4 text-center text-neutral-500">-</td>
                    <td class="py-3 px-4 text-center text-neutral-500">-</td>
                    <td class="py-3 px-4 text-center text-neutral-500">-</td>
                    <td class="py-3 px-4 text-right text-neutral-500 font-bold">-</td>
                </tr>
            `;
        }).join('');
        return;
    }

    // Compute match stats
    const stats = {};
    participants.forEach(p => {
        const name = typeof p === 'object' ? (p.name || 'Unnamed') : p;
        stats[name] = { name: name, won: 0, lost: 0, pts: 0 };
    });

    if (matches && Array.isArray(matches)) {
        matches.forEach(m => {
            if (m.winner) {
                if (stats[m.winner]) {
                    stats[m.winner].won++;
                    stats[m.winner].pts += 3;
                }
                const loser = m.winner === m.team1 ? m.team2 : m.team1;
                if (stats[loser] && loser !== 'BYE' && loser !== 'TBD') {
                    stats[loser].lost++;
                }
            }
        });
    }

    let sorted = Object.values(stats);

    // In completed bracket tournaments, sort podium by official match outcomes
    const grandFinalMatch = getGrandFinalMatch(matches);
    const bronzeMatch = matches && matches.find(m => m.id === 'M-3RD' || m.id === 'BM-1' || m.id === '3RD-1' || m.isBronzeMatch);
    
    if (isCompleted && grandFinalMatch && grandFinalMatch.winner) {
        const champ = grandFinalMatch.winner;
        const runnerUp = (grandFinalMatch.winner === grandFinalMatch.team1) ? grandFinalMatch.team2 : grandFinalMatch.team1;
        const thirdPlace = bronzeMatch && bronzeMatch.winner ? bronzeMatch.winner : null;
        const fourthPlace = bronzeMatch && bronzeMatch.winner ? ((bronzeMatch.winner === bronzeMatch.team1) ? bronzeMatch.team2 : bronzeMatch.team1) : null;

        sorted.sort((a, b) => {
            if (a.name === champ) return -1;
            if (b.name === champ) return 1;
            if (a.name === runnerUp) return -1;
            if (b.name === runnerUp) return 1;
            if (thirdPlace && a.name === thirdPlace) return -1;
            if (thirdPlace && b.name === thirdPlace) return 1;
            if (fourthPlace && a.name === fourthPlace) return -1;
            if (fourthPlace && b.name === fourthPlace) return 1;
            return (b.won - a.won) || (b.pts - a.pts);
        });
    } else {
        sorted.sort((a, b) => (b.won - a.won) || (b.pts - a.pts));
    }

    const pool = parseFloat(prizePool) || 0;
    const split = prizeSplit || { first: 100, second: 0, third: 0 };
    const percentages = [
        (split.first !== undefined ? Number(split.first) : 100) / 100,
        (split.second !== undefined ? Number(split.second) : 0) / 100,
        (split.third !== undefined ? Number(split.third) : 0) / 100
    ];

    if (!isCompleted) {
        // Tournament is ONGOING: show live match stats, but rank and prize payouts show "-"
        tbody.innerHTML = sorted.map((s) => {
            return `
                <tr class="hover:bg-white/5 transition-colors text-xs font-mono-tag">
                    <td class="py-3 px-4 text-center text-neutral-400 font-bold">-</td>
                    <td class="py-3 px-4 text-neutral-200 font-bold uppercase tracking-wide truncate max-w-[180px] sm:max-w-xs">${escapeHtml(s.name)}</td>
                    <td class="py-3 px-4 text-center text-emerald-400 font-bold">${s.won}</td>
                    <td class="py-3 px-4 text-center text-rose-400 font-bold">${s.lost}</td>
                    <td class="py-3 px-4 text-center text-neutral-300 font-bold">${s.pts}</td>
                    <td class="py-3 px-4 text-right text-neutral-500 font-bold">-</td>
                </tr>
            `;
        }).join('');
        return;
    }

    // Tournament is COMPLETED / FINISHED: show final ranks and official prize payouts
    tbody.innerHTML = sorted.map((s, idx) => {
        const rank = idx + 1;
        let rankBadge, rowHighlight, nameClass, prizeBadge;

        if (rank === 1) {
            rankBadge = `<span class="inline-flex items-center justify-center gap-1 w-12 py-1 rounded-md bg-[#FFD700]/20 text-[#FFD700] border border-[#FFD700]/40 font-bold text-[10px] shadow-[0_0_10px_rgba(255,215,0,0.2)]">1ST PLACE</span>`;
            rowHighlight = `bg-gradient-to-r from-[#FFD700]/10 via-transparent to-transparent border-l-4 border-l-[#FFD700]`;
            nameClass = `text-[#FFD700] font-black`;
            prizeBadge = (percentages[0] > 0) 
                ? `<span class="text-[#FFD700] font-extrabold font-heading text-xs">₱${(pool * percentages[0]).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>` 
                : `<span class="text-neutral-500 font-mono-tag text-xs">-</span>`;
        } else if (rank === 2 && percentages[1] > 0) {
            rankBadge = `<span class="inline-flex items-center justify-center gap-1 w-12 py-1 rounded-md bg-slate-300/20 text-slate-200 border border-slate-300/40 font-bold text-[10px]">2ND PLACE</span>`;
            rowHighlight = `bg-gradient-to-r from-slate-400/5 via-transparent to-transparent border-l-4 border-l-slate-300`;
            nameClass = `text-slate-100 font-bold`;
            prizeBadge = `<span class="text-slate-200 font-extrabold font-heading text-xs">₱${(pool * percentages[1]).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>`;
        } else if (rank === 3 && percentages[2] > 0) {
            rankBadge = `<span class="inline-flex items-center justify-center gap-1 w-12 py-1 rounded-md bg-amber-600/20 text-amber-400 border border-amber-600/40 font-bold text-[10px]">3RD PLACE</span>`;
            rowHighlight = `bg-gradient-to-r from-amber-600/5 via-transparent to-transparent border-l-4 border-l-amber-600`;
            nameClass = `text-amber-300 font-bold`;
            prizeBadge = `<span class="text-amber-400 font-extrabold font-heading text-xs">₱${(pool * percentages[2]).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>`;
        } else {
            rankBadge = `<span class="text-neutral-500 font-mono-tag font-bold text-xs">#${String(rank).padStart(2, '0')}</span>`;
            rowHighlight = `hover:bg-white/5`;
            nameClass = `text-neutral-300 font-medium`;
            prizeBadge = `<span class="text-neutral-500 font-mono-tag text-xs">-</span>`;
        }

        return `
            <tr class="${rowHighlight} transition-colors text-xs font-mono-tag">
                <td class="py-3 px-4 text-center">${rankBadge}</td>
                <td class="py-3 px-4 ${nameClass} uppercase tracking-wide truncate max-w-[180px] sm:max-w-xs">${escapeHtml(s.name)}</td>
                <td class="py-3 px-4 text-center text-emerald-400 font-bold">${s.won}</td>
                <td class="py-3 px-4 text-center text-rose-400 font-bold">${s.lost}</td>
                <td class="py-3 px-4 text-center text-neutral-300 font-bold">${s.pts}</td>
                <td class="py-3 px-4 text-right">${prizeBadge}</td>
            </tr>
        `;
    }).join('');
}

function renderParticipantsList(participants) {
    const list = document.getElementById('participantsList');
    const countBadge = document.getElementById('teamsCountBadge');
    const toggleWrap = document.getElementById('rosterViewToggleWrap');
    const soloCountPill = document.getElementById('soloQueueCountPill');
    if (!list) return;

    const t = currentEditingTournament;
    const soloList = (t && t.soloQueue) ? t.soloQueue : [];
    const count = participants ? participants.length : 0;

    if (soloCountPill) soloCountPill.textContent = soloList.length;

    // Show toggle if tournament supports solo or has solo players
    const isSoloTournament = t && (t.registrationType === 'solo' || Number(t.teamSize) === 1);
    if (toggleWrap) {
        const hasSoloSupport = t && (t.registrationType === 'solo' || t.registrationType === 'hybrid' || soloList.length > 0);
        toggleWrap.classList.toggle('hidden', !hasSoloSupport);
        toggleWrap.classList.toggle('flex', hasSoloSupport);
    }

    if (countBadge) {
        const unitLabel = isSoloTournament 
            ? (count === 1 ? 'PLAYER' : 'PLAYERS') 
            : (count === 1 ? 'TEAM' : 'TEAMS');
        countBadge.innerHTML = `
            <span class="px-2.5 py-1 rounded-full bg-[#FFD700]/10 border border-[#FFD700]/30 text-[#FFD700] font-bold text-[10px] font-mono-tag tracking-wider">
                ${count} ${unitLabel} REGISTERED
            </span>
        `;
    }

    if (!participants || participants.length === 0) {
        list.innerHTML = `
            <div class="col-span-full py-12 text-center bg-[#070709] border border-white/5 rounded-2xl p-6">
                <div class="w-10 h-10 rounded-xl bg-white/[0.03] border border-white/10 flex items-center justify-center mx-auto mb-3 text-neutral-500">
                    <svg class="w-5 h-5 text-neutral-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.75" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                    </svg>
                </div>
                <div class="text-neutral-300 font-heading font-bold text-xs uppercase tracking-wider">${isSoloTournament ? 'No Players Registered Yet' : 'No Teams Registered Yet'}</div>
                <p class="text-neutral-500 font-mono-tag text-[11px] mt-1">${isSoloTournament ? 'Be the first competitor to register for this tournament.' : 'Be the first squad to register for this tournament.'}</p>
            </div>
        `;
    } else {
        const auth = getAuth();
        const currentUser = auth.currentUser;
        const isStaff = isTournamentStaff(currentEditingTournament, currentUser);

        list.innerHTML = participants.map((p, idx) => {
            const name = typeof p === 'object' ? (p.name || 'Unnamed') : p;
            const captain = typeof p === 'object' && p.captain ? p.captain : name;
            const members = typeof p === 'object' && Array.isArray(p.members) ? p.members : [];
            const memberCount = members.length || (isSoloTournament ? 1 : 0);
            const initial = name.charAt(0).toUpperCase();
            const isAutoSquad = typeof p === 'object' && (p.isSoloSquad || p.name?.includes('(Solo)'));

            let nameClass = "text-white";
            let actionButtons = "";

            if (currentUser && typeof p === 'object') {
                if (p.registeredBy === currentUser.uid) {
                    nameClass = "text-green-400";
                    if (p.applicationId) {
                        actionButtons = `
                            <div class="flex gap-1 items-center mr-1">
                                <button type="button" onclick="event.stopPropagation(); window.openJoinForm('${currentEditingTournament?.id}', true, '${p.applicationId}')" class="text-neutral-400 hover:text-[var(--gold)] transition-colors p-1" title="Edit Entry">
                                    <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                                </button>
                                <button type="button" onclick="event.stopPropagation(); window.withdrawApplication('${currentEditingTournament?.id}', '${p.applicationId}')" class="text-neutral-400 hover:text-red-500 transition-colors p-1" title="Withdraw Entry">
                                    <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                </button>
                            </div>
                        `;
                    }
                } else if (p.teamId && currentUserTeamIds.has(p.teamId)) {
                    nameClass = "text-blue-400";
                }
            }

            return `
                <div class="bg-[#111116] border border-white/10 hover:border-[#FFD700]/40 rounded-xl p-3.5 flex flex-col justify-between shadow-lg hover:shadow-[0_4px_20px_rgba(0,0,0,0.6)] transition-all group">
                    <div class="flex items-start justify-between gap-3 mb-2.5">
                        <div class="flex items-center gap-3 min-w-0">
                            <div class="w-10 h-10 rounded-xl bg-gradient-to-br from-white/10 to-white/5 border border-white/15 flex items-center justify-center font-heading font-black text-white group-hover:text-[#FFD700] group-hover:border-[#FFD700]/40 transition-colors shrink-0 text-base shadow-inner font-mono-tag">
                                ${escapeHtml(initial)}
                            </div>
                            <div class="min-w-0">
                                <div class="font-heading font-bold ${nameClass} text-sm uppercase tracking-wide truncate group-hover:text-[#FFD700] transition-colors flex items-center gap-1.5">
                                    <span>${escapeHtml(name)}</span>
                                    ${isAutoSquad && !isSoloTournament ? '<span class="px-1.5 py-0.2 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30 text-[9px] font-mono-tag font-bold">Auto-Team</span>' : ''}
                                </div>
                                <div class="text-[11px] text-neutral-400 font-mono-tag flex items-center gap-1.5 mt-0.5 truncate">
                                    ${isSoloTournament 
                                        ? `<span>Solo Competitor</span>` 
                                        : `<span>Cap: <strong class="text-neutral-200">${escapeHtml(captain)}</strong></span>`}
                                </div>
                            </div>
                        </div>
                        <div class="flex items-center gap-1.5 shrink-0">
                            ${actionButtons}
                            ${isStaff ? `
                                <button type="button" onclick="event.stopPropagation(); window.toggleSingleTeamCheckIn(${idx})" 
                                    class="px-2 py-1 rounded ${p.checkedIn ? 'bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40' : 'bg-[#FFD700] hover:bg-[#FFF099] text-black'} text-[9px] font-heading font-black uppercase transition-all cursor-pointer shadow-sm flex items-center gap-1"
                                    title="${p.checkedIn ? 'Organizer: Click to Mark Unready' : 'Organizer: Click to Ready Up this team'}">
                                    <span>${p.checkedIn ? '✓ Ready' : '+ Ready Up'}</span>
                                </button>
                            ` : (
                                p.checkedIn ? '<span class="text-[9px] font-mono-tag font-bold uppercase bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 px-1.5 py-0.5 rounded">Ready</span>' : (currentEditingTournament?.checkInOpen ? '<span class="text-[9px] font-mono-tag font-bold uppercase bg-amber-500/15 text-amber-400 border border-amber-500/30 px-1.5 py-0.5 rounded">Pending Check-In</span>' : '')
                            )}
                            <span class="text-[10px] font-mono-tag font-bold text-neutral-400 bg-white/5 border border-white/10 px-2 py-0.5 rounded-md">
                                #${String(idx + 1).padStart(2, '0')}
                            </span>
                        </div>
                    </div>

                    <div class="flex items-center justify-between gap-2 pt-2.5 border-t border-white/5 font-mono-tag text-xs">
                        <div class="text-[11px] text-neutral-400 flex items-center gap-1">
                            <svg class="w-3.5 h-3.5 text-neutral-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"/></svg>
                            <span>${isSoloTournament ? '1v1 Competitor' : (memberCount > 0 ? `${memberCount} Players` : 'Solo / Team')}</span>
                        </div>
                        ${!isSoloTournament ? `
                            <button type="button" onclick="window.viewTeamMembers('${escapeHtml(name)}')" class="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-white/5 hover:bg-[#FFD700]/10 border border-white/10 hover:border-[#FFD700]/40 text-neutral-300 hover:text-[#FFD700] text-[10px] font-bold uppercase transition-all cursor-pointer">
                                <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg>
                                <span>Roster</span>
                            </button>
                        ` : ''}
                    </div>
                </div>
            `;
        }).join('');
    }

    renderSoloQueueList(t);
}

function renderSoloQueueList(t) {
    const container = document.getElementById('soloQueueList');
    const orgBanner = document.getElementById('soloQueueOrganizerBanner');
    const statusText = document.getElementById('soloQueueStatusText');
    const autoBtn = document.getElementById('autoTeamBtn');
    if (!container) return;

    if (!t) t = currentEditingTournament;
    const soloList = (t && t.soloQueue) ? t.soloQueue : [];
    const teamSize = (t && t.teamSize) ? Number(t.teamSize) : 5;
    const queuedPlayers = soloList.filter(p => p.status === 'Queued');
    const readySquads = Math.floor(queuedPlayers.length / teamSize);

    const auth = getAuth();
    const currentUser = auth.currentUser;
    const role = String(window.currentUserRole || '').toLowerCase();
    const isCreator = (currentUser && (t?.createdBy === currentUser.uid || role === 'admin' || role === 'organizer' || ["admin@champzero.com"].includes(currentUser.email)));

    if (orgBanner) {
        orgBanner.classList.toggle('hidden', !isCreator);
        if (isCreator) {
            if (statusText) {
                statusText.innerHTML = `<strong>${queuedPlayers.length}</strong> players queued (${readySquads} squad${readySquads === 1 ? '' : 's'} ready for ${teamSize}v${teamSize}). Auto-balance and populate bracket.`;
            }
            if (autoBtn) {
                autoBtn.disabled = queuedPlayers.length < teamSize;
                autoBtn.className = queuedPlayers.length >= teamSize 
                    ? "px-3.5 py-2 bg-[#FFD700] hover:bg-[#FFF099] text-black font-heading font-extrabold text-xs uppercase tracking-wider rounded-lg transition-all shadow cursor-pointer"
                    : "px-3.5 py-2 bg-white/5 text-neutral-500 border border-white/10 font-heading font-bold text-xs uppercase tracking-wider rounded-lg transition-all cursor-not-allowed";
            }
        }
    }

    if (soloList.length === 0) {
        container.innerHTML = `
            <div class="col-span-full py-10 text-center bg-black/40 border border-dashed border-white/10 rounded-xl p-6">
                <div class="w-8 h-8 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center mx-auto mb-2 text-neutral-400 font-mono-tag font-bold text-xs">SQ</div>
                <div class="text-neutral-300 font-heading font-bold text-xs uppercase">Solo Queue is Empty</div>
                <p class="text-neutral-500 font-mono-tag text-[11px] mt-0.5">Free agent players registering individually will appear here.</p>
            </div>
        `;
        return;
    }

    container.innerHTML = soloList.map((p, idx) => {
        const isMe = currentUser && (p.userId === currentUser.uid || (p.contact && currentUser.email && p.contact.toLowerCase() === currentUser.email.toLowerCase()));
        const isAssigned = p.status && p.status.startsWith('Assigned:');
        const assignedSquad = isAssigned ? p.status.replace('Assigned:', '').trim() : null;

        return `
            <div class="bg-[#111116] border ${isMe ? 'border-[#FFD700]/50 bg-[#FFD700]/5' : 'border-white/10'} rounded-xl p-3 flex flex-col justify-between space-y-2 font-mono-tag text-xs shadow-md">
                <div class="flex items-center justify-between gap-1.5">
                    <div class="flex items-center gap-2 min-w-0">
                        <div class="w-7 h-7 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center font-bold text-white text-xs shrink-0">
                            ${(p.ign || 'P').charAt(0).toUpperCase()}
                        </div>
                        <div class="min-w-0">
                            <h5 class="font-heading font-black ${isMe ? 'text-[#FFD700]' : 'text-white'} text-xs uppercase truncate">${escapeHtml(p.ign)}</h5>
                            <span class="text-[9px] text-neutral-400 truncate block">${escapeHtml(p.role || 'Flex')} • ${escapeHtml(p.rank || 'Unranked')}</span>
                        </div>
                    </div>
                    <div class="shrink-0">
                        ${isAssigned ? `
                            <span class="px-1.5 py-0.5 rounded text-[8px] font-bold uppercase bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 truncate max-w-[90px] block" title="${escapeHtml(assignedSquad)}">
                                Squad
                            </span>
                        ` : `
                            <span class="px-1.5 py-0.5 rounded text-[8px] font-bold uppercase bg-amber-500/20 text-amber-300 border border-amber-500/40">
                                Queued
                            </span>
                        `}
                    </div>
                </div>

                ${p.notes ? `
                    <p class="text-[10px] text-neutral-400 italic truncate font-sans">${escapeHtml(p.notes)}</p>
                ` : ''}

                <div class="pt-1.5 border-t border-white/5 flex items-center justify-between text-[10px]">
                    <span class="text-neutral-500">${isAssigned ? `Team: <strong class="text-white">${escapeHtml(assignedSquad)}</strong>` : `Slot #${idx + 1}`}</span>
                    ${isMe && !isAssigned ? `
                        <button type="button" onclick="window.cancelSoloRegistration('${t.id}')" class="text-red-400 hover:text-red-300 uppercase font-bold text-[9px] hover:underline cursor-pointer">Leave Queue</button>
                    ` : ''}
                </div>
            </div>
        `;
    }).join('');
}

window.switchRosterSubView = function(view) {
    const teamsBtn = document.getElementById('showTeamsBtn');
    const soloBtn = document.getElementById('showSoloBtn');
    const participantsList = document.getElementById('participantsList');
    const soloQueueContainer = document.getElementById('soloQueueContainer');
    const tabTitle = document.getElementById('rosterTabTitle');

    if (view === 'solo') {
        if (soloBtn) { soloBtn.className = "px-2.5 py-1 rounded-md bg-[#FFD700] text-black font-extrabold uppercase transition-all cursor-pointer flex items-center gap-1"; }
        if (teamsBtn) { teamsBtn.className = "px-2.5 py-1 rounded-md text-neutral-400 hover:text-white uppercase font-bold transition-all cursor-pointer"; }
        if (participantsList) participantsList.classList.add('hidden');
        if (soloQueueContainer) soloQueueContainer.classList.remove('hidden');
        if (tabTitle) tabTitle.textContent = "Solo Queue / Free Agents";
        renderSoloQueueList(currentEditingTournament);
    } else {
        if (teamsBtn) { teamsBtn.className = "px-2.5 py-1 rounded-md bg-[#FFD700] text-black font-extrabold uppercase transition-all cursor-pointer"; }
        if (soloBtn) { soloBtn.className = "px-2.5 py-1 rounded-md text-neutral-400 hover:text-white uppercase font-bold transition-all cursor-pointer flex items-center gap-1"; }
        if (participantsList) participantsList.classList.remove('hidden');
        if (soloQueueContainer) soloQueueContainer.classList.add('hidden');
        if (tabTitle) tabTitle.textContent = "Confirmed Teams";
    }
};

window.autoTeamSoloPlayers = async function (tournamentId) {
    if (!tournamentId) tournamentId = currentEditingTournament?.id;
    if (!tournamentId) return;

    try {
        const tourneyRef = doc(db, "tournaments", tournamentId);
        const tSnap = await getDoc(tourneyRef);
        if (!tSnap.exists()) return;
        const tData = tSnap.data();

        const soloList = tData.soloQueue || [];
        const queuedPlayers = soloList.filter(p => p.status === 'Queued');
        const teamSize = Number(tData.teamSize) || (tData.registrationType === 'solo' ? 1 : 5);

        if (queuedPlayers.length < teamSize) {
            alert(`Need at least ${teamSize} queued solo player${teamSize === 1 ? '' : 's'} to form a roster entry. Currently have ${queuedPlayers.length}.`);
            return;
        }

        const numberOfSquads = Math.floor(queuedPlayers.length / teamSize);
        const confirmAuto = await window.showCustomConfirm(
            teamSize === 1 ? "Populate 1v1 Bracket?" : "Automate Squad Teaming?",
            teamSize === 1
                ? `This will place ${numberOfSquads} solo player(s) directly into the competitive tournament bracket.`
                : `This will automatically group ${numberOfSquads * teamSize} solo players into ${numberOfSquads} full competitive squad(s) and register them directly to the tournament roster.`
        );
        if (!confirmAuto) return;

        const squadNamePool = [
            "Vanguard Titans", "Apex Phantoms", "Shadow Syndicate", "Eclipse Legion",
            "Nova Sentinels", "Vortex Strikers", "Pulse Reapers", "Hyperion Elite",
            "Nebula Protocol", "Zenith Warriors", "Cyber Wolves", "Astral Knights"
        ];

        let participants = tData.participants || [];
        let updatedSoloQueue = [...soloList];

        const shuffled = [...queuedPlayers].sort(() => Math.random() - 0.5);
        const newTeamsCreated = [];

        for (let i = 0; i < numberOfSquads; i++) {
            const squadPlayers = shuffled.slice(i * teamSize, (i + 1) * teamSize);
            const baseName = squadNamePool[i % squadNamePool.length];
            const captainPlayer = squadPlayers[0];
            const squadName = teamSize === 1 ? captainPlayer.ign : `${baseName} (Solo ${i + 1})`;

            const memberUids = squadPlayers.map(p => p.userId).filter(Boolean);
            const newSquad = {
                name: squadName,
                captain: captainPlayer.ign,
                contact: captainPlayer.contact || '',
                phone: captainPlayer.phone || '',
                members: squadPlayers.map(p => p.ign),
                memberUids: memberUids,
                registeredBy: captainPlayer.userId || tData.createdBy || 'system',
                userId: captainPlayer.userId || null,
                isSoloSquad: teamSize > 1,
                isSoloCompetitor: teamSize === 1,
                createdAt: Date.now()
            };

            participants.push(newSquad);
            newTeamsCreated.push(squadName);

            squadPlayers.forEach(sp => {
                const qIdx = updatedSoloQueue.findIndex(p => (p.id && p.id === sp.id) || (p.userId && p.userId === sp.userId) || p.ign === sp.ign);
                if (qIdx !== -1) {
                    updatedSoloQueue[qIdx].status = `Assigned: ${squadName}`;
                    updatedSoloQueue[qIdx].assignedSquad = squadName;
                    updatedSoloQueue[qIdx].assignedAt = Date.now();
                }

                if (sp.userId) {
                    try {
                        addDoc(collection(db, "notifications"), {
                            userId: sp.userId,
                            title: "Squad Teaming Update",
                            message: `You have been placed in squad "${squadName}" for ${tData.name}! Check the roster directory.`,
                            tournamentId: tournamentId,
                            type: "solo_teaming",
                            read: false,
                            createdAt: serverTimestamp()
                        });
                    } catch (err) { console.warn("Notification skipped:", err); }
                }
            });
        }

        await updateDoc(tourneyRef, {
            participants: participants,
            soloQueue: updatedSoloQueue
        });

        if (currentEditingTournament && currentEditingTournament.id === tournamentId) {
            currentEditingTournament.participants = participants;
            currentEditingTournament.soloQueue = updatedSoloQueue;
            renderParticipantsList(participants);
            renderBracket(participants, currentEditingTournament.format, true, currentEditingTournament.isStarted);
        }

        if (window.showSuccessToast) {
            window.showSuccessToast("Auto-Teaming Complete", `Formed ${numberOfSquads} squad(s): ${newTeamsCreated.join(', ')}`);
        }

    } catch (e) {
        console.error("Auto teaming error:", e);
        alert("Failed to auto-team solo players: " + e.message);
    }
};

window.handleAutoTeamClick = function() {
    if (currentEditingTournament) {
        window.autoTeamSoloPlayers(currentEditingTournament.id);
    }
};

window.cancelSoloRegistration = async function (tournamentId) {
    if (!tournamentId) tournamentId = currentEditingTournament?.id;
    if (!tournamentId) return;

    const auth = getAuth();
    const user = auth.currentUser;
    if (!user) return;

    const confirmLeave = confirm("Are you sure you want to leave the Solo Free Agent Queue?");
    if (!confirmLeave) return;

    try {
        const tourneyRef = doc(db, "tournaments", tournamentId);
        const tSnap = await getDoc(tourneyRef);
        if (!tSnap.exists()) return;
        const tData = tSnap.data();

        let soloList = tData.soloQueue || [];
        soloList = soloList.filter(p => p.userId !== user.uid && p.id !== user.uid);

        await updateDoc(tourneyRef, { soloQueue: soloList });
        if (currentEditingTournament && currentEditingTournament.id === tournamentId) {
            currentEditingTournament.soloQueue = soloList;
            renderSoloQueueList(currentEditingTournament);
            renderParticipantsList(currentEditingTournament.participants);
            if (window.openModal) window.openModal(currentEditingTournament);
        }

        if (window.showSuccessToast) window.showSuccessToast("Left Queue", "You have been removed from the Solo Queue.");
    } catch (e) {
        console.error(e);
        alert("Failed to leave queue: " + e.message);
    }
};

// --- TOURNAMENT MANAGEMENT (START, RESET, DELETE) ---
async function startTournament() {
    const confirmStart = await window.showCustomConfirm("Start Tournament?", "This will close registration and generate the elimination bracket.");
    if (!confirmStart) return;

    try {
        const ref = doc(db, "tournaments", currentEditingTournament.id);
        const participants = currentEditingTournament.participants || [];
        if (participants.length < 2) { alert("Need at least 2 teams to start."); return; }

        let matches;
        if (currentEditingTournament.format === 'Double Elimination') {
            matches = generateDoubleEliminationMatches(participants);
        } else if (currentEditingTournament.format === 'Round Robin') {
            matches = generateRoundRobinMatches(participants);
        } else {
            matches = generateInitialMatches(participants, currentEditingTournament.format);
        }

        // Initialize Lobby Timers for active round 1 matches
        const now = Date.now();
        matches.forEach(m => {
            if (m.team1 && m.team2 && m.team1 !== 'TBD' && m.team2 !== 'TBD' && m.team1 !== 'BYE' && m.team2 !== 'BYE') {
                m.startedAt = now;
                m.durationMins = 15;
            }
        });

        await updateDoc(ref, { isStarted: true, status: 'Ongoing', matches: matches, checkInOpen: false });
        if (window.showSuccessToast) window.showSuccessToast("Success", "Tournament Started!");
    } catch (e) { console.error("Start error:", e); alert("Failed to start: " + e.message); }
}

async function deleteTournament(id) {
    const confirmed = await window.showCustomConfirm(
        "Delete Tournament?",
        "Are you sure? This will permanently remove the tournament, bracket, and all records."
    );
    if (!confirmed) return;

    try {
        await deleteDoc(doc(db, "tournaments", id));

        // Delete any notifications associated with this tournament
        try {
            const notifSnaps = await getDocs(query(collection(db, "notifications"), where("tournamentId", "==", id)));
            notifSnaps.forEach(d => deleteDoc(d.ref).catch(() => {}));
            const notifLinkSnaps = await getDocs(query(collection(db, "notifications"), where("link", "==", `/tournaments?id=${id}`)));
            notifLinkSnaps.forEach(d => deleteDoc(d.ref).catch(() => {}));
        } catch (_) {}

        if (window.showSuccessToast) window.showSuccessToast("Deleted", "Tournament successfully removed.");
        window.closeModal('detailsModal');
        window.history.replaceState({}, '', window.location.pathname);
        fetchTournaments();
    } catch (e) {
        console.error("Delete failed:", e);
        alert("Failed to delete tournament: " + e.message);
    }
}

window.resetTournament = async (id) => {
    const confirmed = await window.showCustomConfirm(
        "Reset Tournament?",
        "Are you sure? This will permanently delete the current bracket and match history. Registered teams will remain."
    );
    if (!confirmed) return;

    try {
        await updateDoc(doc(db, "tournaments", id), {
            isStarted: false,
            status: 'Open',
            matches: []
        });
        if (window.showSuccessToast) window.showSuccessToast("Success", "Tournament reset successfully.");
    } catch (e) {
        console.error("Reset failed:", e);
        alert("Failed to reset tournament: " + e.message);
    }
};

window.toggleCancelTournament = async function(id) {
    if (!id) id = currentEditingTournament?.id;
    if (!id) return;
    const tourn = (allTournaments && allTournaments.find(item => item.id === id)) || currentEditingTournament;
    const isCurrentlyCancelled = (tourn?.status === 'Cancelled' || tourn?.isCancelled);

    const confirmed = await window.showCustomConfirm(
        isCurrentlyCancelled ? "Reopen Tournament?" : "Cancel Tournament?",
        isCurrentlyCancelled 
            ? "Are you sure you want to reopen this tournament? Registrations will be re-enabled." 
            : "Are you sure you want to cancel this tournament? This will mark it as Cancelled and close all registrations."
    );
    if (!confirmed) return;

    try {
        const newStatus = isCurrentlyCancelled ? 'Open' : 'Cancelled';
        await updateDoc(doc(db, "tournaments", id), {
            status: newStatus,
            isCancelled: !isCurrentlyCancelled,
            updatedAt: serverTimestamp()
        });

        if (currentEditingTournament && currentEditingTournament.id === id) {
            currentEditingTournament.status = newStatus;
            currentEditingTournament.isCancelled = !isCurrentlyCancelled;
            renderTournamentView(currentEditingTournament);
        }

        fetchTournaments();

        if (window.showSuccessToast) {
            window.showSuccessToast(
                isCurrentlyCancelled ? "Tournament Reopened" : "Tournament Cancelled",
                isCurrentlyCancelled ? "The tournament is now active." : "The tournament has been marked as cancelled."
            );
        }
    } catch (e) {
        console.error("Error toggling tournament cancellation:", e);
        alert("Failed to update tournament status: " + e.message);
    }
};

window.toggleArchiveTournament = async function(id) {
    if (!id) id = currentEditingTournament?.id;
    if (!id) return;
    const tourn = (allTournaments && allTournaments.find(item => item.id === id)) || currentEditingTournament;
    const isArchived = (tourn?.archived === true || tourn?.isArchived === true || tourn?.status === 'Archived');
    const newArchived = !isArchived;

    const confirmed = await window.showCustomConfirm(
        newArchived ? "Archive Tournament?" : "Unarchive Tournament?",
        newArchived 
            ? "Archiving hides this tournament from the active public schedule and moves it to the archive. All match records, brackets, and standings will be safely preserved." 
            : "Unarchiving will restore this tournament to the active public tournament listings."
    );
    if (!confirmed) return;

    try {
        const auth = getAuth();
        await updateDoc(doc(db, "tournaments", id), {
            archived: newArchived,
            isArchived: newArchived,
            archivedAt: newArchived ? new Date().toISOString() : null,
            archivedBy: newArchived ? (auth.currentUser?.email || 'admin@champzero.com') : null,
            updatedAt: serverTimestamp()
        });

        if (currentEditingTournament && currentEditingTournament.id === id) {
            currentEditingTournament.archived = newArchived;
            currentEditingTournament.isArchived = newArchived;
            renderTournamentView(currentEditingTournament);
        }

        fetchTournaments();

        if (window.showSuccessToast) {
            window.showSuccessToast(
                newArchived ? "Tournament Archived" : "Tournament Restored",
                newArchived ? "Moved to the archive collection." : "The tournament is now live in active listings."
            );
        }
    } catch (e) {
        console.error("Error toggling tournament archive status:", e);
        if (window.showErrorToast) {
            window.showErrorToast("Archive Error", "Failed to update archive status: " + e.message);
        } else {
            alert("Failed to update tournament: " + e.message);
        }
    }
};

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

function generateInitialMatches(participants, format) {
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
    let roundCount = Math.log2(size);

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
            nextMatchId: (roundCount === 1) ? null : `2-${Math.floor(i / 2) + 1}`
        });
    }

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

    // Add 3rd Place Decider Match for Single Elimination with 4+ participants
    if (size >= 4) {
        matches.push({
            id: 'M-3RD',
            round: roundCount,
            matchNumber: matchIdCounter++,
            isBronzeMatch: true,
            label: '3rd Place Decider',
            team1: 'TBD',
            team2: 'TBD',
            score1: null,
            score2: null,
            winner: null,
            nextMatchId: null
        });

        const semi1 = matches.find(m => m.id === `${roundCount - 1}-1`);
        const semi2 = matches.find(m => m.id === `${roundCount - 1}-2`);
        if (semi1) semi1.loserMatchId = 'M-3RD';
        if (semi2) semi2.loserMatchId = 'M-3RD';
    }

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

function generateRoundRobinMatches(participants) {
    let teams = participants.map(p => typeof p === 'object' ? p.name : p);
    if (teams.length % 2 !== 0) teams.push("BYE");
    
    const n = teams.length;
    const rounds = n - 1;
    const matchesPerRound = n / 2;
    let matches = [];
    let matchIdCounter = 1;

    for (let r = 0; r < rounds; r++) {
        for (let i = 0; i < matchesPerRound; i++) {
            const t1 = teams[i];
            const t2 = teams[n - 1 - i];

            if (t1 !== "BYE" && t2 !== "BYE") {
                matches.push({
                    id: `RR-R${r + 1}-M${i + 1}`,
                    round: r + 1,
                    matchNumber: matchIdCounter++,
                    team1: t1,
                    team2: t2,
                    score1: null,
                    score2: null,
                    winner: null,
                    nextMatchId: null
                });
            }
        }
        teams.splice(1, 0, teams.pop());
    }

    return matches;
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

    for (let r = 1; r <= wbRounds; r++) {
        let count = size / Math.pow(2, r);
        for (let i = 0; i < count; i++) {
            let id = `WB-R${r}-M${i + 1}`;
            let nextId = (r < wbRounds) ? `WB-R${r + 1}-M${Math.floor(i / 2) + 1}` : `GF-1`;

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
                nextId = `LB-R${r + 1}-M${i + 1}`;
            } else {
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

    matches.sort((a, b) => {
        if (a.bracket === 'upper' && b.bracket === 'lower') return -1;
        if (a.bracket === 'lower' && b.bracket === 'upper') return 1;
        return a.round - b.round;
    });

    matches.forEach(m => {
        let advanced = false;
        let winnerName = null;
        let loserName = null;

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
            m.winner = 'BYE';
            winnerName = 'BYE';
            loserName = 'BYE';
            advanced = true;
        }

        if (advanced) {
            if (m.nextMatchId && winnerName) {
                const nextMatch = matches.find(nm => nm.id === m.nextMatchId);
                if (nextMatch) {
                    if (nextMatch.team1 === 'TBD' || nextMatch.team1 === 'BYE') nextMatch.team1 = winnerName;
                    else nextMatch.team2 = winnerName;
                }
            }

            if (m.bracket === 'upper' && m.loserMatchId && loserName) {
                const loserMatch = matches.find(lm => lm.id === m.loserMatchId);
                if (loserMatch) {
                    if (loserMatch.team1 === 'TBD') loserMatch.team1 = loserName;
                    else loserMatch.team2 = loserName;
                }
            }
        }
    });

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

function resolveByes(matches) {
    let globalChange = false;
    let loopChange = true;
    let loopCount = 0;

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
            if (m.winner === 'TBD' || m.winner === 'BYE') {
                 const isDoubleBye = isBye(m.team1) && isBye(m.team2);
                 if (!isDoubleBye && m.winner === 'TBD') {
                     m.winner = null;
                     m.score1 = null;
                     m.score2 = null;
                     loopChange = true; 
                     globalChange = true;
                 }
            }

            let winnerName = m.winner;
            let loserName = null;

            if (!winnerName) {
                let realTeam = null;
                let winnerSide = 0;

                if (isBye(m.team2) && !isBye(m.team1) && !isTbd(m.team1)) {
                    realTeam = m.team1; winnerSide = 1;
                } else if (isBye(m.team1) && !isBye(m.team2) && !isTbd(m.team2)) {
                    realTeam = m.team2; winnerSide = 2;
                } else if (isBye(m.team1) && isBye(m.team2)) {
                    realTeam = 'BYE'; winnerSide = 1;
                }

                if (realTeam) {
                    m.winner = realTeam;
                    m.score1 = (winnerSide === 1) ? 1 : 0;
                    m.score2 = (winnerSide === 2) ? 1 : 0;
                    winnerName = realTeam;
                    loopChange = true; globalChange = true;
                }
            }

            if (winnerName) {
                if (winnerName === m.team1) loserName = m.team2;
                else if (winnerName === m.team2) loserName = m.team1;
            }

            if (winnerName && !isTbd(winnerName)) {
                let nextMatch = null;
                if (m.nextMatchId) {
                    nextMatch = matches.find(nm => nm.id === m.nextMatchId);
                }

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
                            nextMatch.team1 = winnerName;
                            nextMatch.winner = null; nextMatch.score1 = null; nextMatch.score2 = null;
                            loopChange = true; globalChange = true;
                        } else if (isTbd(nextMatch.team2)) {
                            nextMatch.team2 = winnerName;
                            nextMatch.winner = null; nextMatch.score1 = null; nextMatch.score2 = null;
                            loopChange = true; globalChange = true;
                        }
                    }
                }
            }

            if (m.bracket === 'upper' && m.loserMatchId && loserName && !isTbd(loserName)) {
                const loserMatch = matches.find(lm => lm.id === m.loserMatchId);
                if (loserMatch) {
                    const alreadyIn = (String(loserMatch.team1) === String(loserName) || String(loserMatch.team2) === String(loserName));
                    if (!alreadyIn) {
                        if (isTbd(loserMatch.team1)) {
                            loserMatch.team1 = loserName;
                            loserMatch.winner = null; 
                            loopChange = true; globalChange = true;
                        } else if (isTbd(loserMatch.team2)) {
                            loserMatch.team2 = loserName;
                            loserMatch.winner = null;
                            loopChange = true; globalChange = true;
                        }
                    }
                }
            }
        });
    }
    return globalChange;
}

// --- BRACKET ROUND FORMAT CONFIGURATION (BO1, BO3, BO5, BO7) ---
function getRoundFormat(t, roundKey, defaultVal = null) {
    if (!roundKey) return defaultVal || 'BO1';
    const cleanKey = String(roundKey).trim();
    if (t?.roundFormats && t.roundFormats[cleanKey]) {
        return t.roundFormats[cleanKey];
    }
    if (t?.roundFormats) {
        for (const [k, v] of Object.entries(t.roundFormats)) {
            if (k.toLowerCase() === cleanKey.toLowerCase()) return v;
        }
    }
    if (defaultVal) return defaultVal;

    const keyLower = cleanKey.toLowerCase();
    if (keyLower.includes('grand') || keyLower === 'gf' || keyLower === 'final' || keyLower === 'finals') {
        return 'BO5';
    }
    if (keyLower.includes('semi') || keyLower.includes('ub final') || keyLower.includes('lb final') || keyLower.includes('3rd') || keyLower.includes('bronze')) {
        return 'BO3';
    }
    return 'BO1';
}
window.getRoundFormat = getRoundFormat;

function getTournamentRoundKeys(t) {
    if (!t) return [];
    const format = (t.format || 'Single Elimination').trim();
    const maxTeams = Number(t.maxTeams || (t.participants ? t.participants.length : 8)) || 8;
    let size = 2;
    while (size < maxTeams) size *= 2;
    if (size < 4) size = 4;

    const rounds = [];
    if (format === 'Double Elimination') {
        const totalWBRounds = Math.log2(size);
        for (let r = 1; r <= totalWBRounds; r++) {
            const name = (r === totalWBRounds) ? "UB Final" : (r === totalWBRounds - 1 && totalWBRounds > 2) ? "UB Semi Finals" : `UB Round ${r}`;
            rounds.push({ key: name, label: `Upper Bracket - ${name}`, defaultFormat: (r === totalWBRounds ? 'BO3' : 'BO1') });
        }
        const totalLBRounds = (totalWBRounds - 1) * 2;
        for (let r = 1; r <= totalLBRounds; r++) {
            const name = (r === totalLBRounds) ? "LB Final" : `LB Round ${r}`;
            rounds.push({ key: name, label: `Lower Bracket - ${name}`, defaultFormat: (r === totalLBRounds ? 'BO3' : 'BO1') });
        }
        rounds.push({ key: "Grand Final", label: "Championship - Grand Final", defaultFormat: "BO5" });
    } else if (format === 'Round Robin') {
        const numTeams = t.participants?.length || maxTeams;
        const totalRounds = (numTeams % 2 === 0) ? numTeams - 1 : numTeams;
        for (let r = 1; r <= Math.max(1, totalRounds); r++) {
            rounds.push({ key: `Round ${r}`, label: `Round Robin - Matchday ${r}`, defaultFormat: "BO1" });
        }
    } else {
        const roundCount = Math.log2(size);
        for (let r = 1; r <= roundCount; r++) {
            let name = `Round ${r}`;
            let defaultFmt = 'BO1';
            if (r === roundCount) {
                name = "Grand Final";
                defaultFmt = 'BO5';
            } else if (r === roundCount - 1) {
                name = "Semi Finals";
                defaultFmt = 'BO3';
            } else if (r === roundCount - 2 && roundCount >= 4) {
                name = "Quarter Finals";
                defaultFmt = 'BO1';
            }
            rounds.push({ key: name, label: name, defaultFormat: defaultFmt });
        }
        if (size >= 4) {
            rounds.push({ key: "3rd Place Decider", label: "Podium - 3rd Place Decider", defaultFormat: "BO3" });
        }
    }
    return rounds;
}
window.getTournamentRoundKeys = getTournamentRoundKeys;

function openEditRoundFormatsModal() {
    const t = currentEditingTournament;
    if (!t) return;
    const modal = document.getElementById('editRoundFormatsModal');
    if (!modal) return;

    const listContainer = document.getElementById('roundFormatsEditorList');
    if (!listContainer) return;
    listContainer.innerHTML = '';

    const roundList = getTournamentRoundKeys(t);
    const existingFormats = t.roundFormats || {};

    roundList.forEach(item => {
        const currentFmt = existingFormats[item.key] || getRoundFormat(t, item.key, item.defaultFormat);
        const row = document.createElement('div');
        row.className = "flex items-center justify-between p-3 bg-black/40 border border-white/10 rounded-xl";
        row.dataset.roundKey = item.key;
        row.innerHTML = `
            <div>
                <span class="font-heading font-bold text-xs uppercase text-white">${escapeHtml(item.label || item.key)}</span>
                <span class="text-[9px] text-neutral-500 font-mono-tag block">Format rule for this stage</span>
            </div>
            <select class="round-format-select dark-select bg-[#111116] border border-white/20 text-white font-mono-tag font-bold text-xs p-2 rounded-lg cursor-pointer">
                <option value="BO1" ${currentFmt === 'BO1' ? 'selected' : ''}>BO1 (Best of 1)</option>
                <option value="BO3" ${currentFmt === 'BO3' ? 'selected' : ''}>BO3 (Best of 3)</option>
                <option value="BO5" ${currentFmt === 'BO5' ? 'selected' : ''}>BO5 (Best of 5)</option>
                <option value="BO7" ${currentFmt === 'BO7' ? 'selected' : ''}>BO7 (Best of 7)</option>
            </select>
        `;
        listContainer.appendChild(row);
    });

    modal.classList.remove('hidden');
    modal.classList.add('flex');
}
window.openEditRoundFormatsModal = openEditRoundFormatsModal;

function applyRoundFormatPreset(preset) {
    const list = document.getElementById('roundFormatsEditorList');
    if (!list) return;
    const rows = list.querySelectorAll('[data-round-key]');

    rows.forEach(row => {
        const key = row.dataset.roundKey.toLowerCase();
        const select = row.querySelector('.round-format-select');
        if (!select) return;

        if (preset === 'all_bo1') {
            select.value = 'BO1';
        } else if (preset === 'all_bo3') {
            select.value = (key.includes('grand') || key === 'final') ? 'BO5' : 'BO3';
        } else if (preset === 'major_bo5') {
            select.value = (key.includes('grand') || key === 'final') ? 'BO7' : 'BO3';
        } else if (preset === 'all_bo5') {
            select.value = 'BO5';
        } else {
            // standard esports
            if (key.includes('grand') || key === 'final') select.value = 'BO5';
            else if (key.includes('semi') || key.includes('ub final') || key.includes('lb final') || key.includes('3rd')) select.value = 'BO3';
            else select.value = 'BO1';
        }
    });

    if (window.showToast) window.showToast(`Applied preset. Click "Save Formats" to confirm.`, 'info');
}
window.applyRoundFormatPreset = applyRoundFormatPreset;

async function saveTournamentRoundFormats() {
    const t = currentEditingTournament;
    if (!t) return;

    const list = document.getElementById('roundFormatsEditorList');
    if (!list) return;

    const saveBtn = document.getElementById('saveRoundFormatsBtn');
    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving...';
    }

    try {
        const updatedFormats = {};
        const rows = list.querySelectorAll('[data-round-key]');
        rows.forEach(row => {
            const key = row.dataset.roundKey;
            const select = row.querySelector('.round-format-select');
            if (key && select) {
                updatedFormats[key] = select.value;
            }
        });

        let updatedMatches = t.matches ? JSON.parse(JSON.stringify(t.matches)) : null;
        if (updatedMatches && Array.isArray(updatedMatches)) {
            const maxDepth = t.matches.reduce((max, m) => Math.max(max, m.round || 1), 1);
            updatedMatches.forEach(m => {
                let matchRoundName = `Round ${m.round}`;
                if (m.isBronzeMatch || m.id === 'M-3RD') matchRoundName = '3rd Place Decider';
                else if (m.bracket === 'final' || m.id === 'GF-1' || (!m.nextMatchId && !m.isBronzeMatch && m.round === maxDepth)) matchRoundName = 'Grand Final';
                else if (m.bracket === 'upper') {
                    const ubMax = t.matches.filter(x => x.bracket === 'upper').reduce((max, x) => Math.max(max, x.round || 1), 1);
                    if (m.round === ubMax) matchRoundName = 'UB Final';
                    else matchRoundName = `UB Round ${m.round}`;
                } else if (m.bracket === 'lower') {
                    const lbMax = t.matches.filter(x => x.bracket === 'lower').reduce((max, x) => Math.max(max, x.round || 1), 1);
                    if (m.round === lbMax) matchRoundName = 'LB Final';
                    else matchRoundName = `LB Round ${m.round}`;
                } else if (m.round === maxDepth - 1 && maxDepth >= 2) {
                    matchRoundName = 'Semi Finals';
                }

                if (updatedFormats[matchRoundName]) {
                    m.format = updatedFormats[matchRoundName];
                }
            });
        }

        const payload = { roundFormats: updatedFormats };
        if (updatedMatches) payload.matches = updatedMatches;

        await updateDoc(doc(db, "tournaments", t.id), payload);

        t.roundFormats = updatedFormats;
        if (updatedMatches) t.matches = updatedMatches;
        currentEditingTournament = t;
        window.currentEditingTournament = t;

        renderTournamentView(t);
        closeModal('editRoundFormatsModal');

        if (window.showSuccessToast) {
            window.showSuccessToast("Round Formats Saved", "Bracket rules updated for all rounds.");
        }
    } catch (e) {
        console.error("Save round formats error:", e);
        alert("Failed to save round formats: " + e.message);
    } finally {
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.textContent = 'Save Formats';
        }
    }
}
window.saveTournamentRoundFormats = saveTournamentRoundFormats;

window.quickEditRoundFormat = async function(roundName, event) {
    if (event) event.stopPropagation();
    const t = currentEditingTournament;
    if (!t) return;

    const currentFmt = getRoundFormat(t, roundName);
    const formats = ['BO1', 'BO3', 'BO5', 'BO7'];
    const nextIdx = (formats.indexOf(currentFmt) + 1) % formats.length;
    const nextFmt = formats[nextIdx];

    const currentFormats = t.roundFormats ? { ...t.roundFormats } : {};
    currentFormats[roundName] = nextFmt;

    let updatedMatches = t.matches ? JSON.parse(JSON.stringify(t.matches)) : null;
    if (updatedMatches && Array.isArray(updatedMatches)) {
        const maxDepth = t.matches.reduce((max, m) => Math.max(max, m.round || 1), 1);
        updatedMatches.forEach(m => {
            let matchRoundName = `Round ${m.round}`;
            if (m.isBronzeMatch || m.id === 'M-3RD') matchRoundName = '3rd Place Decider';
            else if (m.bracket === 'final' || m.id === 'GF-1' || (!m.nextMatchId && !m.isBronzeMatch && m.round === maxDepth)) matchRoundName = 'Grand Final';
            else if (m.bracket === 'upper') {
                const ubMax = t.matches.filter(x => x.bracket === 'upper').reduce((max, x) => Math.max(max, x.round || 1), 1);
                if (m.round === ubMax) matchRoundName = 'UB Final';
                else matchRoundName = `UB Round ${m.round}`;
            } else if (m.bracket === 'lower') {
                const lbMax = t.matches.filter(x => x.bracket === 'lower').reduce((max, x) => Math.max(max, x.round || 1), 1);
                if (m.round === lbMax) matchRoundName = 'LB Final';
                else matchRoundName = `LB Round ${m.round}`;
            } else if (m.round === maxDepth - 1 && maxDepth >= 2) {
                matchRoundName = 'Semi Finals';
            }

            if (matchRoundName === roundName) {
                m.format = nextFmt;
            }
        });
    }

    try {
        const payload = { roundFormats: currentFormats };
        if (updatedMatches) payload.matches = updatedMatches;

        await updateDoc(doc(db, "tournaments", t.id), payload);

        t.roundFormats = currentFormats;
        if (updatedMatches) t.matches = updatedMatches;
        currentEditingTournament = t;
        window.currentEditingTournament = t;
        renderTournamentView(t);
        if (window.showSuccessToast) {
            window.showSuccessToast("Round Format Updated", `${roundName} set to ${nextFmt}`);
        }
    } catch (e) {
        console.error(e);
        openEditRoundFormatsModal();
    }
};

window.handleScoreMatchFormatChange = async function() {
    const matchId = document.getElementById('scoreMatchId')?.value;
    const select = document.getElementById('scoreMatchFormatSelect');
    const display = document.getElementById('scoreMatchFormatDisplay');
    if (!matchId || !select) return;

    const newFmt = select.value;
    if (display) display.textContent = `${newFmt} (${newFmt === 'BO1' ? 'First to 1' : newFmt === 'BO3' ? 'First to 2' : newFmt === 'BO5' ? 'First to 3' : 'First to 4'})`;

    const t = currentEditingTournament;
    if (t?.matches) {
        const m = t.matches.find(x => x.id === matchId);
        if (m) {
            m.format = newFmt;
            try {
                await updateDoc(doc(db, "tournaments", t.id), { matches: t.matches });
            } catch (e) {
                console.error("Match format update error:", e);
            }
        }
    }
};

// --- SCORE SUBMISSIONS ---
window.openScoreModal = function (matchId) {
    const t = currentEditingTournament;
    let match = t.matches?.find(m => m.id === matchId);
    if (!match && t.brackets) {
        for (const round of t.brackets) {
            if (Array.isArray(round)) {
                match = round.find(m => m.id === matchId);
                if (match) break;
            }
        }
    }
    if (!match) return;
    if (match.team1 === 'TBD' || match.team2 === 'TBD' || match.team1 === 'BYE' || match.team2 === 'BYE') return;

    document.getElementById('scoreMatchId').value = matchId;
    document.getElementById('scoreTeam1Name').textContent = match.team1;
    document.getElementById('scoreTeam2Name').textContent = match.team2;
    document.getElementById('scoreTeam1').value = match.score1 || 0;
    document.getElementById('scoreTeam2').value = match.score2 || 0;
    document.getElementById('lblTeam1').textContent = match.team1;
    document.getElementById('lblTeam2').textContent = match.team2;

    // Match Format Rule
    const formatSelect = document.getElementById('scoreMatchFormatSelect');
    const formatDisplay = document.getElementById('scoreMatchFormatDisplay');
    const matchFmt = match.format || getRoundFormat(t, `Round ${match.round}`);
    if (formatSelect) formatSelect.value = matchFmt;
    if (formatDisplay) {
        formatDisplay.textContent = `${matchFmt} (${matchFmt === 'BO1' ? 'First to 1' : matchFmt === 'BO3' ? 'First to 2' : matchFmt === 'BO5' ? 'First to 3' : 'First to 4'})`;
    }

    // Reset / Set Winner Radio
    document.querySelectorAll('input[name="matchWinner"]').forEach(r => r.checked = false);
    if (match.winner === match.team1) document.querySelector('input[value="1"]').checked = true;
    if (match.winner === match.team2) document.querySelector('input[value="2"]').checked = true;

    // 1. Lobby Countdown Timer
    const timerWrap = document.getElementById('scoreLobbyTimerWrap');
    const timerText = document.getElementById('scoreLobbyTimerText');
    if (timerWrap && timerText) {
        if (match.startedAt && !match.winner) {
            timerWrap.classList.remove('hidden');
            const durationMs = (match.durationMins || 15) * 60 * 1000;
            const elapsed = Date.now() - match.startedAt;
            const remainingMs = Math.max(0, durationMs - elapsed);
            const remainingSec = Math.floor(remainingMs / 1000);
            const mins = Math.floor(remainingSec / 60);
            const secs = remainingSec % 60;
            
            if (remainingMs === 0) {
                timerText.innerHTML = `<span class="text-rose-400 font-bold">EXPIRED (Forfeit Eligible)</span>`;
            } else {
                timerText.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')} Remaining`;
            }
        } else {
            timerWrap.classList.add('hidden');
        }
    }

    // 2. Map Veto Result Badge
    const vetoBadge = document.getElementById('scoreVetoResultBadge');
    if (vetoBadge) {
        if (match.veto) {
            vetoBadge.textContent = `${match.veto.map} (${match.veto.side || 'Decider'})`;
            vetoBadge.classList.remove('hidden');
        } else {
            vetoBadge.textContent = '';
            vetoBadge.classList.add('hidden');
        }
    }

    // 3. Match MVP Tagging Dropdown
    const mvpSelect = document.getElementById('scoreMatchMvp');
    if (mvpSelect) {
        mvpSelect.innerHTML = '<option value="">-- Tag Match MVP Player --</option>';
        const participants = t.participants || [];
        const t1Obj = participants.find(p => (typeof p === 'object' ? p.name : p) === match.team1);
        const t2Obj = participants.find(p => (typeof p === 'object' ? p.name : p) === match.team2);

        const players = [];
        if (t1Obj && Array.isArray(t1Obj.members)) t1Obj.members.forEach(m => players.push({ name: m, team: match.team1 }));
        if (t2Obj && Array.isArray(t2Obj.members)) t2Obj.members.forEach(m => players.push({ name: m, team: match.team2 }));

        players.forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.name;
            opt.textContent = `${p.name} (${p.team})`;
            if (match.mvp === p.name) opt.selected = true;
            mvpSelect.appendChild(opt);
        });
    }

    // 4. Match Screenshot Proof Preview
    window._scoreProofFile = null;
    window._scoreProofDataURL = match.screenshotURL || null;
    const emptyState = document.getElementById('scoreProofEmptyState');
    const previewWrap = document.getElementById('scoreProofPreviewWrap');
    const thumb = document.getElementById('scoreProofThumbnail');

    if (match.screenshotURL) {
        if (emptyState) emptyState.classList.add('hidden');
        if (previewWrap) previewWrap.classList.remove('hidden');
        if (thumb) thumb.src = match.screenshotURL;
    } else {
        if (emptyState) emptyState.classList.remove('hidden');
        if (previewWrap) previewWrap.classList.add('hidden');
        if (thumb) thumb.src = '';
    }

    document.getElementById('scoreModal').classList.remove('hidden');
    document.getElementById('scoreModal').classList.add('flex');

    (async () => {
        try {
            const { doc, getDoc, setDoc, serverTimestamp } = await import("https://www.gstatic.com/firebasejs/11.1.0/firebase-firestore.js");
            const participants = t.participants || [];
            const authorizedCaptainEmails = [];
            const authorizedViewerEmails = [];

            for (const p of participants) {
                if (!p.registeredBy) continue;
                const userSnap = await getDoc(doc(db, "users", p.registeredBy));
                const email = userSnap.exists() ? userSnap.data().email : null;
                if (!email) continue;

                authorizedViewerEmails.push(email);
                const teamName = p.name || p.teamName;
                if (teamName === match.team1 || teamName === match.team2) {
                    authorizedCaptainEmails.push(email);
                }
            }

            const chatDocRef = doc(db, "tournaments", t.id, "matchChats", matchId);
            await setDoc(chatDocRef, {
                matchId,
                authorizedCaptainEmails,
                authorizedViewerEmails,
                initializedAt: serverTimestamp()
            }, { merge: true });

        } catch (e) {
            console.warn("matchChat doc init failed:", e);
        }
    })();
}

window.saveMatchScore = async function () {
    const matchId = document.getElementById('scoreMatchId').value;
    const s1 = parseInt(document.getElementById('scoreTeam1').value) || 0;
    const s2 = parseInt(document.getElementById('scoreTeam2').value) || 0;
    const winnerVal = document.querySelector('input[name="matchWinner"]:checked')?.value;
    const matchMvpVal = document.getElementById('scoreMatchMvp')?.value || null;

    const saveBtn = document.getElementById('saveScoreBtn');
    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.textContent = "Saving...";
    }

    try {
        const tourneyRef = doc(db, "tournaments", currentEditingTournament.id);
        const tSnap = await getDoc(tourneyRef);
        let matches = tSnap.data().matches || [];

        let matchIndex = matches.findIndex(m => m.id === matchId);
        if (matchIndex === -1) {
            if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = "Save Result"; }
            return;
        }

        let match = matches[matchIndex];
        match.score1 = s1;
        match.score2 = s2;
        if (matchMvpVal) match.mvp = matchMvpVal;

        // Screenshot Proof Upload
        if (window._scoreProofFile) {
            try {
                const proofPath = `tournament-matches/${currentEditingTournament.id}/${matchId}/${Date.now()}_proof.png`;
                const sRef = storageRef(storage, proofPath);
                await uploadBytes(sRef, window._scoreProofFile);
                match.screenshotURL = await getDownloadURL(sRef);
            } catch (err) {
                console.warn("Proof storage upload fallback:", err);
                if (window._scoreProofDataURL) {
                    match.screenshotURL = window._scoreProofDataURL;
                }
            }
        } else if (window._scoreProofDataURL && !match.screenshotURL) {
            match.screenshotURL = window._scoreProofDataURL;
        }

        if (winnerVal) {
            const winnerName = (winnerVal === "1") ? match.team1 : match.team2;
            const loserName = (winnerVal === "1") ? match.team2 : match.team1;

            match.winner = winnerName;
            const isRoundRobin = currentEditingTournament.format === 'Round Robin';

            if (!isRoundRobin) {
                if (match.nextMatchId) {
                    let nextIndex = matches.findIndex(m => m.id === match.nextMatchId);
                    if (nextIndex !== -1) {
                        let nextMatch = matches[nextIndex];
                        if (nextMatch.id === 'GF-1') {
                            if (match.bracket === 'upper') {
                                nextMatch.team1 = winnerName;
                            } else if (match.bracket === 'lower') {
                                nextMatch.team2 = winnerName;
                            }
                        } else {
                            if (nextMatch.team1 === 'TBD' || nextMatch.team1 === 'BYE' || 
                                nextMatch.team1 === match.team1 || nextMatch.team1 === match.team2) {
                                nextMatch.team1 = winnerName;
                            } else {
                                nextMatch.team2 = winnerName;
                            }
                        }
                        // If both teams in nextMatch are now ready, set lobby timer
                        if (nextMatch.team1 && nextMatch.team2 && nextMatch.team1 !== 'TBD' && nextMatch.team2 !== 'TBD' && nextMatch.team1 !== 'BYE' && nextMatch.team2 !== 'BYE') {
                            nextMatch.startedAt = Date.now();
                            nextMatch.durationMins = 15;
                        }
                        matches[nextIndex] = nextMatch;
                    }
                } else {
                    matches.status = 'Completed';
                }

                if (match.loserMatchId) {
                    let loserIndex = matches.findIndex(m => m.id === match.loserMatchId);
                    if (loserIndex !== -1) {
                        let loserMatch = matches[loserIndex];
                        if (loserMatch.team1 === 'TBD' || loserMatch.team1 === match.team1 || loserMatch.team1 === match.team2) {
                            loserMatch.team1 = loserName;
                        } else {
                            loserMatch.team2 = loserName;
                        }
                        if (loserMatch.team1 && loserMatch.team2 && loserMatch.team1 !== 'TBD' && loserMatch.team2 !== 'TBD' && loserMatch.team1 !== 'BYE' && loserMatch.team2 !== 'BYE') {
                            loserMatch.startedAt = Date.now();
                            loserMatch.durationMins = 15;
                        }
                        matches[loserIndex] = loserMatch;
                    }
                }
                resolveByes(matches);
            }
        }

        // Automatic Tournament Completion and Champion Resolution
        const isRoundRobin = currentEditingTournament.format === 'Round Robin';
        let isTournamentFinished = false;
        let championName = null;

        if (isRoundRobin) {
            const allComplete = matches.length > 0 && matches.every(m => m.winner !== null);
            if (allComplete) {
                isTournamentFinished = true;
                const rrStats = {};
                (tSnap.data().participants || []).forEach(p => {
                    const name = typeof p === 'object' ? (p.name || p.teamName) : p;
                    rrStats[name] = { name, won: 0, pts: 0 };
                });
                matches.forEach(m => {
                    if (m.winner && rrStats[m.winner]) {
                        rrStats[m.winner].won++;
                        rrStats[m.winner].pts += 3;
                    }
                });
                const rrSorted = Object.values(rrStats).sort((a, b) => (b.pts - a.pts) || (b.won - a.won));
                if (rrSorted.length > 0) championName = rrSorted[0].name;
            }
        } else {
            const grandFinalMatch = getGrandFinalMatch(matches);
            const bronzeMatch = matches.find(m => m.id === 'M-3RD' || m.id === 'BM-1' || m.id === '3RD-1' || m.isBronzeMatch);
            const isBronzeDone = !bronzeMatch || (bronzeMatch.team1 === 'TBD' || bronzeMatch.team2 === 'TBD' || bronzeMatch.team1 === 'BYE' || bronzeMatch.team2 === 'BYE') || !!bronzeMatch.winner;
            const isFinalDone = !!(grandFinalMatch && grandFinalMatch.winner);

            if (isFinalDone && isBronzeDone) {
                isTournamentFinished = true;
                championName = grandFinalMatch.winner;
            }
        }

        let updatePayload = { matches: matches };
        if (isTournamentFinished) {
            updatePayload.status = 'Completed';
            updatePayload.isCompleted = true;
            updatePayload.completedAt = serverTimestamp();
            if (championName) updatePayload.winner = championName;
        }

        await updateDoc(tourneyRef, updatePayload);
        document.getElementById('scoreModal').classList.add('hidden');
        if (window.showSuccessToast) {
            if (isTournamentFinished) {
                window.showSuccessToast("Tournament Completed!", `Grand Champion: ${championName || 'Podium Decided'}`);
            } else {
                window.showSuccessToast("Updated", "Match Score & Verification Saved!");
            }
        }

    } catch (e) {
        console.error(e);
        alert("Error saving score: " + e.message);
    } finally {
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.textContent = "Save Result";
        }
    }
}

// --- MODAL / HUB LIFECYCLE ---
async function openModal(t) {
    if (!t) return;
    const actualStatus = getTournamentStatus(t);
    const isArchived = (t.archived === true || t.isArchived === true || actualStatus === 'Archived');
    if (isArchived) {
        const auth = getAuth();
        const user = auth.currentUser;
        const cachedRole = sessionStorage.getItem('cz_user_role') || window.currentUserRole || '';
        const role = String(cachedRole).toLowerCase();
        const isCreator = user && (t.createdBy === user.uid || role === 'admin' || ["admin@champzero.com"].includes(user.email));
        if (!isCreator) {
            if (window.showErrorToast) {
                window.showErrorToast("Tournament Archived", "This tournament has been archived by the organizer and is no longer publicly accessible.");
            } else {
                alert("This tournament has been archived by the organizer and is no longer publicly accessible.");
            }
            if (window.clearTournamentUrl) window.clearTournamentUrl();
            return;
        }
    }

    // 1. Instantly open detailsModal
    const detailsModal = document.getElementById('detailsModal');
    if (detailsModal) {
        detailsModal.classList.remove('hidden');
        detailsModal.classList.add('flex');
    }

    window._currentTournamentId = t.id;
    currentEditingTournament = t;
    window.currentEditingTournament = t;

    const newUrl = `${window.location.pathname}?id=${t.id}`;
    window.history.pushState({ path: newUrl }, '', newUrl);

    // 2. Render initial view immediately
    renderTournamentView(t);

    // 3. Realtime listener
    if (tournamentUnsubscribe) { tournamentUnsubscribe(); tournamentUnsubscribe = null; }

    tournamentUnsubscribe = onSnapshot(doc(db, "tournaments", t.id), async (docSnap) => {
        if (!docSnap.exists()) return;
        
        const latestData = { id: docSnap.id, ...docSnap.data() };
        currentEditingTournament = latestData;
        window.currentEditingTournament = latestData;
        
        renderTournamentView(latestData);

        const auth = getAuth();
        const user = auth.currentUser;
        const cachedRole = sessionStorage.getItem('cz_user_role') || window.currentUserRole || '';
        const role = String(cachedRole).toLowerCase();
        const isOrganizerRole = (role === 'admin' || role === 'organizer');
        const isCreator = (user && (latestData.createdBy === user.uid || isOrganizerRole || ["admin@champzero.com"].includes(user.email)));

        if (isCreator && latestData.isStarted && latestData.matches) {
            let matchesClone = JSON.parse(JSON.stringify(latestData.matches));
            const needsUpdate = resolveByes(matchesClone);
            if (needsUpdate) {
                console.log("Auto-advancing participant in BYE match...");
                await updateDoc(doc(db, "tournaments", t.id), { matches: matchesClone });
            }
        }
    });
}

function updateOrganizerPermissions(t) {
    if (!t) return;
    const auth = getAuth();
    const user = auth.currentUser;
    const isStaff = isTournamentStaff(t, user);

    const editBtn = document.getElementById('editTournamentBtn');
    if (editBtn) {
        editBtn.classList.toggle('hidden', !isStaff);
        editBtn.classList.toggle('inline-flex', isStaff);
        editBtn.onclick = () => openEditTournamentModal(t);
    }

    const editPrizeBtn = document.getElementById('btn-edit-prize-pool');
    if (editPrizeBtn) {
        editPrizeBtn.classList.toggle('hidden', !isStaff);
        editPrizeBtn.classList.toggle('inline-flex', isStaff);
        editPrizeBtn.onclick = () => window.openEditPrizeModal(t.id);
    }

    const editPrizeSplitBtn = document.getElementById('btn-edit-prize-split');
    if (editPrizeSplitBtn) {
        editPrizeSplitBtn.classList.toggle('hidden', !isStaff);
        editPrizeSplitBtn.classList.toggle('inline-flex', isStaff);
        editPrizeSplitBtn.onclick = () => window.openEditPrizeModal(t.id);
    }

    const isArchived = (t.archived === true || t.isArchived === true || t.status === 'Archived');

    const archiveBtn = document.getElementById('archiveTournamentBtn');
    const archiveBtnText = document.getElementById('archiveBtnText');
    if (archiveBtn) {
        archiveBtn.classList.toggle('hidden', !isStaff);
        archiveBtn.classList.toggle('inline-flex', isStaff);
        if (archiveBtnText) {
            archiveBtnText.textContent = isArchived ? "Unarchive" : "Archive";
        }
        archiveBtn.onclick = () => window.toggleArchiveTournament(t.id);
    }

    const adjustQuickBtn = document.getElementById('adjustBannerQuickBtn');
    if (adjustQuickBtn) {
        adjustQuickBtn.classList.toggle('hidden', !isStaff);
        adjustQuickBtn.classList.toggle('inline-flex', isStaff);
    }

    const schedControls = document.getElementById('scheduleOrganizerControls');
    if (schedControls) {
        schedControls.classList.toggle('hidden', !isStaff);
    }

    const editRulesQuickBtn = document.getElementById('editRulesQuickBtn');
    if (editRulesQuickBtn) {
        editRulesQuickBtn.classList.toggle('hidden', !isStaff);
        editRulesQuickBtn.classList.toggle('inline-flex', isStaff);
    }

    const roundFormatsBtn = document.getElementById('editRoundFormatsBtn');
    if (roundFormatsBtn) {
        roundFormatsBtn.classList.toggle('hidden', !isStaff);
        roundFormatsBtn.classList.toggle('inline-flex', isStaff);
    }
}
window.updateOrganizerPermissions = updateOrganizerPermissions;

async function renderTournamentView(t) {
    const actualStatus = getTournamentStatus(t);
    const format = t.format || "Single Elimination";
    if (!t.participants) t.participants = [];

    const auth = getAuth();
    const user = auth.currentUser;
    const isStaff = isTournamentStaff(t, user);
    const isCreator = isStaff;

    // 1. Basic Info Rendering
    if (qs('#detailTitle')) qs('#detailTitle').textContent = t.name || 'Untitled Tournament';
    if (qs('#detailName')) qs('#detailName').textContent = t.name || 'Untitled Tournament';
    if (qs('#detailStatus')) {
        qs('#detailStatus').textContent = actualStatus.toUpperCase();
        if (actualStatus === 'Archived') {
            qs('#detailStatus').className = "flex items-center justify-center bg-neutral-800 text-neutral-300 border border-neutral-600 px-2 py-0.5 rounded font-mono-tag text-[9px] uppercase font-bold tracking-wider";
        } else if (actualStatus === 'Cancelled') {
            qs('#detailStatus').className = "flex items-center justify-center bg-red-950 text-red-400 border border-red-500/50 px-2 py-0.5 rounded font-mono-tag text-[9px] uppercase font-bold tracking-wider";
        } else if (actualStatus === 'Ongoing') {
            qs('#detailStatus').className = "flex items-center justify-center bg-emerald-950 text-emerald-300 border border-emerald-500/60 px-2 py-0.5 rounded font-mono-tag text-[9px] uppercase font-bold tracking-wider";
        } else if (actualStatus === 'Completed') {
            qs('#detailStatus').className = "flex items-center justify-center bg-neutral-900 text-neutral-400 border border-neutral-700 px-2 py-0.5 rounded font-mono-tag text-[9px] uppercase font-bold tracking-wider";
        } else {
            qs('#detailStatus').className = "flex items-center justify-center bg-black/70 backdrop-blur-md text-[#FFD700] border border-[#FFD700]/40 px-2 py-0.5 rounded font-mono-tag text-[9px] uppercase font-bold tracking-wider shadow-md";
        }
    }

    const bPos = t.bannerPosition || 'center 50%';
    const bFit = t.bannerFit || 'cover';
    const bScale = t.bannerScale || 1;
    if (qs('#detailBanner')) {
        qs('#detailBanner').innerHTML = `
            <img src="${escapeCssUrl(t.banner || 'pictures/cz_logo.png')}" 
                 id="tournamentBannerImg"
                 onerror="this.onerror=null; this.src='pictures/cz_logo.png';"
                 class="w-full h-full transition-all duration-300 pointer-events-none select-none" 
                 style="object-fit: ${bFit}; object-position: ${bPos}; transform: scale(${bScale}); transform-origin: ${bPos};" />
        `;
    }

    if (qs('#detailGame')) qs('#detailGame').textContent = t.game;
    if (qs('#detailFormatBadge')) qs('#detailFormatBadge').textContent = format;
    if (qs('#detailPrize')) qs('#detailPrize').textContent = `₱${Number(t.prize || 0).toLocaleString()}`;
    
    const venueText = t.venue || (t.venueType === 'LAN' && t.venueLocation ? `LAN: ${t.venueLocation}` : (t.venueType || 'Online'));
    if (qs('#detailVenueText')) qs('#detailVenueText').textContent = venueText;

    // Discord Link
    const discordLinkEl = qs('#detailDiscordLink');
    if (discordLinkEl) {
        if (t.discordLink) {
            discordLinkEl.href = t.discordLink;
            discordLinkEl.classList.remove('hidden');
            discordLinkEl.classList.add('inline-flex');
        } else {
            discordLinkEl.classList.add('hidden');
            discordLinkEl.classList.remove('inline-flex');
        }
    }

    // Overview box text (shown inside Prize & Schedule tab if present)
    const descContainer = qs('#detailDesc');
    const descCard = qs('#detailDescCard');
    if (descContainer) {
        if (t.description && t.description.trim()) {
            descContainer.textContent = t.description.trim();
            if (descCard) descCard.classList.remove('hidden');
        } else {
            descContainer.textContent = "";
            if (descCard) descCard.classList.add('hidden');
        }
    }

    // Render Tournament Rules & Guidelines
    const rulesContainer = qs('#tournamentRulesContent');
    const rulesSearchInput = qs('#rulesSearchInput');
    if (rulesSearchInput) rulesSearchInput.value = '';
    if (rulesContainer) {
        if (t.rules && t.rules.trim()) {
            rulesContainer.textContent = t.rules.trim();
        } else if (isTournamentStaff(t, user)) {
            rulesContainer.innerHTML = `<div class="text-neutral-500 italic py-8 text-center space-y-3"><div>No custom rules added yet. Click <strong>Edit Rulebook</strong> above to set match regulations, map pick/ban policies, or disqualification rules.</div></div>`;
        } else {
            rulesContainer.innerHTML = `<div class="text-neutral-500 italic py-8 text-center">Standard esports tournament regulations apply. Check match chat for specific marshal instructions.</div>`;
        }
    }

    // Render Prize Breakdown, Schedule Timeline, and Rankings with Customizable Prize Split
    renderPrizeBreakdown(t.prize, t.prizeSplit);
    renderScheduleRundown(t);
    renderTournamentRankings(t.participants, t.prize, t.matches, t.prizeSplit, t);
    renderPayoutsTab(t, isCreator, user);

    // Auto-heal / Auto-sync completed tournaments in Firestore
    if (isTournamentCompleteCheck(t) && t.status !== 'Completed' && t.id) {
        t.status = 'Completed';
        t.isCompleted = true;
        const autoGf = getGrandFinalMatch(t.matches);
        if (autoGf && autoGf.winner) t.winner = autoGf.winner;
        try {
            updateDoc(doc(db, 'tournaments', t.id), {
                status: 'Completed',
                isCompleted: true,
                completedAt: serverTimestamp(),
                ...(autoGf?.winner ? { winner: autoGf.winner } : {})
            }).catch(err => console.warn('Auto-finalize sync notice:', err));
        } catch (e) {}
    }

    if (user && !currentUserTeamIds.size) {
        fetchUserTeamIds(user);
    }

    renderParticipantsList(t.participants);

    // 2. Creator & Organizer Permissions
    updateOrganizerPermissions(t);

    const adminDash = qs('#adminDashboard');
    const adminToolbar = qs('#adminBracketToolbar');
    const actionArea = qs('#actionArea');
    const bracketSection = qs('#bracketSection');
    const champSection = qs('#championSection');

    // Render Check-In Banner & Ready-Up Button
    const checkInBanner = document.getElementById('checkInBanner');
    const checkInStatusText = document.getElementById('checkInStatusText');
    const checkInSubText = document.getElementById('checkInSubText');
    const captainReadyBtn = document.getElementById('captainReadyBtn');

    if (checkInBanner) {
        if (t.checkInOpen && !t.isStarted && t.status !== 'Completed') {
            checkInBanner.classList.remove('hidden');
            if (checkInStatusText) checkInStatusText.textContent = "Check-In Window Open";
            if (checkInSubText) checkInSubText.textContent = "Captains must ready up before brackets start";

            let isRegisteredCaptain = false;
            let myTeamCheckedIn = false;
            if (user && t.participants) {
                const myTeam = t.participants.find(p => p.registeredBy === user.uid || (p.captain && p.captain.toLowerCase() === user.displayName?.toLowerCase()));
                if (myTeam) {
                    isRegisteredCaptain = true;
                    myTeamCheckedIn = !!myTeam.checkedIn;
                }
            }

            if (captainReadyBtn) {
                if (isRegisteredCaptain) {
                    captainReadyBtn.classList.remove('hidden');
                    if (myTeamCheckedIn) {
                        captainReadyBtn.textContent = "Ready";
                        captainReadyBtn.className = "shrink-0 px-3 py-1.5 rounded-lg bg-emerald-500 text-black font-heading font-extrabold text-[10px] uppercase tracking-wider transition-all shadow-sm cursor-default";
                        captainReadyBtn.onclick = null;
                    } else {
                        captainReadyBtn.textContent = "Ready Up";
                        captainReadyBtn.className = "shrink-0 px-3 py-1.5 rounded-lg bg-[#FFD700] hover:bg-[#FFF099] text-black font-heading font-extrabold text-[10px] uppercase tracking-wider transition-all shadow-sm cursor-pointer animate-pulse";
                        captainReadyBtn.onclick = window.handleCaptainCheckIn;
                    }
                } else {
                    captainReadyBtn.classList.add('hidden');
                }
            }
        } else {
            checkInBanner.classList.add('hidden');
        }
    }

    // Bracket Visibility: Always show for Started, Ongoing, Completed, or when Matches exist
    const hasBracketData = (t.matches && t.matches.length > 0);
    const isCompletedStatus = (actualStatus === 'Completed' || isTournamentCompleteCheck(t));

    if (t.isStarted || isCompletedStatus || hasBracketData || isCreator) {
        if (bracketSection) bracketSection.classList.remove('hidden');
        renderBracket(t.participants || [], format, isCreator, t.isStarted || isCompletedStatus || hasBracketData);

        const finalMatch = t.matches ? getGrandFinalMatch(t.matches) : null;
        if (isCompletedStatus || (finalMatch && finalMatch.winner)) {
            if (champSection) {
                champSection.classList.remove('hidden');
                renderPodiumShowcase(t, 'championPodiumContainer');
            }
            const championName = (finalMatch && finalMatch.winner) ? finalMatch.winner : (t.winner || t.champion || '');
            if (qs('#champName')) qs('#champName').textContent = championName;
            const winningTeam = t.participants ? t.participants.find(p => (typeof p === 'object' ? p.name : p) === championName) : null;
            if (winningTeam && typeof winningTeam === 'object' && winningTeam.members && qs('#champRoster')) {
                qs('#champRoster').innerHTML = winningTeam.members.map(m => `<span class="bg-white/5 border border-white/10 px-2.5 py-1 rounded text-xs text-neutral-300 font-mono-tag">${escapeHtml(m)}</span>`).join('');
            } else if (qs('#champRoster')) {
                qs('#champRoster').innerHTML = '';
            }
        } else if (champSection) {
            champSection.classList.add('hidden');
        }
    } else {
        if (bracketSection) bracketSection.classList.add('hidden');
        if (champSection) champSection.classList.add('hidden');
    }

    // Winner Payouts Access Control: Only visible to Winners (1st, 2nd, 3rd) and Tournament Staff
    const canAccessPayouts = isCompletedStatus && isUserWinnerOrStaff(t, user);
    const btnPayouts = qs('#btn-tab-payouts');
    const tabsNav = qs('#tournamentTabsNav');

    if (btnPayouts) {
        if (canAccessPayouts) {
            btnPayouts.classList.remove('hidden');
            if (tabsNav) {
                tabsNav.classList.remove('sm:grid-cols-5');
                tabsNav.classList.add('sm:grid-cols-6');
            }
        } else {
            btnPayouts.classList.add('hidden');
            if (tabsNav) {
                tabsNav.classList.remove('sm:grid-cols-6');
                tabsNav.classList.add('sm:grid-cols-5');
            }
            const payoutsPane = qs('#payoutsTab');
            if (payoutsPane && !payoutsPane.classList.contains('hidden')) {
                const redirectTab = isCompletedStatus ? 'standingsTab' : 'rundownTab';
                const redirectBtn = isCompletedStatus ? qs('#btn-tab-standings') : qs('#btn-tab-rundown');
                if (typeof window.switchDetailTab === 'function') {
                    window.switchDetailTab(redirectTab, redirectBtn);
                }
            }
        }
    }

    // 3. Admin / Organizer Dashboard
    if (adminDash) {
        if (isCreator) {
            adminDash.classList.remove('hidden');
            const isSoloTournament = (t.registrationType === 'solo' || Number(t.teamSize) === 1);
            const queuedSoloCount = (t.soloQueue || []).length;
            const teamSize = Number(t.teamSize) || 5;
            const readySquads = Math.floor(queuedSoloCount / teamSize);
            const showSoloControls = !isSoloTournament && (t.registrationType === 'hybrid' || (t.registrationType === 'team' && queuedSoloCount > 0));

            adminDash.innerHTML = `
                <!-- Organizer Header & Actions -->
                <div class="flex items-center justify-between gap-2 pb-3 border-b border-white/5">
                    <div class="flex items-center gap-2">
                        <span class="w-2 h-2 rounded-full bg-[#FFD700] animate-pulse"></span>
                        <span class="text-[10px] font-bold font-mono-tag uppercase tracking-wider text-white">Organizer Controls</span>
                    </div>
                    <div class="flex items-center gap-1 flex-wrap justify-end">
                        <button type="button" onclick="window.openCoOrganizersModal('${t.id}')" class="px-2 py-1 rounded-lg bg-purple-500/15 hover:bg-purple-500/25 text-purple-300 border border-purple-500/30 text-[10px] font-mono-tag font-bold transition-all cursor-pointer uppercase flex items-center gap-1">
                            <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"/></svg>
                            <span>Staff (${(t.coOrganizers || []).length})</span>
                        </button>
                        <button type="button" onclick="window.openEditTournamentModal('${t.id}')" class="px-2 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-neutral-300 hover:text-white border border-white/10 text-[10px] font-mono-tag font-bold transition-all cursor-pointer uppercase">
                            Edit
                        </button>
                        <button type="button" onclick="window.toggleArchiveTournament('${t.id}')" class="px-2 py-1 rounded-lg ${(t.archived === true || t.isArchived === true || t.status === 'Archived') ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30 hover:bg-amber-500/30' : 'bg-white/5 hover:bg-white/10 text-neutral-300 border border-white/10'} text-[10px] font-mono-tag font-bold transition-all cursor-pointer uppercase">
                            ${(t.archived === true || t.isArchived === true || t.status === 'Archived') ? 'Unarchive' : 'Archive'}
                        </button>
                        <button type="button" onclick="window.toggleCancelTournament('${t.id}')" class="px-2 py-1 rounded-lg ${(t.status === 'Cancelled' || t.isCancelled) ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30 hover:bg-amber-500/30' : 'bg-white/5 hover:bg-red-500/20 text-neutral-300 hover:text-red-400 border border-white/10'} text-[10px] font-mono-tag font-bold transition-all cursor-pointer uppercase">
                            ${(t.status === 'Cancelled' || t.isCancelled) ? 'Reopen' : 'Cancel'}
                        </button>
                    </div>
                </div>

                <!-- Section 1: Bracket & Match Execution -->
                <div class="p-3 bg-black/40 border border-white/5 rounded-xl space-y-2">
                    <div class="flex items-center justify-between">
                        <span class="text-[9px] text-neutral-400 font-mono-tag font-bold uppercase tracking-wider">Bracket Stage</span>
                        ${t.isStarted ? '<span class="text-[9px] text-emerald-400 font-mono-tag font-bold uppercase flex items-center gap-1"><span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span> Live</span>' : ''}
                    </div>
                    ${actualStatus === 'Cancelled' ? `
                        <div class="p-2 bg-red-950/40 border border-red-500/30 rounded-lg flex items-center justify-between text-xs">
                            <span class="text-red-400 font-bold uppercase flex items-center gap-2">
                                <span class="w-2 h-2 rounded-full bg-red-500"></span>
                                <span>Tournament Cancelled</span>
                            </span>
                            <button type="button" onclick="window.toggleCancelTournament('${t.id}')" class="px-2 py-0.5 bg-red-500/20 hover:bg-red-500/30 text-red-300 border border-red-500/40 rounded text-[10px] uppercase font-bold transition-colors cursor-pointer">
                                Reopen
                            </button>
                        </div>
                    ` : actualStatus === 'Completed' ? `
                        <div class="p-2 bg-neutral-900 border border-neutral-700 rounded-lg flex items-center justify-between text-xs">
                            <span class="text-neutral-400 font-bold uppercase flex items-center gap-2">
                                <span class="w-2 h-2 rounded-full bg-neutral-500"></span>
                                <span>Tournament Concluded</span>
                            </span>
                        </div>
                    ` : actualStatus === 'Archived' ? `
                        <div class="p-2 bg-neutral-900 border border-neutral-700 rounded-lg flex items-center justify-between text-xs">
                            <span class="text-neutral-400 font-bold uppercase flex items-center gap-2">
                                <span class="w-2 h-2 rounded-full bg-neutral-500"></span>
                                <span>Tournament Archived</span>
                            </span>
                        </div>
                    ` : !t.isStarted ? `
                        <div class="flex items-center gap-2">
                            <select id="organizerFormatSelect" class="dark-select flex-1 text-xs p-2 rounded-lg border border-white/10 bg-[#14141a] text-white cursor-pointer" onchange="window.handleTournamentFormatChange(this.value)">
                                <option value="Single Elimination" ${format === 'Single Elimination' ? 'selected' : ''}>Single Elimination</option>
                                <option value="Double Elimination" ${format === 'Double Elimination' ? 'selected' : ''}>Double Elimination</option>
                                <option value="Round Robin" ${format === 'Round Robin' ? 'selected' : ''}>Round Robin</option>
                            </select>
                            <button type="button" onclick="window.startTournament()" class="shrink-0 px-3.5 py-2 bg-[#FFD700] hover:bg-[#FFF099] text-black font-heading font-extrabold text-xs uppercase tracking-wider rounded-lg transition-all shadow-sm flex items-center justify-center gap-1.5 cursor-pointer">
                                <span>Start Bracket</span>
                            </button>
                        </div>
                    ` : `
                        <div class="p-2 bg-emerald-950/40 border border-emerald-500/40 rounded-lg flex items-center justify-between text-xs text-emerald-300 font-mono-tag">
                            <span>Format: ${escapeHtml(format)}</span>
                            <span class="text-[10px] text-neutral-400 font-mono-tag">Manage matches in Bracket tab</span>
                        </div>
                    `}
                </div>

                <!-- Section 2: Check-In Management -->
                <div class="p-3 bg-black/40 border border-white/5 rounded-xl space-y-2">
                    <div class="flex items-center justify-between">
                        <span class="text-[9px] text-neutral-400 font-mono-tag font-bold uppercase tracking-wider">Check-In Management</span>
                        <span class="text-[9px] font-mono-tag font-bold ${t.checkInOpen ? 'text-[#FFD700]' : 'text-neutral-500'} uppercase">${t.checkInOpen ? 'Window Open' : 'Closed'}</span>
                    </div>
                    <div class="grid grid-cols-3 gap-1.5 text-[10px] font-mono-tag font-bold">
                        <button type="button" onclick="window.toggleTournamentCheckIn()" class="py-1.5 px-2 ${t.checkInOpen ? 'bg-amber-500/20 text-[#FFD700] border-amber-500/40' : 'bg-white/5 text-neutral-300 border-white/10'} hover:bg-white/10 border rounded-lg uppercase transition-colors truncate cursor-pointer text-center">
                            ${t.checkInOpen ? 'Close Check-In' : 'Open Check-In'}
                        </button>
                        <button type="button" onclick="window.checkInAllTeams()" class="py-1.5 px-2 bg-white/5 hover:bg-white/10 border border-white/10 text-neutral-300 hover:text-white rounded-lg uppercase transition-colors cursor-pointer text-center">
                            Ready All
                        </button>
                        <button type="button" onclick="window.dropUnreadyTeams()" class="py-1.5 px-2 bg-white/5 hover:bg-red-500/20 text-neutral-300 hover:text-red-400 border border-white/10 rounded-lg uppercase transition-colors cursor-pointer text-center">
                            Drop Unready
                        </button>
                    </div>
                </div>

                ${showSoloControls ? `
                    <!-- Section 3: Solo Free Agents & Auto-Teaming -->
                    <div class="p-3 bg-black/40 border border-[#FFD700]/25 rounded-xl space-y-2">
                        <div class="flex items-center justify-between text-[9px] font-mono-tag">
                            <span class="text-neutral-300 font-bold uppercase flex items-center gap-1.5">
                                <span>Solo Free Agents</span>
                                <span class="px-1.5 py-0.5 rounded-full bg-[#FFD700]/15 text-[#FFD700] font-bold">${queuedSoloCount} Queued</span>
                            </span>
                            <span class="text-neutral-400">${readySquads} Squads (${teamSize}v${teamSize})</span>
                        </div>
                        <button type="button" onclick="window.autoTeamSoloPlayers('${t.id}')" ${queuedSoloCount < teamSize ? 'disabled' : ''} class="w-full py-2 rounded-lg ${queuedSoloCount >= teamSize ? 'bg-[#FFD700] hover:bg-[#FFF099] text-black font-extrabold cursor-pointer shadow-md' : 'bg-white/5 text-neutral-500 border border-white/10 cursor-not-allowed'} font-heading text-xs uppercase tracking-wider transition-all flex items-center justify-center gap-1.5">
                            <span>Auto-Team Solo Players</span>
                            ${readySquads > 0 ? `<span class="px-1.5 py-0.5 rounded bg-black/20 text-black text-[9px] font-bold">(${readySquads} Ready)</span>` : ''}
                        </button>
                    </div>
                ` : ''}

                ${!isSoloTournament ? `
                    <!-- Section 4: Pending Roster Applications -->
                    <div class="p-3 bg-black/40 border border-white/5 rounded-xl space-y-2">
                        <div class="flex items-center justify-between text-[9px] font-mono-tag">
                            <span class="text-neutral-300 font-bold uppercase tracking-wider flex items-center gap-1.5">
                                <span>Pending Applications</span>
                            </span>
                            <span id="pendingAppBadge" class="px-1.5 py-0.5 rounded-full text-[9px] bg-white/10 text-neutral-400 font-bold">0</span>
                        </div>
                        <div id="adminAppList" class="space-y-1.5 overflow-y-auto custom-scrollbar bg-[#050507] border border-white/5 rounded-lg p-2 max-h-[100px] text-xs">
                            <div class="text-neutral-500 text-[10px] py-1 text-center italic font-mono-tag">No pending applications.</div>
                        </div>
                    </div>
                ` : ''}
            `;

            initAdminDashboard(t.id);
        } else {
            adminDash.classList.add('hidden');
            if (adminUnsubscribe) { adminUnsubscribe(); adminUnsubscribe = null; }
        }
    }

    // 4. Action Area
    if (actionArea) {
        actionArea.innerHTML = '';
        if (actualStatus === 'Cancelled') {
            actionArea.innerHTML = `<div class="w-full bg-red-900/30 border border-red-500/30 text-red-400 font-heading font-bold py-2.5 rounded-lg text-center text-xs uppercase tracking-wider">Tournament Cancelled</div>`;
        } else if (t.isStarted || t.status === 'Completed') {
            actionArea.innerHTML = `<div class="w-full bg-white/5 border border-white/10 text-neutral-400 font-heading font-bold py-2.5 rounded-lg text-center text-xs uppercase tracking-wider cursor-not-allowed">Registration Closed</div>`;
        } else {
            let userStatus = 'none'; 
            let userAppId = null;
            if (user) {
                try {
                    const appsRef = collection(db, "tournaments", t.id, "applications");
                    const q = query(appsRef, where("registeredBy", "==", user.uid));
                    const appSnap = await getDocs(q);
                    if (!appSnap.empty) { 
                        const app = appSnap.docs[0].data(); 
                        userStatus = app.status; 
                        userAppId = appSnap.docs[0].id; 
                    }
                } catch (e) {
                    console.warn("Could not fetch user application:", e);
                }
            }

            const isSoloTournament = (t.registrationType === 'solo' || Number(t.teamSize) === 1);
            const userEmailLower = (user?.email || '').toLowerCase();
            const userNameLower = (user?.displayName || '').toLowerCase();

            // Check if user is directly confirmed in participants roster
            const isConfirmedInRoster = user && Array.isArray(t.participants) && t.participants.some(p => {
                if (!p) return false;
                if (typeof p === 'string') {
                    const pLower = p.toLowerCase();
                    return (userNameLower && pLower === userNameLower) || (userEmailLower && pLower === userEmailLower);
                }
                if (p.registeredBy === user.uid || p.userId === user.uid || p.uid === user.uid || p.id === user.uid) return true;
                if (p.captainEmail && p.captainEmail.toLowerCase() === userEmailLower) return true;
                if (p.contact && p.contact.toLowerCase() === userEmailLower) return true;
                if (Array.isArray(p.members) && p.members.some(m => {
                    if (!m) return false;
                    const mName = typeof m === 'object' ? (m.ign || m.name || '') : m;
                    const mLower = String(mName).toLowerCase();
                    return (userNameLower && mLower === userNameLower) || (userEmailLower && mLower === userEmailLower);
                })) return true;
                return false;
            });

            const mySolo = user && (t.soloQueue || []).find(p => p.userId === user.uid || (p.contact && user.email && p.contact.toLowerCase() === user.email.toLowerCase()));

            let userAppObj = null;
            if (user && userAppId) {
                userAppObj = userStatus !== 'none' ? (allTournaments.find(x => x.id === t.id)?.applications?.find?.(a => a.id === userAppId) || null) : null;
            }

            if (userStatus === 'approved' || isConfirmedInRoster) {
                actionArea.innerHTML = `<div class="w-full bg-green-900/30 border border-green-500/30 text-green-400 font-heading font-bold py-2.5 rounded-lg text-center text-xs uppercase tracking-wider flex items-center justify-center gap-1.5"><span class="w-2 h-2 rounded-full bg-emerald-400"></span><span>Confirmed in Roster</span></div>`;
            } else if (userStatus === 'pending_payment' || (userStatus === 'pending' && t.paymentType === 'automatic')) {
                const feeDisplay = Number(t.entryFee || 0).toFixed(2);
                actionArea.innerHTML = `
                    <div class="space-y-1.5">
                        <a href="/checkout.html?t=${t.id}&app=${userAppId}" class="w-full bg-[#FFD700] hover:bg-[#FFF099] text-black font-heading font-extrabold py-2.5 px-3 rounded-lg text-xs uppercase tracking-wider flex items-center justify-center gap-1.5 shadow-lg transition-all cursor-pointer">
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z"></path></svg>
                            <span>Complete Payment (₱${feeDisplay})</span>
                        </a>
                        <button onclick="window.withdrawApplication('${t.id}', '${userAppId}')" class="w-full text-[11px] font-mono-tag text-red-400 hover:text-red-300 hover:underline text-center cursor-pointer py-0.5">Cancel & Withdraw Registration</button>
                    </div>
                `;
            } else if (userStatus === 'pending' || userStatus === 'pending_update') {
                actionArea.innerHTML = `
                    <button disabled class="w-full bg-amber-500/20 border border-amber-500/30 text-amber-300 font-heading font-bold py-2 rounded-lg text-xs uppercase">Pending Review</button>
                    <button onclick="window.withdrawApplication('${t.id}', '${userAppId}')" class="w-full mt-1.5 text-[11px] font-mono-tag text-red-400 hover:underline text-center cursor-pointer">Cancel Application</button>
                `;
            } else if (mySolo && !isSoloTournament) {
                if (mySolo.status === 'Queued') {
                    actionArea.innerHTML = `
                        <div class="w-full p-2.5 rounded-xl bg-gradient-to-r from-amber-500/15 via-[#FFD700]/5 to-transparent border border-amber-500/30 font-mono-tag text-xs space-y-1">
                            <div class="flex items-center justify-between">
                                <span class="font-bold text-amber-300 text-[11px] uppercase flex items-center gap-1.5">
                                    <span class="relative flex h-2 w-2"><span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span><span class="relative inline-flex rounded-full h-2 w-2 bg-amber-400"></span></span>
                                    <span>Solo Queue Active</span>
                                </span>
                                <span class="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 font-bold">${escapeHtml(mySolo.role || 'Flex')}</span>
                            </div>
                            <p class="text-[10px] text-neutral-400 font-sans">IGN: <strong class="text-white">${escapeHtml(mySolo.ign)}</strong> &bull; Waiting for squad auto-matchmaking.</p>
                            <button type="button" onclick="window.cancelSoloRegistration('${t.id}')" class="w-full text-center text-red-400 hover:text-red-300 text-[10px] uppercase font-bold tracking-wider pt-1 hover:underline cursor-pointer">Leave Solo Queue</button>
                        </div>
                    `;
                } else {
                    actionArea.innerHTML = `
                        <div class="w-full bg-green-900/30 border border-green-500/30 text-green-400 font-heading font-bold py-2.5 rounded-lg text-center text-xs uppercase tracking-wider flex items-center justify-center gap-1.5">
                            <span class="text-emerald-400 font-bold">[ACTIVE]</span> <span>${escapeHtml(mySolo.status)}</span>
                        </div>
                    `;
                }
            } else {
                if (actualStatus === 'Upcoming' || actualStatus === 'Open' || actualStatus === 'Ready to Start') {
                    if (isSoloTournament) {
                        actionArea.innerHTML = `<button onclick="window.openJoinForm('${t.id}', false, null, 'solo')" class="w-full bg-[var(--gold)] hover:bg-[#FFF099] text-black font-heading font-bold py-2.5 rounded-lg text-xs uppercase tracking-wider shadow transition-transform cursor-pointer">Register for 1v1 Tournament</button>`;
                    } else if (t.registrationType === 'hybrid') {
                        actionArea.innerHTML = `<button onclick="window.openJoinForm('${t.id}', false)" class="w-full bg-[var(--gold)] hover:bg-[#FFF099] text-black font-heading font-bold py-2.5 rounded-lg text-xs uppercase tracking-wider shadow transition-transform cursor-pointer">Join Tournament (Team / Solo)</button>`;
                    } else {
                        const teamSizeLabel = t.teamSize ? `${t.teamSize}v${t.teamSize}` : 'Team';
                        actionArea.innerHTML = `<button onclick="window.openJoinForm('${t.id}', false, null, 'team')" class="w-full bg-[var(--gold)] hover:bg-[#FFF099] text-black font-heading font-bold py-2.5 rounded-lg text-xs uppercase tracking-wider shadow transition-transform cursor-pointer">Register ${teamSizeLabel} Squad</button>`;
                    }
                } else {
                    actionArea.innerHTML = `<div class="w-full bg-white/5 border border-white/10 text-neutral-400 font-heading font-bold py-2.5 rounded-lg text-center text-xs uppercase tracking-wider">Registration Closed</div>`;
                }
            }
        }
    }
}

// ----------------------------------------------------
// JOIN & REGISTRATION WORKFLOW (TEAM & SOLO FREE AGENT)
// ----------------------------------------------------
window.updateJoinModalFeeDisplay = function (mode) {
    const tournDoc = (window.currentEditingTournament || (window.allTournaments && window.allTournaments.find(t => t.id === window.currentJoiningId)));
    if (!tournDoc) return;

    const paymentType = tournDoc?.paymentType || (tournDoc?.entryType === 'Paid' ? 'manual' : (tournDoc?.entryType ? String(tournDoc.entryType).toLowerCase() : 'free'));
    const isPaid = (paymentType === 'manual' || paymentType === 'automatic' || tournDoc?.entryType === 'Paid') && (tournDoc?.entryFee > 0);
    const feeDisplay = document.getElementById('join-entry-fee-display');
    if (!feeDisplay) return;

    if (!isPaid) {
        feeDisplay.classList.add('hidden');
        return;
    }

    const targetTeamSize = parseInt(tournDoc?.teamSize) || (tournDoc?.registrationType === 'solo' ? 1 : 5);
    const feeType = tournDoc?.feeType || (targetTeamSize === 1 || tournDoc?.registrationType === 'solo' ? 'solo' : 'team');
    const baseFee = parseFloat(tournDoc?.entryFee) || 0;
    const currency = tournDoc?.entryCurrency || 'PHP';

    let calcAmount = baseFee;
    let label = 'Entry Fee';

    if (mode === 'solo' || targetTeamSize === 1) {
        if (targetTeamSize === 1 || feeType === 'solo') {
            calcAmount = baseFee;
            label = 'Solo Registration Fee';
        } else {
            calcAmount = baseFee / targetTeamSize;
            label = `Solo Share (1/${targetTeamSize} of Team Fee)`;
        }
    } else {
        if (feeType === 'solo') {
            calcAmount = baseFee * targetTeamSize;
            label = `Team Fee (${targetTeamSize} x ₱${baseFee.toFixed(2)})`;
        } else {
            calcAmount = baseFee;
            label = 'Team Registration Fee';
        }
    }

    const currEl = document.getElementById('join-entry-currency');
    const amountEl = document.getElementById('join-entry-fee-amount');
    const labelEl = feeDisplay.querySelector('.font-mono-tag');
    const netEl = document.getElementById('join-net-fee');
    const platEl = document.getElementById('join-platform-fee');

    const sym = currency === 'PHP' ? '₱' : '$';
    const platFee = calcAmount * 0.05;
    const netFee = calcAmount - platFee;

    if (currEl) currEl.textContent = currency;
    if (amountEl) amountEl.textContent = calcAmount.toFixed(2);
    if (labelEl) labelEl.textContent = label;
    if (netEl) netEl.textContent = `${sym}${netFee.toFixed(2)}`;
    if (platEl) platEl.textContent = `${sym}${platFee.toFixed(2)}`;

    feeDisplay.classList.remove('hidden');
};

window.switchJoinMode = function (mode) {
    const activeModeInput = document.getElementById('joinActiveMode');
    const teamBtn = document.getElementById('joinModeTeamBtn');
    const soloBtn = document.getElementById('joinModeSoloBtn');
    const teamFields = document.getElementById('joinTeamFields');
    const soloFields = document.getElementById('joinSoloFields');
    const heading = document.getElementById('joinModalHeading');
    const subheading = document.getElementById('joinModalSubheading');

    const tournDoc = (window.currentEditingTournament || (window.allTournaments && window.allTournaments.find(t => t.id === window.currentJoiningId)));
    const targetTeamSize = parseInt(tournDoc?.teamSize) || 5;

    if (activeModeInput) activeModeInput.value = mode;

    if (mode === 'solo') {
        if (soloBtn) soloBtn.className = "py-2 rounded-lg bg-[#FFD700] text-black font-extrabold uppercase transition-all shadow-sm cursor-pointer text-center";
        if (teamBtn) teamBtn.className = "py-2 rounded-lg bg-white/5 hover:bg-white/10 text-neutral-300 font-bold uppercase transition-all cursor-pointer text-center";
        if (teamFields) {
            teamFields.classList.add('hidden');
            teamFields.querySelectorAll('input, select').forEach(el => el.removeAttribute('required'));
        }
        if (soloFields) {
            soloFields.classList.remove('hidden');
            const soloIgn = document.getElementById('joinSoloIgn');
            if (soloIgn) soloIgn.setAttribute('required', 'true');
        }
        if (heading) heading.textContent = targetTeamSize === 1 ? "1v1 Tournament Registration" : "Register as Solo Free Agent";
        if (subheading) subheading.textContent = targetTeamSize === 1 ? "Enter your player IGN and details to register for this 1v1 tournament." : "Enter your player details. You will be automatically teamed with other free agents.";
    } else {
        if (teamBtn) teamBtn.className = "py-2 rounded-lg bg-[#FFD700] text-black font-extrabold uppercase transition-all shadow-sm cursor-pointer text-center";
        if (soloBtn) soloBtn.className = "py-2 rounded-lg bg-white/5 hover:bg-white/10 text-neutral-300 font-bold uppercase transition-all cursor-pointer text-center";
        if (teamFields) {
            teamFields.classList.remove('hidden');
            const captain = document.getElementById('joinCaptain');
            const contact = document.getElementById('joinContact');
            if (captain) captain.setAttribute('required', 'true');
            if (contact) contact.setAttribute('required', 'true');
        }
        if (soloFields) {
            soloFields.classList.add('hidden');
            soloFields.querySelectorAll('input, select').forEach(el => el.removeAttribute('required'));
        }
        if (heading) heading.textContent = targetTeamSize ? `Join ${targetTeamSize}v${targetTeamSize} Tournament` : "Join Tournament";
        if (subheading) subheading.textContent = `Register your competitive team roster below (${targetTeamSize} players).`;
    }

    window.updateJoinModalFeeDisplay(mode);
};

async function openJoinForm(id, isEdit = false, specificAppId = null, forcedMode = null) {
    const auth = getAuth();
    const user = auth.currentUser;
    if (!user) { 
        if (window.showErrorToast) window.showErrorToast('Login Required', 'Please log in.'); 
        window.location.href = '/login'; 
        return; 
    }

    if (!await checkEmailVerification(isEdit ? "edit tournament registration" : "register for this tournament")) {
        return;
    }

    const tournDoc = allTournaments.find(t => t.id === id) || currentEditingTournament;

    if (!isEdit) {
        try {
            const isAlreadyInParticipants = (tournDoc?.participants || []).some(p => {
                if (!p) return false;
                if (p.registeredBy === user.uid || p.userId === user.uid || p.uid === user.uid) return true;
                if (p.captainEmail && user.email && p.captainEmail.toLowerCase() === user.email.toLowerCase()) return true;
                if (p.contact && user.email && p.contact.toLowerCase() === user.email.toLowerCase()) return true;
                if (Array.isArray(p.members) && p.members.some(m => {
                    const mName = typeof m === 'object' ? (m.ign || m.name || '') : m;
                    return user.displayName && String(mName).toLowerCase() === user.displayName.toLowerCase();
                })) return true;
                return false;
            });

            if (isAlreadyInParticipants) {
                const targetTeamSize = parseInt(tournDoc?.teamSize) || 5;
                const isSolo = (tournDoc?.registrationType === 'solo' || targetTeamSize === 1);
                if (window.showErrorToast) {
                    window.showErrorToast('Already Registered', isSolo ? 'You are already registered for this 1v1 tournament.' : 'Your team is already confirmed in this tournament.');
                }
                return;
            }

            const appsRef = collection(db, "tournaments", id, "applications");
            const q = query(appsRef, where("registeredBy", "==", user.uid));
            const appSnap = await getDocs(q);
            if (!appSnap.empty) {
                const existingStatus = appSnap.docs[0].data().status;
                const existingAppId  = appSnap.docs[0].id;
                if (existingStatus === 'approved') {
                    if (window.showErrorToast) window.showErrorToast('Already Registered', 'Your registration is already confirmed in this tournament.');
                    return;
                }
                if (existingStatus === 'pending' || existingStatus === 'pending_update') {
                    if (window.showErrorToast) window.showErrorToast('Application Pending', 'Redirecting to edit your pending application.');
                    openJoinForm(id, true, existingAppId);
                    return;
                }
            }

            const isSoloTournament = (tournDoc?.registrationType === 'solo' || parseInt(tournDoc?.teamSize) === 1);
            if (!isSoloTournament) {
                const mySolo = (tournDoc?.soloQueue || []).find(p => p.userId === user.uid);
                if (mySolo && mySolo.status === 'Queued') {
                    if (window.showErrorToast) window.showErrorToast('Already Queued', 'You are already registered in the Solo Free Agent queue.');
                    return;
                }
            }
        } catch (e) { console.error(e); }
    }

    currentJoiningId = id;
    userTeams = [];
    let proofURL = null;
    const qrURL = tournDoc?.paymentQrUrl || tournDoc?.qrUrl || tournDoc?.qr || '';

    const regType = tournDoc?.registrationType || 'team';
    const targetTeamSize = parseInt(tournDoc?.teamSize) || 5;
    const typeSelectorWrap = document.getElementById('joinTypeSelectorWrap');

    if (regType === 'solo' || targetTeamSize === 1) {
        if (typeSelectorWrap) typeSelectorWrap.classList.add('hidden');
        window.switchJoinMode('solo');
    } else if (regType === 'hybrid') {
        if (typeSelectorWrap) typeSelectorWrap.classList.remove('hidden');
        window.switchJoinMode(forcedMode || 'team');
    } else {
        if (typeSelectorWrap) typeSelectorWrap.classList.add('hidden');
        window.switchJoinMode('team');
    }

    const modalTitle = qs('#joinModal h3');
    const submitBtn = qs('#joinForm button[type="submit"]');
    const form = qs('#joinForm');

    const isPaid = tournDoc?.paymentType === 'manual' || (!tournDoc?.paymentType && tournDoc?.entryType === 'Paid');

    const select = qs('#joinTeamSelect');
    if (select) select.innerHTML = '<option value="custom" class="bg-[#1a1a1f] text-white">Loading teams...</option>';

    try {
        const teamsRef = collection(db, "recruitment");
        const snap = await getDocs(teamsRef);
        userTeams = [];
        
        snap.forEach(doc => {
            const data = doc.data();
            if (data.type === 'lft' || data.isLft === true) return;
            const isAuthor = data.authorId === user.uid;
            const isMember = data.members && Array.isArray(data.members) && data.members.some(m => m.uid === user.uid);
            if (isAuthor || isMember) userTeams.push({ id: doc.id, ...data });
        });

        const enrichedTeams = await Promise.all(userTeams.map(async (team) => {
            if (!team.members || !Array.isArray(team.members)) return team;
            const enrichedMembers = await Promise.all(team.members.map(async (m) => {
                const uid = typeof m === 'string' ? null : m.uid;
                if (!uid) return m;
                try {
                    const userDoc = await getDoc(doc(db, "users", uid));
                    if (userDoc.exists()) {
                        const displayName = userDoc.data().displayName || m.ign || m.name || '';
                        return { ...m, displayName };
                    }
                } catch (e) { console.error(e); }
                return m;
            }));
            return { ...team, members: enrichedMembers };
        }));

        userTeams = enrichedTeams;
        window.userTeams = userTeams;

        const noTeamsNotice = document.getElementById('noTeamsNotice');
        const createTeamLink = document.getElementById('createTeamDirectLink');

        if (select) {
            if (userTeams.length === 0) {
                select.innerHTML = '<option value="custom" class="bg-[#1a1a1f] text-neutral-400">No teams found — Create a team on Teams page</option>';
                if (noTeamsNotice) noTeamsNotice.classList.remove('hidden');
            } else {
                select.innerHTML = '<option value="custom" class="bg-[#1a1a1f] text-white">-- Select Team --</option>';
                if (noTeamsNotice) noTeamsNotice.classList.add('hidden');
                userTeams.forEach(team => {
                    const option = document.createElement('option');
                    option.value = team.id;
                    option.textContent = team.name || "Unnamed Team";
                    option.className = 'bg-[#1a1a1f] text-white';
                    select.appendChild(option);
                });
            }
        }
    } catch (e) { console.error(e); }

    if (isEdit && specificAppId) {
        try {
            const appRef = doc(db, "tournaments", id, "applications", specificAppId);
            const appSnap = await getDoc(appRef);
            if (appSnap.exists()) {
                const data = appSnap.data();
                proofURL = data.proofURL || data.paymentProof || data.proof || null;
                const matchingTeam = userTeams.find(t => t.name === data.name);
                if (matchingTeam && select) { 
                    select.value = matchingTeam.id; 
                    if (window.toggleTeamInput) window.toggleTeamInput(select); 
                }

                if (qs('#joinCaptain')) qs('#joinCaptain').value = data.captain || '';
                if (qs('#joinContact')) qs('#joinContact').value = data.contact || '';
                if (qs('#joinPhone')) qs('#joinPhone').value = data.phone || '';
                
                const membersContainer = qs('#membersContainer');
                if (membersContainer) {
                    membersContainer.innerHTML = '';
                    if (data.members && data.members.length > 0) {
                        data.members.forEach((savedMemberName) => {
                            const div = document.createElement('div');
                            div.className = 'flex gap-2 items-center animate-row-in w-full';

                            if (matchingTeam && matchingTeam.members) {
                                const selectEl = document.createElement('select');
                                selectEl.name = 'memberIgn[]';
                                selectEl.className = 'dark-select w-full p-2.5 rounded-lg text-xs font-mono-tag cursor-pointer';
                                selectEl.required = true;

                                matchingTeam.members.forEach(m => {
                                    const memberName = typeof m === 'string' ? m : (m.displayName || m.ign || m.name || '');
                                    const option = document.createElement('option');
                                    option.value = memberName;
                                    option.textContent = memberName;
                                    if (memberName === savedMemberName) option.selected = true;
                                    selectEl.appendChild(option);
                                });
                                div.appendChild(selectEl);
                            } else {
                                div.innerHTML = `<input type="text" name="memberIgn[]" value="${escapeHtml(savedMemberName)}" class="dark-input w-full p-2.5 rounded-lg text-xs" required>`;
                            }

                            const deleteBtn = document.createElement('button');
                            deleteBtn.type = 'button';
                            deleteBtn.className = 'text-red-400 hover:text-red-300 px-2 text-xl transition-colors';
                            deleteBtn.innerHTML = '&times;';
                            deleteBtn.onclick = function() { this.parentElement.remove(); };
                            div.appendChild(deleteBtn);
                            membersContainer.appendChild(div);
                        });
                    }
                }
            }
        } catch (e) { console.error(e); }
    } else {
        let userProfile = {};
        try {
            const userSnap = await getDoc(doc(db, "users", user.uid));
            if (userSnap.exists()) userProfile = userSnap.data() || {};
        } catch (e) { console.warn("Failed to fetch user profile for auto-fill:", e); }

        const tGameStr = String(tournDoc?.game || tournDoc?.title || '').toLowerCase();
        let matchedIgn = userProfile.ign || userProfile.displayName || user.displayName || (user.email ? user.email.split('@')[0] : '');
        let matchedRank = '';
        let matchedRole = '';

        if (tGameStr.includes('val')) {
            matchedIgn = userProfile.valId || matchedIgn;
            matchedRank = userProfile.valRank || '';
            matchedRole = userProfile.valRole || '';
        } else if (tGameStr.includes('mlbb') || tGameStr.includes('mobile legends') || tGameStr.includes('bang bang')) {
            matchedIgn = userProfile.mlbbId || matchedIgn;
            matchedRank = userProfile.mlbbRank || '';
            matchedRole = userProfile.mlbbRole || '';
        } else if (tGameStr.includes('hok') || tGameStr.includes('honor of kings')) {
            matchedIgn = userProfile.hokId || matchedIgn;
            matchedRank = userProfile.hokRank || '';
            matchedRole = userProfile.hokRole || '';
        } else {
            matchedRank = userProfile.rank || '';
            matchedRole = userProfile.role || '';
        }

        const matchedContact = userProfile.discord || userProfile.discordTag || userProfile.email || user.email || '';
        const matchedPhone = userProfile.phone || '';
        const matchedBio = userProfile.bio || '';

        if (qs('#joinCaptain')) qs('#joinCaptain').value = matchedIgn; 
        if (qs('#joinContact')) qs('#joinContact').value = matchedContact;
        if (qs('#joinPhone')) qs('#joinPhone').value = matchedPhone;
        if (qs('#joinSoloIgn')) qs('#joinSoloIgn').value = matchedIgn;
        if (qs('#joinSoloRank')) qs('#joinSoloRank').value = matchedRank;
        if (qs('#joinSoloRole') && matchedRole) {
            const roleSelect = qs('#joinSoloRole');
            for (let i = 0; i < roleSelect.options.length; i++) {
                if (roleSelect.options[i].value.toLowerCase().includes(matchedRole.toLowerCase()) || 
                    matchedRole.toLowerCase().includes(roleSelect.options[i].value.toLowerCase().split(' ')[0])) {
                    roleSelect.selectedIndex = i;
                    break;
                }
            }
        }
        if (qs('#joinSoloContact')) qs('#joinSoloContact').value = matchedContact;
        if (qs('#joinSoloPhone')) qs('#joinSoloPhone').value = matchedPhone;
        if (qs('#joinSoloNotes')) qs('#joinSoloNotes').value = matchedBio;

        if (select && window.toggleTeamInput) {
            window.toggleTeamInput(select);
        } else {
            const detailsWrap = document.getElementById('joinTeamDetailsWrap');
            if (detailsWrap) detailsWrap.classList.add('hidden');
        }
    }

    const qrPanel = document.getElementById('join-qr-panel');
    const qrImg   = document.getElementById('join-qr-img');
    const qrDl    = document.getElementById('join-qr-download');
    const qrLabel = document.getElementById('join-qr-download-label');

    if (isPaid && qrURL) {
        if (qrImg) qrImg.src = qrURL;
        const safeName = (tournDoc.name || 'payment-qr').replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_-]/g, '');
        if (qrDl) {
            qrDl.href     = qrURL;
            qrDl.download = `${safeName}_QR`;
        }
        if (qrLabel) qrLabel.textContent = `Download QR`;
        if (qrPanel) qrPanel.classList.remove('hidden');
    } else if (qrPanel) {
        qrPanel.classList.add('hidden');
    }

    const feeDisplay = document.getElementById('join-entry-fee-display');
    if (feeDisplay) {
        if (isPaid && tournDoc.entryFee > 0) {
            const currEl = document.getElementById('join-entry-currency');
            const amtEl = document.getElementById('join-entry-fee-amount');
            const netEl = document.getElementById('join-net-fee');
            const platEl = document.getElementById('join-platform-fee');
            const curr = tournDoc.entryCurrency || 'PHP';
            const sym = curr === 'PHP' ? '₱' : '$';
            const feeVal = parseFloat(tournDoc.entryFee) || 0;
            const pFee = feeVal * 0.05;
            const nFee = feeVal - pFee;

            if (currEl) currEl.textContent = curr;
            if (amtEl) amtEl.textContent = feeVal.toFixed(2);
            if (netEl) netEl.textContent = `${sym}${nFee.toFixed(2)}`;
            if (platEl) platEl.textContent = `${sym}${pFee.toFixed(2)}`;
            feeDisplay.classList.remove('hidden');
        } else {
            feeDisplay.classList.add('hidden');
        }
    }

    const entryFeeUpload = document.getElementById('join-entry-fee-upload');
    if (entryFeeUpload) {
        if (proofURL) {
            window._entryFeePreviewURL = proofURL;
            if (document.getElementById('entry-fee-filename')) document.getElementById('entry-fee-filename').textContent = 'Existing Proof Uploaded';
            if (document.getElementById('entry-fee-preview-btn-wrap')) document.getElementById('entry-fee-preview-btn-wrap').classList.remove('hidden');
        } else {
            window._entryFeeFile = null;
            window._entryFeePreviewURL = null;
            if (document.getElementById('entry-fee-filename')) document.getElementById('entry-fee-filename').textContent = 'Click or drag image here';
            if (document.getElementById('entry-fee-dropzone')) document.getElementById('entry-fee-dropzone').style.borderColor = 'rgba(255,255,255,0.15)';
            if (document.getElementById('entry-fee-preview-btn-wrap')) document.getElementById('entry-fee-preview-btn-wrap').classList.add('hidden');
            if (document.getElementById('entry-fee-file-input')) document.getElementById('entry-fee-file-input').value = '';
        }
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
    if (!user) {
        if (window.showErrorToast) window.showErrorToast('Login Required', 'Please log in.');
        return;
    }
    const isEdit = qs('#joinForm').dataset.mode === 'edit';
    if (!await checkEmailVerification(isEdit ? "edit tournament registration" : "register for this tournament")) {
        return;
    }
    const specificAppId = qs('#joinForm').dataset.appId;
    const activeMode = qs('#joinActiveMode')?.value || 'team';

    const tournDoc = allTournaments.find(t => t.id === currentJoiningId) || currentEditingTournament;
    const paymentType = tournDoc?.paymentType || (tournDoc?.entryType === 'Paid' ? 'manual' : (tournDoc?.entryType ? String(tournDoc.entryType).toLowerCase() : 'free'));
    const isPaid = (paymentType === 'manual' || paymentType === 'automatic' || tournDoc?.entryType === 'Paid') && (tournDoc?.entryFee > 0);
    const isManual = paymentType === 'manual' || (isPaid && paymentType !== 'automatic');

    // === SOLO REGISTRATION & FREE AGENT QUEUE SUBMISSION ===
    if (activeMode === 'solo') {
        const ign = qs('#joinSoloIgn')?.value?.trim();
        const role = qs('#joinSoloRole')?.value || 'Flex / Any';
        const rank = qs('#joinSoloRank')?.value?.trim() || 'Unranked';
        const contact = qs('#joinSoloContact')?.value?.trim();
        const phone = qs('#joinSoloPhone')?.value?.trim() || '';
        const notes = qs('#joinSoloNotes')?.value?.trim() || '';

        if (!ign || !contact) {
            if (window.showErrorToast) window.showErrorToast('Missing Info', 'Please enter your Player IGN and Discord/Email contact.');
            return;
        }

        const isSoloTournament = Number(tournDoc?.teamSize) === 1 || tournDoc?.registrationType === 'solo';

        const submitBtn = qs('#joinForm button[type="submit"]');
        if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = isSoloTournament ? 'Registering...' : 'Joining Queue...'; }

        try {
            const tourneyRef = doc(db, "tournaments", currentJoiningId);
            const tSnap = await getDoc(tourneyRef);
            if (!tSnap.exists()) throw new Error("Tournament not found");
            const tData = tSnap.data();

            let participants = tData.participants || [];
            let soloList = tData.soloQueue || [];

            // Duplicate validation
            const alreadyInParticipants = participants.some(p => {
                if (!p) return false;
                if (p.registeredBy === user.uid || p.userId === user.uid) return true;
                if (p.name && p.name.toLowerCase() === ign.toLowerCase()) return true;
                if (p.captain && p.captain.toLowerCase() === ign.toLowerCase()) return true;
                if (Array.isArray(p.members) && p.members.some(m => String(typeof m === 'object' ? (m.ign || m.name) : m).toLowerCase() === ign.toLowerCase())) return true;
                return false;
            });

            if (alreadyInParticipants) {
                if (window.showErrorToast) {
                    window.showErrorToast('Already Registered', isSoloTournament 
                        ? 'You are already registered as a competitor in this 1v1 tournament.' 
                        : 'You are already registered in a squad for this tournament.');
                }
                if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Confirm Registration'; }
                return;
            }

            let entryFeeProofURL = '';
            if (isPaid && isManual && window._entryFeeFile) {
                const tournamentName = (tournDoc?.name || 'tournament').trim().replace(/\s+/g, '_');
                const safeName = window._entryFeeFile.name.replace(/\s+/g, '_');
                const fileRef = storageRef(storage, `payment-proofs/${tournamentName}/solo-fees/${ign.replace(/\s+/g, '_')}/${safeName}`);
                const snapshot = await uploadBytes(fileRef, window._entryFeeFile);
                entryFeeProofURL = await getDownloadURL(snapshot.ref);
            }

            // === 1V1 TOURNAMENT REGISTRATION (DIRECT COMPETITOR) ===
            if (isSoloTournament) {
                // If Paid Automatic: create pending application and redirect to PayRex checkout
                if (paymentType === 'automatic' && (tournDoc.entryFee > 0)) {
                    const appsRef = collection(db, "tournaments", currentJoiningId, "applications");
                    const appData = {
                        name: ign,
                        captain: ign,
                        contact: contact,
                        phone: phone,
                        rank: rank,
                        role: role,
                        members: [ign],
                        memberUids: [user.uid],
                        registeredBy: user.uid,
                        isSoloCompetitor: true,
                        paymentType: 'automatic',
                        entryFee: tournDoc.entryFee,
                        entryCurrency: tournDoc?.entryCurrency || 'PHP',
                        status: 'pending',
                        submittedAt: serverTimestamp()
                    };
                    const newAppRef = await addDoc(appsRef, appData);

                    document.getElementById('joinModal').classList.add('hidden');
                    window.location.href = `/checkout.html?t=${currentJoiningId}&app=${newAppRef.id}`;
                    return;
                }

                // If Paid Manual: create application with proof for review
                if (isPaid && isManual) {
                    const appsRef = collection(db, "tournaments", currentJoiningId, "applications");
                    const appData = {
                        name: ign,
                        captain: ign,
                        contact: contact,
                        phone: phone,
                        rank: rank,
                        role: role,
                        members: [ign],
                        memberUids: [user.uid],
                        registeredBy: user.uid,
                        isSoloCompetitor: true,
                        paymentType: 'manual',
                        entryFee: tournDoc.entryFee,
                        entryCurrency: tournDoc?.entryCurrency || 'PHP',
                        ...(entryFeeProofURL && { entryFeeProofURL }),
                        status: 'pending',
                        submittedAt: serverTimestamp()
                    };
                    await addDoc(appsRef, appData);

                    if (window.showSuccessToast) {
                        window.showSuccessToast('Application Submitted! 🪙', 'Your 1v1 entry has been submitted for payment verification. (+50 CZ Points)');
                    }
                } else {
                    // Free 1v1 tournament: directly add to participants roster!
                    const participantData = {
                        name: ign,
                        captain: ign,
                        contact: contact,
                        phone: phone,
                        rank: rank,
                        role: role,
                        members: [ign],
                        memberUids: [user.uid],
                        registeredBy: user.uid,
                        userId: user.uid,
                        isSoloCompetitor: true,
                        createdAt: Date.now()
                    };

                    const pIdx = participants.findIndex(p => p.registeredBy === user.uid || (p.name && p.name.toLowerCase() === ign.toLowerCase()));
                    if (pIdx !== -1) {
                        participants[pIdx] = participantData;
                    } else {
                        participants.push(participantData);
                    }

                    // Also save an approved application record for queries
                    const appsRef = collection(db, "tournaments", currentJoiningId, "applications");
                    await addDoc(appsRef, {
                        name: ign,
                        captain: ign,
                        contact: contact,
                        phone: phone,
                        members: [ign],
                        memberUids: [user.uid],
                        registeredBy: user.uid,
                        isSoloCompetitor: true,
                        status: 'approved',
                        submittedAt: serverTimestamp()
                    });

                    // Remove from soloQueue if user was previously queued
                    soloList = soloList.filter(p => p.userId !== user.uid);

                    await updateDoc(tourneyRef, { 
                        participants: participants,
                        soloQueue: soloList
                    });

                    if (currentEditingTournament && currentEditingTournament.id === currentJoiningId) {
                        currentEditingTournament.participants = participants;
                        currentEditingTournament.soloQueue = soloList;
                        renderParticipantsList(participants);
                        renderSoloQueueList(currentEditingTournament);
                        if (window.openModal) window.openModal(currentEditingTournament);
                    }

                    if (window.showSuccessToast) {
                        window.showSuccessToast('Registration Confirmed! 🪙', 'You are now confirmed in the 1v1 tournament roster! (+50 CZ Points)');
                    }
                }

            } else {
                // === TEAM TOURNAMENT SOLO FREE AGENT QUEUE ===
                const targetTeamSize = parseInt(tournDoc?.teamSize) || 5;
                const feeType = tournDoc?.feeType || (targetTeamSize === 1 || tournDoc?.registrationType === 'solo' ? 'solo' : 'team');
                const baseFee = parseFloat(tournDoc?.entryFee) || 0;
                const soloFee = isPaid ? (feeType === 'solo' ? baseFee : (baseFee / targetTeamSize)) : 0;

                const existingIdx = soloList.findIndex(p => p.userId === user.uid || p.ign.toLowerCase() === ign.toLowerCase());
                const soloPlayer = {
                    id: 'solo_' + user.uid + '_' + Date.now(),
                    userId: user.uid,
                    ign: ign,
                    role: role,
                    rank: rank,
                    contact: contact,
                    phone: phone,
                    notes: notes,
                    status: 'Queued',
                    registeredAt: Date.now(),
                    entryFee: soloFee,
                    feeType: feeType,
                    entryCurrency: tournDoc?.entryCurrency || 'PHP',
                    ...(entryFeeProofURL && { entryFeeProofURL })
                };

                if (existingIdx !== -1) {
                    soloList[existingIdx] = soloPlayer;
                } else {
                    soloList.push(soloPlayer);
                }

                await updateDoc(tourneyRef, { soloQueue: soloList });

                if (currentEditingTournament && currentEditingTournament.id === currentJoiningId) {
                    currentEditingTournament.soloQueue = soloList;
                    renderSoloQueueList(currentEditingTournament);
                    renderParticipantsList(currentEditingTournament.participants);
                    if (window.openModal) window.openModal(currentEditingTournament);
                }

                if (window.showSuccessToast) {
                    window.showSuccessToast('Free Agent Queue Joined! 🪙', 'You have been added to the Solo Free Agent queue for squad matchmaking. (+50 CZ Points)');
                }
            }

            // Organizer Notification
            if (tournDoc && tournDoc.createdBy) {
                try {
                    await addDoc(collection(db, "notifications"), {
                        userId: tournDoc.createdBy,
                        title: isSoloTournament ? "New 1v1 Competitor" : "New Solo Free Agent",
                        message: `${ign} (${role}) registered for ${tournDoc.name}.`,
                        tournamentId: currentJoiningId,
                        type: isSoloTournament ? "tournament_registration" : "solo_registration",
                        read: false,
                        createdAt: serverTimestamp()
                    });
                } catch (err) { console.warn("Organizer notification skipped:", err); }
            }

            document.getElementById('joinModal').classList.add('hidden');

            // Award Tournament Action Points (+50 CZ)
            try {
                const userRef = doc(db, "users", user.uid);
                await updateDoc(userRef, {
                    czPoints: increment(50),
                    lifetimePoints: increment(50)
                });
            } catch (ptsErr) {
                console.warn("Could not award tournament registration points:", ptsErr);
            }

        } catch (error) {
            console.error("Error completing solo registration:", error);
            if (window.showErrorToast) window.showErrorToast('Error', 'Failed to complete registration: ' + error.message);
        } finally {
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.textContent = 'Confirm Registration';
            }
        }
        return;
    }

    // === FULL TEAM SUBMISSION ===
    const teamSelectId = qs('#joinTeamSelect').value;

    if (!teamSelectId || teamSelectId === '' || teamSelectId === 'custom') {
        if (window.showErrorToast) window.showErrorToast('No Team Selected', 'Please select a team from your roster list.');
        return;
    }
    
    const isCustom = teamSelectId === 'custom';
    let teamName = userTeams.find(t => t.id === teamSelectId)?.name || "Unknown";
    let dbTeamId = isCustom ? null : teamSelectId;

    const captain = qs('#joinCaptain').value;
    const contact = qs('#joinContact').value;
    const phone = qs('#joinPhone').value;
    const memberInputs = document.querySelectorAll('input[name="memberIgn[]"], select[name="memberIgn[]"]');
    const filledMembers = [...memberInputs].filter(input => input.value.trim());
    
    const targetTeamSize = parseInt(tournDoc?.teamSize) || 5;
    const minMembers = targetTeamSize;
    const maxMembers = targetTeamSize === 1 ? 2 : (targetTeamSize + 1);

    if (filledMembers.length < minMembers || filledMembers.length > maxMembers) {
        const msg = targetTeamSize === 1 
            ? 'You must register with 1 player IGN for this 1v1 tournament.'
            : `You must register with ${minMembers} to ${maxMembers} members for this ${targetTeamSize}v${targetTeamSize} tournament.`;
        if (window.showErrorToast) window.showErrorToast('Invalid Team Size', msg);
        return;
    }

    const membersList = [];
    const memberUids = [user.uid];
    const selectedTeam = userTeams.find(t => t.id === qs('#joinTeamSelect').value);

    memberInputs.forEach(input => {
        if (input.value.trim()) {
            membersList.push(input.value.trim());
            if (selectedTeam && selectedTeam.members) {
                const match = selectedTeam.members.find(m => 
                    (typeof m === 'object' ? (m.displayName || m.ign || m.name) : m) === input.value.trim()
                );
                if (match && match.uid) memberUids.push(match.uid);
            }
        }
    });

    const candidateIgns = [captain.trim().toLowerCase(), ...membersList.map(m => m.trim().toLowerCase())].filter(Boolean);
    const participants = tournDoc?.participants || [];
    for (const p of participants) {
        if (isEdit && p.registeredBy === user.uid) continue;
        const pCaptain = (p.captain || '').trim().toLowerCase();
        const pMembers = (p.members || []).map(m => (typeof m === 'object' ? (m.ign || m.name || '') : m).trim().toLowerCase());
        const pName = (p.name || '').trim().toLowerCase();

        for (const ign of candidateIgns) {
            if (ign && (pCaptain === ign || pMembers.includes(ign) || pName === ign)) {
                if (window.showErrorToast) {
                    window.showErrorToast("Roster Collision", `Player "${ign}" is already registered in another squad ("${p.name}") for this tournament.`);
                }
                return;
            }
        }
    }

    let entryFeeProofURL = '';
    if (isPaid && isManual && window._entryFeeFile) {
        const tournamentName = (tournDoc.name || 'tournament').trim().replace(/\s+/g, '_');
        const safeName = window._entryFeeFile.name.replace(/\s+/g, '_');
        const fileRef = storageRef(storage, `payment-proofs/${tournamentName}/entry-fees/${teamName.replace(/\s+/g, '_')}/${safeName}`);
        const snapshot = await uploadBytes(fileRef, window._entryFeeFile);
        entryFeeProofURL = await getDownloadURL(snapshot.ref);
    }

    const feeType = tournDoc?.feeType || (targetTeamSize === 1 || tournDoc?.registrationType === 'solo' ? 'solo' : 'team');
    const baseFee = parseFloat(tournDoc?.entryFee) || 0;
    const teamTotalFee = isPaid ? (feeType === 'solo' ? (baseFee * targetTeamSize) : baseFee) : 0;

    let appData;
    if (isEdit) {
        appData = {
            pendingData: {
                name: teamName,
                captain: captain,
                contact: contact,
                phone: phone,
                members: membersList,
                memberUids: [...new Set(memberUids)],
                teamId: dbTeamId,
                paymentType: paymentType,
                entryFee: teamTotalFee,
                feeType: feeType,
                entryCurrency: tournDoc?.entryCurrency || 'PHP',
                ...(entryFeeProofURL && { entryFeeProofURL }),
            },
            status: 'pending_update',
            hasPendingUpdate: true,
            submittedAt: serverTimestamp(),
        };
    } else {
        appData = {
            name: teamName,
            captain: captain,
            contact: contact,
            phone: phone,
            members: membersList,
            memberUids: [...new Set(memberUids)], 
            teamId: dbTeamId,
            registeredBy: user.uid,
            submittedAt: serverTimestamp(),
            paymentType: paymentType,
            entryFee: teamTotalFee,
            feeType: feeType,
            entryCurrency: tournDoc?.entryCurrency || 'PHP',
            ...(entryFeeProofURL && { entryFeeProofURL }),
            status: 'pending',
            hasPendingUpdate: true,
        };
    }

    const submitBtn = qs('#joinForm button[type="submit"]');
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Submitting...'; }

    try {
        const appsRef = collection(db, "tournaments", currentJoiningId, "applications");
        let createdAppId = specificAppId;
        if (isEdit && specificAppId) { 
            await updateDoc(doc(appsRef, specificAppId), appData); 
        } else { 
            const newAppRef = await addDoc(appsRef, appData); 
            createdAppId = newAppRef.id;
        }

        if (tournDoc.paymentType === 'automatic') {
            window.location.href = `/checkout.html?t=${currentJoiningId}&app=${createdAppId}`;
            return;
        }

        const msg = isEdit ? 'Update request sent!' : 'Application submitted!';
        if (window.showSuccessToast) {
            window.showSuccessToast('Success! 🪙', isEdit ? msg : `${msg} (+50 CZ Points earned)`);
        }

        if (!isEdit) {
            // Award Tournament Action Points (+50 CZ)
            try {
                const userRef = doc(db, "users", user.uid);
                await updateDoc(userRef, {
                    czPoints: increment(50),
                    lifetimePoints: increment(50)
                });
            } catch (ptsErr) {
                console.warn("Could not award tournament registration points:", ptsErr);
            }
        }

        document.getElementById('joinModal').classList.add('hidden');
    } catch (e) {
        console.error(e);
        alert("Error submitting application: " + e.message);
    } finally {
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = isEdit ? 'Save Changes' : 'Submit Application'; }
    }
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
        if (window.showSuccessToast) window.showSuccessToast('Success', 'Application withdrawn.');
    } catch (e) { console.error(e); alert("Error withdrawing: " + e.message); }
}



function isUserAdminOrOrganizer() {
    const auth = getAuth();
    const user = auth.currentUser;
    if (!user) return false;
    const userRole = String(window.currentUserRole || '').toLowerCase();
    const isOrganizerRole = (userRole === 'admin' || userRole === 'organizer');
    const isOwner = currentEditingTournament && currentEditingTournament.createdBy === user.uid;
    return isOrganizerRole || isOwner;
}

async function viewTeamMembers(target) {
    if (!currentEditingTournament || !currentEditingTournament.participants) return;

    try {
        const tourneySnap = await getDoc(doc(db, "tournaments", currentEditingTournament.id));
        if (tourneySnap.exists()) {
            const freshParticipants = tourneySnap.data().participants || [];
            currentEditingTournament.participants = freshParticipants;
        }
    } catch (e) {
        console.warn("Could not fetch fresh participants:", e);
    }

    const participants = currentEditingTournament.participants || [];
    let team = null;

    if (typeof target === 'number') {
        team = participants[target];
    } else if (typeof target === 'string') {
        team = participants.find(p => (typeof p === 'object' ? p.name : p) === target);
    }

    if (!team) {
        if (window.showErrorToast) window.showErrorToast("Info", "No member details available.");
        return;
    }

    const isObj = typeof team === 'object';
    const teamName = isObj ? (team.name || 'Unnamed Team') : team;
    const captainName = isObj && team.captain ? team.captain : 'N/A';
    const members = isObj && Array.isArray(team.members) ? team.members : [];

    const list = document.getElementById('vm-list');
    const title = document.getElementById('vm-teamName');
    if (title) title.textContent = teamName;

    let contactDiv = document.getElementById('vm-contactInfo');
    if (!contactDiv && list) {
        contactDiv = document.createElement('div');
        contactDiv.id = 'vm-contactInfo';
        contactDiv.className = 'mb-4 p-3 bg-black/40 rounded-xl border border-white/10 text-xs space-y-1.5 font-mono-tag';
        list.parentNode.insertBefore(contactDiv, list);
    }

    if (contactDiv) {
        contactDiv.innerHTML = '';
        contactDiv.classList.add('hidden');

        if (isUserAdminOrOrganizer() && isObj) {
            try {
                let appData = null;
                if (team.applicationId) {
                    const appDocRef = doc(db, "tournaments", currentEditingTournament.id, "applications", team.applicationId);
                    const appDocSnap = await getDoc(appDocRef);
                    if (appDocSnap.exists()) appData = appDocSnap.data();
                }

                if (!appData) {
                    const appsRef = collection(db, "tournaments", currentEditingTournament.id, "applications");
                    const q = query(appsRef, where("name", "==", teamName));
                    const snap = await getDocs(q);
                    if (!snap.empty) appData = snap.docs[0].data();
                }

                if (appData) {
                    const emailStr = appData.contact
                        ? `<div><span class="text-neutral-400">Email:</span> <span class="text-white">${escapeHtml(appData.contact)}</span></div>`
                        : '';
                    const phoneStr = appData.phone
                        ? `<div><span class="text-neutral-400">Phone:</span> <span class="text-white">${escapeHtml(appData.phone)}</span></div>`
                        : '<div><span class="text-neutral-400">Phone:</span> <span class="text-neutral-500 italic">None provided</span></div>';

                    const proofURL = appData.entryFeeProofURL;
                    const proofStr = proofURL
                        ? `<div class="mt-2">
                               <span class="text-neutral-400">Payment Proof:</span>
                               <div class="mt-2">
                                   <img src="${escapeHtml(proofURL)}" alt="Payment Proof"
                                       class="w-full max-h-40 object-contain rounded-lg border border-white/10 cursor-pointer"
                                       onclick="window.openEntryFeeProofViewer('${escapeHtml(proofURL)}')" />
                               </div>
                           </div>`
                        : `<div><span class="text-neutral-400">Payment Proof:</span> <span class="text-neutral-500 italic">None submitted</span></div>`;

                    contactDiv.innerHTML = `
                        <div class="text-[10px] text-[#FFD700] uppercase font-bold tracking-wider mb-1">Organizer Intel</div>
                        ${emailStr}${phoneStr}${proofStr}
                    `;
                    contactDiv.classList.remove('hidden');
                }
            } catch (err) {
                console.error("Error loading contact data:", err);
            }
        }
    }

    if (list) {
        let itemsHtml = `
            <li class="p-3 bg-[#16161d] rounded-xl border border-[#FFD700]/30 flex items-center justify-between font-mono-tag text-xs mb-2">
                <div class="flex items-center gap-2">
                    <span class="px-2 py-0.5 rounded bg-[#FFD700]/20 text-[#FFD700] text-[10px] font-bold">1ST</span>
                    <div>
                        <div class="text-[9px] text-[#FFD700] uppercase font-bold tracking-wider">Team Captain</div>
                        <div class="text-white font-bold text-sm">${escapeHtml(captainName)}</div>
                    </div>
                </div>
                <span class="bg-[#FFD700] text-black text-[9px] font-bold px-1.5 py-0.5 rounded">LEADER</span>
            </li>
        `;

        if (members.length > 0) {
            itemsHtml += `
                <div class="text-[10px] text-neutral-400 uppercase font-bold tracking-wider mb-1.5 font-mono-tag">Active Roster (${members.length})</div>
            `;
            itemsHtml += members.map((m, i) =>
                `<li class="p-2.5 bg-white/5 rounded-xl border border-white/5 flex items-center justify-between font-mono-tag text-xs">
                    <div class="flex items-center gap-2">
                        <span class="w-5 h-5 rounded-full bg-white/10 flex items-center justify-center text-[10px] text-neutral-400 font-bold">${i + 1}</span>
                        <span class="text-neutral-200 font-medium">${escapeHtml(m)}</span>
                    </div>
                    <span class="text-[9px] text-neutral-500 font-mono-tag">PLAYER</span>
                </li>`
            ).join('');
        } else {
            itemsHtml += '<li class="text-center text-neutral-500 italic text-xs py-4 font-mono-tag">No additional roster members listed.</li>';
        }

        list.innerHTML = itemsHtml;
    }

    const modal = document.getElementById('viewMembersModal');
    if (modal) {
        modal.classList.remove('hidden');
        modal.classList.add('flex');
    }
}

window.viewPendingApplication = function(appId) {
    const app = pendingApplicationsMap.get(appId);
    if (!app) return;

    const pending = app.pendingData || null;
    const display = pending || app;

    const list = document.getElementById('vm-list');
    const title = document.getElementById('vm-teamName');

    title.textContent = `Application: ${app.name}`;
    list.innerHTML = '';

    const isUpdateReq = app.status === 'pending_update' && pending;
    if (isUpdateReq) {
        list.innerHTML += `
            <li class="p-2 mb-3 bg-amber-600/20 border border-amber-500/40 rounded text-xs text-amber-300 font-mono-tag">
                This is an update request.
            </li>`;
    }

    const proofURL = display.entryFeeProofURL;
    const proofRow = proofURL
        ? `<div class="text-xs mt-1 font-mono-tag">
               <span class="text-neutral-400">Payment Proof:</span>
               <button onclick="window.openEntryFeeProofViewer('${escapeHtml(proofURL)}')"
                   class="ml-2 inline-flex items-center gap-1 text-[var(--gold)] hover:underline text-xs">
                   View Proof
               </button>
           </div>`
        : `<div class="text-xs mt-1 font-mono-tag"><span class="text-neutral-400">Payment Proof:</span> <span class="text-neutral-500 italic">None submitted</span></div>`;

    const infoHtml = `
        <li class="p-3 mb-2 bg-[var(--gold)]/10 border border-[var(--gold)]/30 rounded flex flex-col gap-1 font-mono-tag text-xs">
            <div class="text-[10px] text-[var(--gold)] uppercase font-bold">Team Details</div>
            <div class="text-white"><span class="text-neutral-400">Captain:</span> ${escapeHtml(display.captain)}</div>
            <div class="text-white"><span class="text-neutral-400">Contact:</span> ${escapeHtml(display.contact || 'N/A')}</div>
            <div class="text-white"><span class="text-neutral-400">Phone:</span> ${escapeHtml(display.phone || 'N/A')}</div>
            ${proofRow}
        </li>
        <li class="mt-3 mb-1 text-[10px] text-neutral-500 uppercase font-mono-tag font-bold">Roster Members</li>
    `;
    list.innerHTML += infoHtml;

    const members = display.members || [];
    if (members.length > 0) {
        list.innerHTML += members.map(m =>
            `<li class="p-2 bg-white/5 rounded border border-white/5 flex items-center gap-2 mb-1 font-mono-tag text-xs">
                <span class="text-[var(--gold)]">&bull;</span> ${escapeHtml(m)}
            </li>`
        ).join('');
    } else {
        list.innerHTML += '<li class="text-center text-neutral-500 italic text-xs">No members listed.</li>';
    }

    document.getElementById('viewMembersModal').classList.remove('hidden');
    document.getElementById('viewMembersModal').classList.add('flex');
};

function initAdminDashboard(tournamentId) {
    const list = qs('#adminAppList');
    const badge = qs('#pendingAppBadge');
    if (!list) return;
    list.innerHTML = '<div class="text-neutral-500 text-[11px] py-1 text-center font-mono-tag">Loading...</div>';
    if (adminUnsubscribe) adminUnsubscribe();

    const q = query(
        collection(db, "tournaments", tournamentId, "applications"),
        where("hasPendingUpdate", "==", true)
    );
    
    adminUnsubscribe = onSnapshot(q, (snap) => {
        pendingApplicationsMap.clear();

        if (badge) {
            if (snap.empty) {
                badge.textContent = '0';
                badge.className = 'px-1.5 py-0.2 rounded-full text-[9px] bg-white/10 text-neutral-400 font-bold';
            } else {
                badge.textContent = snap.size;
                badge.className = 'px-1.5 py-0.2 rounded-full text-[9px] bg-[#FFD700] text-black font-extrabold shadow-sm animate-pulse';
            }
        }

        if (snap.empty) { 
            list.innerHTML = '<div class="text-neutral-500 text-[11px] py-2 text-center font-mono-tag italic">No pending applications.</div>'; 
            return; 
        }
        
        list.innerHTML = '';
        snap.forEach(docSnap => {
            const app = docSnap.data();
            pendingApplicationsMap.set(docSnap.id, app);

            const isUpdate = app.status === 'pending_update';
            const item = document.createElement('div');
            item.className = "flex items-center justify-between bg-black/40 p-3 rounded-xl border border-white/5 gap-2 hover:border-white/15 transition-all";
            const proofBtn = app.entryFeeProofURL ? `
                <button type="button" onclick="window.openEntryFeeProofViewer('${escapeHtml(app.entryFeeProofURL)}')" class="px-1.5 py-1 rounded bg-amber-500/15 text-amber-400 hover:bg-amber-500/30 border border-amber-500/30 text-[9px] font-bold uppercase cursor-pointer shrink-0" title="View Payment Proof">Proof</button>
            ` : '';

            item.innerHTML = `
                <div class="min-w-0 flex-1">
                    <div class="font-heading font-black text-white text-xs flex items-center gap-1.5 truncate">
                        <span class="truncate">${escapeHtml(app.name)}</span>
                        ${isUpdate ? '<span class="text-[8px] bg-amber-500/20 text-amber-400 border border-amber-500/30 px-1 py-0.2 rounded font-mono-tag uppercase shrink-0">UPDATE</span>' : '<span class="text-[8px] bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-1 py-0.2 rounded font-mono-tag uppercase shrink-0">NEW</span>'}
                    </div>
                    <div class="text-[10px] text-neutral-400 font-mono-tag truncate mt-0.5">Cap: <span class="text-neutral-200">${escapeHtml(app.captain)}</span></div>
                </div>
                <div class="flex items-center gap-1 shrink-0 font-mono-tag">
                    ${proofBtn}
                    <button type="button" onclick="window.viewPendingApplication('${docSnap.id}')" class="bg-white/5 hover:bg-white/15 text-neutral-300 text-[9px] px-2 py-1 rounded border border-white/10 uppercase font-bold cursor-pointer transition-colors">View</button>
                    <button type="button" onclick="window.processApplication('${tournamentId}', '${docSnap.id}', true)" class="bg-[#FFD700] hover:bg-[#FFF099] text-black text-[9px] font-extrabold px-2 py-1 rounded uppercase cursor-pointer shadow-sm transition-colors">Accept</button>
                </div>`;

            list.appendChild(item);
        });
    });
}

async function sendTournamentNotification(uids, tourneyId, type, message) {
    if (!uids || !uids.length) return;
    for (const uid of uids) {
        if (window.sendPlayerNotification) {
            await window.sendPlayerNotification(uid, {
                title: type === 'alert' ? 'Tournament Application' : 'Tournament Update',
                message: message,
                type: 'tournament',
                tag: message.includes('accepted') ? 'APPROVED' : 'DECLINED',
                link: `/tournaments?id=${tourneyId}`
            });
        }
    }
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
            const source = appData.pendingData || appData;
            const newParticipantData = {
                name: source.name,
                captain: source.captain,
                contact: source.contact,
                members: source.members,
                teamId: source.teamId,
                registeredBy: appData.registeredBy,
                applicationId: appId,
                ...(source.entryFeeProofURL && { entryFeeProofURL: source.entryFeeProofURL }),
            };

            if (appData.status === 'pending_update' || appData.hasPendingUpdate) {
                const tSnap = await getDoc(tourneyRef);
                const participants = tSnap.data().participants || [];
                const oldEntry = participants.find(p => p.applicationId === appId || p.registeredBy === appData.registeredBy);
                if (oldEntry) await updateDoc(tourneyRef, { participants: arrayRemove(oldEntry) });
            }

            await updateDoc(tourneyRef, { participants: arrayUnion(newParticipantData) });

            const appUpdatePayload = {
                status: 'approved',
                hasPendingUpdate: false,
                pendingData: null
            };

            if (appData.status === 'pending_update' || appData.hasPendingUpdate) {
                appUpdatePayload.name = source.name;
                appUpdatePayload.captain = source.captain;
                appUpdatePayload.contact = source.contact;
                appUpdatePayload.members = source.members;
                appUpdatePayload.teamId = source.teamId;
                if (source.entryFeeProofURL) appUpdatePayload.entryFeeProofURL = source.entryFeeProofURL;
            }

            await updateDoc(appRef, appUpdatePayload);
            const uidsToNotify = appData.memberUids && appData.memberUids.length > 0
                ? appData.memberUids
                : [appData.registeredBy];

            await sendTournamentNotification(uidsToNotify, tourneyId, 'alert', `Your team "${source.name}" has been accepted into "${currentEditingTournament.name}"!`);


            const refreshedSnap = await getDoc(tourneyRef);
            if (refreshedSnap.exists()) {
                currentEditingTournament = { id: tourneyId, ...refreshedSnap.data() };
            }
            if (window.showSuccessToast) window.showSuccessToast('Approved', `"${source.name}" has been approved!`);

        } else {
            await updateDoc(appRef, { status: 'rejected', hasPendingUpdate: false });
            const uidsToNotify = appData.memberUids && appData.memberUids.length > 0
                ? appData.memberUids
                : [appData.registeredBy];

        await sendTournamentNotification(uidsToNotify, tourneyId, 'alert', `Your application for "${appData.name}" was declined.`);
        if (window.showSuccessToast) window.showSuccessToast('Rejected', `Application rejected.`);

        }
    } catch (e) {
        console.error(e);
        alert("Action failed: " + e.message);
    }
}

// ----------------------------------------------------
// BRACKET ZOOM, PAN & FULLSCREEN CONTROLS
// ----------------------------------------------------
let currentBracketZoom = 1.0;
window.currentBracketZoom = currentBracketZoom;

function applyBracketZoom(zoom) {
    currentBracketZoom = Math.min(2.0, Math.max(0.4, Math.round(zoom * 100) / 100));
    window.currentBracketZoom = currentBracketZoom;

    const indicator = document.getElementById('bracketZoomIndicator');
    if (indicator) indicator.textContent = `${Math.round(currentBracketZoom * 100)}%`;

    const wrapper = document.getElementById('bracketZoomWrapper');
    if (wrapper) {
        wrapper.style.transform = `scale(${currentBracketZoom})`;
        wrapper.style.transformOrigin = '0 0';
        wrapper.style.display = 'inline-block';
        wrapper.style.width = 'max-content';
        wrapper.style.height = 'max-content';
    }
}
window.applyBracketZoom = applyBracketZoom;

function zoomBracket(delta) {
    applyBracketZoom(currentBracketZoom + delta);
}
window.zoomBracket = zoomBracket;

function resetBracketZoom() {
    applyBracketZoom(1.0);
}
window.resetBracketZoom = resetBracketZoom;

function toggleBracketFullscreen() {
    const section = document.getElementById('bracketSection');
    const btn = document.getElementById('bracketFullscreenBtn');
    if (!section) return;

    const isFullscreen = section.classList.toggle('bracket-fullscreen-mode');
    
    if (btn) {
        if (isFullscreen) {
            btn.title = "Exit Fullscreen (Esc)";
            btn.innerHTML = `<svg class="w-3.5 h-3.5 text-[#FFD700]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>`;
            btn.classList.add('text-[#FFD700]', 'bg-white/10');
        } else {
            btn.title = "Fullscreen Bracket View";
            btn.innerHTML = `<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"/></svg>`;
            btn.classList.remove('text-[#FFD700]', 'bg-white/10');
        }
    }
}
window.toggleBracketFullscreen = toggleBracketFullscreen;

window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        const section = document.getElementById('bracketSection');
        if (section && section.classList.contains('bracket-fullscreen-mode')) {
            toggleBracketFullscreen();
        }
    }
});

function initBracketPanAndZoom() {
    const viewport = document.getElementById('bracketViewport');
    if (!viewport || viewport._panZoomInit) return;
    viewport._panZoomInit = true;

    let isPanning = false;
    let startX = 0, startY = 0;
    let scrollLeft = 0, scrollTop = 0;

    viewport.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return; // left click only
        if (e.target.closest('button, select, input, .tree-match-card, .match-card, a')) return;
        isPanning = true;
        startX = e.pageX - viewport.offsetLeft;
        startY = e.pageY - viewport.offsetTop;
        scrollLeft = viewport.scrollLeft;
        scrollTop = viewport.scrollTop;
        viewport.style.cursor = 'grabbing';
    });

    window.addEventListener('mousemove', (e) => {
        if (!isPanning) return;
        e.preventDefault();
        const x = e.pageX - viewport.offsetLeft;
        const y = e.pageY - viewport.offsetTop;
        const walkX = (x - startX);
        const walkY = (y - startY);
        viewport.scrollLeft = scrollLeft - walkX;
        viewport.scrollTop = scrollTop - walkY;
    });

    window.addEventListener('mouseup', () => {
        if (isPanning) {
            isPanning = false;
            viewport.style.cursor = 'grab';
        }
    });

    viewport.addEventListener('wheel', (e) => {
        if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            const delta = e.deltaY < 0 ? 0.15 : -0.15;
            zoomBracket(delta);
        }
    }, { passive: false });

    let initialPinchDist = null;
    let initialZoom = 1.0;

    viewport.addEventListener('touchstart', (e) => {
        if (e.touches.length === 2) {
            initialPinchDist = Math.hypot(
                e.touches[0].pageX - e.touches[1].pageX,
                e.touches[0].pageY - e.touches[1].pageY
            );
            initialZoom = currentBracketZoom;
        }
    }, { passive: true });

    viewport.addEventListener('touchmove', (e) => {
        if (e.touches.length === 2 && initialPinchDist) {
            e.preventDefault();
            const dist = Math.hypot(
                e.touches[0].pageX - e.touches[1].pageX,
                e.touches[0].pageY - e.touches[1].pageY
            );
            const factor = dist / initialPinchDist;
            applyBracketZoom(initialZoom * factor);
        }
    }, { passive: false });

    viewport.addEventListener('touchend', (e) => {
        if (e.touches.length < 2) {
            initialPinchDist = null;
        }
    }, { passive: true });
}

// ----------------------------------------------------
// BRACKET TREE RENDERING
// ----------------------------------------------------
function renderBracket(participants, format, isAdmin, isStarted) {
    const container = qs('#bracketContainer');
    if (!container) return;
    container.innerHTML = '';

    const safeFormat = (format || '').trim();

    if (safeFormat === 'Round Robin') {
        renderRoundRobin(container, participants, isAdmin);
    } else if (isStarted && safeFormat === 'Double Elimination' && currentEditingTournament.matches) {
        renderDoubleEliminationLive(container, currentEditingTournament.matches, isAdmin);
    } else if (isStarted && currentEditingTournament.matches && currentEditingTournament.matches.length > 0) {
        renderMatchesFromDatabase(container, currentEditingTournament.matches, safeFormat, isAdmin);
    } else {
        let teams = participants.map(p => typeof p === 'object' ? p.name : p);
        if (safeFormat === 'Double Elimination') renderDoubleEliminationPlaceholder(container, teams, isAdmin);
        else renderSingleEliminationPlaceholder(container, teams, isAdmin);
    }

    initBracketPanAndZoom();
    applyBracketZoom(currentBracketZoom);
}

function buildMatchTree(matches, rootMatchId = null) {
    let finalMatch;
    if (rootMatchId) {
        finalMatch = matches.find(m => m.id === rootMatchId);
    } else {
        finalMatch = matches.find(m => !m.nextMatchId) || matches.sort((a, b) => b.round - a.round)[0];
    }

    if (!finalMatch) return null;

    function getSources(targetMatch) {
        const sources = matches.filter(m => m.nextMatchId === targetMatch.id);
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

function handleMatchCardClick(matchId) {
    const auth = getAuth();
    const user = auth.currentUser;
    const role = String(window.currentUserRole || '').toLowerCase();
    const isOrganizer = (role === 'admin' || role === 'organizer' || currentEditingTournament?.createdBy === user?.uid);

    if (!user) return;

    if (isOrganizer) {
        window.openScoreModal(matchId);
        return;
    }

    let match = currentEditingTournament?.matches?.find(m => m.id === matchId);
    if (!match && currentEditingTournament?.brackets) {
        for (const round of currentEditingTournament.brackets) {
            if (Array.isArray(round)) {
                match = round.find(m => m.id === matchId);
                if (match) break;
            }
        }
    }
    if (!match) return;

    const participants = currentEditingTournament.participants || [];
    const userParticipant = participants.find(p => p.registeredBy === user.uid);
    const userTeamName = (userParticipant?.name || userParticipant?.teamName || '').trim().toLowerCase();
    const team1 = (match.team1 || '').trim().toLowerCase();
    const team2 = (match.team2 || '').trim().toLowerCase();
    const isCaptainOfThisMatch = userTeamName && (userTeamName === team1 || userTeamName === team2);

    if (!isCaptainOfThisMatch) {
        if (window.showToast) window.showToast("You can only view your own match chat.", "error");
        return;
    }

    document.getElementById('scoreMatchId').value = matchId;
    window.openMatchChatFromModal();
}
window.handleMatchCardClick = handleMatchCardClick;

function renderMatchBadgesHtml(m) {
    if (!m) return '';
    let html = '';
    
    // 1. Map Veto Badge
    if (m.veto && m.veto.map) {
        html += `<div class="mt-1 text-[8px] bg-amber-500/10 text-amber-300 px-1 py-0.5 rounded truncate font-mono-tag font-bold">${escapeHtml(m.veto.map)} (${escapeHtml(m.veto.side || 'Veto')})</div>`;
    }

    // 2. Match MVP Star Badge
    if (m.mvp) {
        html += `<div class="mt-0.5 text-[8px] bg-[#FFD700]/10 text-[#FFD700] px-1 py-0.5 rounded truncate font-mono-tag font-bold">MVP: ${escapeHtml(m.mvp)}</div>`;
    }

    // 3. Victory Screenshot Proof Button
    if (m.screenshotURL) {
        html += `
            <div class="mt-1 flex items-center justify-between gap-1">
                <button type="button" onclick="event.stopPropagation(); window.viewMatchScreenshot('${escapeHtml(m.screenshotURL)}')" class="text-[8px] bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-400 border border-emerald-500/30 px-1.5 py-0.5 rounded font-mono-tag font-bold flex items-center gap-1 transition-colors cursor-pointer">
                    <span>Proof</span>
                </button>
            </div>
        `;
    }

    // 4. Lobby Countdown Timer / Forfeit status
    if (m.startedAt && !m.winner && m.team1 !== 'TBD' && m.team2 !== 'TBD' && m.team1 !== 'BYE' && m.team2 !== 'BYE') {
        const durationMs = (m.durationMins || 15) * 60 * 1000;
        const elapsed = Date.now() - m.startedAt;
        const remainingMs = Math.max(0, durationMs - elapsed);
        const remainingSec = Math.floor(remainingMs / 1000);
        const mins = Math.floor(remainingSec / 60);
        const secs = remainingSec % 60;

        if (remainingMs === 0) {
            html += `<div class="mt-1 text-[8px] bg-rose-500/20 text-rose-400 border border-rose-500/40 px-1 py-0.5 rounded truncate font-mono-tag font-bold">Forfeit Eligible</div>`;
        } else {
            html += `<div class="mt-1 text-[8px] bg-white/5 text-neutral-400 px-1 py-0.5 rounded truncate font-mono-tag font-mono">${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}</div>`;
        }
    }

    return html;
}

function renderRecursiveBracket(container, treeNode, isAdmin) {
    if (!treeNode) return;

    const item = document.createElement('div');
    item.className = 'item';

    const childrenContainer = document.createElement('div');
    childrenContainer.className = 'item-childrens';

    if (treeNode.children && treeNode.children.length > 0) {
        treeNode.children.forEach(childNode => {
            const childWrapper = document.createElement('div');
            childWrapper.className = 'item-child';
            const isDoubleBye = childNode.match.team1 === 'BYE' && childNode.match.team2 === 'BYE';
            if (!isDoubleBye) {
                renderRecursiveBracket(childWrapper, childNode, isAdmin);
                childrenContainer.appendChild(childWrapper);
            }
        });
    }

    const parentContainer = document.createElement('div');
    parentContainer.className = 'item-parent';

    const m = treeNode.match;
    const isCompleted = !!m.winner;
    const isByeMatch = (m.team1 === 'BYE' || m.team2 === 'BYE');

    const card = document.createElement('div');
    let baseClass = `tree-match-card`;
    if (isCompleted) baseClass += ` completed`;
    if (isAdmin && !isByeMatch) baseClass += ` admin-editable cursor-pointer`;

    card.className = baseClass;
    if (!isByeMatch) card.onclick = () => handleMatchCardClick(m.id);

    if (isByeMatch) {
        const realTeam = m.team1 !== 'BYE' ? m.team1 : m.team2;
        card.className += " bye-card";
        card.innerHTML = `
            <div class="flex justify-between items-center text-[9px] text-neutral-500 mb-1 font-mono-tag">
                <span>R${m.round} • Advance</span>
            </div>
            <div class="flex items-center text-[var(--gold)] font-bold text-xs font-mono-tag">
                <span>${escapeHtml(realTeam)}</span>
            </div>
        `;
    } else {
        const mFmt = m.format || getRoundFormat(currentEditingTournament, `Round ${m.round}`);
        card.innerHTML = `
            <div class="flex justify-between items-center mb-1.5 text-[9px] text-neutral-500 font-mono-tag uppercase tracking-wider">
                <span>M${m.matchNumber} • R${m.round}</span>
                <span class="px-1.5 py-0.2 rounded bg-white/5 text-[8px] font-bold text-neutral-400 border border-white/10 font-mono-tag">${mFmt}</span>
                ${isCompleted ? '<span class="text-emerald-400 font-bold text-[10px]">DONE</span>' : ''}
            </div>
            <div class="space-y-1 w-full">
                <div class="flex justify-between items-center ${m.winner === m.team1 ? 'text-[var(--gold)] font-bold' : 'text-neutral-300'}">
                    <span class="text-xs truncate pr-2 font-mono-tag">${escapeHtml(m.team1)}</span>
                    <span class="bg-white/10 px-1 rounded text-[10px] font-mono-tag ${m.winner === m.team1 ? 'text-[var(--gold)]' : 'text-neutral-400'}">${m.score1 !== null ? m.score1 : '-'}</span>
                </div>
                <div class="flex justify-between items-center ${m.winner === m.team2 ? 'text-[var(--gold)] font-bold' : 'text-neutral-300'}">
                    <span class="text-xs truncate pr-2 font-mono-tag">${escapeHtml(m.team2)}</span>
                    <span class="bg-white/10 px-1 rounded text-[10px] font-mono-tag ${m.winner === m.team2 ? 'text-[var(--gold)]' : 'text-neutral-400'}">${m.score2 !== null ? m.score2 : '-'}</span>
                </div>
            </div>
            ${renderMatchBadgesHtml(m)}
        `;
    }

    parentContainer.appendChild(card);
    item.appendChild(childrenContainer);
    item.appendChild(parentContainer);
    container.appendChild(item);
}

function renderMatchesFromDatabase(container, matches, format, isAdmin) {
    container.innerHTML = '';
    injectTreeStyles();

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

    const headersDiv = document.createElement('div');
    headersDiv.className = 'bracket-header-row';

    for (let i = maxDepth; i >= 1; i--) {
        const hItem = document.createElement('div');
        hItem.className = 'header-item';
        let roundName = `Round ${maxDepth - i + 1}`;
        if (i === 1) roundName = "Grand Final";
        else if (i === 2) roundName = "Semi Finals";
        else if (i === 3 && maxDepth >= 4) roundName = "Quarter Finals";

        const fmt = getRoundFormat(currentEditingTournament, roundName);

        hItem.innerHTML = `
            <span class="font-heading font-black text-xs uppercase text-white tracking-wider whitespace-nowrap">${escapeHtml(roundName)}</span>
            ${isAdmin ? `
                <button type="button" onclick="window.quickEditRoundFormat('${roundName}', event)"
                    title="Click to cycle format (${fmt})"
                    class="px-1.5 py-0.5 rounded bg-[#FFD700]/15 hover:bg-[#FFD700]/30 text-[#FFD700] border border-[#FFD700]/40 text-[9px] font-mono-tag font-bold transition-all cursor-pointer inline-flex items-center gap-0.5 shadow-sm shrink-0">
                    <span>${fmt}</span>
                    <span class="text-[7px] opacity-70">▾</span>
                </button>
            ` : `
                <span class="px-1.5 py-0.5 rounded bg-white/5 text-neutral-400 border border-white/10 text-[9px] font-mono-tag font-bold shrink-0">${fmt}</span>
            `}
        `;
        headersDiv.appendChild(hItem);
    }

    const bracketScrollWrapper = document.createElement('div');
    bracketScrollWrapper.className = "bracket-scroll-container custom-scrollbar";
    bracketScrollWrapper.appendChild(headersDiv);

    if (rootNode) {
        const rootWrapper = document.createElement('div');
        rootWrapper.className = 'wrapper';
        renderRecursiveBracket(rootWrapper, rootNode, isAdmin);
        bracketScrollWrapper.appendChild(rootWrapper);

        const bronzeMatch = matches.find(m => m.id === 'M-3RD' || m.isBronzeMatch);
        if (bronzeMatch) {
            const bronzeWrap = document.createElement('div');
            bronzeWrap.className = 'mt-6 pt-4 border-t border-white/10 flex flex-col items-center justify-center font-mono-tag';
            const isBronzeDone = !!bronzeMatch.winner;
            bronzeWrap.innerHTML = `
                <div class="p-3.5 rounded-xl bg-[#0F0E17] border border-amber-500/30 w-full max-w-[280px] shadow-lg ${isAdmin ? 'hover:border-amber-400 cursor-pointer' : ''}">
                    <div class="flex justify-between items-center text-[10px] text-amber-400 font-bold uppercase mb-2 border-b border-amber-500/20 pb-1.5">
                        <span class="flex items-center gap-1.5"><span>3rd Place Decider</span></span>
                        ${isBronzeDone ? '<span class="text-emerald-400 font-bold text-[10px]">FINISHED</span>' : '<span class="text-neutral-400">Bronze Match</span>'}
                    </div>
                    <div class="space-y-1.5 text-xs">
                        <div class="flex justify-between items-center p-1.5 rounded bg-white/5 ${bronzeMatch.winner === bronzeMatch.team1 ? 'text-[#FFD700] font-bold border border-[#FFD700]/30' : 'text-neutral-300'}">
                            <span class="truncate pr-2">${escapeHtml(bronzeMatch.team1 || 'TBD')}</span>
                            <span class="bg-black/40 px-1.5 py-0.5 rounded text-[10px] font-bold">${bronzeMatch.score1 !== null ? bronzeMatch.score1 : '-'}</span>
                        </div>
                        <div class="flex justify-between items-center p-1.5 rounded bg-white/5 ${bronzeMatch.winner === bronzeMatch.team2 ? 'text-[#FFD700] font-bold border border-[#FFD700]/30' : 'text-neutral-300'}">
                            <span class="truncate pr-2">${escapeHtml(bronzeMatch.team2 || 'TBD')}</span>
                            <span class="bg-black/40 px-1.5 py-0.5 rounded text-[10px] font-bold">${bronzeMatch.score2 !== null ? bronzeMatch.score2 : '-'}</span>
                        </div>
                    </div>
                    ${renderMatchBadgesHtml(bronzeMatch)}
                </div>
            `;
            if (isAdmin) {
                bronzeWrap.firstElementChild.onclick = () => handleMatchCardClick(bronzeMatch.id);
            }
            bracketScrollWrapper.appendChild(bronzeWrap);
        }
    } else {
        bracketScrollWrapper.innerHTML = '<div class="text-neutral-500 w-full text-center mt-10 font-mono-tag text-xs">No bracket data available.</div>';
    }

    container.appendChild(bracketScrollWrapper);
}

function renderSingleEliminationPlaceholder(container, participants, isEditable) {
    let targetSize = currentEditingTournament.maxTeams || 8;
    let bracketSize = 2;
    while (bracketSize < participants.length) bracketSize *= 2;
    if (targetSize > bracketSize) bracketSize = targetSize;
    
    let s = 1; while (s < bracketSize) s *= 2;
    bracketSize = s;

    let teamNames = [...participants.map(p => typeof p === 'object' ? p.name : p)];
    const totalSlots = bracketSize;
    while (teamNames.length < totalSlots) teamNames.push('BYE');

    const seedOrder = getStandardSeeding(totalSlots);
    let seeds = new Array(totalSlots);
    for (let i = 0; i < totalSlots; i++) {
        seeds[i] = teamNames[seedOrder[i] - 1];
    }

    let rounds = Math.log2(bracketSize);
    const bracketWrapper = document.createElement('div');
    bracketWrapper.className = "bracket-wrapper";

    for (let r = 0; r < rounds; r++) {
        const roundDiv = document.createElement('div');
        roundDiv.className = 'bracket-round';
        
        let roundName = `Round ${r + 1}`;
        if (r === rounds - 1) roundName = "Grand Final";
        else if (r === rounds - 2) roundName = "Semi Finals";
        else if (r === rounds - 3 && rounds >= 4) roundName = "Quarter Finals";

        const fmt = getRoundFormat(currentEditingTournament, roundName);
        
        roundDiv.innerHTML = `
            <div class="flex items-center justify-center mb-3 border-b border-white/10 pb-1.5 gap-2">
                <span class="text-center text-xs text-white font-heading font-bold uppercase tracking-wider whitespace-nowrap">${escapeHtml(roundName)}</span>
                ${isEditable ? `
                    <button type="button" onclick="window.quickEditRoundFormat('${roundName}', event)"
                        title="Click to cycle format (${fmt})"
                        class="px-1.5 py-0.5 rounded bg-[#FFD700]/15 hover:bg-[#FFD700]/30 text-[#FFD700] border border-[#FFD700]/40 text-[9px] font-mono-tag font-bold transition-all cursor-pointer inline-flex items-center gap-0.5 shadow-sm shrink-0">
                        <span>${fmt}</span>
                        <span class="text-[7px] opacity-70">▾</span>
                    </button>
                ` : `
                    <span class="px-1.5 py-0.5 rounded bg-white/5 text-neutral-400 border border-white/10 text-[9px] font-mono-tag font-bold shrink-0">${fmt}</span>
                `}
            </div>
        `;
        
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

                let matchHTML = '';
                if (isSingleBye) {
                    const realTeam = (team1 !== 'BYE') ? team1 : team2;
                    matchHTML = `
                        <div class="match-card opacity-60 border-dashed border-neutral-600 my-1.5">
                            <div class="team-slot">
                                <span class="text-[var(--gold)] font-mono-tag text-xs">${escapeHtml(realTeam)}</span>
                                <span class="text-[10px] text-green-400 font-mono-tag font-bold ml-2">Advances</span>
                            </div>
                            <div class="team-slot text-neutral-600 text-xs italic font-mono-tag"><span>BYE</span></div>
                        </div>`;
                } else {
                    const idx1 = (r === 0) ? currentM * 2 : -1;
                    const idx2 = (r === 0) ? currentM * 2 + 1 : -1;
                    const click1 = (isEditable && r === 0 && team1 !== 'TBD') ? `onclick="window.selectTeam(${idx1})"` : '';
                    const click2 = (isEditable && r === 0 && team2 !== 'TBD') ? `onclick="window.selectTeam(${idx2})"` : '';
                    const sel1 = (swapSourceIndex === idx1 && r === 0) ? 'selected-for-swap' : '';
                    const sel2 = (swapSourceIndex === idx2 && r === 0) ? 'selected-for-swap' : '';
                    const extraClasses = isFinalRound ? 'champ-card' : '';

                    matchHTML = `
                        <div class="match-card ${extraClasses} ${isEditable && r === 0 ? 'editable-mode' : ''} my-1.5">
                            <div class="team-slot ${sel1}" ${click1}><span class="truncate">${escapeHtml(team1)}</span><span class="team-score">-</span></div>
                            <div class="team-slot ${sel2}" ${click2}><span class="truncate">${escapeHtml(team2)}</span><span class="team-score">-</span></div>
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
    controlsDiv.className = "flex gap-2 mb-3 border-b border-white/10 pb-3 font-mono-tag text-xs";
    controlsDiv.innerHTML = `
        <button id="btn-ub" onclick="window.switchBracketTab('upper')" class="px-4 py-1.5 rounded font-bold transition-all bg-[#FFD700] text-black uppercase cursor-pointer shadow-md">Upper Bracket</button>
        <button id="btn-lb" onclick="window.switchBracketTab('lower')" class="px-4 py-1.5 rounded font-bold transition-all bg-white/5 text-neutral-400 hover:text-white hover:bg-white/10 border border-white/10 uppercase cursor-pointer">Lower Bracket</button>
    `;
    container.appendChild(controlsDiv);

    const bracketScrollWrapper = document.createElement('div');
    bracketScrollWrapper.className = "bracket-wrapper overflow-x-auto custom-scrollbar w-full";

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
        let roundName = (r === wbRounds - 1) ? "UB Final" : `UB Round ${r + 1}`;
        const fmt = getRoundFormat(currentEditingTournament, roundName, (r === wbRounds - 1 ? 'BO3' : 'BO1'));
        roundDiv.innerHTML = `
            <div class="flex items-center justify-center mb-3 border-b border-white/10 pb-1.5 gap-2">
                <span class="text-center text-xs text-[var(--gold)] font-heading font-bold uppercase tracking-wider whitespace-nowrap">${escapeHtml(roundName)}</span>
                ${isEditable ? `
                    <button type="button" onclick="window.quickEditRoundFormat('${roundName}', event)"
                        title="Click to cycle format (${fmt})"
                        class="px-1.5 py-0.5 rounded bg-[#FFD700]/15 hover:bg-[#FFD700]/30 text-[#FFD700] border border-[#FFD700]/40 text-[9px] font-mono-tag font-bold transition-all cursor-pointer inline-flex items-center gap-0.5 shadow-sm shrink-0">
                        <span>${fmt}</span>
                        <span class="text-[7px] opacity-70">▾</span>
                    </button>
                ` : `
                    <span class="px-1.5 py-0.5 rounded bg-white/5 text-neutral-400 border border-white/10 text-[9px] font-mono-tag font-bold shrink-0">${fmt}</span>
                `}
            </div>
        `;

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
                        <div class="match-card opacity-60 border-dashed border-neutral-600 my-1.5">
                            <div class="team-slot"><span class="text-[var(--gold)] font-mono-tag text-xs">${escapeHtml(real)}</span><span class="text-[10px] text-green-400 font-mono-tag">Advances</span></div>
                            <div class="team-slot text-neutral-600 font-mono-tag text-xs"><span>BYE</span></div>
                        </div>`;
                } else {
                    const idx1 = r === 0 ? currentM * 2 : -1;
                    const idx2 = r === 0 ? currentM * 2 + 1 : -1;
                    const click1 = (isEditable && r === 0 && team1 !== 'TBD') ? `onclick="window.selectTeam(${idx1})"` : '';
                    const click2 = (isEditable && r === 0 && team2 !== 'TBD') ? `onclick="window.selectTeam(${idx2})"` : '';
                    const sel1 = (swapSourceIndex === idx1 && r === 0) ? 'selected-for-swap' : '';
                    const sel2 = (swapSourceIndex === idx2 && r === 0) ? 'selected-for-swap' : '';

                    pairWrapper.innerHTML += `
                        <div class="match-card ${straightLineClass} ${isEditable && r === 0 ? 'editable-mode' : ''} my-1.5">
                            <div class="team-slot ${sel1}" ${click1}><span class="truncate">${escapeHtml(team1)}</span><span class="team-score">-</span></div>
                            <div class="team-slot ${sel2}" ${click2}><span class="truncate">${escapeHtml(team2)}</span><span class="team-score">-</span></div>
                        </div>`;
                }
            }
            roundDiv.appendChild(pairWrapper);
        }
        ubContainer.appendChild(roundDiv);
    }

    const finalDiv = document.createElement('div');
    finalDiv.className = 'bracket-round flex flex-col justify-center';
    const gfFmt = getRoundFormat(currentEditingTournament, 'Grand Final', 'BO5');
    finalDiv.innerHTML = `
        <div class="flex items-center justify-center mb-3 border-b border-white/10 pb-1.5 gap-2">
            <span class="text-center text-xs text-[var(--gold)] font-heading font-bold uppercase tracking-wider whitespace-nowrap">Grand Final</span>
            ${isEditable ? `
                <button type="button" onclick="window.quickEditRoundFormat('Grand Final', event)"
                    title="Click to cycle format (${gfFmt})"
                    class="px-1.5 py-0.5 rounded bg-[#FFD700]/15 hover:bg-[#FFD700]/30 text-[#FFD700] border border-[#FFD700]/40 text-[9px] font-mono-tag font-bold transition-all cursor-pointer inline-flex items-center gap-0.5 shadow-sm shrink-0">
                    <span>${gfFmt}</span>
                    <span class="text-[7px] opacity-70">▾</span>
                </button>
            ` : `
                <span class="px-1.5 py-0.5 rounded bg-white/5 text-neutral-400 border border-white/10 text-[9px] font-mono-tag font-bold shrink-0">${gfFmt}</span>
            `}
        </div>
        <div class="match-pair straight-mode">
            <div class="match-card border-[var(--gold)] shadow-[0_0_20px_rgba(255,215,0,0.15)] h-[80px]">
                 <div class="team-slot"><span class="text-[var(--gold)] font-bold text-sm">Winner UB</span></div>
                 <div class="team-slot"><span class="text-red-400 font-bold text-sm">Winner LB</span></div>
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
        let roundName = (r === lbRoundsCount - 1) ? "LB Final" : `LB Round ${r + 1}`;
        const fmt = getRoundFormat(currentEditingTournament, roundName, (r === lbRoundsCount - 1 ? 'BO3' : 'BO1'));
        roundDiv.innerHTML = `
            <div class="flex items-center justify-center mb-3 border-b border-white/10 pb-1.5 gap-2">
                <span class="text-center text-xs text-red-400 font-heading font-bold uppercase tracking-wider whitespace-nowrap">${escapeHtml(roundName)}</span>
                ${isEditable ? `
                    <button type="button" onclick="window.quickEditRoundFormat('${roundName}', event)"
                        title="Click to cycle format (${fmt})"
                        class="px-1.5 py-0.5 rounded bg-red-500/15 hover:bg-red-500/30 text-red-300 border border-red-500/40 text-[9px] font-mono-tag font-bold transition-all cursor-pointer inline-flex items-center gap-0.5 shadow-sm shrink-0">
                        <span>${fmt}</span>
                        <span class="text-[7px] opacity-70">▾</span>
                    </button>
                ` : `
                    <span class="px-1.5 py-0.5 rounded bg-white/5 text-neutral-400 border border-white/10 text-[9px] font-mono-tag font-bold shrink-0">${fmt}</span>
                `}
            </div>
        `;
        const powerDrop = Math.floor(r / 2);
        const matchesInThisRound = Math.max(1, (bracketSize / 4) / Math.pow(2, powerDrop));
        const nextPowerDrop = Math.floor((r + 1) / 2);
        const matchesInNextRound = Math.max(1, (bracketSize / 4) / Math.pow(2, nextPowerDrop));
        const isStraightRound = matchesInThisRound === matchesInNextRound;

        for (let m = 0; m < matchesInThisRound; m += (isStraightRound ? 1 : 2)) {
            const pairWrapper = document.createElement('div');
            pairWrapper.className = isStraightRound ? 'match-pair straight-mode' : 'match-pair';
            pairWrapper.innerHTML = `
                <div class="match-card border-red-500/20 my-1.5">
                    <div class="team-slot text-neutral-400 font-mono-tag"><span>Waiting...</span></div>
                    <div class="team-slot text-neutral-400 font-mono-tag"><span>Waiting...</span></div>
                </div>`;
            roundDiv.appendChild(pairWrapper);
        }
        lbContainer.appendChild(roundDiv);
    }

    bracketScrollWrapper.appendChild(lbContainer);
    container.appendChild(bracketScrollWrapper);
}

function renderDoubleEliminationLive(container, matches, isAdmin) {
    container.innerHTML = '';
    const scrollWrapper = document.createElement('div');
    scrollWrapper.className = "overflow-auto custom-scrollbar pb-8 h-full flex flex-col gap-8";
    scrollWrapper.style.minHeight = "480px";

    // UPPER BRACKET
    const ubSection = document.createElement('div');
    ubSection.className = "flex flex-col items-start";

    const ubTitle = document.createElement('div');
    ubTitle.className = "text-[var(--gold)] font-heading font-bold text-sm mb-4 uppercase tracking-wider pl-4 border-l-2 border-[var(--gold)]";
    ubTitle.textContent = "Upper Bracket";
    ubSection.appendChild(ubTitle);

    const ubContainer = document.createElement('div');
    ubContainer.className = "flex flex-col items-start";

    const wbMatches = matches.filter(m => m.bracket === 'upper');
    const finalWBMatch = wbMatches.sort((a, b) => b.round - a.round)[0];
    const maxRound = finalWBMatch ? finalWBMatch.round : 0;

    if (wbMatches.length > 0) {
        const headersDiv = document.createElement('div');
        headersDiv.className = 'bracket-header-row';
        headersDiv.style.marginBottom = "14px";
        headersDiv.style.paddingLeft = "40px";

        for (let i = 1; i <= maxRound; i++) {
            const hItem = document.createElement('div');
            hItem.className = 'header-item';
            const roundName = (i === maxRound) ? "UB Final" : (i === maxRound - 1 && maxRound > 2) ? "UB Semi Finals" : `UB Round ${i}`;
            const fmt = getRoundFormat(currentEditingTournament, roundName, (i === maxRound ? 'BO3' : 'BO1'));
            hItem.innerHTML = `
                <span class="font-heading font-black text-xs uppercase text-white tracking-wider whitespace-nowrap">${escapeHtml(roundName)}</span>
                ${isAdmin ? `
                    <button type="button" onclick="window.quickEditRoundFormat('${roundName}', event)"
                        title="Click to cycle format (${fmt})"
                        class="px-1.5 py-0.5 rounded bg-[#FFD700]/15 hover:bg-[#FFD700]/30 text-[#FFD700] border border-[#FFD700]/40 text-[9px] font-mono-tag font-bold transition-all cursor-pointer inline-flex items-center gap-0.5 shadow-sm shrink-0">
                        <span>${fmt}</span>
                        <span class="text-[7px] opacity-70">▾</span>
                    </button>
                ` : `
                    <span class="px-1.5 py-0.5 rounded bg-white/5 text-neutral-400 border border-white/10 text-[9px] font-mono-tag font-bold shrink-0">${fmt}</span>
                `}
            `;
            headersDiv.appendChild(hItem);
        }

        const gfHeader = document.createElement('div');
        gfHeader.className = 'header-item gf-header';
        const gfFmt = getRoundFormat(currentEditingTournament, 'Grand Final', 'BO5');
        gfHeader.innerHTML = `
            <span class="font-heading font-black text-xs uppercase text-white tracking-wider whitespace-nowrap">Grand Final</span>
            ${isAdmin ? `
                <button type="button" onclick="window.quickEditRoundFormat('Grand Final', event)"
                    title="Click to cycle format (${gfFmt})"
                    class="px-1.5 py-0.5 rounded bg-[#FFD700]/15 hover:bg-[#FFD700]/30 text-[#FFD700] border border-[#FFD700]/40 text-[9px] font-mono-tag font-bold transition-all cursor-pointer inline-flex items-center gap-0.5 shadow-sm shrink-0">
                    <span>${gfFmt}</span>
                    <span class="text-[7px] opacity-70">▾</span>
                </button>
            ` : `
                <span class="px-1.5 py-0.5 rounded bg-white/5 text-neutral-400 border border-white/10 text-[9px] font-mono-tag font-bold shrink-0">${gfFmt}</span>
            `}
        `;
        if (headersDiv.lastChild) headersDiv.lastChild.style.marginRight = "0";

        headersDiv.appendChild(gfHeader);
        ubContainer.appendChild(headersDiv);
    }

    const treeRowWrapper = document.createElement('div');
    treeRowWrapper.className = "flex items-center";

    if (finalWBMatch) {
        const ubTree = buildMatchTree(matches, finalWBMatch.id);
        const treeWrapper = document.createElement('div');
        treeWrapper.className = 'wrapper';
        treeWrapper.style.padding = "0";

        renderRecursiveBracket(treeWrapper, ubTree, isAdmin);
        treeRowWrapper.appendChild(treeWrapper);

        const gfMatch = matches.find(m => m.bracket === 'final');
        if (gfMatch) {
            const connector = document.createElement('div');
            connector.className = "gf-connector-line";
            treeRowWrapper.appendChild(connector);

            const finalWrapper = document.createElement('div');
            finalWrapper.className = "gf-wrapper flex flex-col justify-center";
            finalWrapper.style.paddingLeft = "0px";
            finalWrapper.style.marginLeft = "-2px";

            const card = createLiveMatchCard(gfMatch, isAdmin);
            card.style.border = "1.5px solid var(--gold)";
            card.style.boxShadow = "0 0 15px rgba(255, 215, 0, 0.2)";

            finalWrapper.appendChild(card);
            treeRowWrapper.appendChild(finalWrapper);
        }
    }

    ubContainer.appendChild(treeRowWrapper);
    ubSection.appendChild(ubContainer);
    scrollWrapper.appendChild(ubSection);

    // LOWER BRACKET
    const lbSection = document.createElement('div');
    lbSection.className = "flex flex-col items-start mt-6";

    const lbTitle = document.createElement('div');
    lbTitle.className = "text-red-400 font-heading font-bold text-sm mb-4 uppercase tracking-wider pl-4 border-l-2 border-red-500";
    lbTitle.textContent = "Lower Bracket";
    lbSection.appendChild(lbTitle);

    const lbMatches = matches.filter(m => m.bracket === 'lower');
    if (lbMatches.length > 0) {
        const finalLBMatch = lbMatches.sort((a, b) => b.round - a.round)[0];
        const maxLBRound = finalLBMatch ? finalLBMatch.round : 0;

        const lbContainer = document.createElement('div');
        lbContainer.className = "flex flex-col items-start";

        const lbHeadersDiv = document.createElement('div');
        lbHeadersDiv.className = 'bracket-header-row';
        lbHeadersDiv.style.marginBottom = "14px";
        lbHeadersDiv.style.paddingLeft = "40px";

        for (let i = 1; i <= maxLBRound; i++) {
            const hItem = document.createElement('div');
            hItem.className = 'header-item';
            const roundName = (i === maxLBRound) ? "LB Final" : `LB Round ${i}`;
            const fmt = getRoundFormat(currentEditingTournament, roundName, (i === maxLBRound ? 'BO3' : 'BO1'));
            hItem.innerHTML = `
                <span class="font-heading font-black text-xs uppercase text-white tracking-wider whitespace-nowrap">${escapeHtml(roundName)}</span>
                ${isAdmin ? `
                    <button type="button" onclick="window.quickEditRoundFormat('${roundName}', event)"
                        title="Click to cycle format (${fmt})"
                        class="px-1.5 py-0.5 rounded bg-[#FFD700]/15 hover:bg-[#FFD700]/30 text-[#FFD700] border border-[#FFD700]/40 text-[9px] font-mono-tag font-bold transition-all cursor-pointer inline-flex items-center gap-0.5 shadow-sm shrink-0">
                        <span>${fmt}</span>
                        <span class="text-[7px] opacity-70">▾</span>
                    </button>
                ` : `
                    <span class="px-1.5 py-0.5 rounded bg-white/5 text-neutral-400 border border-white/10 text-[9px] font-mono-tag font-bold shrink-0">${fmt}</span>
                `}
            `;
            lbHeadersDiv.appendChild(hItem);
        }
        lbContainer.appendChild(lbHeadersDiv);

        const lbTreeRowWrapper = document.createElement('div');
        lbTreeRowWrapper.className = "flex items-center";

        if (finalLBMatch) {
            const lbTree = buildMatchTree(matches, finalLBMatch.id);
            const lbTreeWrapper = document.createElement('div');
            lbTreeWrapper.className = 'wrapper';
            lbTreeWrapper.style.padding = "0";

            renderRecursiveBracket(lbTreeWrapper, lbTree, isAdmin);
            lbTreeRowWrapper.appendChild(lbTreeWrapper);
        }

        lbContainer.appendChild(lbTreeRowWrapper);
        lbSection.appendChild(lbContainer);
        scrollWrapper.appendChild(lbSection);
    }

    container.appendChild(scrollWrapper);
    injectTreeStyles();
}

function createLiveMatchCard(m, isAdmin) {
    const card = document.createElement('div');
    card.className = "tree-match-card relative flex flex-col justify-center";

    if (m.team1 !== 'BYE' && m.team2 !== 'BYE') {
        card.classList.add('cursor-pointer', 'hover:brightness-110');
        card.onclick = () => handleMatchCardClick(m.id);
    }

    const isWinner1 = m.winner === m.team1;
    const isWinner2 = m.winner === m.team2;
    const score1 = m.score1 !== null ? m.score1 : '-';
    const score2 = m.score2 !== null ? m.score2 : '-';

    const mFmt = m.format || getRoundFormat(currentEditingTournament, m.bracket === 'final' ? 'Grand Final' : m.round ? `Round ${m.round}` : null);
    card.innerHTML = `
        <div class="flex justify-between items-center mb-1.5 text-[9px] text-neutral-500 uppercase tracking-wider font-mono-tag">
            <span>M${m.matchNumber}</span>
            <span class="px-1.5 py-0.2 rounded bg-white/5 text-[8px] font-bold text-neutral-400 border border-white/10 font-mono-tag">${mFmt}</span>
            ${m.winner ? '<span class="text-emerald-400 font-bold text-[10px]">DONE</span>' : ''}
        </div>
        <div class="space-y-1.5 w-full font-mono-tag">
            <div class="flex justify-between items-center ${isWinner1 ? 'text-[var(--gold)] font-bold' : 'text-neutral-300'}">
                <span class="text-xs truncate w-24">${escapeHtml(m.team1)}</span>
                <span class="bg-black/50 px-1.5 py-0.5 rounded text-[10px]">${score1}</span>
            </div>
            <div class="flex justify-between items-center ${isWinner2 ? 'text-[var(--gold)] font-bold' : 'text-neutral-300'}">
                <span class="text-xs truncate w-24">${escapeHtml(m.team2)}</span>
                <span class="bg-black/50 px-1.5 py-0.5 rounded text-[10px]">${score2}</span>
            </div>
        </div>
        ${renderMatchBadgesHtml(m)}
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
        if (btnUb) btnUb.className = 'px-4 py-1.5 rounded font-bold transition-all bg-[#FFD700] text-black uppercase cursor-pointer shadow-md';
        if (btnLb) btnLb.className = 'px-4 py-1.5 rounded font-bold transition-all bg-white/5 text-neutral-400 hover:text-white hover:bg-white/10 border border-white/10 uppercase cursor-pointer';
    } else {
        ubContainer.classList.add('hidden');
        lbContainer.classList.remove('hidden');
        if (btnLb) btnLb.className = 'px-4 py-1.5 rounded font-bold transition-all bg-[#FFD700] text-black uppercase cursor-pointer shadow-md';
        if (btnUb) btnUb.className = 'px-4 py-1.5 rounded font-bold transition-all bg-white/5 text-neutral-400 hover:text-white hover:bg-white/10 border border-white/10 uppercase cursor-pointer';
    }
};

function renderRoundRobin(container, participants, isAdmin) {
    container.innerHTML = '';
    const matches = currentEditingTournament.matches || [];
    
    const settingSize = parseInt(currentEditingTournament.maxTeams) || 8;
    const actualCount = participants.length;
    const targetSize = Math.max(settingSize, actualCount);

    const displayTeams = [];
    for (let i = 0; i < targetSize; i++) {
        if (participants[i]) {
            displayTeams.push(typeof participants[i] === 'object' ? participants[i].name : participants[i]);
        } else {
            displayTeams.push("Empty"); 
        }
    }

    let stats = {};
    displayTeams.forEach(name => {
        if (name !== "Empty") stats[name] = { name: name, played: 0, w: 0, l: 0, pts: 0 };
    });

    matches.forEach(m => {
        if (m.winner) {
            if (stats[m.winner]) { stats[m.winner].played++; stats[m.winner].w++; stats[m.winner].pts += 3; }
            const loser = m.winner === m.team1 ? m.team2 : m.team1;
            if (stats[loser]) { stats[loser].played++; stats[loser].l++; }
        }
    });

    const sortedStats = Object.values(stats).sort((a, b) => (b.pts - a.pts) || (b.w - a.w));

    let html = `<div class="flex flex-col gap-6 w-full font-mono-tag">`;
    html += `
        <div class="overflow-x-auto bg-[#0A0A0E] rounded-xl border border-white/10 p-4">
            <div class="flex justify-between items-center mb-3 border-b border-white/10 pb-2">
                <h3 class="text-white font-heading font-bold uppercase tracking-wider text-xs">Cross Table</h3>
                ${isAdmin ? `<span class="text-[10px] text-neutral-500 uppercase">Size: ${targetSize} Teams</span>` : ''}
            </div>
            <table class="rr-table min-w-full border-collapse text-xs">
                <thead>
                    <tr>
                        <th class="p-2.5 bg-black/40 border border-white/10 text-left w-28 sticky left-0 z-10">Team</th>
                        ${displayTeams.map((_, i) => `<th class="p-2 bg-black/40 border border-white/10 w-12 text-center text-[10px] text-neutral-400">${i + 1}</th>`).join('')}
                        <th class="p-2 bg-[var(--gold)]/10 border border-white/10 w-14 text-center text-[var(--gold)] font-bold">Pts</th>
                    </tr>
                </thead>
                <tbody>
    `;

    displayTeams.forEach((teamA, i) => {
        const isEmptyA = teamA === "Empty";
        const rowClass = isEmptyA ? "bg-black/20" : "";
        const nameDisplay = isEmptyA 
            ? `<span class="text-neutral-600 italic text-[10px]">EMPTY</span>` 
            : `<span class="text-[var(--gold)] text-[10px] mr-1.5">${i + 1}</span>${escapeHtml(teamA)}`;

        html += `<tr class="${rowClass}">
            <td class="p-2.5 border border-white/10 font-bold text-white truncate max-w-[130px] bg-[#0A0A0E] sticky left-0 z-10 text-xs">
                ${nameDisplay}
            </td>`;
        
        displayTeams.forEach((teamB, j) => {
            const isEmptyB = teamB === "Empty";
            if (i === j) {
                html += `<td class="bg-white/5 border border-white/10"></td>`; 
            } else if (isEmptyA || isEmptyB) {
                html += `<td class="border border-white/10 text-center text-neutral-700 text-[10px]">-</td>`;
            } else {
                const match = matches.find(m => 
                    (m.team1 === teamA && m.team2 === teamB) || 
                    (m.team1 === teamB && m.team2 === teamA)
                );

                if (match) {
                    const hasScores = (match.score1 !== null && match.score1 !== undefined) || 
                                      (match.score2 !== null && match.score2 !== undefined);
                    const clickAttr = `onclick="window.handleMatchCardClick('${match.id}')"`;
                    const cursorClass = isAdmin ? 'cursor-pointer hover:bg-white/10' : 'cursor-default';

                    if (hasScores || match.winner) {
                        const s1 = match.score1 !== null ? match.score1 : 0;
                        const s2 = match.score2 !== null ? match.score2 : 0;
                        const scoreDisplay = (match.team1 === teamA) ? `${s1}-${s2}` : `${s2}-${s1}`;
                        let colorClass = 'text-white'; 
                        if (match.winner) {
                            colorClass = (match.winner === teamA) ? 'text-green-400 font-bold' : 'text-red-400';
                        }
                        html += `<td ${clickAttr} class="p-2 border border-white/10 text-center text-xs ${colorClass} ${cursorClass}">${scoreDisplay}</td>`;
                    } else {
                        html += `<td ${clickAttr} class="p-2 border border-white/10 text-center text-[10px] text-neutral-500 ${cursorClass}">vs</td>`;
                    }
                } else {
                    html += `<td class="border border-white/10 text-center text-neutral-700">-</td>`;
                }
            }
        });
        
        const teamStats = stats[teamA] || { pts: 0 };
        const ptsDisplay = isEmptyA ? "-" : teamStats.pts;
        html += `<td class="p-2.5 border border-white/10 text-center font-bold text-[var(--gold)]">${ptsDisplay}</td></tr>`;
    });

    html += `</tbody></table></div></div>`;
    container.innerHTML = html;
}

function formatDateRange(start, end) {
    if (!start) return 'TBA';
    try {
        let startDateObj;
        if (typeof start.toDate === 'function') {
            startDateObj = start.toDate();
        } else if (start.seconds) {
            startDateObj = new Date(start.seconds * 1000);
        } else {
            startDateObj = new Date(start);
        }
        
        let display = (isNaN(startDateObj.getTime())) 
            ? 'TBA' 
            : startDateObj.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
        
        if (end) {
            let endDateObj;
            if (typeof end.toDate === 'function') {
                endDateObj = end.toDate();
            } else if (end.seconds) {
                endDateObj = new Date(end.seconds * 1000);
            } else {
                endDateObj = new Date(end);
            }
            if (!isNaN(endDateObj.getTime())) {
                display = `${display} - ${endDateObj.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
            }
        }
        return display;
    } catch (e) {
        return 'TBA';
    }
}

// ----------------------------------------------------
// MATCH DISPUTE CHAT
// ----------------------------------------------------
let matchChatUnsubscribe = null;
let currentMatchId = null;

window.openMatchChat = function (matchId) {
    currentMatchId = matchId;
    let match = currentEditingTournament?.matches?.find(m => m.id === matchId);
    if (!match && currentEditingTournament?.brackets) {
        for (const round of currentEditingTournament.brackets) {
            if (Array.isArray(round)) {
                match = round.find(m => m.id === matchId);
                if (match) break;
            }
        }
    }

    if (!match) {
        if (window.showErrorToast) window.showErrorToast('Error', 'Match not found.');
        return;
    }

    qs('#chat-match-title').textContent = `${match.team1} vs ${match.team2}`;
    qs('#chat-match-info').textContent = `Match ${match.matchNumber} - Round ${match.round || 1}`;

    const auth = getAuth();
    const user = auth.currentUser;
    const participants = currentEditingTournament.participants || [];
    const userParticipant = participants.find(p => p.registeredBy === user?.uid);
    const userTeamName = (userParticipant?.name || userParticipant?.teamName || '').trim().toLowerCase();
    const team1 = (match.team1 || '').trim().toLowerCase();
    const team2 = (match.team2 || '').trim().toLowerCase();
    const isCaptainOfThisMatch = userTeamName && (userTeamName === team1 || userTeamName === team2);
    
    const role = String(window.currentUserRole || '').toLowerCase();
    const isOrganizerRole = (role === 'admin' || role === 'organizer' || currentEditingTournament?.createdBy === user?.uid);
    const canSend = isCaptainOfThisMatch || isOrganizerRole;

    const chatFooter = document.getElementById('matchChatModal')?.querySelector('.border-t.p-4');
    const existingNotice = document.getElementById('chat-readonly-notice');
    if (existingNotice) existingNotice.remove();

    if (chatFooter) {
        if (canSend) {
            chatFooter.classList.remove('hidden');
        } else {
            chatFooter.classList.add('hidden');
            const notice = document.createElement('p');
            notice.id = 'chat-readonly-notice';
            notice.className = 'text-center text-neutral-500 text-xs py-3 border-t border-white/10 bg-[#0A0A0E] font-mono-tag';
            notice.textContent = 'Only team captains and organizers can send messages. You are in view-only mode.';
            chatFooter.parentElement?.appendChild(notice);
        }
    }

    startMatchChatListener(currentEditingTournament.id, matchId);
    document.getElementById('matchChatModal').classList.remove('hidden');
    document.getElementById('matchChatModal').classList.add('flex');
}

function startMatchChatListener(tournamentId, matchId) {
    const chatContainer = qs('#match-chat-container');
    if (!chatContainer) return;
    chatContainer.innerHTML = '<p class="text-center text-neutral-500 mt-4 font-mono-tag text-xs">Loading messages...</p>';
    if (matchChatUnsubscribe) matchChatUnsubscribe();

    import("https://www.gstatic.com/firebasejs/11.1.0/firebase-firestore.js").then(({ collection, query, orderBy, onSnapshot }) => {
        const messagesRef = collection(db, "tournaments", tournamentId, "matchChats", matchId, "messages");
        const q = query(messagesRef, orderBy("createdAt", "asc"));

        matchChatUnsubscribe = onSnapshot(q, (snapshot) => {
            chatContainer.innerHTML = '';
            if (snapshot.empty) {
                chatContainer.innerHTML = '<p class="text-center text-neutral-500 mt-10 font-mono-tag text-xs">No messages yet.</p>';
                return;
            }
            const auth = getAuth();
            const currentUser = auth.currentUser;
            snapshot.forEach((doc) => {
                const msg = doc.data();
                const isAdmin = msg.senderRole === 'admin' || msg.senderRole === 'organizer';
                const isMe = currentUser && msg.senderId === currentUser.uid;
                const bubble = document.createElement('div');
                bubble.className = `mb-3 ${isMe ? 'text-right' : 'text-left'}`;
                bubble.innerHTML = `
                    <div class="inline-block max-w-[80%] ${isMe ? 'bg-[var(--gold)]/20 border-[var(--gold)]/40' : isAdmin ? 'bg-red-500/20 border-red-500/40' : 'bg-white/5 border-white/10'} border rounded-xl p-3">
                        <div class="font-bold text-[10px] mb-1 font-mono-tag ${isAdmin ? 'text-red-400' : 'text-neutral-400'}">${escapeHtml(msg.senderName)}${isAdmin ? ' (Organizer)' : ''}</div>
                        <div class="text-xs text-white leading-relaxed font-sans">${escapeHtml(msg.text)}</div>
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
        const role = String(window.currentUserRole || '').toLowerCase();
        const isOrganizer = (role === 'admin' || role === 'organizer' || currentEditingTournament.createdBy === user.uid);

        await addDoc(messagesRef, {
            text: text,
            senderId: user.uid,
            senderName: user.displayName || user.email.split('@')[0],
            senderRole: isOrganizer ? 'organizer' : 'user',
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

window.openMatchChatFromModal = function() {
    const matchId = document.getElementById('scoreMatchId')?.value;
    if (!matchId || !currentEditingTournament) return;
    if (document.getElementById('scoreModal')) document.getElementById('scoreModal').classList.add('hidden');
    if (typeof window.openMatchChat === 'function') window.openMatchChat(matchId);
};

// ==========================================
// FEATURE SUITE 1: CAPTAIN CHECK-IN / READY-UP & STAFF SUITE
// ==========================================
window.toggleSingleTeamCheckIn = async function (teamIndex) {
    if (!currentEditingTournament) return;
    const auth = getAuth();
    const user = auth.currentUser;
    if (!isTournamentStaff(currentEditingTournament, user)) {
        if (window.showErrorToast) window.showErrorToast("Access Denied", "Only organizers or marshals can ready up teams.");
        else alert("Only organizers or marshals can ready up teams.");
        return;
    }

    let participants = currentEditingTournament.participants || [];
    if (!participants[teamIndex]) return;

    try {
        const teamObj = participants[teamIndex];
        const nextState = !teamObj.checkedIn;
        teamObj.checkedIn = nextState;
        teamObj.checkedInAt = nextState ? Date.now() : null;

        await updateDoc(doc(db, "tournaments", currentEditingTournament.id), {
            participants: participants
        });

        currentEditingTournament.participants = participants;
        renderParticipantsList(participants);

        const teamName = typeof teamObj === 'object' ? (teamObj.name || `Team #${teamIndex + 1}`) : teamObj;
        if (window.showSuccessToast) {
            window.showSuccessToast(nextState ? "Team Ready!" : "Check-In Revoked", `${teamName} has been ${nextState ? 'marked as Ready by Organizer' : 'marked as Unready'}.`);
        }
    } catch (e) {
        console.error("Error toggling single team check-in:", e);
        if (window.showErrorToast) window.showErrorToast("Error", "Could not update team check-in: " + e.message);
    }
};

window.toggleTournamentCheckIn = async function () {
    if (!currentEditingTournament) return;
    const auth = getAuth();
    const user = auth.currentUser;
    const isStaff = isTournamentStaff(currentEditingTournament, user);
    if (!isStaff) {
        alert("Only tournament organizers or marshals can toggle check-in.");
        return;
    }

    try {
        const nextState = !currentEditingTournament.checkInOpen;
        await updateDoc(doc(db, "tournaments", currentEditingTournament.id), {
            checkInOpen: nextState
        });
        if (window.showSuccessToast) window.showSuccessToast("Check-In Updated", nextState ? "Check-In Window is now OPEN" : "Check-In Window is now CLOSED");
    } catch (e) {
        console.error(e);
        alert("Failed to toggle check-in: " + e.message);
    }
};

window.handleCaptainCheckIn = async function () {
    if (!currentEditingTournament) return;
    const auth = getAuth();
    const user = auth.currentUser;
    if (!user) {
        alert("Please login to check in your squad.");
        return;
    }

    let participants = currentEditingTournament.participants || [];
    let myTeamIndex = participants.findIndex(p => p.registeredBy === user.uid || (p.captain && p.captain.toLowerCase() === user.displayName?.toLowerCase()));

    if (myTeamIndex === -1) {
        alert("You are not registered as a captain in this tournament.");
        return;
    }

    try {
        participants[myTeamIndex].checkedIn = true;
        participants[myTeamIndex].checkedInAt = Date.now();

        await updateDoc(doc(db, "tournaments", currentEditingTournament.id), {
            participants: participants
        });

        if (window.showSuccessToast) window.showSuccessToast("Squad Ready!", "You have checked in for the tournament.");
    } catch (e) {
        console.error(e);
        alert("Failed to ready up: " + e.message);
    }
};

window.checkInAllTeams = async function () {
    if (!currentEditingTournament) return;
    const confirmed = await window.showCustomConfirm("Check In All Teams?", "This will mark all registered squads as ready.");
    if (!confirmed) return;

    try {
        let participants = currentEditingTournament.participants || [];
        participants.forEach(p => {
            if (typeof p === 'object') {
                p.checkedIn = true;
                p.checkedInAt = Date.now();
            }
        });

        await updateDoc(doc(db, "tournaments", currentEditingTournament.id), {
            participants: participants
        });
        if (window.showSuccessToast) window.showSuccessToast("Success", "All teams marked as Ready!");
    } catch (e) {
        console.error(e);
        alert("Failed to check in all teams: " + e.message);
    }
};

window.dropUnreadyTeams = async function () {
    if (!currentEditingTournament) return;
    const confirmed = await window.showCustomConfirm("Drop Unready Teams?", "This will remove all squads that have not checked in.");
    if (!confirmed) return;

    try {
        let participants = currentEditingTournament.participants || [];
        let readyParticipants = participants.filter(p => typeof p === 'object' && p.checkedIn === true);

        if (readyParticipants.length < 2) {
            alert("Cannot drop teams: Need at least 2 checked-in teams to continue.");
            return;
        }

        await updateDoc(doc(db, "tournaments", currentEditingTournament.id), {
            participants: readyParticipants
        });
        if (window.showSuccessToast) window.showSuccessToast("Updated", "Unready squads have been removed from roster.");
    } catch (e) {
        console.error(e);
        alert("Failed to drop teams: " + e.message);
    }
};

// ==========================================
// FEATURE SUITE: CO-ORGANIZERS & TOURNAMENT MARSHALS
// ==========================================
window.openCoOrganizersModal = async function (tId) {
    const modal = document.getElementById('coOrganizersModal');
    if (!modal) return;

    let t = currentEditingTournament;
    if (!t || t.id !== tId) {
        t = allTournaments.find(item => item.id === tId);
        currentEditingTournament = t;
    }
    if (!t) return;

    modal.classList.remove('hidden');
    modal.classList.add('flex');
    renderAppointedStaffList(t);
};

function renderAppointedStaffList(t) {
    const list = document.getElementById('appointedStaffList');
    const countEl = document.getElementById('staffTotalCount');
    if (!list) return;

    const auth = getAuth();
    const currentUser = auth.currentUser;
    const isPrimaryCreator = currentUser && (t.createdBy === currentUser.uid || ["admin"].includes(String(window.currentUserRole || '').toLowerCase()));

    const coOrgs = Array.isArray(t.coOrganizers) ? t.coOrganizers : [];
    if (countEl) countEl.textContent = `${coOrgs.length + 1} Staff Member(s)`;

    let creatorHtml = `
        <div class="p-2.5 rounded-xl bg-black/40 border border-[#FFD700]/30 flex items-center justify-between gap-2">
            <div class="flex items-center gap-2.5 min-w-0">
                <div class="w-8 h-8 rounded-lg bg-[#FFD700]/20 border border-[#FFD700]/40 flex items-center justify-center text-[#FFD700] shrink-0">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/></svg>
                </div>
                <div class="min-w-0">
                    <div class="font-heading font-bold text-white text-xs truncate">Primary Organizer</div>
                    <div class="text-[10px] text-neutral-400 font-mono-tag">Tournament Host & Creator</div>
                </div>
            </div>
            <span class="px-2 py-0.5 rounded bg-[#FFD700]/15 text-[#FFD700] text-[9px] font-mono-tag font-bold uppercase border border-[#FFD700]/30">Lead Host</span>
        </div>
    `;

    if (coOrgs.length === 0) {
        list.innerHTML = creatorHtml + `<div class="text-center py-4 text-neutral-500 text-xs italic">No Co-Organizers or Marshals appointed yet. Add staff using the form above!</div>`;
        return;
    }

    list.innerHTML = creatorHtml + coOrgs.map((staff) => {
        const isMarshal = staff.role === 'marshal';
        const roleLabel = isMarshal ? 'Tournament Marshal' : 'Co-Organizer';
        const badgeClass = isMarshal ? 'bg-blue-500/15 text-blue-300 border-blue-500/30' : 'bg-purple-500/15 text-purple-300 border-purple-500/30';
        const avatar = staff.avatar || ('https://ui-avatars.com/api/?name=' + encodeURIComponent(staff.name || staff.ign || 'Staff') + '&background=111116&color=A855F7');

        return `
            <div class="p-2.5 rounded-xl bg-black/40 border border-white/5 hover:border-white/15 flex items-center justify-between gap-2 transition-colors">
                <div class="flex items-center gap-2.5 min-w-0">
                    <img src="${escapeHtml(avatar)}" class="w-8 h-8 rounded-lg object-cover bg-black border border-white/10 shrink-0" alt="Avatar">
                    <div class="min-w-0">
                        <div class="font-heading font-bold text-white text-xs truncate">${escapeHtml(staff.name || staff.ign || staff.email)}</div>
                        <div class="text-[9px] text-neutral-400 font-mono-tag truncate">${escapeHtml(staff.email || 'Registered Staff')}</div>
                    </div>
                </div>
                <div class="flex items-center gap-1.5 shrink-0">
                    <span class="px-2 py-0.5 rounded text-[9px] font-mono-tag font-bold uppercase border ${badgeClass}">${roleLabel}</span>
                    ${isPrimaryCreator ? `
                        <button type="button" onclick="window.removeTournamentStaff('${escapeHtml(staff.uid || staff.email)}')" class="p-1 rounded text-neutral-500 hover:text-rose-400 hover:bg-rose-500/10 transition-colors cursor-pointer" title="Remove Staff Member">
                            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                        </button>
                    ` : ''}
                </div>
            </div>
        `;
    }).join('');
}

window.saveTournamentStaff = async function () {
    if (!currentEditingTournament) return;
    const inputEl = document.getElementById('staffUserInput');
    const roleEl = document.getElementById('staffRoleSelect');
    const btn = document.getElementById('addStaffBtn');
    if (!inputEl || !roleEl) return;

    const queryVal = inputEl.value.trim();
    const roleVal = roleEl.value || 'marshal';
    if (!queryVal) return;

    if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<span>Searching User...</span>`;
    }

    try {
        let foundUser = null;

        // Search Firestore users collection by IGN or Email
        const qValLower = queryVal.toLowerCase();
        try {
            const usersRef = collection(db, "users");
            const snap = await getDocs(usersRef);
            snap.forEach(docSnap => {
                const u = { id: docSnap.id, ...docSnap.data() };
                const uIgn = (u.ign || u.displayName || u.username || '').toLowerCase();
                const uEmail = (u.email || '').toLowerCase();
                if (uIgn === qValLower || uEmail === qValLower || u.id === queryVal) {
                    foundUser = u;
                }
            });
        } catch (e) {
            console.warn("Could not query all users, searching local:", e);
        }

        const staffEntry = {
            uid: foundUser ? foundUser.id : ('ext_' + Date.now()),
            name: foundUser ? (foundUser.ign || foundUser.displayName || queryVal) : queryVal,
            email: foundUser ? (foundUser.email || '') : (queryVal.includes('@') ? queryVal : ''),
            avatar: foundUser?.avatar || '',
            role: roleVal,
            addedAt: new Date().toISOString()
        };

        let coOrgs = Array.isArray(currentEditingTournament.coOrganizers) ? [...currentEditingTournament.coOrganizers] : [];
        let coUids = Array.isArray(currentEditingTournament.coOrganizerUids) ? [...currentEditingTournament.coOrganizerUids] : [];

        // Check if already added
        if (coOrgs.some(c => (staffEntry.uid && c.uid === staffEntry.uid) || (staffEntry.email && c.email && c.email.toLowerCase() === staffEntry.email.toLowerCase()))) {
            if (window.showErrorToast) window.showErrorToast("Already Added", `${staffEntry.name} is already in the tournament staff!`);
            else alert(`${staffEntry.name} is already in tournament staff.`);
            if (btn) { btn.disabled = false; btn.textContent = 'Add To Tournament Staff'; }
            return;
        }

        coOrgs.push(staffEntry);
        if (staffEntry.uid) coUids.push(staffEntry.uid);

        await updateDoc(doc(db, "tournaments", currentEditingTournament.id), {
            coOrganizers: coOrgs,
            coOrganizerUids: coUids
        });

        currentEditingTournament.coOrganizers = coOrgs;
        currentEditingTournament.coOrganizerUids = coUids;

        inputEl.value = '';
        renderAppointedStaffList(currentEditingTournament);
        if (window.showSuccessToast) window.showSuccessToast("Staff Appointed!", `${staffEntry.name} appointed as ${roleVal === 'marshal' ? 'Tournament Marshal' : 'Co-Organizer'}.`);
    } catch (err) {
        console.error("Error adding tournament staff:", err);
        if (window.showErrorToast) window.showErrorToast("Error", "Could not add staff: " + err.message);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.textContent = 'Add To Tournament Staff';
        }
    }
};

window.removeTournamentStaff = async function (staffIdentifier) {
    if (!currentEditingTournament) return;
    const confirmed = await (window.showCustomConfirm ? window.showCustomConfirm("Remove Staff Member?", "Revoke staff permissions for this user?") : confirm("Revoke staff permissions for this user?"));
    if (!confirmed) return;

    try {
        let coOrgs = (currentEditingTournament.coOrganizers || []).filter(c => c.uid !== staffIdentifier && c.email !== staffIdentifier);
        let coUids = (currentEditingTournament.coOrganizerUids || []).filter(uid => uid !== staffIdentifier);

        await updateDoc(doc(db, "tournaments", currentEditingTournament.id), {
            coOrganizers: coOrgs,
            coOrganizerUids: coUids
        });

        currentEditingTournament.coOrganizers = coOrgs;
        currentEditingTournament.coOrganizerUids = coUids;

        renderAppointedStaffList(currentEditingTournament);
        if (window.showSuccessToast) window.showSuccessToast("Staff Removed", "User removed from tournament staff.");
    } catch (e) {
        console.error("Error removing staff:", e);
        if (window.showErrorToast) window.showErrorToast("Error", "Could not remove staff: " + e.message);
    }
};

// ==========================================
// FEATURE SUITE 2: COIN TOSS & MAP VETO
// ==========================================
const GAME_MAP_POOLS = {
    'Valorant': ['Ascent', 'Bind', 'Haven', 'Split', 'Sunset', 'Lotus', 'Abyss'],
    'Mobile Legends: Bang Bang': ['Sanctum Island (Draft 1)', 'Sanctum Island (Draft 2)', 'Decider Match'],
    'Honor of Kings': ['Gorge of Kings (Game 1)', 'Gorge of Kings (Game 2)', 'Decider Game'],
    'League of Legends': ['Summoner\'s Rift (Game 1)', 'Summoner\'s Rift (Game 2)', 'Decider Game'],
    'Dota 2': ['Standard Map (Game 1)', 'Standard Map (Game 2)', 'Decider Game'],
    'Default': ['Map 1', 'Map 2', 'Map 3', 'Map 4', 'Map 5']
};

let currentVetoMatchId = null;
let currentVetoState = null;

window.openMapVetoFromScoreModal = function () {
    const matchId = document.getElementById('scoreMatchId')?.value;
    if (matchId) window.openMapVetoForMatch(matchId);
};

window.openMapVetoForMatch = function (matchId) {
    currentVetoMatchId = matchId;
    const t = currentEditingTournament;
    let match = t.matches?.find(m => m.id === matchId);
    if (!match) return;

    const modal = document.getElementById('mapVetoModal');
    if (!modal) return;

    document.getElementById('vetoTeam1Name').textContent = match.team1;
    document.getElementById('vetoTeam2Name').textContent = match.team2;

    const coinSection = document.getElementById('vetoCoinTossSection');
    const pickBanSection = document.getElementById('vetoPickBanSection');
    const coinResultDisplay = document.getElementById('coinResultDisplay');
    const coinGraphic = document.getElementById('coinGraphic');
    const sideWrap = document.getElementById('vetoSideSelectionWrap');

    if (sideWrap) sideWrap.classList.add('hidden');
    if (coinResultDisplay) coinResultDisplay.textContent = '';
    if (coinGraphic) coinGraphic.style.transform = '';

    // If veto already completed
    if (match.veto && match.veto.map) {
        coinSection.classList.add('hidden');
        pickBanSection.classList.remove('hidden');
        if (sideWrap) {
            sideWrap.classList.remove('hidden');
            document.getElementById('vetoFinalMapName').textContent = `${match.veto.map} (${match.veto.side || 'Selected'})`;
            document.getElementById('vetoSidePickerNotice').textContent = `Veto completed on ${match.team1} vs ${match.team2}.`;
        }
        renderCompletedVetoGrid(match.veto);
    } else {
        coinSection.classList.remove('hidden');
        pickBanSection.classList.add('hidden');

        const game = t.game || 'Valorant';
        const maps = GAME_MAP_POOLS[game] || GAME_MAP_POOLS['Default'];

        currentVetoState = {
            team1: match.team1,
            team2: match.team2,
            maps: [...maps],
            bans: [],
            coinWinner: null,
            firstBanTeam: null,
            currentTurnTeam: null,
            step: 1,
            finalMap: null
        };
    }

    modal.classList.remove('hidden');
    modal.classList.add('flex');
};

window.executeCoinToss = function () {
    if (!currentVetoState) return;
    const coinGraphic = document.getElementById('coinGraphic');
    const flipBtn = document.getElementById('flipCoinBtn');
    const coinResultDisplay = document.getElementById('coinResultDisplay');

    if (flipBtn) flipBtn.disabled = true;
    if (coinGraphic) {
        coinGraphic.style.transition = 'transform 1s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
        coinGraphic.style.transform = 'rotateY(1080deg) scale(1.2)';
    }

    setTimeout(() => {
        const coinWinner = Math.random() < 0.5 ? currentVetoState.team1 : currentVetoState.team2;
        currentVetoState.coinWinner = coinWinner;
        currentVetoState.firstBanTeam = coinWinner;
        currentVetoState.currentTurnTeam = coinWinner;

        if (coinResultDisplay) {
            coinResultDisplay.innerHTML = `<span class="text-white font-bold">${escapeHtml(coinWinner)}</span> won the coin flip and bans first!`;
        }

        setTimeout(() => {
            document.getElementById('vetoCoinTossSection').classList.add('hidden');
            document.getElementById('vetoPickBanSection').classList.remove('hidden');
            renderMapVetoUI();
            if (flipBtn) flipBtn.disabled = false;
        }, 1200);
    }, 1000);
};

function renderMapVetoUI() {
    if (!currentVetoState) return;
    const grid = document.getElementById('vetoMapGrid');
    const turnText = document.getElementById('vetoCurrentTurnText');
    const stepCount = document.getElementById('vetoStepCount');
    const sideWrap = document.getElementById('vetoSideSelectionWrap');

    const remainingMaps = currentVetoState.maps.filter(m => !currentVetoState.bans.includes(m));

    if (turnText) {
        turnText.innerHTML = `<span class="text-[#FFD700] font-black">${escapeHtml(currentVetoState.currentTurnTeam)}</span> (CLICK TO BAN)`;
    }
    if (stepCount) {
        stepCount.textContent = `Ban Phase: ${remainingMaps.length} Maps Remaining`;
    }

    if (remainingMaps.length === 1) {
        currentVetoState.finalMap = remainingMaps[0];
        if (turnText) turnText.innerHTML = `<span class="text-emerald-400 font-black">VETO COMPLETE</span>`;
        if (sideWrap) {
            sideWrap.classList.remove('hidden');
            document.getElementById('vetoFinalMapName').textContent = currentVetoState.finalMap;
            const sidePickerTeam = (currentVetoState.currentTurnTeam === currentVetoState.team1) ? currentVetoState.team2 : currentVetoState.team1;
            document.getElementById('vetoSidePickerNotice').textContent = `${sidePickerTeam} selects starting side:`;
        }
    } else {
        if (sideWrap) sideWrap.classList.add('hidden');
    }

    if (grid) {
        grid.innerHTML = currentVetoState.maps.map(mapName => {
            const isBanned = currentVetoState.bans.includes(mapName);
            const isFinal = (mapName === currentVetoState.finalMap);

            let bgClass = "bg-black/50 border-white/10 hover:border-amber-400/50 text-white cursor-pointer";
            let statusTag = `<span class="text-[9px] text-neutral-400 font-mono-tag uppercase">Available</span>`;

            if (isBanned) {
                bgClass = "bg-red-950/20 border-red-500/30 text-neutral-500 opacity-60 line-through cursor-not-allowed";
                statusTag = `<span class="text-[9px] text-rose-400 font-mono-tag font-bold uppercase">Banned</span>`;
            } else if (isFinal) {
                bgClass = "bg-emerald-950/30 border-emerald-500 text-[#FFD700] shadow-[0_0_15px_rgba(16,185,129,0.3)]";
                statusTag = `<span class="text-[9px] text-emerald-400 font-mono-tag font-extrabold uppercase">Decider Map</span>`;
            }

            return `
                <div onclick="${!isBanned && remainingMaps.length > 1 ? `window.handleMapVetoAction('${escapeHtml(mapName)}')` : ''}"
                    class="p-3 rounded-xl border ${bgClass} flex flex-col justify-between min-h-[70px] transition-all">
                    <div class="flex items-center justify-between">
                        <span class="text-neutral-400 text-[10px] uppercase font-bold">MAP:</span>
                        ${statusTag}
                    </div>
                    <div class="font-heading font-black text-xs uppercase truncate mt-2">${escapeHtml(mapName)}</div>
                </div>
            `;
        }).join('');
    }
}

function renderCompletedVetoGrid(veto) {
    const grid = document.getElementById('vetoMapGrid');
    if (!grid) return;
    const bans = veto.bannedMaps || [];
    grid.innerHTML = bans.map(b => `
        <div class="p-3 rounded-xl border bg-red-950/20 border-red-500/20 text-neutral-500 line-through text-xs font-mono-tag">
            <span>${escapeHtml(b)} (Banned)</span>
        </div>
    `).join('') + `
        <div class="p-3 rounded-xl border bg-emerald-950/30 border-emerald-500/40 text-emerald-300 text-xs font-heading font-bold uppercase">
            <span>Decider: ${escapeHtml(veto.map)} (${escapeHtml(veto.side || 'Decider')})</span>
        </div>
    `;
}

window.handleMapVetoAction = function (mapName) {
    if (!currentVetoState || currentVetoState.bans.includes(mapName)) return;
    currentVetoState.bans.push(mapName);
    currentVetoState.currentTurnTeam = (currentVetoState.currentTurnTeam === currentVetoState.team1) ? currentVetoState.team2 : currentVetoState.team1;
    renderMapVetoUI();
};

window.finalizeMapSide = async function (sideChoice) {
    if (!currentVetoMatchId || !currentVetoState || !currentVetoState.finalMap) return;

    try {
        const tourneyRef = doc(db, "tournaments", currentEditingTournament.id);
        const tSnap = await getDoc(tourneyRef);
        let matches = tSnap.data().matches || [];
        let matchIndex = matches.findIndex(m => m.id === currentVetoMatchId);
        if (matchIndex === -1) return;

        matches[matchIndex].veto = {
            map: currentVetoState.finalMap,
            side: sideChoice,
            bannedMaps: currentVetoState.bans,
            coinWinner: currentVetoState.coinWinner,
            completedAt: Date.now()
        };

        await updateDoc(tourneyRef, { matches: matches });
        window.closeModal('mapVetoModal');

        const vetoBadge = document.getElementById('scoreVetoResultBadge');
        if (vetoBadge) {
            vetoBadge.textContent = `${currentVetoState.finalMap} (${sideChoice})`;
            vetoBadge.classList.remove('hidden');
        }

        if (window.showSuccessToast) window.showSuccessToast("Map Veto Saved", `Decider: ${currentVetoState.finalMap} (${sideChoice})`);
    } catch (e) {
        console.error(e);
        alert("Failed to save map veto: " + e.message);
    }
};

// ==========================================
// FEATURE SUITE 3: MATCH SCREENSHOT PROOF
// ==========================================
window.handleScoreProofSelect = function (event) {
    const file = event.target.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
        alert("Please select an image file (PNG, JPG, JPEG).");
        return;
    }

    window._scoreProofFile = file;
    const reader = new FileReader();
    reader.onload = (e) => {
        window._scoreProofDataURL = e.target.result;
        const emptyState = document.getElementById('scoreProofEmptyState');
        const previewWrap = document.getElementById('scoreProofPreviewWrap');
        const thumb = document.getElementById('scoreProofThumbnail');

        if (emptyState) emptyState.classList.add('hidden');
        if (previewWrap) previewWrap.classList.remove('hidden');
        if (thumb) thumb.src = e.target.result;
    };
    reader.readAsDataURL(file);
};

window.clearScoreProof = function () {
    window._scoreProofFile = null;
    window._scoreProofDataURL = null;
    const input = document.getElementById('scoreProofFileInput');
    if (input) input.value = '';
    const emptyState = document.getElementById('scoreProofEmptyState');
    const previewWrap = document.getElementById('scoreProofPreviewWrap');
    const thumb = document.getElementById('scoreProofThumbnail');

    if (emptyState) emptyState.classList.remove('hidden');
    if (previewWrap) previewWrap.classList.add('hidden');
    if (thumb) thumb.src = '';
};

window.viewCurrentScoreProof = function () {
    const thumb = document.getElementById('scoreProofThumbnail');
    if (thumb && thumb.src) {
        window.viewMatchScreenshot(thumb.src);
    }
};

window.viewMatchScreenshot = function (url) {
    if (!url) return;
    const modal = document.getElementById('screenshotViewerModal');
    const img = document.getElementById('screenshotViewerImg');
    if (!modal || !img) return;
    img.src = url;
    modal.style.display = 'flex';
};

window.closeScreenshotViewer = function () {
    const modal = document.getElementById('screenshotViewerModal');
    if (modal) modal.style.display = 'none';
};

// ==========================================
// FEATURE SUITE 4: AUTOMATED FORFEIT RULES
// ==========================================
window.declareCurrentMatchForfeit = async function (winningTeamVal = "1") {
    const matchId = document.getElementById('scoreMatchId')?.value;
    const t1 = document.getElementById('scoreTeam1Name')?.textContent || 'Team 1';
    const t2 = document.getElementById('scoreTeam2Name')?.textContent || 'Team 2';
    if (!matchId) return;

    const winningTeamName = winningTeamVal === "2" ? t2 : t1;
    const forfeitedTeamName = winningTeamVal === "2" ? t1 : t2;

    const confirmed = await window.showCustomConfirm(
        "Award Forfeit / DQ Win?",
        `Award forfeit victory (2-0) to "${winningTeamName}" due to forfeit / no-show by "${forfeitedTeamName}"?`
    );
    if (!confirmed) return;

    const winnerRadio = document.querySelector(`input[name="matchWinner"][value="${winningTeamVal}"]`);
    if (winnerRadio) winnerRadio.checked = true;
    const s1Input = document.getElementById('scoreTeam1');
    const s2Input = document.getElementById('scoreTeam2');
    if (s1Input) s1Input.value = (winningTeamVal === "1") ? 2 : 0;
    if (s2Input) s2Input.value = (winningTeamVal === "2") ? 2 : 0;

    await window.saveMatchScore();
};

// ==========================================
// ==========================================
// FEATURE SUITE 5: WINNER PAYOUT CLAIM & DISBURSEMENT PORTAL
// ==========================================
function determinePodiumTeams(t) {
    const matches = t.matches || [];
    let firstTeam = t.champion || t.winner || 'TBD';
    let secondTeam = t.runnerUp || t.secondPlace || 'TBD';
    let thirdTeam = t.thirdPlace || 'TBD';

    if (t.format === 'Round Robin') {
        const stats = {};
        (t.participants || []).forEach(p => {
            const name = typeof p === 'object' ? (p.name || p.teamName) : p;
            stats[name] = { name: name, won: 0, lost: 0, pts: 0 };
        });
        matches.forEach(m => {
            if (m.winner && stats[m.winner]) {
                stats[m.winner].won++;
                stats[m.winner].pts += 3;
            }
        });
        const sorted = Object.values(stats).sort((a, b) => (b.won - a.won) || (b.pts - a.pts));
        if (sorted[0]) firstTeam = sorted[0].name;
        if (sorted[1]) secondTeam = sorted[1].name;
        if (sorted[2]) thirdTeam = sorted[2].name;
    } else {
        const gfMatch = getGrandFinalMatch(matches);
        if (gfMatch && gfMatch.winner) {
            firstTeam = gfMatch.winner;
            secondTeam = (gfMatch.winner === gfMatch.team1) ? gfMatch.team2 : gfMatch.team1;
        }
        const bronzeMatch = matches.find(m => m.id === 'BM-1' || m.id === '3RD-1' || m.id === 'M-3RD' || m.isBronzeMatch);
        if (bronzeMatch && bronzeMatch.winner) {
            thirdTeam = bronzeMatch.winner;
        } else if (thirdTeam === 'TBD' && matches.length > 1 && gfMatch) {
            const semiMatches = matches.filter(m => m.nextMatchId === 'GF-1' || m.nextMatchId === gfMatch.id);
            if (semiMatches.length > 0) {
                const sfLosers = [];
                semiMatches.forEach(sm => {
                    if (sm.winner) {
                        const loser = sm.winner === sm.team1 ? sm.team2 : sm.team1;
                        if (loser && loser !== 'TBD' && loser !== 'BYE') sfLosers.push(loser);
                    }
                });
                if (sfLosers.length > 0) thirdTeam = sfLosers.join(' / ');
            }
        }
    }

    return { firstTeam, secondTeam, thirdTeam };
}

function renderPayoutsTab(t, isCreator, user) {
    const summaryEl = document.getElementById('payoutStatusSummary');
    const claimSection = document.getElementById('winnerClaimSection');
    const podiumCardsEl = document.getElementById('payoutPodiumCards');
    const organizerPanel = document.getElementById('organizerPayoutPanel');
    const organizerClaimsList = document.getElementById('organizerClaimsList');
    const myClaimBadge = document.getElementById('myClaimBadge');

    const totalPrize = Number(t.prize) || 0;
    const split = t.prizeSplit || { first: 60, second: 30, third: 10 };
    const split1 = Number(split.first) || 0;
    const split2 = Number(split.second) || 0;
    const split3 = Number(split.third) || 0;

    const prize1 = Math.round(totalPrize * (split1 / 100));
    const prize2 = Math.round(totalPrize * (split2 / 100));
    const prize3 = Math.round(totalPrize * (split3 / 100));

    const { firstTeam, secondTeam, thirdTeam } = determinePodiumTeams(t);

    const podium = [];
    if (split1 > 0) podium.push({ place: '1st Place (Champion)', placeShort: '1st Place', team: firstTeam, prize: prize1, split: split1, icon: '1ST', border: 'border-[#FFD700]/50' });
    if (split2 > 0) podium.push({ place: '2nd Place (Runner-Up)', placeShort: '2nd Place', team: secondTeam, prize: prize2, split: split2, icon: '2ND', border: 'border-slate-400/40' });
    if (split3 > 0) podium.push({ place: '3rd Place', placeShort: '3rd Place', team: thirdTeam, prize: prize3, split: split3, icon: '3RD', border: 'border-amber-700/40' });

    const claims = t.payoutClaims || [];
    const disbursedCount = claims.filter(c => c.status === 'Disbursed').length;
    const activeTiersCount = podium.length;

    // 1. Top Summary Strip
    if (summaryEl) {
        summaryEl.innerHTML = `
            <span class="px-2 py-0.5 rounded bg-[#FFD700]/10 text-[#FFD700] border border-[#FFD700]/30 font-bold">Pool: ₱${totalPrize.toLocaleString()}</span>
            <span class="px-2 py-0.5 rounded bg-white/5 text-neutral-300 border border-white/10 font-bold">${activeTiersCount} Tiers</span>
            ${disbursedCount === activeTiersCount && activeTiersCount > 0 ? `
                <span class="px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 font-bold flex items-center gap-1"><span class="text-emerald-400 font-bold">[ACTIVE]</span> All Disbursed</span>
            ` : (disbursedCount > 0 ? `
                <span class="px-2 py-0.5 rounded bg-amber-500/15 text-amber-400 border border-amber-500/30 font-bold">${disbursedCount}/${activeTiersCount} Disbursed</span>
            ` : `
                <span class="px-2 py-0.5 rounded bg-white/5 text-neutral-400 border border-white/10">Pending Disbursement</span>
            `)}
        `;
    }

    // 2. Podium Distribution Cards
    if (podiumCardsEl) {
        if (podium.length === 0) {
            podiumCardsEl.innerHTML = `<div class="col-span-full text-center text-neutral-500 py-3 text-xs font-mono-tag">No placement prize split defined for this tournament.</div>`;
        } else {
            podiumCardsEl.innerHTML = podium.map(p => {
                const teamClaim = claims.find(c => c.teamName === p.team && p.team !== 'TBD');
                const isMyWinningTeam = user && t.participants && t.participants.some(pt => {
                    const ptName = typeof pt === 'object' ? (pt.name || pt.teamName) : pt;
                    const isCaptain = (pt.registeredBy === user.uid || (pt.captain && pt.captain.toLowerCase() === user.displayName?.toLowerCase()));
                    return isCaptain && ptName === p.team && p.team !== 'TBD';
                });

                const statusBadge = teamClaim 
                    ? (teamClaim.status === 'Disbursed' 
                        ? `<span class="px-2 py-0.5 rounded text-[9px] font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">Disbursed</span>`
                        : `<span class="px-2 py-0.5 rounded text-[9px] font-bold bg-amber-500/15 text-amber-400 border border-amber-500/30">Pending Review</span>`)
                    : `<span class="px-2 py-0.5 rounded text-[9px] font-bold bg-white/5 text-neutral-400 border border-white/10">Unclaimed</span>`;

                return `
                    <div class="bg-black/40 border ${p.border} rounded-xl p-3 sm:p-3.5 flex flex-col justify-between space-y-2.5 font-mono-tag shadow-lg min-w-0">
                        <div class="flex items-center justify-between gap-1.5">
                            <div class="flex items-center gap-1.5 min-w-0">
                                <span class="text-base shrink-0">${p.icon}</span>
                                <span class="text-[10px] sm:text-[11px] text-neutral-300 font-bold uppercase truncate">${p.place}</span>
                            </div>
                            <div class="shrink-0">${statusBadge}</div>
                        </div>

                        <div class="min-w-0 bg-white/[0.02] border border-white/5 rounded-lg p-2.5">
                            <h4 class="font-heading font-black text-xs sm:text-sm text-white uppercase truncate">${escapeHtml(p.team)}</h4>
                            ${teamClaim ? `
                                <div class="text-[10px] text-neutral-400 mt-1 truncate">
                                    <span class="text-[#FFD700] font-bold">${escapeHtml(teamClaim.channel)}:</span> ${escapeHtml(teamClaim.accountNumber)} (${escapeHtml(teamClaim.accountName)})
                                </div>
                                ${teamClaim.referenceNumber && teamClaim.status === 'Disbursed' ? `
                                    <div class="text-[9px] text-emerald-400 mt-0.5 truncate font-mono-tag">Ref: ${escapeHtml(teamClaim.referenceNumber)}</div>
                                ` : ''}
                            ` : `
                                <div class="text-[10px] text-neutral-500 mt-1 italic">${p.team === 'TBD' ? 'Waiting for match results' : 'No payout claim submitted yet'}</div>
                            `}
                        </div>

                        <div class="pt-2 border-t border-white/5 flex items-center justify-between gap-1">
                            <span class="text-[9px] sm:text-[10px] text-neutral-500 truncate">${p.split}% Pool</span>
                            <span class="font-heading font-extrabold text-xs sm:text-sm text-[#FFD700] whitespace-nowrap shrink-0">₱${p.prize.toLocaleString()}</span>
                        </div>

                        <!-- Card Action Buttons -->
                        <div class="pt-1 flex gap-1.5 font-heading text-[10px] uppercase">
                            ${isMyWinningTeam ? `
                                <button type="button" onclick="window.openPayoutClaimModal('${escapeHtml(p.team)}')" class="w-full py-1.5 rounded-lg bg-[#FFD700] hover:bg-[#FFF099] text-black font-black uppercase transition-all shadow-sm cursor-pointer text-center">
                                    ${teamClaim ? 'Edit Payout Info' : 'Claim Payout'}
                                </button>
                            ` : ''}
                            ${isCreator && p.team !== 'TBD' ? `
                                ${teamClaim && teamClaim.status !== 'Disbursed' ? `
                                    <button type="button" onclick="window.openDisbursePayoutModal('${escapeHtml(p.team)}')" class="w-full py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-black font-black uppercase transition-all shadow-sm cursor-pointer text-center">
                                        Disburse Payout
                                    </button>
                                ` : (teamClaim && teamClaim.status === 'Disbursed' ? `
                                    <div class="w-full py-1 text-center text-emerald-400 font-bold text-[9px] bg-emerald-500/10 rounded border border-emerald-500/20">
                                        Disbursed
                                    </div>
                                ` : `
                                    <button type="button" onclick="window.openDisbursePayoutModal('${escapeHtml(p.team)}')" class="w-full py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-neutral-300 border border-white/10 font-bold uppercase transition-all cursor-pointer text-center">
                                        Record Manual Payout
                                    </button>
                                `)}
                            ` : ''}
                        </div>
                    </div>
                `;
            }).join('');
        }
    }

    // 3. User Winning Banner
    let userTeamInPodium = null;
    if (user && t.participants) {
        const myTeam = t.participants.find(p => p.registeredBy === user.uid || (p.captain && p.captain.toLowerCase() === user.displayName?.toLowerCase()));
        const myTeamName = myTeam ? (myTeam.name || myTeam.teamName) : null;
        if (myTeamName && podium.some(p => p.team === myTeamName && p.team !== 'TBD')) {
            userTeamInPodium = myTeamName;
        }
    }

    if (claimSection) {
        if (userTeamInPodium) {
            claimSection.classList.remove('hidden');
            const myClaim = claims.find(c => c.teamName === userTeamInPodium);
            if (myClaimBadge) {
                myClaimBadge.textContent = myClaim ? `Status: ${myClaim.status}` : "No Claim Submitted Yet";
                myClaimBadge.className = myClaim?.status === 'Disbursed' 
                    ? 'px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-emerald-500/20 text-emerald-300 border border-emerald-500/40' 
                    : 'px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-amber-500/20 text-amber-300 border border-amber-500/40';
            }
        } else {
            claimSection.classList.add('hidden');
        }
    }

    // 4. Organizer Disbursement Panel
    if (organizerPanel) {
        organizerPanel.classList.toggle('hidden', !isCreator);
        if (isCreator) {
            // Update Organizer Fee Summary Breakdown
            const entryFee = parseFloat(t.entryFee) || 0;
            const partCount = (t.participants || []).length;
            const pType = t.paymentType || (t.entryType === 'Paid' ? 'manual' : (t.entryType ? String(t.entryType).toLowerCase() : 'free'));
            const isAuto = pType === 'automatic';
            const isPaid = (pType === 'manual' || isAuto || t.entryType === 'Paid') && entryFee > 0;
            const grossFees = isPaid ? (partCount * entryFee) : 0;
            const platformFee = isAuto ? (grossFees * 0.05) : 0; // 5% Platform Fee on Automated Payments, 0% for Manual
            const netFees = grossFees - platformFee;

            const grossEl = document.getElementById('orgPayoutGross');
            const feeEl = document.getElementById('orgPayoutFee');
            const netEl = document.getElementById('orgPayoutNet');
            const prizeEl = document.getElementById('orgPayoutPrize');
            const feeBadgeEl = document.getElementById('orgPayoutFeeBadge');
            const feeLabelEl = document.getElementById('orgPayoutFeeLabel');

            if (grossEl) grossEl.textContent = `₱${grossFees.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
            if (feeEl) feeEl.textContent = `₱${platformFee.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
            if (netEl) netEl.textContent = `₱${netFees.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
            if (prizeEl) prizeEl.textContent = `₱${totalPrize.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
            if (feeBadgeEl) feeBadgeEl.textContent = isAuto ? '5% Platform Fee' : (isPaid ? '0% Fee (Manual)' : '0% Fee (Free)');
            if (feeLabelEl) feeLabelEl.textContent = isAuto ? 'Platform Fee (5%)' : 'Platform Fee (0%)';

            if (organizerClaimsList) {
                if (claims.length === 0) {
                    organizerClaimsList.innerHTML = `<div class="text-neutral-500 italic py-3 text-center">No payout claims submitted yet by winning captains.</div>`;
                } else {
                    organizerClaimsList.innerHTML = claims.map(c => `
                        <div class="p-3 bg-black/40 border border-white/10 rounded-xl flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2.5">
                            <div class="min-w-0">
                                <div class="flex items-center gap-2 flex-wrap">
                                    <span class="font-heading font-black text-white uppercase text-xs truncate">${escapeHtml(c.teamName)}</span>
                                    <span class="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${c.status === 'Disbursed' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40' : 'bg-amber-500/20 text-amber-400 border border-amber-500/40'}">${escapeHtml(c.status)}</span>
                                </div>
                                <div class="text-[11px] text-neutral-300 mt-1">
                                    <span class="text-[#FFD700] font-bold">${escapeHtml(c.channel)}:</span> ${escapeHtml(c.accountNumber)} (${escapeHtml(c.accountName)})
                                </div>
                                ${c.contact ? `<div class="text-[10px] text-neutral-400 mt-0.5">Contact: ${escapeHtml(c.contact)}</div>` : ''}
                                ${c.referenceNumber ? `<div class="text-[10px] text-emerald-400 mt-0.5 font-mono-tag">Ref #: ${escapeHtml(c.referenceNumber)}</div>` : ''}
                            </div>
                            <div class="flex gap-1.5 shrink-0 font-heading text-xs uppercase">
                                ${c.status !== 'Disbursed' ? `
                                    <button type="button" onclick="window.openDisbursePayoutModal('${escapeHtml(c.teamName)}')" class="px-3.5 py-2 bg-emerald-500 hover:bg-emerald-400 text-black font-extrabold rounded-lg transition-colors cursor-pointer shadow-sm">
                                        Disburse
                                    </button>
                                ` : `
                                    <span class="px-2.5 py-1 text-emerald-400 text-xs font-bold font-mono-tag bg-emerald-500/10 rounded border border-emerald-500/20">Paid</span>
                                `}
                            </div>
                        </div>
                    `).join('');
                }
            }
        }
    }
}

window.openPayoutClaimModal = function (preferredTeamName) {
    const t = currentEditingTournament;
    if (!t) return;

    const select = document.getElementById('payoutClaimTeamSelect');
    if (!select) return;

    select.innerHTML = '';
    const participants = t.participants || [];
    const { firstTeam, secondTeam, thirdTeam } = determinePodiumTeams(t);
    const podiumTeams = [firstTeam, secondTeam, thirdTeam].filter(name => name && name !== 'TBD');

    const optionsList = [...new Set([...podiumTeams, ...participants.map(p => typeof p === 'object' ? (p.name || p.teamName) : p)])];

    optionsList.forEach(teamName => {
        if (!teamName) return;
        const opt = document.createElement('option');
        opt.value = teamName;
        opt.textContent = teamName;
        if (preferredTeamName && teamName === preferredTeamName) {
            opt.selected = true;
        }
        select.appendChild(opt);
    });

    if (preferredTeamName && select.value !== preferredTeamName) {
        select.value = preferredTeamName;
    }

    // Auto-populate existing claim details if already submitted
    const selectedTeam = select.value;
    const existingClaim = (t.payoutClaims || []).find(c => c.teamName === selectedTeam);
    if (existingClaim) {
        if (qs('#payoutChannelSelect')) qs('#payoutChannelSelect').value = existingClaim.channel || 'GCash';
        if (qs('#payoutAccountName')) qs('#payoutAccountName').value = existingClaim.accountName || '';
        if (qs('#payoutAccountNumber')) qs('#payoutAccountNumber').value = existingClaim.accountNumber || '';
        if (qs('#payoutContact')) qs('#payoutContact').value = existingClaim.contact || '';
        if (qs('#payoutNotes')) qs('#payoutNotes').value = existingClaim.notes || '';
    } else {
        if (qs('#payoutAccountName')) qs('#payoutAccountName').value = '';
        if (qs('#payoutAccountNumber')) qs('#payoutAccountNumber').value = '';
        if (qs('#payoutContact')) qs('#payoutContact').value = '';
        if (qs('#payoutNotes')) qs('#payoutNotes').value = '';

        // Pre-fill from user's profile and saved withdrawal/payout method
        const auth = getAuth();
        const user = auth.currentUser;
        if (user) {
            getDoc(doc(db, "users", user.uid)).then(snap => {
                if (snap.exists()) {
                    const uData = snap.data();
                    const pm = uData.payoutMethod || {};
                    if (qs('#payoutChannelSelect')) qs('#payoutChannelSelect').value = pm.channel || 'GCash';
                    if (qs('#payoutAccountName')) qs('#payoutAccountName').value = pm.accountName || uData.realName || uData.ign || uData.displayName || user.displayName || '';
                    if (qs('#payoutAccountNumber')) qs('#payoutAccountNumber').value = pm.accountNumber || '';
                    if (qs('#payoutContact')) qs('#payoutContact').value = uData.discord || uData.discordTag || uData.email || user.email || '';
                    if (qs('#payoutNotes') && !qs('#payoutNotes').value) qs('#payoutNotes').value = pm.notes || (pm.bankName ? `Bank: ${pm.bankName}` : '');
                }
            }).catch(e => console.warn(e));
        }
    }

    window.updateClaimModalPrizeDisplay();

    const modal = document.getElementById('payoutClaimModal');
    if (modal) {
        modal.classList.remove('hidden');
        modal.classList.add('flex');
    }
};

window.updateClaimModalPrizeDisplay = function () {
    const t = currentEditingTournament;
    if (!t) return;
    const selectedTeam = document.getElementById('payoutClaimTeamSelect')?.value;
    const tierText = document.getElementById('payoutClaimTierText');
    const amountText = document.getElementById('payoutClaimAmountText');
    if (!tierText || !amountText) return;

    const totalPrize = Number(t.prize) || 0;
    const split = t.prizeSplit || { first: 60, second: 30, third: 10 };
    const { firstTeam, secondTeam, thirdTeam } = determinePodiumTeams(t);

    let tier = 'Podium Placement';
    let percentage = 0;

    if (selectedTeam === firstTeam) {
        tier = '1st Place (Champion)';
        percentage = Number(split.first) || 60;
    } else if (selectedTeam === secondTeam) {
        tier = '2nd Place (Runner-Up)';
        percentage = Number(split.second) || 30;
    } else if (selectedTeam === thirdTeam) {
        tier = '3rd Place (Bronze)';
        percentage = Number(split.third) || 10;
    } else {
        tier = 'Participant Claim';
        percentage = Number(split.first) || 100;
    }

    const prizeAmt = Math.round(totalPrize * (percentage / 100));
    tierText.textContent = `${tier} (${percentage}%)`;
    amountText.textContent = `₱${prizeAmt.toLocaleString()}`;
};

window.saveWinnerPayoutClaim = async function () {
    if (!currentEditingTournament) return;
    const auth = getAuth();
    const user = auth.currentUser;

    const teamName = document.getElementById('payoutClaimTeamSelect')?.value;
    const channel = document.getElementById('payoutChannelSelect')?.value;
    const accountName = document.getElementById('payoutAccountName')?.value?.trim();
    const accountNumber = document.getElementById('payoutAccountNumber')?.value?.trim();
    const contact = document.getElementById('payoutContact')?.value?.trim();
    const notes = document.getElementById('payoutNotes')?.value?.trim();

    if (!teamName || !accountName || !accountNumber) {
        alert("Please fill in all required payout details.");
        return;
    }

    const saveBtn = document.getElementById('savePayoutClaimBtn');
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Submitting...'; }

    try {
        const tourneyRef = doc(db, "tournaments", currentEditingTournament.id);
        const tSnap = await getDoc(tourneyRef);
        let claims = tSnap.data().payoutClaims || [];

        const existingIdx = claims.findIndex(c => c.teamName === teamName);
        const newClaim = {
            teamName,
            channel,
            accountName,
            accountNumber,
            contact: contact || '',
            notes: notes || '',
            status: 'Pending Review',
            submittedAt: Date.now(),
            submittedBy: user ? user.uid : null
        };

        if (existingIdx !== -1) {
            claims[existingIdx] = newClaim;
        } else {
            claims.push(newClaim);
        }

        await updateDoc(tourneyRef, { payoutClaims: claims });
        currentEditingTournament.payoutClaims = claims;

        // Notify tournament organizer
        if (currentEditingTournament.createdBy) {
            try {
                await addDoc(collection(db, "notifications"), {
                    userId: currentEditingTournament.createdBy,
                    title: "New Payout Claim",
                    message: `${teamName} submitted payout claim details for ${currentEditingTournament.name} via ${channel}.`,
                    tournamentId: currentEditingTournament.id,
                    type: "payout_claim",
                    read: false,
                    createdAt: serverTimestamp()
                });
            } catch (err) { console.warn("Organizer notification skipped:", err); }
        }

        window.closeModal('payoutClaimModal');
        renderPayoutsTab(currentEditingTournament, true, user);
        if (window.showSuccessToast) window.showSuccessToast("Claim Submitted!", "Payout details sent to organizer.");
    } catch (e) {
        console.error(e);
        alert("Failed to submit payout claim: " + e.message);
    } finally {
        if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Submit Claim'; }
    }
};

window.openDisbursePayoutModal = function (teamName) {
    const t = currentEditingTournament;
    if (!t || !teamName) return;

    const modal = document.getElementById('disbursePayoutModal');
    if (!modal) return;

    const claims = t.payoutClaims || [];
    const claim = claims.find(c => c.teamName === teamName);
    const { firstTeam, secondTeam, thirdTeam } = determinePodiumTeams(t);
    const split = t.prizeSplit || { first: 60, second: 30, third: 10 };
    const totalPrize = Number(t.prize) || 0;

    let percentage = 0;
    if (teamName === firstTeam) percentage = Number(split.first) || 60;
    else if (teamName === secondTeam) percentage = Number(split.second) || 30;
    else if (teamName === thirdTeam) percentage = Number(split.third) || 10;
    else percentage = 100;

    const amount = Math.round(totalPrize * (percentage / 100));

    if (qs('#disburseTeamName')) qs('#disburseTeamName').textContent = teamName;
    if (qs('#disburseAmount')) qs('#disburseAmount').textContent = `₱${amount.toLocaleString()}`;
    if (qs('#disburseTargetTeam')) qs('#disburseTargetTeam').value = teamName;
    if (qs('#disburseChannel')) qs('#disburseChannel').textContent = claim ? claim.channel : 'GCash';
    if (qs('#disburseAccountName')) qs('#disburseAccountName').textContent = claim ? claim.accountName : 'N/A';
    if (qs('#disburseAccountNumber')) qs('#disburseAccountNumber').textContent = claim ? claim.accountNumber : 'N/A';
    if (qs('#disburseContact')) qs('#disburseContact').textContent = claim?.contact || 'None';
    if (qs('#disburseNotes')) qs('#disburseNotes').textContent = claim?.notes || 'None';
    if (qs('#disburseRefNumber')) qs('#disburseRefNumber').value = claim?.referenceNumber || '';
    if (qs('#disburseReceiptNotes')) qs('#disburseReceiptNotes').value = claim?.receiptNotes || '';

    modal.classList.remove('hidden');
    modal.classList.add('flex');
};

window.confirmDisbursement = async function () {
    if (!currentEditingTournament) return;
    const teamName = document.getElementById('disburseTargetTeam')?.value;
    const refNo = document.getElementById('disburseRefNumber')?.value?.trim();
    const receiptNotes = document.getElementById('disburseReceiptNotes')?.value?.trim() || '';

    if (!teamName || !refNo) {
        alert("Please enter a valid Transaction Reference Number.");
        return;
    }

    const confirmBtn = document.getElementById('confirmDisburseBtn');
    if (confirmBtn) { confirmBtn.disabled = true; confirmBtn.textContent = 'Saving...'; }

    try {
        const tourneyRef = doc(db, "tournaments", currentEditingTournament.id);
        const tSnap = await getDoc(tourneyRef);
        let claims = tSnap.data().payoutClaims || [];
        let claim = claims.find(c => c.teamName === teamName);
        if (!claim) {
            claim = { teamName, channel: 'GCash', accountName: 'Direct Disbursed', accountNumber: 'Direct' };
            claims.push(claim);
        }

        const auth = getAuth();
        const user = auth.currentUser;

        claim.status = 'Disbursed';
        claim.referenceNumber = refNo;
        claim.receiptNotes = receiptNotes;
        claim.disbursedAt = Date.now();
        claim.disbursedBy = user ? user.uid : null;

        await updateDoc(tourneyRef, { payoutClaims: claims });
        currentEditingTournament.payoutClaims = claims;

        // Notify the winning team captain
        if (claim.submittedBy) {
            try {
                await addDoc(collection(db, "notifications"), {
                    userId: claim.submittedBy,
                    title: "Prize Payout Disbursed!",
                    message: `Your prize payout for ${currentEditingTournament.name} (${teamName}) has been marked as disbursed! Ref #: ${refNo}`,
                    tournamentId: currentEditingTournament.id,
                    type: "payout_disbursed",
                    read: false,
                    createdAt: serverTimestamp()
                });
            } catch (err) { console.warn("Captain notification skipped:", err); }
        }

        window.closeModal('disbursePayoutModal');
        renderPayoutsTab(currentEditingTournament, true, user);
        if (window.showSuccessToast) window.showSuccessToast("Disbursed!", `${teamName} payout confirmed and recorded.`);
    } catch (e) {
        console.error(e);
        alert("Failed to confirm disbursement: " + e.message);
    } finally {
        if (confirmBtn) { confirmBtn.disabled = false; confirmBtn.textContent = 'Confirm Payout'; }
    }
};

window.markPayoutDisbursed = function (teamName) {
    window.openDisbursePayoutModal(teamName);
};

// ==========================================
// FEATURE SUITE 6: TOURNAMENT MVP AWARDING
// ==========================================
window.openAwardMvpModal = function () {
    const t = currentEditingTournament;
    if (!t) return;

    const select = document.getElementById('mvpSelectPlayer');
    if (select) {
        select.innerHTML = '<option value="">-- Choose from Participants --</option>';
        const participants = t.participants || [];
        participants.forEach(p => {
            const teamName = typeof p === 'object' ? (p.name || p.teamName) : p;
            const members = typeof p === 'object' && Array.isArray(p.members) ? p.members : [teamName];
            members.forEach(m => {
                const opt = document.createElement('option');
                opt.value = m;
                opt.textContent = `${m} (${teamName})`;
                opt.dataset.team = teamName;
                select.appendChild(opt);
            });
        });

        select.onchange = (e) => {
            const selectedOpt = select.selectedOptions[0];
            if (selectedOpt && selectedOpt.value) {
                document.getElementById('mvpCustomIgn').value = selectedOpt.value;
                document.getElementById('mvpCustomTeam').value = selectedOpt.dataset.team || '';
            }
        };
    }

    if (t.mvp) {
        if (document.getElementById('mvpCustomIgn')) document.getElementById('mvpCustomIgn').value = t.mvp.ign || '';
        if (document.getElementById('mvpCustomTeam')) document.getElementById('mvpCustomTeam').value = t.mvp.team || '';
        if (document.getElementById('mvpCustomTitle')) document.getElementById('mvpCustomTitle').value = t.mvp.title || 'Grand Finals MVP';
        if (document.getElementById('mvpCustomStats')) document.getElementById('mvpCustomStats').value = t.mvp.stats || '';
    }

    const modal = document.getElementById('awardMvpModal');
    if (modal) {
        modal.classList.remove('hidden');
        modal.classList.add('flex');
    }
};

window.saveTournamentMvp = async function () {
    if (!currentEditingTournament) return;
    const ign = document.getElementById('mvpCustomIgn')?.value?.trim() || document.getElementById('mvpSelectPlayer')?.value?.trim();
    const team = document.getElementById('mvpCustomTeam')?.value?.trim() || '';
    const title = document.getElementById('mvpCustomTitle')?.value?.trim() || 'Grand Finals MVP';
    const stats = document.getElementById('mvpCustomStats')?.value?.trim() || '';

    if (!ign) {
        alert("Please enter or select an MVP player IGN.");
        return;
    }

    try {
        const mvpPayload = {
            ign,
            team,
            title,
            stats,
            awardedAt: Date.now()
        };

        await updateDoc(doc(db, "tournaments", currentEditingTournament.id), {
            mvp: mvpPayload
        });

        window.closeModal('awardMvpModal');
        if (window.showSuccessToast) window.showSuccessToast("MVP Crowned! ⭐", `${ign} awarded Tournament MVP!`);
    } catch (e) {
        console.error(e);
        alert("Failed to save MVP: " + e.message);
    }
};

window.handleTournamentFormatChange = async function(newFormat) {
    if (!currentEditingTournament) return;
    try {
        await updateDoc(doc(db, "tournaments", currentEditingTournament.id), {
            format: newFormat
        });
        currentEditingTournament.format = newFormat;
        const formatBadge = document.getElementById('detailFormatBadge');
        if (formatBadge) formatBadge.textContent = newFormat;
        
        const orgSelect = document.getElementById('organizerFormatSelect');
        if (orgSelect) orgSelect.value = newFormat;

        renderBracket(currentEditingTournament.participants || [], newFormat, true, currentEditingTournament.isStarted);
        if (window.showSuccessToast) window.showSuccessToast("Format Updated", `Bracket type changed to ${newFormat}`);
    } catch (e) {
        console.error("Failed to update format:", e);
        alert("Failed to update format: " + e.message);
    }
};

// --- WINDOW EXPOSURES ---
window.handleMatchCardClick = handleMatchCardClick;
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
window.openEditTournamentModal = openEditTournamentModal;
window.zoomBracket = zoomBracket;
window.resetBracketZoom = resetBracketZoom;
window.applyBracketZoom = applyBracketZoom;
window.toggleBracketFullscreen = toggleBracketFullscreen;
window.openEditScheduleModal = openEditScheduleModal;
window.addScheduleStageRow = addScheduleStageRow;
window.saveTournamentSchedule = saveTournamentSchedule;
window.fetchTournaments = fetchTournaments;
window.renderTournaments = renderTournaments;

// Feature Suite Window Exports
window.toggleTournamentCheckIn = toggleTournamentCheckIn;
window.handleCaptainCheckIn = handleCaptainCheckIn;
window.checkInAllTeams = checkInAllTeams;
window.dropUnreadyTeams = dropUnreadyTeams;
window.openMapVetoFromScoreModal = openMapVetoFromScoreModal;
window.openMapVetoForMatch = openMapVetoForMatch;
window.executeCoinToss = executeCoinToss;
window.handleMapVetoAction = handleMapVetoAction;
window.finalizeMapSide = finalizeMapSide;
window.handleScoreProofSelect = handleScoreProofSelect;
window.clearScoreProof = clearScoreProof;
window.viewCurrentScoreProof = viewCurrentScoreProof;
window.viewMatchScreenshot = viewMatchScreenshot;
window.closeScreenshotViewer = closeScreenshotViewer;
window.declareCurrentMatchForfeit = declareCurrentMatchForfeit;
window.openPayoutClaimModal = openPayoutClaimModal;
window.updateClaimModalPrizeDisplay = updateClaimModalPrizeDisplay;
window.saveWinnerPayoutClaim = saveWinnerPayoutClaim;
window.openDisbursePayoutModal = openDisbursePayoutModal;
window.confirmDisbursement = confirmDisbursement;
window.markPayoutDisbursed = markPayoutDisbursed;
window.openAwardMvpModal = openAwardMvpModal;
window.saveTournamentMvp = saveTournamentMvp;
window.toggleSingleTeamCheckIn = toggleSingleTeamCheckIn;
window.openCoOrganizersModal = openCoOrganizersModal;
window.saveTournamentStaff = saveTournamentStaff;
window.removeTournamentStaff = removeTournamentStaff;

window.openEntryFeeProofViewer = function(url) {
    const modal = document.getElementById('proofViewerModal');
    const img   = document.getElementById('proofViewerImg');
    if (!modal || !img) return;
    img.src = url;
    modal.style.display = 'flex';
};

window.closeProofViewerModal = function() {
    const modal = document.getElementById('proofViewerModal');
    if (modal) modal.style.display = 'none';
};

window.closeModal = (id) => {
    const modal = document.getElementById(id);
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }
    if (id === 'detailsModal') {
        const bracketSection = document.getElementById('bracketSection');
        if (bracketSection && bracketSection.classList.contains('bracket-fullscreen-mode')) {
            toggleBracketFullscreen();
        }
        if (tournamentUnsubscribe) {
            tournamentUnsubscribe();
            tournamentUnsubscribe = null;
        }
        if (typeof window.clearTournamentUrl === 'function') {
            window.clearTournamentUrl();
        }
        document.body.style.overflow = '';
        document.documentElement.style.overflow = '';
    }
};

// --- BANNER FRAMING & ASPECT RATIO ADJUSTMENT SUITE ---
window._tournamentBannerFile = null;
window.handleTournamentBannerSelect = function(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    processTournamentBannerFile(file);
};

window.handleTournamentBannerDrop = function(event) {
    event.preventDefault();
    const dropzone = qs('#c-banner-dropzone');
    if (dropzone) dropzone.style.borderColor = 'rgba(255,255,255,0.15)';
    const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
    if (!file) return;
    processTournamentBannerFile(file);
};

function processTournamentBannerFile(file) {
    if (!file.type.startsWith('image/')) {
        if (window.showToast) window.showToast('Invalid File', 'Please upload a valid image file (PNG, JPG, WEBP, GIF).', 'error');
        return;
    }
    if (file.size > 15 * 1024 * 1024) {
        if (window.showToast) window.showToast('File Too Large', 'Banner image must be under 15MB.', 'error');
        return;
    }

    window._tournamentBannerFile = file;

    const reader = new FileReader();
    reader.onload = (e) => {
        const previewUrl = e.target.result;
        const bannerInput = qs('#c-banner');
        const filenameEl = qs('#c-banner-filename');
        const previewImg = qs('#c-banner-preview-img');
        const dropzone = qs('#c-banner-dropzone');

        if (bannerInput) bannerInput.value = previewUrl;
        if (filenameEl) filenameEl.textContent = `Selected: ${file.name}`;
        if (previewImg) previewImg.src = previewUrl;
        if (dropzone) {
            dropzone.classList.remove('border-white/15');
            dropzone.classList.add('border-emerald-500/50', 'bg-emerald-500/5');
        }
    };
    reader.readAsDataURL(file);
}
window.processTournamentBannerFile = processTournamentBannerFile;

window._adjustBannerFile = null;
window.handleAdjustBannerFileSelect = function(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
        if (window.showToast) window.showToast('Invalid File', 'Please upload a valid image file.', 'error');
        return;
    }
    window._adjustBannerFile = file;
    const reader = new FileReader();
    reader.onload = (e) => {
        const previewImg = document.getElementById('adjustBannerPreviewImg');
        if (previewImg) previewImg.src = e.target.result;
    };
    reader.readAsDataURL(file);
};

window.updateCreateModalBannerPreview = function() {
    const bannerUrl = qs('#c-banner')?.value || 'pictures/cz_logo.png';
    const posY = qs('#c-banner-pos-y')?.value || 50;
    const fit = qs('#c-banner-fit')?.value || 'cover';
    const display = qs('#c-banner-pos-display');
    const img = qs('#c-banner-preview-img');
    
    if (display) {
        let label = 'Center (50%)';
        if (posY < 35) label = `Top (${posY}%)`;
        else if (posY > 65) label = `Bottom (${posY}%)`;
        else label = `Center (${posY}%)`;
        display.textContent = `${label} • ${fit.toUpperCase()}`;
    }
    if (img) {
        img.src = bannerUrl;
        img.style.objectPosition = `50% ${posY}%`;
        img.style.objectFit = fit;
    }
};

window.openAdjustBannerModal = function() {
    const t = currentEditingTournament;
    if (!t) return;
    const modal = document.getElementById('adjustBannerModal');
    const previewImg = document.getElementById('adjustBannerPreviewImg');
    if (!modal || !previewImg) return;

    window._adjustBannerFile = null;
    const fileInput = document.getElementById('adjustBannerFileInput');
    if (fileInput) fileInput.value = '';

    previewImg.src = t.banner || 'pictures/cz_logo.png';

    let y = 50;
    if (t.bannerPosition) {
        const matches = t.bannerPosition.match(/(\d+)%/g);
        if (matches && matches.length >= 2) y = parseInt(matches[1]);
        else if (matches && matches[0]) y = parseInt(matches[0]);
    }

    const fit = t.bannerFit || 'cover';
    const scale = Math.round((t.bannerScale || 1) * 100);

    const yRange = document.getElementById('bannerYRange');
    const fitSelect = document.getElementById('bannerFitSelect');
    const scaleRange = document.getElementById('bannerScaleRange');

    if (yRange) yRange.value = y;
    if (fitSelect) fitSelect.value = fit;
    if (scaleRange) scaleRange.value = scale;

    window.updateBannerFramingPreview();

    modal.classList.remove('hidden');
    modal.classList.add('flex');
};

window.updateBannerFramingPreview = function() {
    const previewImg = document.getElementById('adjustBannerPreviewImg');
    const yRange = document.getElementById('bannerYRange');
    const fitSelect = document.getElementById('bannerFitSelect');
    const scaleRange = document.getElementById('bannerScaleRange');

    const y = yRange ? yRange.value : 50;
    const fit = fitSelect ? fitSelect.value : 'cover';
    const scale = scaleRange ? scaleRange.value : 100;

    const yVal = document.getElementById('bannerYVal');
    const scaleVal = document.getElementById('bannerScaleVal');

    if (yVal) yVal.textContent = `${y}%`;
    if (scaleVal) scaleVal.textContent = `${scale}%`;

    if (previewImg) {
        previewImg.style.objectPosition = `50% ${y}%`;
        previewImg.style.objectFit = fit;
        previewImg.style.transform = `scale(${scale / 100})`;
        previewImg.style.transformOrigin = `50% ${y}%`;
    }
};

window.setBannerPreset = function(preset) {
    const yRange = document.getElementById('bannerYRange');
    const fitSelect = document.getElementById('bannerFitSelect');

    if (fitSelect) fitSelect.value = 'cover';

    if (preset === 'center top' && yRange) yRange.value = 10;
    else if (preset === 'center center' && yRange) yRange.value = 50;
    else if (preset === 'center bottom' && yRange) yRange.value = 90;

    window.updateBannerFramingPreview();
};

window.setBannerFitPreset = function(fitMode) {
    const fitSelect = document.getElementById('bannerFitSelect');
    if (fitSelect) fitSelect.value = fitMode;
    window.updateBannerFramingPreview();
};

window.saveBannerFraming = async function() {
    if (!currentEditingTournament) return;
    const y = document.getElementById('bannerYRange')?.value || 50;
    const fit = document.getElementById('bannerFitSelect')?.value || 'cover';
    const scale = (Number(document.getElementById('bannerScaleRange')?.value) || 100) / 100;
    const position = `50% ${y}%`;

    try {
        let newBannerUrl = currentEditingTournament.banner;
        if (window._adjustBannerFile) {
            const tourneyFolder = (currentEditingTournament.name || 'tournament').trim().replace(/[^a-zA-Z0-9_-]/g, '_');
            const fileRef = storageRef(storage, `tournament-banners/${tourneyFolder}/${Date.now()}_${window._adjustBannerFile.name}`);
            const snapshot = await uploadBytes(fileRef, window._adjustBannerFile);
            newBannerUrl = await getDownloadURL(snapshot.ref);
            window._adjustBannerFile = null;
        }

        const updateData = {
            bannerPosition: position,
            bannerFit: fit,
            bannerScale: scale,
            ...(newBannerUrl && { banner: newBannerUrl })
        };

        await updateDoc(doc(db, "tournaments", currentEditingTournament.id), updateData);

        currentEditingTournament.bannerPosition = position;
        currentEditingTournament.bannerFit = fit;
        currentEditingTournament.bannerScale = scale;
        if (newBannerUrl) currentEditingTournament.banner = newBannerUrl;

        const mainBannerImg = document.getElementById('tournamentBannerImg');
        if (mainBannerImg) {
            if (newBannerUrl) mainBannerImg.src = newBannerUrl;
            mainBannerImg.style.objectPosition = position;
            mainBannerImg.style.objectFit = fit;
            mainBannerImg.style.transform = `scale(${scale})`;
            mainBannerImg.style.transformOrigin = position;
        }

        window.closeModal('adjustBannerModal');
        if (window.showSuccessToast) window.showSuccessToast("Framing Saved!", "Tournament banner framing updated.");
    } catch (e) {
        console.error("Save banner framing error:", e);
        alert("Failed to save banner framing: " + e.message);
    }
};

// --- PRIZE TIER PRESETS & DYNAMIC SPLIT SUITE ---
window.updatePresetButtonsState = function(preset) {
    ['tierBtn-wta', 'tierBtn-top2', 'tierBtn-top3', 'tierBtn-custom'].forEach(id => {
        const btn = document.getElementById(id);
        if (btn) {
            btn.className = "px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-neutral-300 text-[10px] font-bold uppercase transition-all cursor-pointer text-center truncate";
        }
    });

    const activeBtnId = preset === 'winner_takes_all' ? 'tierBtn-wta' : (preset === 'top_2' ? 'tierBtn-top2' : (preset === 'top_3' ? 'tierBtn-top3' : 'tierBtn-custom'));
    const activeBtn = document.getElementById(activeBtnId);
    if (activeBtn) {
        activeBtn.className = "px-2.5 py-1.5 rounded-lg bg-[#FFD700] text-black border border-[#FFD700] text-[10px] font-extrabold uppercase transition-all cursor-pointer text-center truncate shadow-sm";
    }
};

window.addNextPrizeTier = function() {
    const wrap2 = document.getElementById('prizeInputWrap-2nd');
    const wrap3 = document.getElementById('prizeInputWrap-3rd');
    const in1 = document.getElementById('c-prize-1st');
    const in2 = document.getElementById('c-prize-2nd');
    const in3 = document.getElementById('c-prize-3rd');
    const addBtnWrap = document.getElementById('addPrizeTierWrap');

    if (wrap2 && wrap2.classList.contains('hidden')) {
        wrap2.classList.remove('hidden');
        if (Number(in2.value) === 0) {
            in2.value = 30;
            if (Number(in1.value) === 100) in1.value = 70;
            else in1.value = Math.max(0, Number(in1.value) - 30);
        }
        window.updatePresetButtonsState('top_2');
    } else if (wrap3 && wrap3.classList.contains('hidden')) {
        wrap3.classList.remove('hidden');
        if (Number(in3.value) === 0) {
            in3.value = 10;
            if (Number(in1.value) >= 70 && Number(in2.value) === 30) {
                in1.value = 60;
                in2.value = 30;
            } else {
                in1.value = Math.max(0, Number(in1.value) - 10);
            }
        }
        window.updatePresetButtonsState('top_3');
    }

    const is2ndVisible = wrap2 && !wrap2.classList.contains('hidden');
    const is3rdVisible = wrap3 && !wrap3.classList.contains('hidden');
    if (addBtnWrap) {
        addBtnWrap.classList.toggle('hidden', is2ndVisible && is3rdVisible);
    }

    window.handlePrizeSplitInput();
};

window.removePrizeTier = function(tierNum) {
    const wrap = document.getElementById(`prizeInputWrap-${tierNum === 2 ? '2nd' : '3rd'}`);
    const input = document.getElementById(`c-prize-${tierNum === 2 ? '2nd' : '3rd'}`);
    const in1 = document.getElementById('c-prize-1st');
    const addBtnWrap = document.getElementById('addPrizeTierWrap');

    if (wrap) wrap.classList.add('hidden');
    const removedVal = Number(input?.value) || 0;
    if (input) input.value = 0;
    if (in1) in1.value = Math.min(100, (Number(in1.value) || 0) + removedVal);

    if (addBtnWrap) addBtnWrap.classList.remove('hidden');

    const wrap2 = document.getElementById('prizeInputWrap-2nd');
    const wrap3 = document.getElementById('prizeInputWrap-3rd');
    const is2ndVisible = wrap2 && !wrap2.classList.contains('hidden');
    const is3rdVisible = wrap3 && !wrap3.classList.contains('hidden');

    if (!is2ndVisible && !is3rdVisible) {
        window.updatePresetButtonsState('winner_takes_all');
    } else if (is2ndVisible && !is3rdVisible) {
        window.updatePresetButtonsState('top_2');
    } else {
        window.updatePresetButtonsState('custom');
    }

    window.handlePrizeSplitInput();
};

window.setPrizeTierPreset = function(preset) {
    const in1 = document.getElementById('c-prize-1st');
    const in2 = document.getElementById('c-prize-2nd');
    const in3 = document.getElementById('c-prize-3rd');
    const wrap2 = document.getElementById('prizeInputWrap-2nd');
    const wrap3 = document.getElementById('prizeInputWrap-3rd');
    const addBtnWrap = document.getElementById('addPrizeTierWrap');

    window.updatePresetButtonsState(preset);

    if (preset === 'winner_takes_all') {
        if (in1) in1.value = 100;
        if (in2) in2.value = 0;
        if (in3) in3.value = 0;
        if (wrap2) wrap2.classList.add('hidden');
        if (wrap3) wrap3.classList.add('hidden');
        if (addBtnWrap) addBtnWrap.classList.remove('hidden');
    } else if (preset === 'top_2') {
        if (in1) in1.value = 70;
        if (in2) in2.value = 30;
        if (in3) in3.value = 0;
        if (wrap2) wrap2.classList.remove('hidden');
        if (wrap3) wrap3.classList.add('hidden');
        if (addBtnWrap) addBtnWrap.classList.remove('hidden');
    } else if (preset === 'top_3') {
        if (in1) in1.value = 60;
        if (in2) in2.value = 30;
        if (in3) in3.value = 10;
        if (wrap2) wrap2.classList.remove('hidden');
        if (wrap3) wrap3.classList.remove('hidden');
        if (addBtnWrap) addBtnWrap.classList.add('hidden');
    } else {
        if (wrap2) wrap2.classList.remove('hidden');
        if (addBtnWrap) addBtnWrap.classList.remove('hidden');
    }

    window.handlePrizeSplitInput();
};

window.handlePrizeSplitInput = function() {
    const pool = Number(document.getElementById('c-prize')?.value) || 0;
    const in1 = document.getElementById('c-prize-1st');
    const in2 = document.getElementById('c-prize-2nd');
    const in3 = document.getElementById('c-prize-3rd');
    const wrap2 = document.getElementById('prizeInputWrap-2nd');
    const wrap3 = document.getElementById('prizeInputWrap-3rd');

    const s1 = Number(in1?.value) || 0;
    const s2 = (wrap2 && !wrap2.classList.contains('hidden')) ? (Number(in2?.value) || 0) : 0;
    const s3 = (wrap3 && !wrap3.classList.contains('hidden')) ? (Number(in3?.value) || 0) : 0;

    const sum = s1 + s2 + s3;
    const sumDisplay = document.getElementById('c-prize-split-sum');
    if (sumDisplay) {
        if (sum === 100) {
            sumDisplay.textContent = 'Total: 100%';
            sumDisplay.className = 'text-[10px] font-mono-tag text-emerald-400 font-bold';
        } else {
            sumDisplay.textContent = `Total: ${sum}% (Must equal 100%)`;
            sumDisplay.className = 'text-[10px] font-mono-tag text-amber-400 font-bold animate-pulse';
        }
    }

    const c1 = document.getElementById('prizeCalc-1st');
    const c2 = document.getElementById('prizeCalc-2nd');
    const c3 = document.getElementById('prizeCalc-3rd');

    if (c1) c1.textContent = `₱${Math.round(pool * (s1 / 100)).toLocaleString()}`;
    if (c2) c2.textContent = `₱${Math.round(pool * (s2 / 100)).toLocaleString()}`;
    if (c3) c3.textContent = `₱${Math.round(pool * (s3 / 100)).toLocaleString()}`;
};

// --- TOURNAMENT PRIZE POOL & PODIUM SPLIT EDITING ---
window.openEditPrizeModal = function (tId) {
    let t = null;
    if (tId && typeof tId === 'string') {
        t = (allTournaments && allTournaments.find(item => item.id === tId)) || currentEditingTournament;
    } else {
        t = currentEditingTournament || window.currentEditingTournament || (allTournaments && allTournaments.find(item => item.id === window._currentTournamentId));
    }
    if (!t) return;

    const idInput = document.getElementById('edit-prize-tourney-id');
    const totalInput = document.getElementById('edit-prize-total-input');
    const currSelect = document.getElementById('edit-prize-currency-select');
    const in1 = document.getElementById('edit-prize-1st-input');
    const in2 = document.getElementById('edit-prize-2nd-input');
    const in3 = document.getElementById('edit-prize-3rd-input');

    if (idInput) idInput.value = t.id;
    if (totalInput) totalInput.value = t.prize || 0;
    if (currSelect) currSelect.value = t.entryCurrency || 'PHP';

    const split = t.prizeSplit || { first: 100, second: 0, third: 0 };
    const s1 = split.first !== undefined ? Number(split.first) : 100;
    const s2 = split.second !== undefined ? Number(split.second) : 0;
    const s3 = split.third !== undefined ? Number(split.third) : 0;

    if (in1) in1.value = s1;
    if (in2) in2.value = s2;
    if (in3) in3.value = s3;

    if (s1 === 100 && s2 === 0 && s3 === 0) {
        window.setEditPrizePresetStyle('winner_takes_all');
    } else if (s1 === 70 && s2 === 30 && s3 === 0) {
        window.setEditPrizePresetStyle('top_2');
    } else if (s1 === 60 && s2 === 30 && s3 === 10) {
        window.setEditPrizePresetStyle('top_3');
    } else {
        window.setEditPrizePresetStyle('custom');
    }

    window.handleEditPrizeSplitInput();
    window.openModal('editPrizeModal');
};

window.setEditPrizePresetStyle = function (preset) {
    const pWinner = document.getElementById('edit-preset-winner');
    const pTop2 = document.getElementById('edit-preset-top2');
    const pTop3 = document.getElementById('edit-preset-top3');
    const pCustom = document.getElementById('edit-preset-custom');

    const resetStyle = (el) => {
        if (!el) return;
        el.className = 'p-2 rounded-lg bg-white/5 hover:bg-white/10 text-neutral-300 font-bold uppercase transition-all border border-white/10 cursor-pointer text-center';
    };
    const activeStyle = (el) => {
        if (!el) return;
        el.className = 'p-2 rounded-lg bg-[#FFD700] text-black font-bold uppercase transition-all cursor-pointer text-center shadow-sm';
    };

    [pWinner, pTop2, pTop3, pCustom].forEach(resetStyle);

    if (preset === 'winner_takes_all') activeStyle(pWinner);
    else if (preset === 'top_2') activeStyle(pTop2);
    else if (preset === 'top_3') activeStyle(pTop3);
    else activeStyle(pCustom);
};

window.setEditPrizePreset = function (preset) {
    const in1 = document.getElementById('edit-prize-1st-input');
    const in2 = document.getElementById('edit-prize-2nd-input');
    const in3 = document.getElementById('edit-prize-3rd-input');

    if (preset === 'winner_takes_all') {
        if (in1) in1.value = 100;
        if (in2) in2.value = 0;
        if (in3) in3.value = 0;
    } else if (preset === 'top_2') {
        if (in1) in1.value = 70;
        if (in2) in2.value = 30;
        if (in3) in3.value = 0;
    } else if (preset === 'top_3') {
        if (in1) in1.value = 60;
        if (in2) in2.value = 30;
        if (in3) in3.value = 10;
    }

    window.setEditPrizePresetStyle(preset);
    window.handleEditPrizeSplitInput();
};

window.handleEditPrizeSplitInput = function () {
    const pool = Number(document.getElementById('edit-prize-total-input')?.value) || 0;
    const currency = document.getElementById('edit-prize-currency-select')?.value || 'PHP';
    const sym = currency === 'USD' ? '$' : '₱';

    const in1 = document.getElementById('edit-prize-1st-input');
    const in2 = document.getElementById('edit-prize-2nd-input');
    const in3 = document.getElementById('edit-prize-3rd-input');

    const s1 = Number(in1?.value) || 0;
    const s2 = Number(in2?.value) || 0;
    const s3 = Number(in3?.value) || 0;

    const sum = s1 + s2 + s3;
    const sumDisplay = document.getElementById('edit-prize-split-sum');
    if (sumDisplay) {
        if (sum === 100) {
            sumDisplay.textContent = 'Total: 100%';
            sumDisplay.className = 'text-[10px] font-mono-tag text-emerald-400 font-bold';
        } else {
            sumDisplay.textContent = `Total: ${sum}% (Must equal 100%)`;
            sumDisplay.className = 'text-[10px] font-mono-tag text-amber-400 font-bold animate-pulse';
        }
    }

    const c1 = document.getElementById('edit-prize-calc-1st');
    const c2 = document.getElementById('edit-prize-calc-2nd');
    const c3 = document.getElementById('edit-prize-calc-3rd');

    if (c1) c1.textContent = `${sym}${Math.round(pool * (s1 / 100)).toLocaleString()}`;
    if (c2) c2.textContent = `${sym}${Math.round(pool * (s2 / 100)).toLocaleString()}`;
    if (c3) c3.textContent = `${sym}${Math.round(pool * (s3 / 100)).toLocaleString()}`;
};

window.saveTournamentPrize = async function (event) {
    if (event && event.preventDefault) event.preventDefault();

    const tId = document.getElementById('edit-prize-tourney-id')?.value;
    const newPrize = Number(document.getElementById('edit-prize-total-input')?.value) || 0;
    const currency = document.getElementById('edit-prize-currency-select')?.value || 'PHP';

    const s1 = Number(document.getElementById('edit-prize-1st-input')?.value) || 0;
    const s2 = Number(document.getElementById('edit-prize-2nd-input')?.value) || 0;
    const s3 = Number(document.getElementById('edit-prize-3rd-input')?.value) || 0;

    if (!tId) {
        if (window.showErrorToast) window.showErrorToast("Error", "No tournament selected.");
        return;
    }

    const sum = s1 + s2 + s3;
    if (sum !== 100) {
        if (window.showWarningToast) window.showWarningToast("Invalid Split", `Prize percentages sum to ${sum}%. They must equal exactly 100%.`);
        return;
    }

    const submitBtn = document.getElementById('edit-prize-submit-btn');
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Saving...';
    }

    try {
        const tRef = doc(db, "tournaments", tId);
        const updateData = {
            prize: newPrize,
            entryCurrency: currency,
            prizeSplit: {
                first: s1,
                second: s2,
                third: s3
            },
            updatedAt: new Date().toISOString()
        };

        await updateDoc(tRef, updateData);

        // Update local object
        if (currentEditingTournament && currentEditingTournament.id === tId) {
            currentEditingTournament.prize = newPrize;
            currentEditingTournament.entryCurrency = currency;
            currentEditingTournament.prizeSplit = updateData.prizeSplit;
        }

        if (allTournaments) {
            const idx = allTournaments.findIndex(item => item.id === tId);
            if (idx !== -1) {
                allTournaments[idx].prize = newPrize;
                allTournaments[idx].entryCurrency = currency;
                allTournaments[idx].prizeSplit = updateData.prizeSplit;
            }
        }

        window.closeModal('editPrizeModal');

        // Re-render prize displays
        renderPrizeBreakdown(currentEditingTournament || { prize: newPrize, prizeSplit: updateData.prizeSplit });
        const detailPrizeEl = document.getElementById('detailPrize');
        if (detailPrizeEl) {
            detailPrizeEl.textContent = `₱${newPrize.toLocaleString()}`;
        }
        const orgPayoutPrizeEl = document.getElementById('orgPayoutPrize');
        if (orgPayoutPrizeEl) {
            orgPayoutPrizeEl.textContent = `₱${newPrize.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
        }

        if (window.showSuccessToast) {
            window.showSuccessToast("Prize Updated! 💰", `Total prize pool set to ₱${newPrize.toLocaleString()}`);
        }
    } catch (err) {
        console.error("Error saving tournament prize:", err);
        if (window.showErrorToast) window.showErrorToast("Save Failed", err.message || "Failed to update prize pool.");
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Save Prize Pool';
        }
    }
};

// --- TOURNAMENT RULES MANAGEMENT & PRESETS ---
const RULES_PRESETS = {
    standard: `1. Match Check-In: All teams and players must check in at least 15 minutes before their scheduled match time. Failure to check in will result in an automatic match forfeit.
2. Rosters & Substitutions: Only officially registered roster members are eligible to compete. No unregistered ringers or unauthorized substitutions are permitted once brackets are generated.
3. Map Pick / Bans: High seed chooses starting side or first map ban. Subsequent bans and picks alternate between teams.
4. Technical Pauses: Each team is entitled to up to 10 minutes of technical pause per series. Pauses must be announced immediately in match chat.
5. Score Reporting: The winning captain must capture an end-of-game victory scoreboard screenshot and report the score in the match portal.
6. Code of Conduct: Cheating, glitch exploits, hate speech, or unsportsmanlike behavior will lead to immediate tournament disqualification.`,

    fps: `1. Lobby Settings: Official Tournament Mode, Overtime: Win by 2, Cheats: OFF.
2. Side Selection: Higher seed selects starting side (Attack / Defend).
3. Tactical Timeouts: Up to 2 tactical timeouts (60 seconds each) allowed per team per map.
4. Disconnect Policy: If a player disconnects before first blood in round 1, round may be reloaded upon marshal confirmation.
5. Anti-Cheat & Proof: Third-party overlays, macro scripts, or unauthorized software will result in an instant ban. Endgame scoreboard screenshot required.`,

    moba: `1. Game Mode: Custom 5v5 Draft Pick.
2. Hero Restrictions: All official draft bans must be followed. Newly released heroes are prohibited for 14 days from tournament date.
3. Pause Rules: Maximum 5 minutes total pause time per team for hardware or connectivity issues.
4. Victory Condition: The team that destroys the enemy Core / Ancient / Base claims the win.
5. Disputes: In case of match disputes or bugs, pause immediately and ping the Tournament Marshal. Marshal decisions are final.`,

    duel: `1. Format: 1v1 Custom Duel Arena (BO1 for qualifying rounds, BO3 for semifinals & finals).
2. Punctuality: 10-minute maximum grace period from match call.
3. Arena Boundaries: Primary duel lane only (no outside jungle farming or side-lane stalling).
4. Victory Condition: First to score 2 kills OR first to destroy the first turret/tower.
5. Proof Submission: The winner must submit an undisputed victory screenshot immediately following the match.`
};

function openEditRulesModal(t) {
    if (typeof t === 'string') {
        t = (allTournaments && allTournaments.find(item => item.id === t)) || currentEditingTournament || window.currentEditingTournament;
    } else if (!t) {
        t = currentEditingTournament || window.currentEditingTournament || (allTournaments && allTournaments.find(item => item.id === window._currentTournamentId));
    }
    if (!t) return;

    window._rulesTargetTournamentId = t.id;
    const textarea = document.getElementById('editRulesTextarea');
    if (textarea) {
        textarea.value = t.rules || '';
    }

    const modal = document.getElementById('editRulesModal');
    if (modal) {
        modal.classList.remove('hidden');
        modal.classList.add('flex');
    }
}
window.openEditRulesModal = openEditRulesModal;

function applyRulesPreset(type) {
    const textarea = document.getElementById('editRulesTextarea');
    if (textarea && RULES_PRESETS[type]) {
        textarea.value = RULES_PRESETS[type];
        textarea.focus();
    }
}
window.applyRulesPreset = applyRulesPreset;

function insertCreateRulesTemplate() {
    const textarea = document.getElementById('c-rules');
    if (textarea) {
        textarea.value = RULES_PRESETS.standard;
        textarea.focus();
    }
}
window.insertCreateRulesTemplate = insertCreateRulesTemplate;

async function saveTournamentRules() {
    const tourneyId = window._rulesTargetTournamentId || window._currentTournamentId || (window.currentEditingTournament && window.currentEditingTournament.id);
    if (!tourneyId) {
        if (window.showToast) window.showToast('Error', 'Tournament not found.', 'error');
        return;
    }

    const textarea = document.getElementById('editRulesTextarea');
    const rulesText = textarea ? textarea.value.trim() : '';
    const submitBtn = document.getElementById('saveRulesSubmitBtn');

    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Saving...';
    }

    try {
        await updateDoc(doc(db, 'tournaments', tourneyId), {
            rules: rulesText,
            updatedAt: serverTimestamp()
        });

        // Update local memory objects
        if (window.currentEditingTournament && window.currentEditingTournament.id === tourneyId) {
            window.currentEditingTournament.rules = rulesText;
        }
        if (allTournaments) {
            const found = allTournaments.find(x => x.id === tourneyId);
            if (found) found.rules = rulesText;
        }

        // Update UI DOM
        const rulesContent = qs('#tournamentRulesContent');
        if (rulesContent) {
            if (rulesText) {
                rulesContent.textContent = rulesText;
            } else {
                rulesContent.innerHTML = `<span class="text-neutral-500 italic">No custom rules added yet. Click <strong>Edit Rules</strong> above to set match regulations, pick/ban policies, or disqualification rules.</span>`;
            }
        }

        if (window.showSuccessToast) window.showSuccessToast('Rules Updated', 'Tournament rules updated successfully!');
        if (window.closeModal) window.closeModal('editRulesModal');
    } catch (err) {
        console.error('Failed to save tournament rules:', err);
        if (window.showToast) window.showToast('Error', 'Failed to save rules: ' + err.message, 'error');
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Save Rules';
        }
    }
}
window.saveTournamentRules = saveTournamentRules;

function filterRulesSearch(query) {
    const rulesContent = qs('#tournamentRulesContent');
    if (!rulesContent) return;
    const q = (query || '').toLowerCase().trim();
    const t = currentEditingTournament || window.currentEditingTournament || (allTournaments && allTournaments.find(item => item.id === window._currentTournamentId));
    const fullRules = (t && t.rules) ? t.rules.trim() : '';

    if (!q) {
        rulesContent.textContent = fullRules || 'No custom rules configured yet.';
        return;
    }

    const lines = fullRules.split('\n');
    const matchingLines = lines.filter(l => l.toLowerCase().includes(q));
    if (matchingLines.length > 0) {
        rulesContent.innerHTML = matchingLines.map(l => {
            const regex = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
            const highlighted = escapeHtml(l).replace(regex, '<mark class="bg-[#FFD700] text-black px-1 rounded font-bold">$1</mark>');
            return `<div class="py-1 border-b border-white/5 last:border-0">${highlighted}</div>`;
        }).join('');
    } else {
        rulesContent.innerHTML = `<div class="text-neutral-500 italic py-4 text-center">No rules matching "${escapeHtml(q)}" found. Clear search to view complete rulebook.</div>`;
    }
}
window.filterRulesSearch = filterRulesSearch;

// Global Window Exports for Event Handlers
window.openJoinForm = openJoinForm;
window.submitJoinRequest = submitJoinRequest;
window.withdrawApplication = withdrawApplication;
window.startTournament = startTournament;
window.resetTournament = resetTournament;
window.deleteTournament = deleteTournament;
window.toggleCancelTournament = window.toggleCancelTournament;
window.openEditTournamentModal = openEditTournamentModal;
window.createTournament = typeof handleCreateTournament === 'function' ? handleCreateTournament : null;
window.handleCreateTournament = typeof handleCreateTournament === 'function' ? handleCreateTournament : null;
window.renderParticipantsList = renderParticipantsList;
window.renderSoloQueueList = renderSoloQueueList;
window.addNextPrizeTier = window.addNextPrizeTier;
window.removePrizeTier = window.removePrizeTier;
window.updatePresetButtonsState = window.updatePresetButtonsState;
window.getRoundFormat = getRoundFormat;
window.getTournamentRoundKeys = getTournamentRoundKeys;
window.openEditRoundFormatsModal = openEditRoundFormatsModal;
window.applyRoundFormatPreset = applyRoundFormatPreset;
window.saveTournamentRoundFormats = saveTournamentRoundFormats;
window.quickEditRoundFormat = window.quickEditRoundFormat;
window.handleScoreMatchFormatChange = window.handleScoreMatchFormatChange;
window.goToCreateStep = goToCreateStep;
window.nextCreateStep = nextCreateStep;
window.prevCreateStep = prevCreateStep;
window.validateCurrentCreateStep = validateCurrentCreateStep;
window.syncCreateWizardSummary = syncCreateWizardSummary;
window.setTournamentScope = setTournamentScope;
window.renderPayoutsTab = renderPayoutsTab;
window.renderTournamentRankings = renderTournamentRankings;
window.renderPodiumShowcase = renderPodiumShowcase;
window.isUserWinnerOrStaff = isUserWinnerOrStaff;
window.openEditPrizeModal = window.openEditPrizeModal;
window.saveTournamentPrize = window.saveTournamentPrize;
window.setEditPrizePreset = window.setEditPrizePreset;
window.handleEditPrizeSplitInput = window.handleEditPrizeSplitInput;