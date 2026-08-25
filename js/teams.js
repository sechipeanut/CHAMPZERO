import { db, auth } from './firebase-config.js';
import {
    collection, getDocs, doc, addDoc, updateDoc, deleteDoc,
    serverTimestamp, arrayUnion, arrayRemove, getDoc, onSnapshot, query, orderBy, collectionGroup, where, setDoc, increment,
    runTransaction, limit, Timestamp
} from "https://www.gstatic.com/firebasejs/11.1.0/firebase-firestore.js";
import { uploadImage } from './utils.js';

function qs(sel) { return document.querySelector(sel); }
function escapeHtml(str) { if (!str) return ''; return String(str).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])); }

function formatGameBadge(game) {
    if (!game) return 'ESPORTS';
    const g = String(game).trim().toLowerCase();
    if (g === 'valid' || g === 'val' || g === 'valorant') return 'VALORANT';
    if (g === 'mlbbid' || g === 'mlbb' || g.includes('mobile legends') || g.includes('bang bang')) return 'MLBB';
    if (g === 'hokid' || g === 'hok' || g.includes('honor of kings')) return 'HONOR OF KINGS';
    return String(game).toUpperCase();
}

function formatGameTitle(game) {
    if (!game) return 'All Games';
    const g = String(game).trim().toLowerCase();
    if (g === 'valid' || g === 'val' || g === 'valorant') return 'Valorant';
    if (g === 'mlbbid' || g === 'mlbb' || g.includes('mobile legends') || g.includes('bang bang')) return 'Mobile Legends: Bang Bang';
    if (g === 'hokid' || g === 'hok' || g.includes('honor of kings')) return 'Honor of Kings';
    return game;
}

const displayNameCache = new Map();

async function getUserDisplayName(uid, fallbackName) {
    const fallback = fallbackName || 'Player';
    if (!uid) return fallback;
    if (displayNameCache.has(uid)) return displayNameCache.get(uid);

    try {
        const snap = await getDoc(doc(db, "users", uid));
        const resolved = snap.exists()
            ? (snap.data().displayName || snap.data().name || snap.data().ign || snap.data().username || fallback)
            : fallback;
        displayNameCache.set(uid, resolved);
        return resolved;
    } catch {
        return fallback;
    }
}

// --- FEATURE FLAGS ---
const TEAM_RECRUITMENT_ENABLED = true; // Set to true to enable everyone to create a team

let currentUserRole = null;
let chatUnsubscribe = null;
let kickUnsubscribe = null;
let currentManageId = null;
let myTeamRole = null;
let activeTeamFilter = 'available';
let activeGameFilter = 'all';
let activeRosterFilter = 'all';
let activeRoleFilter = 'all';
let activeView = 'teams';
let searchTerm = '';
let cachedRecruitmentPosts = [];

// SCRIM MATCHMAKING BOARD STATE
let scrimsUnsubscribe = null;
let activeScrimsList = [];
let scrimGameFilter = 'all';
let scrimFormatFilter = 'all';
let scrimRankFilter = 'all';
let scrimSearchQuery = '';

// STORE CARD LISTENERS TO CLEAN UP LATER
let cardListeners = [];

// --- 1. ANIMATION HELPERS ---
function animateGenericOpen(modalId, backdropId, panelId) {
    const modal = document.getElementById(modalId);
    const backdrop = document.getElementById(backdropId);
    const panel = document.getElementById(panelId);
    if (!modal) return;
    modal.classList.remove('hidden');
    setTimeout(() => {
        backdrop.classList.remove('opacity-0');
        panel.classList.remove('opacity-0', 'scale-95');
        panel.classList.add('opacity-100', 'scale-100');
    }, 10);
}

function animateGenericClose(modalId, backdropId, panelId, callback) {
    const modal = document.getElementById(modalId);
    const backdrop = document.getElementById(backdropId);
    const panel = document.getElementById(panelId);
    if (!modal) return;
    backdrop.classList.add('opacity-0');
    panel.classList.remove('opacity-100', 'scale-100');
    panel.classList.add('opacity-0', 'scale-95');
    setTimeout(() => {
        modal.classList.add('hidden');
        if (callback) callback();
    }, 300);
}

// --- 2. CUSTOM ALERTS ---
window.showCustomAlert = (title, message) => {
    return new Promise((resolve) => {
        const titleEl = document.getElementById('alertTitle');
        const msgEl = document.getElementById('alertMessage');
        const btnContainer = document.getElementById('alertButtons');
        if (!document.getElementById('customAlertModal')) { alert(message); resolve(); return; }
        titleEl.textContent = title;
        msgEl.innerHTML = message;
        btnContainer.innerHTML = '';
        const okBtn = document.createElement('button');
        okBtn.className = "px-6 py-2 bg-[var(--gold)] text-black rounded-lg text-sm font-bold hover:bg-yellow-400 transition-colors shadow-lg";
        okBtn.textContent = "Okay";
        okBtn.onclick = () => { animateGenericClose('customAlertModal', 'alertBackdrop', 'alertBox'); resolve(); };
        btnContainer.appendChild(okBtn);
        animateGenericOpen('customAlertModal', 'alertBackdrop', 'alertBox');
    });
};

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
        cancelBtn.className = "px-5 py-2 bg-white/10 text-gray-300 rounded-lg text-sm font-bold hover:bg-white/20 transition-colors";
        cancelBtn.textContent = "Cancel";
        cancelBtn.onclick = () => { animateGenericClose('customAlertModal', 'alertBackdrop', 'alertBox'); resolve(false); };
        const confirmBtn = document.createElement('button');
        confirmBtn.className = "px-5 py-2 bg-[var(--gold)] text-black rounded-lg text-sm font-bold hover:bg-yellow-400 transition-colors shadow-lg";
        confirmBtn.textContent = "Confirm";
        confirmBtn.onclick = () => { animateGenericClose('customAlertModal', 'alertBackdrop', 'alertBox'); resolve(true); };
        btnContainer.appendChild(cancelBtn);
        btnContainer.appendChild(confirmBtn);
        animateGenericOpen('customAlertModal', 'alertBackdrop', 'alertBox');
    });
};
window.customConfirm = window.showCustomConfirm;

// --- UPDATED INITIALIZATION WITH REAL-TIME SCRIM FEED ---
document.addEventListener('DOMContentLoaded', async () => {
    console.log("DOM Loaded: Initializing Teams, Recruitment & Scrim Board...");

    // Start real-time Scrims feed immediately
    subscribeToScrims();

    const scrimSearchInput = document.getElementById('scrim-search');
    if (scrimSearchInput) {
        scrimSearchInput.addEventListener('input', (e) => {
            scrimSearchQuery = (e.target.value || '').trim().toLowerCase();
            if (activeView === 'scrims') renderScrimsBoard();
        });
    }

    auth.onAuthStateChanged(async (user) => {
        if (user) {
            console.log(`Auth State: User ${user.uid} is logged in.`);
            try {
                const snap = await getDoc(doc(db, "users", user.uid));
                if (snap.exists()) currentUserRole = snap.data().role;
                startKickListener(user.uid);

                // --- SESSION RESTORATION LOGIC ---
                const savedTeamId = sessionStorage.getItem('active_chat_teamId');
                const savedLftId = sessionStorage.getItem('active_chat_lftId');

                if (savedTeamId) {
                    console.log(`Session Found: Attempting to reopen ID ${savedTeamId}`);
                    if (savedLftId) {
                        activeLftChatId = savedLftId;
                        window.startLftChat(savedTeamId, "User");
                    } else {
                        window.openManageModal(savedTeamId);
                    }
                }
            } catch (e) {
                console.error("Error fetching role or session:", e);
            }
        } else {
            console.log("Auth State: No user logged in.");
            if (kickUnsubscribe) kickUnsubscribe();
            currentUserRole = null;
        }
        renderTeams();
    });
    setupForms();
});

const TAB_ACTIVE_CLASS = "px-3.5 py-1.5 rounded-lg bg-[#FFD700] text-black font-extrabold shadow-sm transition-all cursor-pointer flex items-center gap-1.5 whitespace-nowrap";
const TAB_INACTIVE_CLASS = "px-3.5 py-1.5 rounded-lg text-neutral-400 hover:text-white font-bold transition-all cursor-pointer flex items-center gap-1.5 whitespace-nowrap";

async function updateTeamTabCounts() {
    const user = auth.currentUser;
    const allTeams = (cachedRecruitmentPosts || []).filter(p => p.type === 'team' || !p.type);
    const allPlayers = (cachedRecruitmentPosts || []).filter(p => p.type === 'lft');
    
    const countFindTeams = document.getElementById('count-find-teams');
    const countFindPlayers = document.getElementById('count-find-players');
    const countScrims = document.getElementById('count-scrims');
    const countMyTeams = document.getElementById('count-my-teams');
    const countMyLft = document.getElementById('count-my-lft');
    const countInvites = document.getElementById('count-invites');

    if (countFindTeams) countFindTeams.textContent = allTeams.length;
    if (countFindPlayers) countFindPlayers.textContent = allPlayers.length;
    if (countScrims) countScrims.textContent = (activeScrimsList || []).filter(s => s.status === 'open').length;

    if (user) {
        const myTeams = allTeams.filter(p => p.authorId === user.uid || (Array.isArray(p.members) && p.members.some(m => (typeof m === 'object' ? m.uid : m) === user.uid)));
        const myLft = allPlayers.filter(p => p.authorId === user.uid || p.userId === user.uid);
        if (countMyTeams) countMyTeams.textContent = myTeams.length;
        if (countMyLft) countMyLft.textContent = myLft.length;

        try {
            const invitesSnap = await getDocs(collection(db, "users", user.uid, "invites"));
            const pendingCount = invitesSnap.docs.filter(d => d.data().status === 'pending' && d.data().invitedBy !== user.uid).length;
            if (countInvites) countInvites.textContent = pendingCount;
        } catch(e) {}
    } else {
        if (countMyTeams) countMyTeams.textContent = '0';
        if (countMyLft) countMyLft.textContent = '0';
        if (countInvites) countInvites.textContent = '0';
    }
}
window.updateTeamTabCounts = updateTeamTabCounts;

window.setTab = (tabName) => {
    if (tabName === 'find-teams') { activeView = 'teams'; activeTeamFilter = 'available'; }
    else if (tabName === 'find-players') { activeView = 'players'; activeTeamFilter = 'available'; }
    else if (tabName === 'scrims') { activeView = 'scrims'; activeTeamFilter = 'all'; }
    else if (tabName === 'my-teams') { activeView = 'teams'; activeTeamFilter = 'mine'; }
    else if (tabName === 'my-lft') { activeView = 'players'; activeTeamFilter = 'mine'; }
    else if (tabName === 'invites') { activeView = 'invites'; activeTeamFilter = 'none'; }

    // Updated list to include scrims and invites tab buttons
    const tabs = ['find-teams', 'find-players', 'scrims', 'my-teams', 'my-lft', 'invites'];
    tabs.forEach(t => {
        const btn = document.getElementById(`tab-${t}`);
        const countBadge = document.getElementById(`count-${t}`);
        if (btn) {
            btn.className = (t === tabName) ? TAB_ACTIVE_CLASS : TAB_INACTIVE_CLASS;
        }
        if (countBadge) {
            countBadge.className = (t === tabName)
                ? "text-[10px] bg-black/20 text-black px-1.5 py-0.2 rounded-full font-mono-tag font-bold"
                : "text-[10px] bg-white/10 text-neutral-300 px-1.5 py-0.2 rounded-full font-mono-tag font-bold";
        }
    });

    // Toggle filter grids and UI elements based on Scrim vs Standard view
    const teamFilterGrid = document.getElementById('team-filter-grid');
    const scrimFilterGrid = document.getElementById('scrim-filter-grid');
    const paginationContainer = document.getElementById('teams-pagination-container');

    if (tabName === 'scrims') {
        if (teamFilterGrid) teamFilterGrid.classList.add('hidden');
        if (scrimFilterGrid) {
            scrimFilterGrid.classList.remove('hidden');
            scrimFilterGrid.classList.add('grid');
        }
        if (paginationContainer) paginationContainer.classList.add('hidden');
    } else {
        if (teamFilterGrid) teamFilterGrid.classList.remove('hidden');
        if (scrimFilterGrid) {
            scrimFilterGrid.classList.add('hidden');
            scrimFilterGrid.classList.remove('grid');
        }
        if (paginationContainer && tabName !== 'invites') paginationContainer.classList.remove('hidden');
    }

    // Update tab counts
    updateTeamTabCounts();

    // --- HANDLE COPIABLE USER UID CARD DISPLAY ---
    const uidContainer = document.getElementById('user-uid-container');
    const uidDisplay = document.getElementById('user-uid-display');
    const copyBtn = document.getElementById('btn-copy-uid');

    if (tabName === 'invites') {
        // Reveal the copy-paste box
        if (uidContainer) uidContainer.classList.remove('hidden');
        
        // Grab the logged-in user from Firebase Auth
        const user = auth.currentUser; 
        if (user && uidDisplay) {
            uidDisplay.textContent = user.uid;
        } else if (uidDisplay) {
            uidDisplay.textContent = "Log in to view ID";
        }

        // Add the copy button functionality once
        if (copyBtn && !copyBtn.dataset.listenerAttached) {
            copyBtn.dataset.listenerAttached = "true";
            copyBtn.addEventListener('click', () => {
                if (!user) return;
                
                navigator.clipboard.writeText(user.uid).then(() => {
                    const originalText = copyBtn.textContent;
                    copyBtn.textContent = "Copied!";
                    copyBtn.classList.remove('text-gray-400');
                    copyBtn.classList.add('text-green-400');

                    setTimeout(() => {
                        copyBtn.textContent = originalText;
                        copyBtn.classList.remove('text-green-400');
                        copyBtn.classList.add('text-gray-400');
                    }, 2000);
                }).catch(err => console.error("Clipboard copy failed:", err));
            });
        }
    } else {
        // Hide the copy box completely on any other tab view
        if (uidContainer) uidContainer.classList.add('hidden');
    }

    renderTeams();
};

let teamsViewMode = localStorage.getItem('cz_teams_view_mode') || 'grid';
let teamsPageSize = localStorage.getItem('cz_teams_page_size') === 'all' ? 'all' : (parseInt(localStorage.getItem('cz_teams_page_size')) || 24);
let teamsCurrentPage = 1;

window.setTeamsViewMode = (mode) => {
    teamsViewMode = mode;
    localStorage.setItem('cz_teams_view_mode', mode);
    
    const btnGrid = document.getElementById('btn-view-grid');
    const btnList = document.getElementById('btn-view-list');
    if (btnGrid && btnList) {
        if (mode === 'grid') {
            btnGrid.className = "p-1.5 rounded bg-[#FFD700] text-black transition-colors cursor-pointer";
            btnList.className = "p-1.5 rounded text-neutral-400 hover:text-white transition-colors cursor-pointer";
        } else {
            btnGrid.className = "p-1.5 rounded text-neutral-400 hover:text-white transition-colors cursor-pointer";
            btnList.className = "p-1.5 rounded bg-[#FFD700] text-black transition-colors cursor-pointer";
        }
    }
    renderTeams();
};

window.setTeamsPageSize = (size) => {
    teamsPageSize = (size === 'all') ? 'all' : parseInt(size);
    localStorage.setItem('cz_teams_page_size', size);
    teamsCurrentPage = 1;
    renderTeams();
};

window.changeTeamsPage = (page) => {
    teamsCurrentPage = page;
    renderTeams();
    const finderEl = document.getElementById('finder');
    if (finderEl) {
        finderEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
};

window.setGameFilter = (game) => { activeGameFilter = game; teamsCurrentPage = 1; renderTeams(); }
window.setRosterFilter = (roster) => { activeRosterFilter = roster; teamsCurrentPage = 1; renderTeams(); }
window.setRoleFilter = (role) => { activeRoleFilter = role; teamsCurrentPage = 1; renderTeams(); }

window.resetFilters = () => {
    activeGameFilter = 'all';
    activeRosterFilter = 'all';
    activeRoleFilter = 'all';
    searchTerm = '';
    teamsCurrentPage = 1;
    const gameSelect = document.getElementById('filter-game');
    const rosterSelect = document.getElementById('filter-roster');
    const roleSelect = document.getElementById('filter-role');
    const searchInput = document.getElementById('team-search');
    if (gameSelect) gameSelect.value = 'all';
    if (rosterSelect) rosterSelect.value = 'all';
    if (roleSelect) roleSelect.value = 'all';
    if (searchInput) searchInput.value = '';
    renderTeams();
};

async function renderTeams() {
    const board = qs('#recruitment-board');
    if (!board) return;

    // 0. EARLY HANDLE FOR SCRIMS VIEW
    if (activeView === 'scrims') {
        // Clear card real-time blimp listeners
        cardListeners.forEach(unsub => unsub());
        cardListeners = [];
        renderScrimsBoard();
        return;
    }

    // 1. EARLY HANDLE FOR THE INVITES VIEW
    if (activeView === 'invites') {
        // Clear existing real-time listeners for cards
        cardListeners.forEach(unsub => unsub());
        cardListeners = [];

        const user = auth.currentUser;
        if (!user) {
            board.innerHTML = `
                <div class="col-span-full py-20 text-center flex flex-col items-center justify-center">
                    <div class="bg-white/5 p-8 rounded-2xl border border-white/10 max-w-sm">
                        <svg class="w-12 h-12 text-gray-500 mb-4 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                        </svg>
                        <h3 class="text-xl font-bold text-white mb-2">Sign in to view invites</h3>
                        <p class="text-gray-400 text-sm mb-6">You need to be logged in to manage and review your direct recruitment invitations.</p>
                        <a href="/login" class="inline-block bg-[var(--gold)] text-black font-bold px-8 py-3 rounded-lg hover:bg-yellow-400 transition-transform active:scale-95 shadow-lg">
                            Log In Now
                        </a>
                    </div>
                </div>`;
            return;
        }
        
        // Fetch and render actual invites from Firestore
        board.innerHTML = '<div class="col-span-full py-20 text-center"><div class="inline-block animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-[var(--gold)] mb-4"></div><p class="text-gray-500">Loading invites...</p></div>';

        try {
            const invitesSnap = await getDocs(collection(db, "users", user.uid, "invites"));

            const validInvites = [];
            for (const d of invitesSnap.docs) {
                const inv = d.data();
                // Filter out and auto-clean any self-invitations
                if (inv.invitedBy === user.uid) {
                    try { deleteDoc(d.ref); } catch(err){}
                    continue;
                }
                validInvites.push({ id: d.id, ...inv });
            }

            if (validInvites.length === 0) {
                board.innerHTML = `
                    <div class="col-span-full py-20 text-center flex flex-col items-center justify-center border border-dashed border-white/5 rounded-2xl bg-zinc-900/10">
                        <svg class="w-10 h-10 text-gray-600 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/>
                        </svg>
                        <p class="text-gray-400 text-sm font-medium">No invites yet</p>
                        <p class="text-gray-500 text-xs mt-1 max-w-xs mx-auto">Share your Recruitment ID with team leaders so they can invite you directly.</p>
                    </div>`;
                return;
            }

            board.innerHTML = '';
            const container = document.createElement('div');
            container.className = 'col-span-full space-y-3';

            validInvites.forEach(inv => {
                const isPending = inv.status === 'pending';

                const card = document.createElement('div');
                card.className = 'bg-white/5 border border-white/10 rounded-xl p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 hover:border-white/20 transition-colors';
                card.innerHTML = `
                    <div class="flex flex-col gap-1">
                        <div class="text-white font-bold text-sm">${escapeHtml(inv.teamName || 'Unknown Team')}</div>
                        <div class="text-gray-400 text-xs">Invited by <span class="text-[var(--gold)]">${escapeHtml(inv.invitedByName || 'Team Captain')}</span></div>
                        <div class="text-gray-600 text-[10px] mt-0.5 uppercase tracking-wide font-bold">${isPending ? '⏳ Pending' : inv.status === 'accepted' ? '✅ Accepted' : '❌ Declined'}</div>
                    </div>
                    ${isPending ? `
                    <div class="flex gap-2 w-full sm:w-auto sm:shrink-0">
                        <button data-action="accept-invite" data-invite-id="${inv.id}" data-team-id="${escapeHtml(inv.teamId)}" data-team-name="${escapeHtml(inv.teamName)}"
                            class="bg-green-600/20 text-green-400 border border-green-600/30 text-xs px-4 py-2 rounded-lg font-bold hover:bg-green-600/30 transition flex-1 sm:flex-none cursor-pointer">
                            Accept
                        </button>
                        <button data-action="decline-invite" data-invite-id="${inv.id}"
                            class="bg-red-600/20 text-red-400 border border-red-600/30 text-xs px-4 py-2 rounded-lg font-bold hover:bg-red-600/30 transition cursor-pointer">
                            Decline
                        </button>
                    </div>` : ''}
                `;
                container.appendChild(card);
            });

            board.appendChild(container);

        } catch (e) {
            console.error("Failed to load invites:", e);
            board.innerHTML = '<div class="col-span-full py-20 text-center"><p class="text-red-500">Failed to load invites.</p></div>';
        }
        return;
    }

    // 2. AUTH CHECK FOR 'MINE' FILTER ON STANDARD VIEWS
    if ((activeTeamFilter === 'mine') && !auth.currentUser) {
        board.innerHTML = `
            <div class="col-span-full py-20 text-center flex flex-col items-center justify-center">
                <div class="bg-white/5 p-8 rounded-2xl border border-white/10 max-w-sm">
                    <svg class="w-12 h-12 text-gray-500 mb-4 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                    <h3 class="text-xl font-bold text-white mb-2">Sign in to view teams</h3>
                    <p class="text-gray-400 text-sm mb-6">You need to be logged in to manage your team memberships and listings.</p>
                    <a href="/login" class="inline-block bg-[var(--gold)] text-black font-bold px-8 py-3 rounded-lg hover:bg-yellow-400 transition-transform active:scale-95 shadow-lg">
                        Log In Now
                    </a>
                </div>
            </div>`;
        return;
    }

    // Clear existing real-time listeners for cards
    cardListeners.forEach(unsub => unsub());
    cardListeners = [];

    board.innerHTML = '<div class="col-span-full py-20 text-center"><div class="inline-block animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-[var(--gold)] mb-4"></div><p class="text-gray-500">Loading listings...</p></div>';

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

    try {
        let posts = [];
        const fetchSDK = new Promise(async (resolve, reject) => {
            try {
                const querySnapshot = await getDocs(collection(db, "recruitment"));
                const items = [];
                querySnapshot.forEach(doc => items.push({ id: doc.id, ...doc.data() }));
                resolve(items);
            } catch (e) { reject(e); }
        });
        const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('SDK Timeout')), 2500));

        try {
            posts = await Promise.race([fetchSDK, timeout]);
        } catch (sdkErr) {
            console.warn("Teams SDK slow/failed, using REST API:", sdkErr);
            const res = await fetch('https://firestore.googleapis.com/v1/projects/champzero-92951/databases/(default)/documents/recruitment');
            if (res.ok) {
                const data = await res.json();
                posts = (data.documents || []).map(doc => {
                    const id = doc.name ? doc.name.split('/').pop() : '';
                    const d = { id };
                    for (const k in (doc.fields || {})) d[k] = parseFirestoreValue(doc.fields[k]);
                    return d;
                });
            }
        }

        cachedRecruitmentPosts = posts;
        updateTeamTabCounts();

        const targetType = activeView === 'teams' ? 'team' : 'lft';
        posts = posts.filter(p => (p.type === targetType) || (!p.type && activeView === 'teams'));
        posts.sort((a, b) => {
            if (a.isPremium !== b.isPremium) return b.isPremium ? 1 : -1;
            return (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0);
        });

        const myUid = auth.currentUser ? auth.currentUser.uid : null;
        let count = 0;
        let openCount = 0;
        let filteredPosts = [];

        // We will collect joined teams to attach listeners later
        let joinedTeamsToListen = [];

        posts.forEach((post) => {
            const isAuthor = myUid === post.authorId;
            const myMemberData = post.members ? post.members.find(m => m.uid === myUid) : null;
            const isMember = !!myMemberData;
            const isJoined = isAuthor || isMember;

            if (activeTeamFilter === 'mine' && !isJoined) return;
            if (activeTeamFilter === 'available' && isJoined) return;

            // Game filter
            if (activeGameFilter !== 'all') {
                const targetBadge = formatGameBadge(activeGameFilter);
                const postBadge = formatGameBadge(post.game || post.gameId);
                if (targetBadge !== postBadge) return;
            }

            // Roster Availability Filter
            const memberCount = post.members ? post.members.length : (post.currentMembers || 1);
            const maxMembers = post.maxMembers || 5;
            const isFull = memberCount >= maxMembers;

            if (activeView === 'teams') {
                if (activeRosterFilter === 'open' && isFull) return;
                if (activeRosterFilter === 'full' && !isFull) return;
                if (!isFull) openCount++;
            }

            // Role Filter
            if (activeRoleFilter !== 'all') {
                const searchRole = activeRoleFilter.toLowerCase();
                if (activeView === 'teams') {
                    const hasRole = post.roles && post.roles.some(r => r.toLowerCase().includes(searchRole));
                    if (!hasRole) return;
                } else {
                    const hasRole = post.role && post.role.toLowerCase().includes(searchRole);
                    if (!hasRole) return;
                }
            }

            // Search Term Filter
            if (searchTerm) {
                const term = searchTerm.toLowerCase();
                const nameMatch = (post.name || post.ign || '').toLowerCase().includes(term);
                const descMatch = (post.description || '').toLowerCase().includes(term);
                const roleMatch = (post.role || '').toLowerCase().includes(term) || (post.roles && post.roles.some(r => r.toLowerCase().includes(term)));
                const gameMatch = (post.game || '').toLowerCase().includes(term);
                const captMatch = post.members && post.members.some(m => (m.name || '').toLowerCase().includes(term));
                if (!nameMatch && !descMatch && !roleMatch && !gameMatch && !captMatch) return;
            }

            count++;
            filteredPosts.push(post);

            // If we are part of this team, add to list for real-time monitoring
            if (isJoined && activeView === 'teams') {
                const myRole = isAuthor ? 'Captain' : (myMemberData ? myMemberData.role : 'Member');
                const canSeeApps = (myRole === 'Captain' || myRole === 'Vice Captain');
                joinedTeamsToListen.push({
                    id: post.id,
                    canSeeApps: canSeeApps
                });
            }
        });

        // Pagination Calculation
        const totalCount = filteredPosts.length;
        const pageSizeNum = (teamsPageSize === 'all') ? totalCount : teamsPageSize;
        const totalPages = Math.max(1, Math.ceil(totalCount / (pageSizeNum || 1)));
        if (teamsCurrentPage > totalPages) teamsCurrentPage = totalPages;
        if (teamsCurrentPage < 1) teamsCurrentPage = 1;

        const startIndex = (teamsCurrentPage - 1) * pageSizeNum;
        const endIndex = Math.min(totalCount, startIndex + pageSizeNum);
        const displayedPosts = (teamsPageSize === 'all') ? filteredPosts : filteredPosts.slice(startIndex, endIndex);

        // Sync view toggle buttons & selector UI
        const btnGrid = document.getElementById('btn-view-grid');
        const btnList = document.getElementById('btn-view-list');
        if (btnGrid && btnList) {
            if (teamsViewMode === 'grid') {
                btnGrid.className = "p-1.5 rounded bg-[#FFD700] text-black transition-colors cursor-pointer";
                btnList.className = "p-1.5 rounded text-neutral-400 hover:text-white transition-colors cursor-pointer";
            } else {
                btnGrid.className = "p-1.5 rounded text-neutral-400 hover:text-white transition-colors cursor-pointer";
                btnList.className = "p-1.5 rounded bg-[#FFD700] text-black transition-colors cursor-pointer";
            }
        }
        const pageSizeSelect = document.getElementById('teams-page-size-select');
        if (pageSizeSelect) pageSizeSelect.value = String(teamsPageSize);

        board.innerHTML = '';

        if (teamsViewMode === 'list') {
            board.className = "flex flex-col gap-2 min-h-[300px]";
            displayedPosts.forEach(post => {
                const isAuthor = myUid === post.authorId;
                const myMemberData = post.members ? post.members.find(m => m.uid === myUid) : null;
                const isMember = !!myMemberData;
                board.innerHTML += (activeView === 'teams')
                    ? renderTeamRow(post, isAuthor, isMember)
                    : renderPlayerRow(post, isAuthor);
            });
        } else {
            board.className = "grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3.5 auto-rows-fr min-h-[300px]";
            displayedPosts.forEach(post => {
                const isAuthor = myUid === post.authorId;
                const myMemberData = post.members ? post.members.find(m => m.uid === myUid) : null;
                const isMember = !!myMemberData;
                board.innerHTML += (activeView === 'teams')
                    ? renderTeamCard(post, isAuthor, isMember)
                    : renderPlayerCard(post, isAuthor);
            });
        }

        // Render Pagination Controls
        renderPagination(totalCount, teamsCurrentPage, totalPages, startIndex, endIndex);

        // Update Filter HUD / Count
        const countTextEl = document.getElementById('filter-count-text');
        const resetBtnEl = document.getElementById('btn-reset-filters');
        const isFiltered = (activeGameFilter !== 'all' || activeRosterFilter !== 'all' || activeRoleFilter !== 'all' || searchTerm !== '');

        if (countTextEl) {
            if (activeView === 'teams') {
                countTextEl.textContent = `Showing ${count} Squad${count === 1 ? '' : 's'} (${openCount} with open recruitment spots)`;
            } else {
                countTextEl.textContent = `Showing ${count} Player LFT Listing${count === 1 ? '' : 's'}`;
            }
        }
        if (resetBtnEl) {
            if (isFiltered) resetBtnEl.classList.remove('hidden');
            else resetBtnEl.classList.add('hidden');
        }

        if (count === 0) {
            board.innerHTML = `
                <div class="col-span-full py-20 text-center flex flex-col items-center justify-center">
                    <div class="w-12 h-12 rounded-full bg-white/5 border border-white/10 flex items-center justify-center mb-3 text-neutral-500">
                        <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path>
                        </svg>
                    </div>
                    <p class="text-white font-heading font-bold text-base mb-1">No matching ${activeView === 'teams' ? 'teams' : 'players'} found</p>
                    <p class="text-neutral-400 text-xs max-w-sm mb-4">Try clearing some search filters or select a different game category.</p>
                    <button onclick="window.resetFilters()" class="font-heading font-bold text-xs uppercase px-4 py-2 rounded-lg bg-[#FFD700] text-black hover:bg-[#FFF099] transition-all cursor-pointer">
                        Reset All Filters
                    </button>
                </div>`;
            const pagContainer = document.getElementById('teams-pagination-container');
            if (pagContainer) pagContainer.classList.add('hidden');
        }

        // Start Real-time Listeners for Blimps
        subscribeToCardUpdates(joinedTeamsToListen);

    } catch (error) {
        console.error("Render Error:", error);
        board.innerHTML = '<div class="col-span-full py-20 text-center"><p class="text-red-500">Failed to load listings.</p></div>';
    }
}

function renderPagination(totalCount, currentPage, totalPages, startIndex, endIndex) {
    const pagContainer = document.getElementById('teams-pagination-container');
    if (!pagContainer) return;
    if (totalCount === 0 || totalPages <= 1 || teamsPageSize === 'all') {
        pagContainer.innerHTML = '';
        pagContainer.classList.add('hidden');
        return;
    }
    pagContainer.classList.remove('hidden');

    let pagesHtml = '';
    const maxButtons = 5;
    let startPage = Math.max(1, currentPage - 2);
    let endPage = Math.min(totalPages, startPage + maxButtons - 1);
    if (endPage - startPage < maxButtons - 1) {
        startPage = Math.max(1, endPage - maxButtons + 1);
    }

    for (let p = startPage; p <= endPage; p++) {
        if (p === currentPage) {
            pagesHtml += `<button type="button" class="w-7 h-7 rounded-lg bg-[#FFD700] text-black font-bold text-xs cursor-default font-mono-tag">${p}</button>`;
        } else {
            pagesHtml += `<button type="button" onclick="window.changeTeamsPage(${p})" class="w-7 h-7 rounded-lg bg-white/5 hover:bg-white/15 text-neutral-300 hover:text-white border border-white/10 text-xs transition cursor-pointer font-mono-tag">${p}</button>`;
        }
    }

    pagContainer.innerHTML = `
        <div class="text-neutral-400 text-xs font-mono-tag">
            Showing <span class="text-white font-bold">${totalCount === 0 ? 0 : startIndex + 1}–${endIndex}</span> of <span class="text-[#FFD700] font-bold">${totalCount}</span> ${activeView === 'teams' ? 'squads' : 'listings'}
        </div>
        <div class="flex items-center gap-1.5">
            <button type="button" ${currentPage <= 1 ? 'disabled class="px-2.5 py-1 rounded-lg bg-white/5 text-neutral-600 border border-white/5 text-xs cursor-not-allowed font-mono-tag"' : `onclick="window.changeTeamsPage(${currentPage - 1})" class="px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/15 text-neutral-300 hover:text-white border border-white/10 text-xs transition cursor-pointer font-mono-tag"`}>
                &laquo; Prev
            </button>
            ${pagesHtml}
            <button type="button" ${currentPage >= totalPages ? 'disabled class="px-2.5 py-1 rounded-lg bg-white/5 text-neutral-600 border border-white/5 text-xs cursor-not-allowed font-mono-tag"' : `onclick="window.changeTeamsPage(${currentPage + 1})" class="px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/15 text-neutral-300 hover:text-white border border-white/10 text-xs transition cursor-pointer font-mono-tag"`}>
                Next &raquo;
            </button>
        </div>
    `;
}

// --- REAL-TIME CARD UPDATES (The Magic for Live Blimps) ---
function subscribeToCardUpdates(teams) {
    teams.forEach(team => {
        // 1. Listen for CHAT updates (Red Blimp)
        // We listen to the Team Document 'lastActive' field
        const teamUnsub = onSnapshot(doc(db, "recruitment", team.id), (docSnap) => {
            if (docSnap.exists()) {
                const data = docSnap.data();
                const lastReadTime = localStorage.getItem(`lastRead_${team.id}`);
                const teamLastActive = data.lastActive ? data.lastActive.toMillis() : 0;

                // Show RED if activity is newer than last read
                const showRed = (teamLastActive > 0 && (!lastReadTime || teamLastActive > parseInt(lastReadTime)));
                updateBlimpUI(team.id, 'red', showRed);
            }
        });
        cardListeners.push(teamUnsub);

        // 2. Listen for NEW APPLICATIONS (Blue Blimp)
        if (team.canSeeApps) {
            const appsQuery = query(collection(db, "recruitment", team.id, "applications"), where("status", "==", "pending"));
            const appUnsub = onSnapshot(appsQuery, (snap) => {
                const hasPending = !snap.empty;
                updateBlimpUI(team.id, 'blue', hasPending);
            });
            cardListeners.push(appUnsub);
        }
    });
}

function updateBlimpUI(teamId, color, show) {
    const card = document.querySelector(`article[data-id="${teamId}"]`);
    if (!card) return;
    const container = card.querySelector('.blimp-container');
    if (!container) return;

    let blimp = container.querySelector(`.blimp.${color}`);
    if (show) {
        if (!blimp) {
            blimp = document.createElement('div');
            blimp.className = `blimp ${color}`;
            container.appendChild(blimp);
        }
    } else {
        if (blimp) blimp.remove();
    }
}

function renderTeamCard(post, isAuthor, isMember) {
    const memberCount = post.members ? post.members.length : (post.currentMembers || 1);
    const maxMembers = post.maxMembers || 5;
    const isFull = memberCount >= maxMembers;
    const spotsLeft = Math.max(0, maxMembers - memberCount);
    const captain = post.members?.find(m => m.role === 'Captain') || { name: post.authorName || 'Captain' };
    const borderClass = "border-white/10 hover:border-[#FFD700] hover:shadow-[0_0_20px_rgba(255,215,0,0.15)]";
    const verifiedBadge = post.isPremium ? `<span class="bg-[#FFD700] text-black text-[8px] font-mono-tag font-bold px-1 py-0.2 rounded uppercase">PRO</span>` : '';
    
    const rolesHtml = post.roles && post.roles.length > 0 
        ? post.roles.slice(0, 2).map(r => `<span class="bg-black/60 text-indigo-200 border border-indigo-500/30 text-[8px] font-mono-tag font-bold px-1.5 py-0.2 rounded uppercase tracking-wider">${escapeHtml(r.trim())}</span>`).join(' ') + (post.roles.length > 2 ? `<span class="text-[8px] text-neutral-400 font-mono-tag pl-0.5">+${post.roles.length - 2}</span>` : '')
        : `<span class="text-[8px] text-neutral-500 font-mono-tag">Any Role</span>`;

    let actionBtn = '';
    if (isAuthor || isMember) {
        actionBtn = `<button onclick="window.openManageModal('${post.id}')" class="flex-1 py-1.5 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 rounded-lg text-[11px] font-heading font-bold uppercase tracking-wider transition-all cursor-pointer text-center flex items-center justify-center gap-1.5"><svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"></path></svg><span>Team Chat</span></button>`;
    } else if (isFull) {
        actionBtn = `<button disabled class="flex-1 py-1.5 bg-neutral-900/80 text-neutral-500 border border-neutral-800 rounded-lg text-[11px] font-heading font-bold uppercase tracking-wider cursor-not-allowed text-center">Full</button>`;
    } else if (post.applicationsOpen === false) {
        actionBtn = `<button disabled class="flex-1 py-1.5 bg-neutral-900/80 text-neutral-500 border border-neutral-800 rounded-lg text-[11px] font-heading font-bold uppercase tracking-wider cursor-not-allowed text-center">Closed</button>`;
    } else {
        actionBtn = `<button onclick="window.openApplicationModal('${post.id}', '${escapeHtml(post.name)}')" class="flex-1 py-1.5 bg-[#FFD700] hover:bg-[#FFF099] text-black rounded-lg text-[11px] font-heading font-bold uppercase tracking-wider transition-all shadow-sm active:scale-95 flex items-center justify-center gap-1 cursor-pointer font-semibold"><span>Apply</span> &rarr;</button>`;
    }

    const statusBadge = isFull 
        ? `<span class="bg-red-500/20 text-red-400 border border-red-500/40 text-[8px] font-mono-tag font-bold px-1.5 py-0.2 rounded-full uppercase">Full</span>`
        : `<span class="bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 text-[8px] font-mono-tag font-bold px-1.5 py-0.2 rounded-full uppercase">${spotsLeft} Open</span>`;

    return `
        <article data-id="${post.id}" class="bg-[#0D0D12] border rounded-xl overflow-hidden transition-all duration-200 group flex flex-col justify-between relative ${borderClass}">
            <!-- Card Top Header Banner -->
            <div class="relative h-20 w-full bg-cover bg-center overflow-hidden" style="background-image: url('${escapeHtml(post.image || 'pictures/cz_logo.png')}');">
                <div class="absolute inset-0 bg-gradient-to-t from-[#0D0D12] via-[#0D0D12]/60 to-black/50"></div>
                
                <div class="absolute top-2 left-2 right-2 flex items-center justify-between z-10">
                    <div class="flex items-center gap-1 min-w-0">
                        <span class="bg-black/80 backdrop-blur-md text-[#FFD700] border border-[#FFD700]/30 font-mono-tag font-bold text-[8px] px-1.5 py-0.2 rounded uppercase tracking-wider truncate">${escapeHtml(formatGameBadge(post.game || post.gameId))}</span>
                        <div class="blimp-container"></div>
                    </div>
                    ${statusBadge}
                </div>
            </div>

            <!-- Card Body Details -->
            <div class="px-3 pb-3 pt-1 flex-1 flex flex-col justify-between relative z-10 -mt-4">
                <div>
                    <div class="flex items-center justify-between gap-1.5 mb-1">
                        <h3 class="text-sm font-heading font-bold text-white truncate group-hover:text-[#FFD700] transition-colors flex items-center gap-1">
                            ${escapeHtml(post.name)} ${verifiedBadge}
                        </h3>
                    </div>
                    
                    <p class="text-[9px] text-neutral-400 font-mono-tag truncate mb-1.5">
                        Capt: <span class="text-neutral-200 font-semibold">${escapeHtml(captain.name)}</span>
                    </p>

                    <div class="flex flex-wrap items-center gap-1 mb-2">
                        ${rolesHtml}
                    </div>
                </div>

                <div>
                    <div class="mb-2">
                        <div class="flex justify-between text-[8px] font-mono-tag text-neutral-400 mb-0.5 font-bold uppercase">
                            <span>Roster</span>
                            <span class="${isFull ? 'text-red-400' : 'text-[#FFD700]'}">${memberCount} / ${maxMembers}</span>
                        </div>
                        <div class="w-full bg-black/60 h-1 rounded-full overflow-hidden border border-white/5">
                            <div class="bg-gradient-to-r from-amber-500 to-[#FFD700] h-full transition-all duration-500" style="width: ${Math.min(100, (memberCount / maxMembers) * 100)}%"></div>
                        </div>
                    </div>

                    <!-- Action Button Row -->
                    <div class="flex items-center gap-1.5 pt-1.5 border-t border-white/5">
                        <button onclick="window.openTeamDetailsModal('${post.id}')" class="px-2.5 py-1.5 bg-white/5 hover:bg-white/15 text-neutral-200 border border-white/10 hover:border-white/30 rounded-lg text-[11px] font-heading font-bold uppercase tracking-wider transition-all cursor-pointer text-center">
                            Roster
                        </button>
                        ${actionBtn}
                    </div>
                </div>
            </div>
        </article>`;
}

function renderTeamRow(post, isAuthor, isMember) {
    const memberCount = post.members ? post.members.length : (post.currentMembers || 1);
    const maxMembers = post.maxMembers || 5;
    const isFull = memberCount >= maxMembers;
    const spotsLeft = Math.max(0, maxMembers - memberCount);
    const captain = post.members?.find(m => m.role === 'Captain') || { name: post.authorName || 'Captain' };
    const verifiedBadge = post.isPremium ? `<span class="bg-[#FFD700] text-black text-[8px] font-mono-tag font-bold px-1 py-0.2 rounded uppercase">PRO</span>` : '';
    
    const rolesHtml = post.roles && post.roles.length > 0 
        ? post.roles.slice(0, 2).map(r => `<span class="bg-black/60 text-indigo-200 border border-indigo-500/30 text-[8px] font-mono-tag font-bold px-1.5 py-0.5 rounded uppercase tracking-tight">${escapeHtml(r.trim())}</span>`).join(' ') + (post.roles.length > 2 ? `<span class="text-[8px] text-neutral-400 font-mono-tag">+${post.roles.length - 2}</span>` : '')
        : `<span class="text-[8px] text-neutral-500 font-mono-tag">Any Role</span>`;

    let actionBtn = '';
    if (isAuthor || isMember) {
        actionBtn = `<button onclick="window.openManageModal('${post.id}')" class="px-3 py-1.5 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 rounded-lg text-[11px] font-heading font-bold uppercase tracking-wider transition-all cursor-pointer flex items-center gap-1.5"><svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"></path></svg><span>Team Chat</span></button>`;
    } else if (isFull) {
        actionBtn = `<button disabled class="px-3 py-1.5 bg-neutral-900/80 text-neutral-500 border border-neutral-800 rounded-lg text-[11px] font-heading font-bold uppercase tracking-wider cursor-not-allowed">Full</button>`;
    } else if (post.applicationsOpen === false) {
        actionBtn = `<button disabled class="px-3 py-1.5 bg-neutral-900/80 text-neutral-500 border border-neutral-800 rounded-lg text-[11px] font-heading font-bold uppercase tracking-wider cursor-not-allowed">Closed</button>`;
    } else {
        actionBtn = `<button onclick="window.openApplicationModal('${post.id}', '${escapeHtml(post.name)}')" class="px-3 py-1.5 bg-[#FFD700] hover:bg-[#FFF099] text-black rounded-lg text-[11px] font-heading font-bold uppercase tracking-wider transition-all shadow-sm active:scale-95 flex items-center gap-1 cursor-pointer font-semibold"><span>Apply</span> &rarr;</button>`;
    }

    const statusBadge = isFull 
        ? `<span class="bg-red-500/15 text-red-400 border border-red-500/30 text-[9px] font-mono-tag font-bold px-2 py-0.5 rounded-full uppercase">Full</span>`
        : `<span class="bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 text-[9px] font-mono-tag font-bold px-2 py-0.5 rounded-full uppercase">${spotsLeft} Open</span>`;

    return `
        <div data-id="${post.id}" class="bg-[#0D0D12] hover:bg-[#12121A] border border-white/10 hover:border-[#FFD700]/50 rounded-xl p-3 sm:px-4 sm:py-2.5 transition-all duration-200 flex flex-col md:flex-row items-start md:items-center justify-between gap-3 group">
            <!-- Left Identity -->
            <div class="flex items-center gap-3 min-w-0 flex-1">
                <img src="${escapeHtml(post.image || 'pictures/cz_logo.png')}" class="w-9 h-9 rounded-lg object-cover border border-white/10 shrink-0 group-hover:border-[#FFD700]/50 transition-colors" alt="Team Logo">
                <div class="min-w-0 flex-1">
                    <div class="flex items-center gap-1.5">
                        <span class="font-heading font-bold text-white text-sm truncate group-hover:text-[#FFD700] transition-colors">${escapeHtml(post.name)}</span>
                        ${verifiedBadge}
                        <div class="blimp-container"></div>
                    </div>
                    <div class="flex items-center gap-2 text-[10px] text-neutral-400 font-mono-tag">
                        <span>Capt: <strong class="text-neutral-300 font-medium">${escapeHtml(captain.name)}</strong></span>
                        <span class="text-neutral-600">•</span>
                        <span class="text-[#FFD700] font-bold">${escapeHtml(formatGameBadge(post.game || post.gameId))}</span>
                    </div>
                </div>
            </div>

            <!-- Center: Roles -->
            <div class="hidden lg:flex items-center gap-2 shrink-0">
                ${rolesHtml}
            </div>

            <!-- Mid-Right: Capacity Progress Bar -->
            <div class="flex items-center gap-3 shrink-0">
                <div class="hidden sm:block w-28 text-right">
                    <div class="flex justify-between text-[9px] font-mono-tag text-neutral-400 mb-1 font-bold uppercase">
                        <span>Roster</span>
                        <span class="${isFull ? 'text-red-400' : 'text-[#FFD700]'}">${memberCount}/${maxMembers}</span>
                    </div>
                    <div class="w-full bg-black/60 h-1 rounded-full overflow-hidden border border-white/5">
                        <div class="bg-gradient-to-r from-amber-500 to-[#FFD700] h-full" style="width: ${Math.min(100, (memberCount / maxMembers) * 100)}%"></div>
                    </div>
                </div>
                ${statusBadge}
            </div>

            <!-- Right Action Buttons -->
            <div class="flex items-center gap-2 shrink-0 w-full sm:w-auto justify-end">
                <button onclick="window.openTeamDetailsModal('${post.id}')" class="px-2.5 py-1.5 bg-white/5 hover:bg-white/10 text-neutral-300 hover:text-white border border-white/10 rounded-lg text-[11px] font-heading font-bold uppercase tracking-wider transition-all cursor-pointer">
                    Roster
                </button>
                ${actionBtn}
            </div>
        </div>`;
}

// --- TEAM DETAILS & ROSTER MODAL LOGIC ---
window.openTeamDetailsModal = async (teamId) => {
    const modal = document.getElementById('teamDetailsModal');
    if (!modal) return;

    let team = cachedRecruitmentPosts.find(p => p.id === teamId);
    if (!team) {
        try {
            const docSnap = await getDoc(doc(db, "recruitment", teamId));
            if (docSnap.exists()) team = { id: docSnap.id, ...docSnap.data() };
        } catch (e) { console.error(e); }
    }
    if (!team) return;

    const members = team.members && team.members.length > 0 ? team.members : [{ name: team.authorName || 'Captain', role: 'Captain' }];
    const memberCount = members.length;
    const maxMembers = team.maxMembers || 5;
    const isFull = memberCount >= maxMembers;
    const spotsLeft = Math.max(0, maxMembers - memberCount);
    const captain = members.find(m => m.role === 'Captain') || { name: 'Captain' };

    const myUid = auth.currentUser ? auth.currentUser.uid : null;
    const isAuthor = myUid === team.authorId;
    const isMember = members.some(m => m.uid === myUid);

    // Header Info
    if (qs('#td-image')) qs('#td-image').src = team.image || 'pictures/cz_logo.png';
    if (qs('#td-name')) qs('#td-name').textContent = team.name || 'Unnamed Team';
    if (qs('#td-game')) qs('#td-game').textContent = formatGameTitle(team.game || team.gameId);
    if (qs('#td-captain')) qs('#td-captain').textContent = captain.name || 'Captain';

    const verifiedEl = qs('#td-verified');
    if (verifiedEl) {
        if (team.isPremium) verifiedEl.classList.remove('hidden');
        else verifiedEl.classList.add('hidden');
    }

    const statusEl = qs('#td-status');
    if (statusEl) {
        if (isFull) {
            statusEl.textContent = 'ROSTER FULL';
            statusEl.className = 'font-mono-tag text-[9px] bg-red-500/15 text-red-400 border border-red-500/30 font-bold px-2 py-0.5 rounded uppercase';
        } else {
            statusEl.textContent = `${spotsLeft} SPOT${spotsLeft > 1 ? 'S' : ''} OPEN`;
            statusEl.className = 'font-mono-tag text-[9px] bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 font-bold px-2 py-0.5 rounded uppercase';
        }
    }

    // Roster Progress Bar
    if (qs('#td-roster-count')) {
        qs('#td-roster-count').textContent = `${memberCount} / ${maxMembers} Registered (${isFull ? 'Roster Full' : spotsLeft + ' Open Spot' + (spotsLeft > 1 ? 's' : '')})`;
    }
    if (qs('#td-roster-progress')) {
        qs('#td-roster-progress').style.width = `${Math.min(100, (memberCount / maxMembers) * 100)}%`;
    }

    // Member Roster List
    const rosterListEl = qs('#td-roster-list');
    if (rosterListEl) {
        rosterListEl.innerHTML = members.map(m => {
            const isCapt = m.role === 'Captain';
            const isVice = m.role === 'Vice Captain';
            const roleBadge = isCapt
                ? `<span class="bg-[#FFD700]/20 text-[#FFD700] border border-[#FFD700]/40 text-[9px] font-mono-tag font-bold px-1.5 py-0.5 rounded uppercase">Captain</span>`
                : isVice
                    ? `<span class="bg-purple-500/20 text-purple-300 border border-purple-500/40 text-[9px] font-mono-tag font-bold px-1.5 py-0.5 rounded uppercase">Vice Captain</span>`
                    : `<span class="bg-white/10 text-neutral-300 border border-white/10 text-[9px] font-mono-tag px-1.5 py-0.5 rounded uppercase">Member</span>`;

            return `
                <div class="bg-black/50 p-2.5 rounded-xl border border-white/5 flex items-center justify-between gap-2">
                    <div class="flex items-center gap-2.5 min-w-0">
                        <div class="w-8 h-8 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center font-heading font-bold text-xs text-[#FFD700] shrink-0">
                            ${escapeHtml((m.name || 'P').charAt(0).toUpperCase())}
                        </div>
                        <div class="min-w-0">
                            <p class="font-heading font-bold text-white text-xs truncate">${escapeHtml(m.name || 'Player')}</p>
                            <p class="text-[9px] text-neutral-500 font-mono-tag">${escapeHtml(m.rank || 'Active Roster')}</p>
                        </div>
                    </div>
                    ${roleBadge}
                </div>`;
        }).join('');
    }

    // Roles Needed
    const rolesListEl = qs('#td-roles-list');
    if (rolesListEl) {
        if (team.roles && team.roles.length > 0) {
            rolesListEl.innerHTML = team.roles.map(r => `
                <span class="bg-[#FFD700]/10 text-[#FFD700] border border-[#FFD700]/30 font-mono-tag font-bold text-[10px] px-2.5 py-1 rounded-lg uppercase tracking-wider">
                    ${escapeHtml(r.trim())}
                </span>
            `).join('');
        } else {
            rolesListEl.innerHTML = `<span class="text-neutral-500 italic text-xs">Any competitive role welcome</span>`;
        }
    }

    // Description
    if (qs('#td-description')) {
        qs('#td-description').textContent = team.description || 'No team mission description provided yet.';
    }

    // Discord / External Links
    const linksWrap = qs('#td-links-wrap');
    const discordLinkEl = qs('#td-discord-link');
    if (linksWrap && discordLinkEl) {
        if (team.contactLink) {
            discordLinkEl.href = team.contactLink;
            linksWrap.classList.remove('hidden');
        } else {
            linksWrap.classList.add('hidden');
        }
    }

    // Footer Actions
    const footerActionsEl = qs('#td-footer-actions');
    if (footerActionsEl) {
        let actionBtnHtml = '';
        if (isAuthor || isMember) {
            actionBtnHtml = `
                <button onclick="window.closeTeamDetailsModal(); window.openManageModal('${team.id}');"
                    class="py-2.5 px-5 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 rounded-lg text-xs font-heading font-bold uppercase tracking-wider transition-all cursor-pointer">
                    Manage Team Dashboard &rarr;
                </button>`;
        } else if (isFull) {
            actionBtnHtml = `
                <button disabled
                    class="py-2.5 px-5 bg-neutral-900 text-neutral-500 border border-neutral-800 rounded-lg text-xs font-heading font-bold uppercase tracking-wider cursor-not-allowed">
                    Roster is Currently Full
                </button>`;
        } else {
            actionBtnHtml = `
                <button onclick="window.closeTeamDetailsModal(); window.openApplicationModal('${team.id}', '${escapeHtml(team.name)}');"
                    class="py-2.5 px-6 bg-[#FFD700] hover:bg-[#FFF099] text-black font-heading font-bold text-xs uppercase tracking-wider rounded-lg shadow-lg hover:shadow-yellow-500/25 active:scale-95 transition-all cursor-pointer flex items-center gap-1.5">
                    <span>Apply to Join Team</span> &rarr;
                </button>`;
        }

        footerActionsEl.innerHTML = `
            <button type="button" onclick="window.closeTeamDetailsModal()"
                class="py-2.5 px-4 bg-white/5 hover:bg-white/10 text-neutral-400 hover:text-white rounded-lg text-xs font-heading font-bold uppercase tracking-wider transition-colors border border-white/10 cursor-pointer">
                Close
            </button>
            ${actionBtnHtml}`;
    }

    modal.classList.remove('hidden');
};

window.closeTeamDetailsModal = () => {
    const modal = document.getElementById('teamDetailsModal');
    if (modal) modal.classList.add('hidden');
};

function renderPlayerCard(post, isAuthor) {
    const borderClass = "border-white/10 hover:border-[#FFD700] hover:shadow-[0_0_20px_rgba(255,215,0,0.15)]";
    const verifiedBadge = post.isPremium ? `<span class="bg-[#FFD700] text-black text-[8px] font-mono-tag font-bold px-1 py-0.2 rounded uppercase">PRO</span>` : '';
    const avatarUrl = post.image || `https://ui-avatars.com/api/?name=${encodeURIComponent(post.ign || 'Player')}&background=111116&color=FFD700`;
    const gameBadge = formatGameBadge(post.game || post.gameId);

    let actionBtn = '';
    if (isAuthor) {
        actionBtn = `
            <button onclick="window.openLftManageModal('${post.id}')" class="flex-1 py-1.5 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 rounded-lg text-[11px] font-heading font-bold uppercase tracking-wider transition-all cursor-pointer text-center">
                Manage
            </button>`;
    } else {
        actionBtn = `
            <button onclick="window.startLftChat('${post.id}', '${escapeHtml(post.ign)}')" class="flex-1 py-1.5 bg-[#FFD700] hover:bg-[#FFF099] text-black rounded-lg text-[11px] font-heading font-bold uppercase tracking-wider transition-all shadow-sm active:scale-95 flex items-center justify-center gap-1 cursor-pointer font-semibold">
                <span>Message</span>
            </button>`;
    }

    return `
        <article data-id="${post.id}" class="bg-[#0D0D12] border rounded-xl p-3 transition-all duration-200 group flex flex-col justify-between relative ${borderClass}">
            <div class="blimp-container static mb-1.5"></div>

            <div>
                <!-- Top Header: Game Badge & LFT Status -->
                <div class="flex items-center justify-between gap-1.5 mb-2">
                    <span class="bg-black/80 text-[#FFD700] border border-[#FFD700]/30 font-mono-tag font-bold text-[8px] px-1.5 py-0.2 rounded uppercase tracking-wider truncate">
                        ${escapeHtml(gameBadge)}
                    </span>
                    <span class="bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 text-[8px] font-mono-tag font-bold px-1.5 py-0.2 rounded-full uppercase tracking-wider shrink-0">
                        FREE AGENT
                    </span>
                </div>

                <!-- Player Identity -->
                <div class="flex items-center gap-2.5 mb-2">
                    <img src="${escapeHtml(avatarUrl)}" class="w-9 h-9 rounded-lg border border-white/10 object-cover shadow-sm shrink-0 group-hover:border-[#FFD700]/50 transition-colors" alt="Avatar">
                    <div class="min-w-0 flex-1">
                        <h3 class="text-sm font-heading font-bold text-white truncate group-hover:text-[#FFD700] transition-colors flex items-center gap-1">
                            ${escapeHtml(post.ign || 'Player')} ${verifiedBadge}
                        </h3>
                        <p class="text-[9px] text-neutral-400 font-mono-tag truncate">
                            Role: <span class="text-neutral-200 font-semibold">${escapeHtml(post.role || 'Flex')}</span>
                        </p>
                    </div>
                </div>

                <!-- Tactical Stats HUD -->
                <div class="grid grid-cols-2 gap-1.5 mb-2 bg-black/40 p-2 rounded-lg border border-white/5">
                    <div class="min-w-0">
                        <p class="text-[7px] text-neutral-500 uppercase font-mono-tag font-bold tracking-tight">Rank</p>
                        <p class="text-[11px] text-[#FFD700] font-heading font-bold truncate mt-0.2">${escapeHtml(post.rank || 'Unranked')}</p>
                    </div>
                    <div class="min-w-0">
                        <p class="text-[7px] text-neutral-500 uppercase font-mono-tag font-bold tracking-tight">Status</p>
                        <p class="text-[11px] text-emerald-400 font-heading font-bold truncate mt-0.2">Available</p>
                    </div>
                </div>
            </div>

            <div class="pt-1.5 border-t border-white/5 flex items-center gap-1.5">
                ${actionBtn}
            </div>
        </article>`;
}

function renderPlayerRow(post, isAuthor) {
    const verifiedBadge = post.isPremium ? `<span class="bg-[#FFD700] text-black text-[8px] font-mono-tag font-bold px-1 py-0.2 rounded uppercase">PRO</span>` : '';
    const avatarUrl = post.image || `https://ui-avatars.com/api/?name=${encodeURIComponent(post.ign || 'Player')}&background=111116&color=FFD700`;
    const gameBadge = formatGameBadge(post.game || post.gameId);

    let actionBtn = isAuthor
        ? `<button onclick="window.openLftManageModal('${post.id}')" class="px-3 py-1.5 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 rounded-lg text-[11px] font-heading font-bold uppercase tracking-wider transition-all cursor-pointer">Manage</button>`
        : `<button onclick="window.startLftChat('${post.id}', '${escapeHtml(post.ign)}')" class="px-3 py-1.5 bg-[#FFD700] hover:bg-[#FFF099] text-black rounded-lg text-[11px] font-heading font-bold uppercase tracking-wider transition-all shadow-sm active:scale-95 flex items-center gap-1 cursor-pointer font-semibold">Message</button>`;

    return `
        <div data-id="${post.id}" class="bg-[#0D0D12] hover:bg-[#12121A] border border-white/10 hover:border-[#FFD700]/50 rounded-xl p-3 sm:px-4 sm:py-2.5 transition-all duration-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 group">
            <div class="flex items-center gap-3 min-w-0 flex-1">
                <img src="${escapeHtml(avatarUrl)}" class="w-9 h-9 rounded-lg object-cover border border-white/10 shrink-0 group-hover:border-[#FFD700]/50 transition-colors" alt="Avatar">
                <div class="min-w-0 flex-1">
                    <div class="flex items-center gap-1.5">
                        <span class="font-heading font-bold text-white text-sm truncate group-hover:text-[#FFD700] transition-colors">${escapeHtml(post.ign || 'Player')}</span>
                        ${verifiedBadge}
                        <div class="blimp-container"></div>
                    </div>
                    <div class="flex items-center gap-2 text-[10px] text-neutral-400 font-mono-tag">
                        <span class="text-[#FFD700] font-bold">${escapeHtml(gameBadge)}</span>
                        <span class="text-neutral-600">•</span>
                        <span>Rank: <strong class="text-neutral-300 font-medium">${escapeHtml(post.rank || 'Unranked')}</strong></span>
                        <span class="text-neutral-600">•</span>
                        <span>Role: <strong class="text-neutral-300 font-medium">${escapeHtml(post.role || 'Flex')}</strong></span>
                    </div>
                </div>
            </div>

            <div class="flex items-center gap-2 shrink-0 w-full sm:w-auto justify-end">
                <span class="bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 text-[9px] font-mono-tag font-bold px-2 py-0.5 rounded-full uppercase shrink-0">Free Agent</span>
                ${actionBtn}
            </div>
        </div>`;
}

let activeLftChatId = null; // Stores the UID of the person the creator is chatting with

// 1. For a user to start a chat with the lister
window.startLftChat = async (listingId, ign) => {
    const user = auth.currentUser;
    if (!user) return window.showCustomAlert("Login Required", "Please log in to message players.");

    // Check if listing belongs to the user
    let post = cachedRecruitmentPosts.find(p => p.id === listingId);
    if (!post) {
        try {
            const d = await getDoc(doc(db, "recruitment", listingId));
            if (d.exists()) post = { id: d.id, ...d.data() };
        } catch(e){}
    }
    if (post && (post.authorId === user.uid || post.userId === user.uid)) {
        return window.openLftManageModal(listingId);
    }

    currentManageId = listingId;
    activeLftChatId = user.uid;

    // CHANGE: Open the LFT Modal, not the Manage Team Modal
    const lftModal = document.getElementById('manageLftModal');
    if (lftModal) {
        lftModal.classList.remove('hidden');

        // Set the UI labels
        document.getElementById('lft-manage-name').textContent = `Chat with ${ign}`;

        // Switch to the chat tab in the LFT modal
        window.switchLftTab('chat');

        // Hide the "Inboxes" tab button because the sender doesn't need to see other people's chats
        const inboxTabBtn = document.getElementById('lft-tab-inbox');
        if (inboxTabBtn) inboxTabBtn.style.display = 'none';

        startLftChatListener(listingId, activeLftChatId);
    }
};

// 2. For the creator to see who messaged them
window.openLftManageModal = async (listingId) => {
    currentManageId = listingId;
    activeLftChatId = null;

    // Use the NEW modal ID
    document.getElementById('manageLftModal').classList.remove('hidden');
    switchLftTab('inbox');
    loadLftInboxes(listingId);
};

//close
window.closeLftModal = () => {
    document.getElementById('manageLftModal').classList.add('hidden');
    if (chatUnsubscribe) chatUnsubscribe();
};

window.switchLftTab = (tab) => {
    document.querySelectorAll('.lft-manage-view').forEach(el => el.classList.add('hidden'));
    const target = document.getElementById(`lft-view-${tab}`);
    if (target) target.classList.remove('hidden');

    // Style the two tabs
    const tabs = ['inbox', 'chat'];
    tabs.forEach(t => {
        const btn = document.getElementById(`lft-tab-${t}`);
        if (btn) {
            btn.className = (t === tab)
                ? "flex-1 py-3 text-xs font-heading font-bold uppercase tracking-wider text-[#FFD700] border-b-2 border-[#FFD700] bg-white/5 cursor-pointer"
                : "flex-1 py-3 text-xs font-heading font-bold uppercase tracking-wider text-neutral-400 hover:text-white hover:bg-white/5 cursor-pointer";
        }
    });
};

// 3. Listener specifically for Private LFT Chats
function startLftChatListener(listingId, participantUid) {
    const chatContainer = document.getElementById('lft-chat-messages');
    const isCreator = !auth.currentUser || auth.currentUser.uid !== participantUid;
    const backBtnHtml = isCreator ?
        `<button onclick="window.switchLftTab('inbox')" class="mb-4 text-[var(--gold)] text-xs font-bold flex items-center gap-1 hover:underline">← Back to Inboxes</button>` : '';

    const q = query(
        collection(db, "recruitment", listingId, "private_chats", participantUid, "messages"),
        orderBy("createdAt", "asc")
    );

    if (chatUnsubscribe) chatUnsubscribe();
chatUnsubscribe = onSnapshot(q, async (snapshot) => {
    chatContainer.innerHTML = backBtnHtml;
    let lastDateLabel = null;

    const docs = snapshot.docs.map(d => d.data());
    const resolvedNames = await Promise.all(docs.map(msg => getUserDisplayName(msg.senderId, msg.senderName)));

    docs.forEach((msg, i) => {
        const senderDisplayName = resolvedNames[i];
        const isMe = auth.currentUser && msg.senderId === auth.currentUser.uid;
            const dateObj = msg.createdAt ? msg.createdAt.toDate() : new Date();

            const dateLabel = dateObj.toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' });
            const timeString = dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

            // DATE DIVIDER LOGIC
            if (dateLabel !== lastDateLabel) {
                const dateDivider = document.createElement('div');
                dateDivider.className = "flex justify-center my-6";
                dateDivider.innerHTML = `<span class="bg-white/5 text-gray-500 text-[9px] px-3 py-1 rounded-full border border-white/5 uppercase tracking-widest font-bold">${dateLabel}</span>`;
                chatContainer.appendChild(dateDivider);
                lastDateLabel = dateLabel;
            }

            const bubble = document.createElement('div');
            bubble.className = `chat-bubble ${isMe ? 'mine' : 'theirs'} mb-3 shadow-md flex flex-col`;
            bubble.innerHTML = `
                <div class="flex justify-between items-baseline mb-1 w-full gap-4">
                    <span class="font-bold text-[10px] opacity-75">${escapeHtml(senderDisplayName)}</span>
                    <span class="text-[9px] opacity-50 font-mono">${timeString}</span>
                </div>
                <div class="leading-relaxed break-words">${escapeHtml(msg.text)}</div>`;
            chatContainer.appendChild(bubble);
        });
        chatContainer.scrollTop = chatContainer.scrollHeight;
    });
}

async function loadLftInboxes(listingId) {
    // CHANGE: Target 'lft-inbox-list' instead of 'applications-list'
    const list = document.getElementById('lft-inbox-list');
    list.innerHTML = '<p class="text-center text-gray-500 py-4 text-sm animate-pulse">Checking messages...</p>';

    try {
        const chatCollectionRef = collection(db, "recruitment", listingId, "private_chats");
        const snap = await getDocs(chatCollectionRef);
        list.innerHTML = '';

        if (snap.empty) {
            list.innerHTML = '<p class="text-center text-gray-500 py-4 text-sm">No messages yet.</p>';
            return;
        }

        snap.forEach(chatDoc => {
            const chatData = chatDoc.data();
            const participantName = chatData.participantName || "Interested Player";
            const lastMsg = chatData.lastMessage || "Sent a message...";

            const div = document.createElement('div');
            div.className = "bg-black/20 p-4 rounded-lg border border-white/5 mb-3 hover:border-[var(--gold)] cursor-pointer transition-all flex justify-between items-center";
            div.innerHTML = `
                <div>
                    <div class="font-bold text-white text-sm">${escapeHtml(participantName)}</div>
                    <div class="text-[10px] text-gray-400 truncate max-w-[200px]">${escapeHtml(lastMsg)}</div>
                </div>
                <div class="text-[var(--gold)] text-xs font-bold">Open Chat</div>
            `;
            div.onclick = () => {
                activeLftChatId = chatDoc.id;
                window.switchLftTab('chat'); // Use the LFT switch function
                startLftChatListener(listingId, activeLftChatId); // Start listener
            };
            list.appendChild(div);
        });
    } catch (err) {
        console.error("Inbox Load Error:", err);
    }
}

// Admin function to view all private conversations for a specific LFT listing
window.openLftAdminLogs = async (listingId) => {
    if (currentUserRole !== 'admin') return;

    currentManageId = listingId;
    const modal = document.getElementById('manageTeamModal');
    modal.classList.remove('hidden');

    // Set UI title
    document.getElementById('manage-team-name').textContent = "ADMIN LOGS: Private Chats";

    // Reuse the "Inboxes" logic but with Admin permissions
    const inboxTab = document.getElementById('tab-applications');
    inboxTab.style.display = 'block';
    inboxTab.textContent = "All Chat Logs";

    window.switchManageTab('applications');
    loadLftInboxes(listingId); // This will now fetch all private_chats sub-collections
};

// --- UTILS ---
window.toggleFormType = (type) => {
    const hiddenType = document.getElementById('create-type');
    if (hiddenType) hiddenType.value = type;
    const btnTeam = document.getElementById('btn-type-team');
    const btnLft = document.getElementById('btn-type-lft');
    const teamFields = document.getElementById('team-fields');
    const lftFields = document.getElementById('lft-fields');
    const ignField = document.getElementById('lft-ign-field');
    const syncBanner = document.getElementById('lft-sync-banner');
    const descLabel = document.getElementById('desc-label');
    const descInput = document.getElementById('create-desc');
    const gameSelect = document.getElementById('create-game');

    if (type === 'team') {
        if (btnTeam) btnTeam.className = "py-2.5 rounded-lg bg-[#FFD700] text-black shadow-md transition-all cursor-pointer font-heading text-xs uppercase font-bold tracking-wider";
        if (btnLft) btnLft.className = "py-2.5 rounded-lg text-neutral-400 hover:text-white transition-all cursor-pointer font-heading text-xs uppercase font-bold tracking-wider";
        if (teamFields) teamFields.classList.remove('hidden');
        if (lftFields) lftFields.classList.add('hidden');
        if (ignField) ignField.classList.add('hidden');
        if (syncBanner) syncBanner.classList.add('hidden');
        if (descLabel) descLabel.innerHTML = 'Team Description &amp; Requirements <span class="text-red-500">*</span>';
        if (descInput) descInput.placeholder = "Tell potential recruits about your team's practice schedule, tournament goals, and requirements...";
    } else {
        if (btnLft) btnLft.className = "py-2.5 rounded-lg bg-[#FFD700] text-black shadow-md transition-all cursor-pointer font-heading text-xs uppercase font-bold tracking-wider";
        if (btnTeam) btnTeam.className = "py-2.5 rounded-lg text-neutral-400 hover:text-white transition-all cursor-pointer font-heading text-xs uppercase font-bold tracking-wider";
        if (lftFields) lftFields.classList.remove('hidden');
        if (teamFields) teamFields.classList.add('hidden');
        if (ignField) ignField.classList.remove('hidden');
        if (descLabel) descLabel.innerHTML = 'LFT Summary &amp; Playstyle Goals <span class="text-red-500">*</span>';
        if (descInput) descInput.placeholder = "Describe your agent pool, schedule availability, and tournament ambitions...";
        
        // Auto-sync profile info immediately
        const selectedGame = gameSelect ? gameSelect.value : '';
        syncProfileToLftForm(selectedGame);
    }
}

// Auto-sync helper to pull fixed profile data into Player LFT form
async function syncProfileToLftForm(selectedGame) {
    if (!auth.currentUser) return;
    
    const ignCard = document.getElementById('lft-card-ign');
    const rankCard = document.getElementById('lft-card-rank');
    const roleCard = document.getElementById('lft-card-role');
    const discordCard = document.getElementById('lft-card-discord');
    const emailCard = document.getElementById('lft-card-email');
    const warningBox = document.getElementById('lft-profile-warning');

    const ignInput = document.getElementById('create-ign');
    const rankInput = document.getElementById('create-rank');
    const roleInput = document.getElementById('create-main-role');
    const discordInput = document.getElementById('create-discord');
    const emailInput = document.getElementById('create-email');
    const descInput = document.getElementById('create-desc');
    const imgInput = document.getElementById('create-img');

    try {
        const userSnap = await getDoc(doc(db, "users", auth.currentUser.uid));
        const data = userSnap.exists() ? (userSnap.data() || {}) : {};

        const rankMap = { valId: 'valRank', mlbbId: 'mlbbRank', hokId: 'hokRank' };
        const roleMap = { valId: 'valRole', mlbbId: 'mlbbRole', hokId: 'hokRole' };

        // 1. In-Game Name
        const gameIgn = selectedGame && data[selectedGame] ? data[selectedGame] : (data.ign || data.displayName || '');
        if (ignCard) ignCard.textContent = gameIgn || 'Not set';
        if (ignInput) ignInput.value = gameIgn;

        // 2. Rank
        const gameRank = selectedGame && rankMap[selectedGame] && data[rankMap[selectedGame]] ? data[rankMap[selectedGame]] : (data.rank || 'Unranked');
        if (rankCard) rankCard.textContent = gameRank;
        if (rankInput) rankInput.value = gameRank;

        // 3. Main Role
        const gameRole = selectedGame && roleMap[selectedGame] && data[roleMap[selectedGame]] ? data[roleMap[selectedGame]] : 'Flex / Any';
        if (roleCard) roleCard.textContent = gameRole;
        if (roleInput) roleInput.value = gameRole;

        // 4. Discord Handle
        const discordVal = data.discord || data.discordTag || '';
        if (discordCard) discordCard.textContent = discordVal || 'Not set';
        if (discordInput) discordInput.value = discordVal;

        // 5. Email
        const emailVal = data.email || auth.currentUser.email || '';
        if (emailCard) emailCard.textContent = emailVal || 'Not set';
        if (emailInput) emailInput.value = emailVal;

        // 6. Avatar
        const avatarVal = data.avatar || auth.currentUser.photoURL || '';
        if (imgInput) imgInput.value = avatarVal;

        // 7. Autofill Bio into LFT Summary if empty
        if (descInput && (!descInput.value || descInput.value.trim() === '')) {
            descInput.value = data.bio || '';
        }

        // 8. Warning if missing game ID or Discord
        if (warningBox) {
            if (selectedGame && (!gameIgn || !data[selectedGame] || !discordVal)) {
                warningBox.classList.remove('hidden');
            } else {
                warningBox.classList.add('hidden');
            }
        }

    } catch (err) {
        console.warn("Failed to auto-sync profile to LFT form:", err);
    }
}

window.openCreateModal = async () => {
    if (!auth.currentUser) { window.showCustomAlert("Login Required", "Please log in to post a listing."); return; }

    const isAdminOrSub = currentUserRole === 'admin' || currentUserRole === 'subscriber';

    if (TEAM_RECRUITMENT_ENABLED) {
        const btnTeam = document.getElementById('btn-type-team');
        if (btnTeam) {
            btnTeam.classList.remove('opacity-50', 'cursor-not-allowed');
            btnTeam.onclick = () => toggleFormType('team');
        }
        toggleFormType('team');
    } else if (isAdminOrSub) {
        const btnTeam = document.getElementById('btn-type-team');
        if (btnTeam) {
            btnTeam.classList.remove('opacity-50', 'cursor-not-allowed');
            btnTeam.onclick = () => toggleFormType('team');
        }
        toggleFormType('team');
    } else {
        toggleFormType('lft');
        const btnTeam = document.getElementById('btn-type-team');
        if (btnTeam) {
            btnTeam.classList.add('opacity-50', 'cursor-not-allowed');
            btnTeam.onclick = (e) => { e.stopPropagation(); window.showCustomAlert("Premium Feature", "Team Recruitment is available for Subscribers and Admins only."); };
        }
    }

    animateGenericOpen('createTeamModal', 'createTeamBackdrop', 'createTeamPanel');
}

window.closeCreateModal = () => { animateGenericClose('createTeamModal', 'createTeamBackdrop', 'createTeamPanel', () => { qs('#createTeamForm').reset(); }); }

function startKickListener(uid) {
    const q = query(collectionGroup(db, 'applications'), where('applicantId', '==', uid), where('status', '==', 'kicked'));
    kickUnsubscribe = onSnapshot(q, async (snapshot) => {
        for (const change of snapshot.docChanges()) {
            if (change.type === 'added') {
                await window.showCustomAlert("Notification", `You have been kicked from a team.`);
                await deleteDoc(change.doc.ref);
                renderTeams();
            }
        }
    });
}

// --- MANAGEMENT LOGIC ---

window.openManageModal = async (teamId) => {
    currentManageId = teamId;
    activeLftChatId = null;

    // --- INSTANT UI UPDATE: CLEAR RED BLIMP ---
    localStorage.setItem(`lastRead_${teamId}`, Date.now().toString());
    updateBlimpUI(teamId, 'red', false);
    // ------------------------------------------

    document.getElementById('manageTeamModal').classList.remove('hidden');

    document.querySelector('#manageTeamModal h3').textContent = "Team Dashboard";

    // Hide administrative elements by default
    document.querySelectorAll('.admin-only').forEach(el => el.style.display = 'none');
    document.getElementById('btn-disband').style.display = 'none';

    try {
        const snap = await getDoc(doc(db, "recruitment", teamId));
        if (snap.exists()) {
            const data = snap.data();
            document.getElementById('manage-team-name').textContent = data.name;

            // Determine Role: Captain, Vice Captain, or Member
            myTeamRole = 'Member';
            if (auth.currentUser && data.authorId === auth.currentUser.uid) {
                myTeamRole = 'Captain';
            } else if (auth.currentUser && data.members) {
                const memberData = data.members.find(m => m.uid === auth.currentUser.uid);
                if (memberData && memberData.role === 'Vice Captain') {
                    myTeamRole = 'Vice Captain';
                }
            }

            // Logic for Captains and Vice Captains
            const canManage = myTeamRole === 'Captain' || myTeamRole === 'Vice Captain';

            if (canManage) {
                document.querySelectorAll('.admin-only').forEach(el => el.style.display = 'block'); // Show Requests/Settings tabs
                loadApplications(teamId);

                // Only Captain can edit Team Info and Disband
                if (myTeamRole === 'Captain') {
                    document.getElementById('edit-team-id').value = teamId;
                    document.getElementById('edit-desc').value = data.description;
                    document.getElementById('edit-max').value = data.maxMembers;
                    const appsOpen = data.applicationsOpen !== false;
                    const toggleBtn = document.getElementById('toggle-applications');
                    const toggleKnob = document.getElementById('toggle-applications-knob');
                    if (toggleBtn && toggleKnob) {
                        toggleBtn.setAttribute('aria-checked', appsOpen ? 'true' : 'false');
                        toggleBtn.classList.toggle('bg-indigo-600', appsOpen);
                        toggleBtn.classList.toggle('bg-white/20', !appsOpen);
                        toggleKnob.classList.toggle('translate-x-5', appsOpen);
                        toggleKnob.classList.toggle('translate-x-0', !appsOpen);
                    }
                    document.getElementById('edit-form-container').classList.remove('hidden');
                    document.getElementById('btn-disband').style.display = 'block';
                } else {
                    document.getElementById('edit-form-container').classList.add('hidden');
                    document.getElementById('btn-disband').style.display = 'none';
                }
            } else {
                // Regular members hide Requests/Settings tabs
                document.querySelectorAll('.admin-only').forEach(el => el.style.display = 'none');
            }

            renderRosterList(data.members || []);
            startChatListener(teamId);
            window.switchManageTab('chat');
        }
    } catch (err) { console.error(err); }
}

window.closeManageModal = () => {
    document.getElementById('manageTeamModal').classList.add('hidden');
    if (chatUnsubscribe) chatUnsubscribe();
    currentManageId = null;
    myTeamRole = null;
    // We don't need to re-render teams fully, just let listeners handle it, 
    // but re-rendering ensures data consistency if other things changed.
    // However, for smooth UI, we can avoid it. But let's keep it for safety.
    // renderTeams(); // Optional: Removed to prevent flicker, listeners handle blimps
}

window.switchManageTab = (tabName) => {
    document.querySelectorAll('.manage-view').forEach(el => el.classList.add('hidden'));
    const targetView = document.getElementById(`view-${tabName}`);
    if (targetView) targetView.classList.remove('hidden');

    // Style tabs
    ['chat', 'roster', 'applications', 'settings'].forEach(t => {
        const btn = document.getElementById(`tab-${t}`);
        if (btn) {
            btn.className = "flex-1 py-3 text-xs font-heading font-bold uppercase tracking-wider text-neutral-400 hover:text-white hover:bg-white/5 transition-all cursor-pointer";
            btn.style.borderBottom = "none";
        }
    });
    const activeBtn = document.getElementById(`tab-${tabName}`);
    if (activeBtn) {
        activeBtn.className = "flex-1 py-3 text-xs font-heading font-bold uppercase tracking-wider text-[#FFD700] bg-white/5 transition-all cursor-pointer";
        activeBtn.style.borderBottom = "2px solid #FFD700";
    }

    // NEW: If switching to Chat, ensure we use the correct listener
    if (tabName === 'chat' && currentManageId) {
        if (activeLftChatId) {
            // It's a private LFT chat
            startLftChatListener(currentManageId, activeLftChatId);
        } else {
            // It's a standard team chat
            startChatListener(currentManageId);
        }
    }
}

// HANDLE APPLICATION FUNCTION
window.handleApp = async (appId, applicantId, applicantName, isAccept) => {
    if (!currentManageId) return;
    // Security check: Only Captain or Vice Captain
    if (myTeamRole !== 'Captain' && myTeamRole !== 'Vice Captain') {
        await window.showCustomAlert("Unauthorized", "Only Captains and Vice Captains can manage requests.");
        return;
    }

    const action = isAccept ? "Accept" : "Reject";
    if (!await window.showCustomConfirm(`${action} Applicant?`, `Are you sure you want to ${action.toLowerCase()} this player?`)) return;

    try {
        const teamRef = doc(db, "recruitment", currentManageId);
        const appRef = doc(db, "recruitment", currentManageId, "applications", appId);

        if (isAccept) {
            const teamSnap = await getDoc(teamRef);
            if (!teamSnap.exists()) return;
            const data = teamSnap.data();

            if ((data.members || []).length >= data.maxMembers) {
                await window.showCustomAlert("Roster Full", "Cannot accept more members. The team is full.");
                return;
            }
            let applicantIgn = applicantName; // fallback to name if nothing else
                try {
                    const userSnap = await getDoc(doc(db, "users", applicantId));
                    if (userSnap.exists()) {
                        const userData = userSnap.data();
                        applicantIgn = userData.ign || userData.displayName || userData.username || applicantName;
                    }
                } catch (e) { /* silently fall back */ }


            const newMember = {
                uid: applicantId,
                name: applicantName,
                ign: applicantIgn,
                role: 'Member', // Default role
                joinedAt: Date.now()
            };

            await updateDoc(teamRef, {
                members: arrayUnion(newMember),
                currentMembers: (data.members || []).length + 1
            });
            await updateDoc(appRef, { status: 'accepted' });
            if (window.sendPlayerNotification) {
                await window.sendPlayerNotification(applicantId, {
                    title: "Team Application Accepted",
                    message: `You have been officially accepted into ${data.name || 'the team'}!`,
                    type: 'team',
                    tag: 'ROSTER ACCEPTED',
                    link: `/teams?id=${currentManageId}`
                });
            }
            const applicantDisplayName = await getUserDisplayName(applicantId, applicantName);
            await sendSystemMessage(currentManageId, `${applicantDisplayName} has joined the team`);
            await window.showCustomAlert("Success", "Player accepted into the roster!");
        } else {
            await updateDoc(appRef, { status: 'rejected' });
            if (window.sendPlayerNotification) {
                await window.sendPlayerNotification(applicantId, {
                    title: "Team Application Update",
                    message: `Your application to join the team was declined.`,
                    type: 'team',
                    tag: 'DECLINED',
                    link: `/teams`
                });
            }
            await window.showCustomAlert("Rejected", "Application rejected.");
        }
        loadApplications(currentManageId);
        const updatedSnap = await getDoc(teamRef);
        renderRosterList(updatedSnap.data().members || []);

    } catch (error) {
        console.error("Handle App Error:", error);
        await window.showCustomAlert("Error", "Action failed: " + error.message);
    }
};

window.deleteListing = async (docId) => {
    // Standard delete for LFT players
    if (!await window.showCustomConfirm("Delete Listing?", "Are you sure?")) return;
    try { await deleteDoc(doc(db, "recruitment", docId)); await window.showCustomAlert("Deleted", "Listing removed."); renderTeams(); } catch (e) { console.error(e); }
};

window.toggleApplications = () => {
    const btn = document.getElementById('toggle-applications');
    const knob = document.getElementById('toggle-applications-knob');
    if (!btn || !knob) return;
    const isOn = btn.getAttribute('aria-checked') === 'true';
    const newState = !isOn;
    btn.setAttribute('aria-checked', newState ? 'true' : 'false');
    btn.classList.toggle('bg-indigo-600', newState);
    btn.classList.toggle('bg-white/20', !newState);
    knob.classList.toggle('translate-x-5', newState);
    knob.classList.toggle('translate-x-0', !newState);
    // Show the notice when the user toggles the switch
    const warningNotice = document.getElementById('unsaved-warning');
    if (warningNotice) {
        warningNotice.classList.remove('hidden');
    }
};

window.invitePlayer = async (uid, playerName) => {
    const user = auth.currentUser;
    if (!user) {
        window.showCustomAlert("Not Logged In", "You must be logged in to send invites.");
        return;
    }

    // 1. SELF-INVITE GUARD: Cannot invite yourself
    if (uid === user.uid) {
        window.showCustomAlert("Invalid Action", "You cannot invite yourself to your own team.");
        return;
    }

    if (!currentManageId) {
        window.showCustomAlert("Error", "No team context found. Please re-open the team dashboard.");
        return;
    }

    try {
        // Fetch the team document to get the team name
        const teamSnap = await getDoc(doc(db, "recruitment", currentManageId));
        if (!teamSnap.exists()) {
            window.showCustomAlert("Error", "Team not found.");
            return;
        }
        const teamData = teamSnap.data();

        // 2. EXISTING ROSTER GUARD: Cannot invite existing members or captain
        const isCaptain = teamData.captainId === uid || teamData.userId === uid || teamData.createdBy === uid || teamData.leaderId === uid || teamData.authorId === uid;
        const isAlreadyMember = Array.isArray(teamData.members) && teamData.members.some(m => {
            const mUid = typeof m === 'object' ? (m.uid || m.userId) : m;
            return mUid === uid;
        });

        if (isCaptain || isAlreadyMember) {
            window.showCustomAlert("Already on Roster", `${playerName || 'This player'} is already a member of this team.`);
            return;
        }

        // Check if an invite already exists for this user
        const existingInviteSnap = await getDoc(doc(db, "users", uid, "invites", currentManageId));
        if (existingInviteSnap.exists()) {
            window.showCustomAlert("Already Invited", `${playerName} has already been invited to this team.`);
            return;
        }

        // Write the invite
        const inviterSnap = await getDoc(doc(db, "users", user.uid));
        const inviterName = inviterSnap.exists() 
            ? (inviterSnap.data().displayName || inviterSnap.data().name || user.displayName || "Team Captain")
            : (user.displayName || "Team Captain");

        await setDoc(doc(db, "users", uid, "invites", currentManageId), {
            teamId: currentManageId,
            teamName: teamData.name || "Unknown Team",
            invitedBy: user.uid,
            invitedByName: inviterName,
            invitedAt: serverTimestamp(),
            status: "pending"
        });

        window.showCustomAlert("Invite Sent!", `${playerName} has been invited to join ${teamData.name}.`);

    } catch (e) {
        // Log the FULL error so we can see exactly which path was denied
        console.error("❌ invitePlayer failed:", e.code, e.message, e);
        throw e; // Re-throw so inviteByUid catch can also see it
    }
};

window.inviteByUid = async () => {
    if (myTeamRole !== 'Captain' && myTeamRole !== 'Vice Captain') {
        window.showCustomAlert("Permission Denied", "Only Captains or Vice Captains can invite players.");
        return;
    }

    const input = document.getElementById('invite-uid-input');
    if (!input) return;
    
    const uid = input.value.trim();

    if (!uid) {
        window.showCustomAlert("Missing ID", "Please paste or enter a player's Recruitment ID.");
        return;
    }

    // Direct self-invite check
    if (auth.currentUser && uid === auth.currentUser.uid) {
        window.showCustomAlert("Invalid Action", "You cannot invite yourself to your own team.");
        return;
    }

    try {
        // Attempt to pull user profile data if it exists
        const userSnap = await getDoc(doc(db, "users", uid));
        let playerName = "Recruited Player";

        // SAFELY check if the document exists AND contains data before reading fields
        if (userSnap.exists() && userSnap.data()) {
            const data = userSnap.data();
            playerName = data.displayName || data.name || data.ign || playerName;
        } else {
            console.warn(`No user document found in Firestore for UID: ${uid}. Proceeding with fallback name.`);
        }

        // Send the invite directly using the provided UID and resolved name
        await window.invitePlayer(uid, playerName);
        
        // Clear input field on success
        input.value = "";
        
    } catch (e) {
        console.error("Invite processing error:", e);
        window.showCustomAlert("Error", "Failed to process invitation. Please check the ID string.");
    }
};

window.declineInvite = async (inviteDocId) => {
    const user = auth.currentUser;
    if (!user) return;

    await deleteDoc(doc(db, "users", user.uid, "invites", inviteDocId));
    renderTeams(); // Refresh
};

window.disbandTeam = async () => {
    if (myTeamRole !== 'Captain') {
        window.showCustomAlert("Unauthorized", "Only the Team Captain can disband the team.");
        return;
    }
    const confirmed = await window.showCustomConfirm("DISBAND TEAM?", "Warning: This will delete the team and kick all members. This action cannot be undone.");
    if (!confirmed) return;

    try {
        await deleteDoc(doc(db, "recruitment", currentManageId));
        window.closeManageModal();
        await window.showCustomAlert("Disbanded", "Team has been disbanded.");
        renderTeams();
    } catch (error) {
        console.error(error);
        window.showCustomAlert("Error", "Failed to disband team.");
    }
}

window.openApplicationModal = async (teamId, teamName) => {
    const user = auth.currentUser;
    if (!user) { window.showCustomAlert("Login Required", "Please log in to apply."); return; }

    let team = cachedRecruitmentPosts.find(p => p.id === teamId);
    if (!team) {
        try {
            const docSnap = await getDoc(doc(db, "recruitment", teamId));
            if (docSnap.exists()) team = { id: docSnap.id, ...docSnap.data() };
        } catch (e) { console.error(e); }
    }

    // Self-application guard: Cannot apply to own team or if already a member
    if (team) {
        const isCaptain = team.captainId === user.uid || team.userId === user.uid || team.createdBy === user.uid || team.leaderId === user.uid || team.authorId === user.uid;
        const isMember = Array.isArray(team.members) && team.members.some(m => {
            const mUid = typeof m === 'object' ? (m.uid || m.userId) : m;
            return mUid === user.uid;
        });
        if (isCaptain) {
            window.showCustomAlert("Cannot Apply", "You are the captain of this team.");
            return;
        }
        if (isMember) {
            window.showCustomAlert("Already on Roster", "You are already a member of this team.");
            return;
        }
    }

    document.getElementById('app-team-id').value = teamId;
    document.getElementById('app-team-name').textContent = teamName;

    // Auto-fill applicant rank and role based on user profile and team's game
    try {
        const userSnap = await getDoc(doc(db, "users", user.uid));
        if (userSnap.exists()) {
            const uData = userSnap.data() || {};
            const teamGame = String(team?.game || team?.gameId || '').toLowerCase();
            let rankVal = '';
            let roleVal = '';

            if (teamGame.includes('val')) {
                rankVal = uData.valRank || uData.rank || '';
                roleVal = uData.valRole || uData.role || '';
            } else if (teamGame.includes('mlbb') || teamGame.includes('mobile legends')) {
                rankVal = uData.mlbbRank || uData.rank || '';
                roleVal = uData.mlbbRole || uData.role || '';
            } else if (teamGame.includes('hok') || teamGame.includes('honor of kings')) {
                rankVal = uData.hokRank || uData.rank || '';
                roleVal = uData.hokRole || uData.role || '';
            } else {
                rankVal = uData.rank || uData.valRank || uData.mlbbRank || uData.hokRank || '';
                roleVal = uData.role || uData.valRole || uData.mlbbRole || uData.hokRole || '';
            }

            const appRank = document.getElementById('app-rank');
            const appRole = document.getElementById('app-role');
            const appNote = document.getElementById('app-note');

            if (appRank && !appRank.value) appRank.value = rankVal;
            if (appRole && !appRole.value) appRole.value = roleVal;
            if (appNote && !appNote.value && uData.bio) appNote.value = uData.bio;
        }
    } catch(err) { console.warn("Failed to auto-fill application fields:", err); }

    document.getElementById('applicationModal').classList.remove('hidden');
};

window.promoteMember = async (uid) => {
    if (myTeamRole !== 'Captain') return;
    if (!await window.showCustomConfirm("Promote Member?", "Promote this player to Vice Captain? They will be able to Accept applicants and Kick members.")) return;

    try {
        const teamRef = doc(db, "recruitment", currentManageId);
        const snap = await getDoc(teamRef);
        let members = snap.data().members;

        const index = members.findIndex(m => m.uid === uid);
        if (index !== -1) {
            // 1. Perform the update
            members[index].role = 'Vice Captain';
            await updateDoc(teamRef, { members: members });

            // 2. Send System Message
            // We use the name found in the array index we just modified
            const memberName = await getUserDisplayName(members[index].uid, members[index].name);
            await sendSystemMessage(currentManageId, `${memberName} has been promoted to Vice Captain`);
            // 3. Update UI
            renderRosterList(members);
            window.showCustomAlert("Success", "Member promoted to Vice Captain.");
        }
    } catch (error) { console.error(error); }
}

window.acceptInvite = async (inviteDocId, teamId, teamName) => {
    const user = auth.currentUser;
    if (!user) return;

    const confirmed = await window.showCustomConfirm("Accept Invite", `Join <strong>${teamName}</strong>?`);
    if (!confirmed) return;

    try {
        const playerName = await getUserDisplayName(user.uid, user.displayName || "Player");

        // Add the user to the team's members array
        await updateDoc(doc(db, "recruitment", teamId), {
            members: arrayUnion({ uid: user.uid, name: playerName, ign: playerName, role: "Member" }),
            currentMembers: increment(1)
        });

        // ✅ Post system message to team chat
        await sendSystemMessage(teamId, `${playerName} has joined the team via invite`);

        // Delete the invite
        await deleteDoc(doc(db, "users", user.uid, "invites", inviteDocId));

        await window.showCustomAlert("Joined!", `You are now a member of ${teamName}.`);
        renderTeams();

    } catch (e) {
        console.error("Accept invite error:", e);
        window.showCustomAlert("Error", "Failed to accept invite.");
    }
};

window.demoteMember = async (uid) => {
    if (myTeamRole !== 'Captain') return;
    if (!await window.showCustomConfirm("Demote Member?", "Remove Vice Captain status?")) return;

    try {
        const teamRef = doc(db, "recruitment", currentManageId);
        const snap = await getDoc(teamRef);
        let members = snap.data().members;

        const index = members.findIndex(m => m.uid === uid);
        if (index !== -1) {
            // 1. Perform the update
            members[index].role = 'Member';
            await updateDoc(teamRef, { members: members });

            // 2. Send System Message
            const memberName = await getUserDisplayName(members[index].uid, members[index].name);
            await sendSystemMessage(currentManageId, `${memberName} has been demoted to Member`);

            // 3. Update UI
            renderRosterList(members);
            window.showCustomAlert("Success", "Member demoted.");
        }
    } catch (error) { console.error(error); }
}

window.kickMember = async (uid, memberRole) => {
    if (myTeamRole === 'Member') return;
    if (myTeamRole === 'Vice Captain' && (memberRole === 'Captain' || memberRole === 'Vice Captain')) {
        window.showCustomAlert("Permission Denied", "Vice Captains cannot kick the Captain or other Vice Captains.");
        return;
    }

    const confirm = await window.showCustomConfirm("Kick Member?", "Are you sure you want to remove this player?");
    if (!confirm) return;
    try {
        const teamRef = doc(db, "recruitment", currentManageId);
        const appsRef = collection(db, "recruitment", currentManageId, "applications");
        const q = query(appsRef, where("applicantId", "==", uid));
        const appSnaps = await getDocs(q);
        await Promise.all(appSnaps.docs.map(d => updateDoc(d.ref, { status: 'kicked' })));

        const snap = await getDoc(teamRef);
        const allMembers = snap.data().members;
        const kickedMember = allMembers.find(m => m.uid === uid);
        const kickedName = kickedMember ? await getUserDisplayName(kickedMember.uid, kickedMember.name) : 'A member';
        const mems = allMembers.filter(m => m.uid !== uid);
        await updateDoc(teamRef, { members: mems, currentMembers: mems.length });

        await sendSystemMessage(currentManageId, `${kickedName} has been kicked from the team`);

        renderRosterList(mems);
        window.showCustomAlert("Kicked", "Member removed.");
    } catch (error) { console.error(error); }
};

window.leaveTeam = async () => {
    const confirm = await window.showCustomConfirm("Leave Team?", "Are you sure?");
    if (!confirm) return;
    try {
        const teamRef = doc(db, "recruitment", currentManageId);
        const leaverName = await getUserDisplayName(auth.currentUser.uid, auth.currentUser.displayName || auth.currentUser.email.split('@')[0]);
        await sendSystemMessage(currentManageId, `${leaverName} has left the team`);
        const appsRef = collection(db, "recruitment", currentManageId, "applications");
        const q = query(appsRef, where("applicantId", "==", auth.currentUser.uid));
        const appSnaps = await getDocs(q);
        await Promise.all(appSnaps.docs.map(d => deleteDoc(d.ref)));

        const snap = await getDoc(teamRef);
        const mems = snap.data().members.filter(m => m.uid !== auth.currentUser.uid);
        await updateDoc(teamRef, { members: mems, currentMembers: mems.length });

        window.closeManageModal();
        await window.showCustomAlert("Success", "You left the team.");
    } catch (error) { console.error(error); }
};

function setupForms() {
    const createForm = document.getElementById('createTeamForm');
    if (createForm) {
        createForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = createForm.querySelector('button[type="submit"]');
            btn.textContent = "Posting..."; btn.disabled = true;
            try {
                const type = document.getElementById('create-type').value;
                const isPremium = currentUserRole === 'admin' || currentUserRole === 'subscriber';
                const selectedGameVal = document.getElementById('create-game').value;
                const gameNameMap = { valId: 'Valorant', mlbbId: 'Mobile Legends: Bang Bang', hokId: 'Honor of Kings' };
                const gameName = gameNameMap[selectedGameVal] || selectedGameVal;

                const baseData = {
                    type: type,
                    game: gameName,
                    gameId: selectedGameVal,
                    description: document.getElementById('create-desc').value.trim(),
                    image: document.getElementById('create-img').value || auth.currentUser.photoURL || 'pictures/cz_logo.png',
                    contactLink: document.getElementById('create-link') ? document.getElementById('create-link').value.trim() : null,
                    discord: document.getElementById('create-discord') ? document.getElementById('create-discord').value.trim() : null,
                    isPremium: isPremium,
                    authorId: auth.currentUser.uid,
                    authorEmail: auth.currentUser.email,
                    createdAt: serverTimestamp(),
                    lastActive: serverTimestamp()
                };

                if (type === 'team') {
                    const rolesInput = document.getElementById('create-roles').value;
                    baseData.name = document.getElementById('create-name').value.trim();
                    baseData.maxMembers = Math.min(parseInt(document.getElementById('create-max').value) || 7, 7);
                    baseData.currentMembers = 1;
                    baseData.roles = rolesInput ? rolesInput.split(',').map(r => r.trim()).filter(r => r) : [];
                    baseData.members = [{ uid: auth.currentUser.uid, name: auth.currentUser.displayName || "Captain", role: 'Captain', joinedAt: Date.now() }];
                } else {
                    const profileIgn = document.getElementById('create-ign').value.trim();
                    if (!profileIgn) {
                        await window.showCustomAlert("Profile Account Required", "Please configure your game account on your <a href='/edit-profile' class='text-[var(--gold)] underline'>Profile page</a> before posting an LFT listing.");
                        btn.textContent = "Post Listing"; btn.disabled = false;
                        return;
                    }
                    baseData.ign = profileIgn;
                    baseData.role = document.getElementById('create-main-role').value.trim() || 'Flex';
                    baseData.rank = document.getElementById('create-rank').value.trim() || 'Unranked';
                    baseData.discord = document.getElementById('create-discord').value.trim() || null;
                    baseData.email = document.getElementById('create-email').value.trim() || auth.currentUser.email;
                    baseData.name = baseData.ign;
                }

                await addDoc(collection(db, "recruitment"), baseData);
                window.closeCreateModal();
                await window.showCustomAlert("Success", "Listing created successfully.");
                renderTeams();
            } catch (e) { console.error(e); await window.showCustomAlert("Error", e.message); }
            finally { btn.textContent = "Post Listing"; btn.disabled = false; }
        });
    }

    // AUTO-FILL IGN, RANK, ROLE, DISCORD, BIO FROM PROFILE BASED ON GAME SELECTION
    const gameSelect = document.getElementById('create-game');
    if (gameSelect) {
        gameSelect.addEventListener('change', async () => {
            const selectedGame = gameSelect.value;
            const currentType = document.getElementById('create-type').value;
            if (currentType === 'lft') {
                await syncProfileToLftForm(selectedGame);
            }
        });
    }

    // Application Form Listener
    // Handle create-img upload
    const createImgUpload = document.getElementById('create-img-upload');
    if (createImgUpload) {
        createImgUpload.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const statusEl = document.getElementById('create-img-status');
            statusEl.textContent = "Uploading image...";
            statusEl.classList.replace('text-red-500', 'text-gray-500');
            statusEl.classList.replace('text-green-500', 'text-gray-500');
            try {
                const url = await uploadImage(file, 'teams');
                document.getElementById('create-img').value = url;
                statusEl.textContent = "Upload successful!";
                statusEl.classList.replace('text-gray-500', 'text-green-500');
            } catch (error) {
                console.error(error);
                statusEl.textContent = "Upload failed.";
                statusEl.classList.replace('text-gray-500', 'text-red-500');
            }
        });
    }

    const appForm = document.getElementById('applicationForm');
    if (appForm) {
        appForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const teamId = document.getElementById('app-team-id').value;
            const note = document.getElementById('app-note').value;
            const rank = document.getElementById('app-rank').value;
            const role = document.getElementById('app-role').value;

            const btn = appForm.querySelector('button[type="submit"]');
            btn.textContent = "Sending..."; btn.disabled = true;

            try {
                await addDoc(collection(db, "recruitment", teamId, "applications"), {
                    applicantId: auth.currentUser.uid,
                    applicantName: auth.currentUser.displayName || auth.currentUser.email,
                    rank: rank,
                    role: role,
                    note: note,
                    status: 'pending',
                    appliedAt: serverTimestamp()
                });
                try {
                    const teamDoc = await getDoc(doc(db, "recruitment", teamId));
                    if (teamDoc.exists()) {
                        const leaderId = teamDoc.data().leaderId;
                        if (leaderId && window.sendPlayerNotification) {
                            await window.sendPlayerNotification(leaderId, {
                                title: "New Team Applicant",
                                message: `${auth.currentUser.displayName || 'A player'} applied to join ${teamDoc.data().name || 'your team'}.`,
                                type: 'team',
                                tag: 'NEW APPLICANT',
                                link: `/teams?id=${teamId}`
                            });
                        }
                    }
                } catch(err) {}

                await window.showCustomAlert("Success", "Application sent successfully!");
                document.getElementById('applicationModal').classList.add('hidden');
                appForm.reset();
            } catch (error) { console.error(error); await window.showCustomAlert("Error", error.message); }
            finally { btn.textContent = "Send Request"; btn.disabled = false; }
        });
    }

    // Chat Form Listener
    const chatForm = document.getElementById('chatForm');
    chatForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const input = document.getElementById('chat-input');
        const text = input.value.trim();

        // Safety checks
        if (!text || !currentManageId) return;

        input.value = ''; // Clear input immediately for better UX

        try {
            // 1. Check if we are currently in an LFT Private Chat session
            // If activeLftChatId is set, we use the private_chats sub-collection
            const senderDisplayName = await getUserDisplayName(auth.currentUser.uid, auth.currentUser.displayName || auth.currentUser.email.split('@')[0]);

            if (activeLftChatId) {
                const chatDocRef = doc(db, "recruitment", currentManageId, "private_chats", activeLftChatId);

                await setDoc(chatDocRef, {
                    lastMessage: text,
                    lastMessageTime: serverTimestamp(),
                    participantId: activeLftChatId,
                    participantName: senderDisplayName
                }, { merge: true });

                await addDoc(collection(chatDocRef, "messages"), {
                    text: text,
                    senderId: auth.currentUser.uid,
                    senderName: senderDisplayName,
                    createdAt: serverTimestamp()
                });
            }
            // 2. STANDARD TEAM CHAT LOGIC
            // If activeLftChatId is null, we are in a regular Team Dashboard
            else {
                await addDoc(collection(db, "recruitment", currentManageId, "messages"), {
                    text: text,
                    senderId: auth.currentUser.uid,
                    senderName: senderDisplayName,
                    createdAt: serverTimestamp()
                });
            }

            // 3. Update the main listing's heartbeat
            await updateDoc(doc(db, "recruitment", currentManageId), {
                lastActive: serverTimestamp()
            });

        } catch (err) {
            console.error("Chat transmission error:", err);
        }
    });

    // Add this inside your setupForms() function in teams.js
    const lftChatForm = document.getElementById('lftChatForm');
    if (lftChatForm) {
        lftChatForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const input = document.getElementById('lft-chat-input');
            const text = input.value.trim();
            if (!text || !currentManageId || !activeLftChatId) return;

            input.value = '';
            try {
                const chatDocRef = doc(db, "recruitment", currentManageId, "private_chats", activeLftChatId);

                const senderDisplayName = await getUserDisplayName(auth.currentUser.uid, auth.currentUser.displayName || auth.currentUser.email.split('@')[0]);

                await setDoc(chatDocRef, {
                    lastMessage: text,
                    lastMessageTime: serverTimestamp(),
                    participantId: activeLftChatId,
                    participantName: senderDisplayName
                }, { merge: true });

                await addDoc(collection(chatDocRef, "messages"), {
                    text: text,
                    senderId: auth.currentUser.uid,
                    senderName: senderDisplayName,
                    createdAt: serverTimestamp()
                });

                await updateDoc(doc(db, "recruitment", currentManageId), { lastActive: serverTimestamp() });
            } catch (err) {
                console.error("LFT Chat error", err);
            }
        });
    }

    // Handle edit-img upload
    const editImgUpload = document.getElementById('edit-img-upload');
    if (editImgUpload) {
        editImgUpload.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const statusEl = document.getElementById('edit-img-status');
            statusEl.textContent = "Uploading image...";
            statusEl.className = "font-mono-tag text-[10px] text-gray-400 mt-1 block";
            try {
                const url = await uploadImage(file, 'teams');
                const editImgInput = document.getElementById('edit-img');
                if (editImgInput) editImgInput.value = url;
                statusEl.textContent = "Upload successful!";
                statusEl.className = "font-mono-tag text-[10px] text-emerald-400 mt-1 block";
            } catch (error) {
                console.error(error);
                statusEl.textContent = "Upload failed.";
                statusEl.className = "font-mono-tag text-[10px] text-red-400 mt-1 block";
            }
        });
    }

    // Edit Team Form Listener
    const editForm = document.getElementById('editTeamForm');
    if (editForm) {
        editForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const id = document.getElementById('edit-team-id').value;
            const desc = document.getElementById('edit-desc').value;
            const max = Math.min(parseInt(document.getElementById('edit-max').value) || 7, 7); // clamp to 7
            const newImg = document.getElementById('edit-img')?.value;

            try {
                const toggleBtn = document.getElementById('toggle-applications');
                const applicationsOpen = toggleBtn ? toggleBtn.getAttribute('aria-checked') === 'true' : true;
                
                const updatePayload = { description: desc, maxMembers: max, applicationsOpen };
                if (newImg) updatePayload.image = newImg;

                await updateDoc(doc(db, "recruitment", id), updatePayload);
                
                // HIDE THE WARNING BANNER HERE AFTER A SUCCESSFUL SAVE 
                const warningNotice = document.getElementById('unsaved-warning');
                if (warningNotice) {
                    warningNotice.classList.add('hidden');
                }

                window.showCustomAlert("Saved", "Team settings updated.");
            } catch (e) { 
                console.error(e); 
            }
        });
    }

    // Delegated click handler — uses data-* attributes instead of inline
    // onclick="...'${name}'..." so free-text fields (team/player/applicant
    // names) can safely contain apostrophes without breaking JS syntax.
    const board = document.getElementById('recruitment-board');
    if (board) {
        board.addEventListener('click', (e) => {
            const applyBtn = e.target.closest('[data-action="apply"]');
            if (applyBtn) {
                window.openApplicationModal(
                    applyBtn.getAttribute('data-team-id'),
                    applyBtn.getAttribute('data-team-name')
                );
                return;
            }

            const acceptBtn = e.target.closest('[data-action="accept-invite"]');
            if (acceptBtn) {
                window.acceptInvite(
                    acceptBtn.getAttribute('data-invite-id'),
                    acceptBtn.getAttribute('data-team-id'),
                    acceptBtn.getAttribute('data-team-name')
                );
                return;
            }

            const declineBtn = e.target.closest('[data-action="decline-invite"]');
            if (declineBtn) {
                window.declineInvite(declineBtn.getAttribute('data-invite-id'));
                return;
            }

            const lftBtn = e.target.closest('[data-action="lft-chat"]');
            if (lftBtn) {
                window.startLftChat(
                    lftBtn.getAttribute('data-team-id'),
                    lftBtn.getAttribute('data-team-name')
                );
                return;
            }
        });
    }

    // Live Search Input Listener
    const searchInput = document.getElementById('team-search');
    if (searchInput) {
        let debounceTimer;
        searchInput.addEventListener('input', (e) => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                searchTerm = e.target.value.trim();
                renderTeams();
            }, 150);
        });
    }
}

// Helpers for Roster/Chat
async function renderRosterList(members) {
    const list = document.getElementById('roster-list');
    list.innerHTML = '<p class="text-gray-600 text-xs text-center py-4">Loading roster...</p>';

    // Fetch live displayNames from Firestore for all members in parallel
    const enriched = await Promise.all(members.map(async (m) => {
        try {
            const snap = await getDoc(doc(db, "users", m.uid));
            const displayName = snap.exists() ? (snap.data().displayName || snap.data().name || m.name) : m.name;
            return { ...m, name: displayName };
        } catch {
            return m; // fallback to stored name if fetch fails
        }
    }));

    list.innerHTML = '';

    if (myTeamRole === 'Member' || myTeamRole === 'Vice Captain') {
        const leaveContainer = document.createElement('div');
        leaveContainer.className = "mb-4 pb-4 border-b border-white/10 text-right";
        leaveContainer.innerHTML = `<button onclick="window.leaveTeam()" class="text-xs bg-red-900/80 text-white px-3 py-2 rounded-lg hover:bg-red-800 transition font-bold">Leave Team</button>`;
        list.appendChild(leaveContainer);
    }

    enriched.forEach(m => {
        const isMe = auth.currentUser && m.uid === auth.currentUser.uid;
        const targetRole = m.role || 'Member';
        const roleBadge = targetRole === 'Captain'
            ? '<span class="text-[10px] bg-yellow-600/30 text-[var(--gold)] border border-[var(--gold)]/30 px-1.5 py-0.5 rounded ml-2 uppercase font-bold">Captain</span>'
            : targetRole === 'Vice Captain'
                ? '<span class="text-[10px] bg-purple-600/30 text-purple-300 border border-purple-500/30 px-1.5 py-0.5 rounded ml-2 uppercase font-bold">Vice</span>'
                : '';

        const item = document.createElement('div');
        item.className = "flex justify-between items-center bg-black/20 p-4 rounded-lg border border-white/5 hover:border-white/10 transition-colors";

        let buttons = '';
        if (!isMe) {
            if (myTeamRole === 'Captain') {
                if (targetRole === 'Member') {
                    buttons += `<button onclick="window.promoteMember('${m.uid}')" class="text-xs bg-purple-600/20 text-purple-400 border border-purple-600/30 px-2 py-1.5 rounded hover:bg-purple-600/40 mr-2 transition font-bold">Promote</button>`;
                } else if (targetRole === 'Vice Captain') {
                    buttons += `<button onclick="window.demoteMember('${m.uid}')" class="text-xs bg-gray-600/20 text-gray-400 border border-gray-600/30 px-2 py-1.5 rounded hover:bg-gray-600/40 mr-2 transition font-bold">Demote</button>`;
                }
                buttons += `<button onclick="window.kickMember('${m.uid}', '${targetRole}')" class="text-xs bg-red-900/30 text-red-300 border border-red-900/50 px-2 py-1.5 rounded hover:bg-red-900/50 transition font-bold">Kick</button>`;
            } else if (myTeamRole === 'Vice Captain' && targetRole === 'Member') {
                buttons += `<button onclick="window.kickMember('${m.uid}', '${targetRole}')" class="text-xs bg-red-900/30 text-red-300 border border-red-900/50 px-2 py-1.5 rounded hover:bg-red-900/50 transition font-bold">Kick</button>`;
            }
        }

        item.innerHTML = `
            <div>
                <div class="font-bold text-white flex items-center gap-1 text-sm">
                    ${escapeHtml(m.name)} 
                    ${isMe ? '<span class="text-[10px] bg-indigo-600 px-1.5 py-0.5 rounded text-white font-bold tracking-wide">YOU</span>' : ''}
                    ${roleBadge}
                </div>
                <div class="text-xs text-gray-400 mt-0.5">${targetRole}</div>
            </div>
            <div>${buttons}</div>`;
        list.appendChild(item);
    });
}

function startChatListener(teamId) {
    const chatContainer = document.getElementById('chat-messages');
    const q = query(collection(db, "recruitment", teamId, "messages"), orderBy("createdAt", "asc"));

chatUnsubscribe = onSnapshot(q, async (snapshot) => {
    chatContainer.innerHTML = '';
    let lastDateLabel = null;

    const docs = snapshot.docs.map(d => d.data());
    const resolvedNames = await Promise.all(docs.map(msg =>
        msg.isSystem ? Promise.resolve(msg.senderName) : getUserDisplayName(msg.senderId, msg.senderName)
    ));

    docs.forEach((msg, i) => {
        const senderDisplayName = resolvedNames[i];
        const isMe = auth.currentUser && msg.senderId === auth.currentUser.uid;
            const dateObj = msg.createdAt ? msg.createdAt.toDate() : new Date();

            // Format for date divider (e.g., "January 16, 2026")
            const dateLabel = dateObj.toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' });
            const timeString = dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

            // ADD DATE DIVIDER if the date changed
            if (dateLabel !== lastDateLabel) {
                const dateDivider = document.createElement('div');
                dateDivider.className = "flex justify-center my-6";
                dateDivider.innerHTML = `<span class="bg-white/5 text-gray-500 text-[9px] px-3 py-1 rounded-full border border-white/5 uppercase tracking-widest font-bold">${dateLabel}</span>`;
                chatContainer.appendChild(dateDivider);
                lastDateLabel = dateLabel;
            }

            const bubble = document.createElement('div');
            if (msg.isSystem) {
                bubble.className = "flex justify-center my-4 opacity-75";
                bubble.innerHTML = `
                    <div class="bg-white/10 text-gray-300 text-[10px] px-3 py-1 rounded-full border border-white/5 font-bold uppercase tracking-wide">
                        ${escapeHtml(msg.text)} <span class="opacity-50 border-l border-white/20 pl-2 ml-2">${timeString}</span>
                    </div>`;
            } else {
                bubble.className = `chat-bubble ${isMe ? 'mine' : 'theirs'} mb-3 shadow-md flex flex-col`;
                bubble.innerHTML = `
                    <div class="flex justify-between items-baseline mb-1 w-full gap-4">
                        <span class="font-bold text-[10px] opacity-75 tracking-wide">${escapeHtml(senderDisplayName)}</span>
                        <span class="text-[9px] opacity-50 font-mono">${timeString}</span>
                    </div>
                    <div class="leading-relaxed break-words">${escapeHtml(msg.text)}</div>`;
            }
            chatContainer.appendChild(bubble);
        });
        chatContainer.scrollTop = chatContainer.scrollHeight;
    });
}



async function loadApplications(teamId) {
    const list = document.getElementById('applications-list');
    const snap = await getDocs(collection(db, "recruitment", teamId, "applications"));
    list.innerHTML = '';
    let hasPending = false;
    snap.forEach(d => {
        const app = d.data();
        if (app.status === 'pending') {
            hasPending = true;
const div = document.createElement('div');
            div.className = "bg-black/20 p-4 rounded-lg border border-white/5 mb-3 hover:border-white/10 transition-colors";
            div.innerHTML = `
                <div class="flex justify-between items-start mb-2">
                    <div>
                        <div class="font-bold text-sm text-white">${escapeHtml(app.applicantName)}</div>
                        <div class="text-xs text-[var(--gold)] mt-0.5">${escapeHtml(app.rank)} • ${escapeHtml(app.role)}</div>
                    </div>
                </div>
                <div class="text-xs text-gray-400 italic mb-3 bg-black/20 p-2 rounded leading-relaxed">"${escapeHtml(app.note)}"</div>
                <div class="flex gap-2">
                    <button data-action="accept-app" class="flex-1 bg-green-600/20 text-green-400 border border-green-600/30 text-xs py-2 rounded font-bold hover:bg-green-600/30 transition">Accept</button>
                    <button data-action="reject-app" class="flex-1 bg-red-600/20 text-red-400 border border-red-600/30 text-xs py-2 rounded font-bold hover:bg-red-600/30 transition">Reject</button>
                </div>`;

            div.querySelector('[data-action="accept-app"]').addEventListener('click', () => {
                window.handleApp(d.id, app.applicantId, app.applicantName, true);
            });
            div.querySelector('[data-action="reject-app"]').addEventListener('click', () => {
                window.handleApp(d.id, null, null, false);
            });

            list.appendChild(div);
        }
    });

    // Update badge count
    const badge = document.getElementById('badge-apps');
    if (hasPending) {
        badge.classList.remove('hidden');
        badge.textContent = '!';
    } else {
        list.innerHTML = '<p class="text-center text-gray-500 py-4 text-sm">No pending requests.</p>';
        badge.classList.add('hidden');
    }
}

async function sendSystemMessage(teamId, text) {
    try {
        await addDoc(collection(db, "recruitment", teamId, "messages"), {
            text: text,
            senderId: 'SYSTEM',
            senderName: 'System',
            isSystem: true, // Flag to identify system messages
            createdAt: serverTimestamp()
        });
        // Update lastActive so the team moves up the list
        await updateDoc(doc(db, "recruitment", teamId), { lastActive: serverTimestamp() });
    } catch (err) {
        console.error("Failed to send system message:", err);
    }
}

// ==========================================
// DAILY LFG & SCRIM MATCHMAKING BOARD ENGINE
// ==========================================

function formatScrimGameBadge(game) {
    if (!game) return { title: 'ESPORTS', cssClass: 'scrim-badge-val' };
    const g = String(game).toLowerCase();
    if (g.includes('val') || g === 'valorant') {
        return { title: 'VALORANT', cssClass: 'scrim-badge-val' };
    }
    if (g.includes('mlbb') || g.includes('mobile legends') || g.includes('bang bang')) {
        return { title: 'MLBB', cssClass: 'scrim-badge-mlbb' };
    }
    if (g.includes('hok') || g.includes('honor of kings')) {
        return { title: 'HONOR OF KINGS', cssClass: 'scrim-badge-hok' };
    }
    return { title: String(game).toUpperCase(), cssClass: 'scrim-badge-val' };
}

// 1. REAL-TIME SUBSCRIPTION TO SCRIMS FEED
function subscribeToScrims() {
    if (typeof scrimsUnsubscribe === 'function') {
        scrimsUnsubscribe();
        scrimsUnsubscribe = null;
    }

    try {
        const scrimsCol = collection(db, "scrims");
        const q = query(scrimsCol, orderBy("createdAt", "desc"), limit(100));

        scrimsUnsubscribe = onSnapshot(q, (snapshot) => {
            const now = Date.now();
            const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;
            const list = [];

            snapshot.forEach((docSnap) => {
                const data = docSnap.data();
                const id = docSnap.id;

                let createdAtMs = now;
                if (data.createdAt && typeof data.createdAt.toMillis === 'function') {
                    createdAtMs = data.createdAt.toMillis();
                } else if (data.createdAt && data.createdAt.seconds) {
                    createdAtMs = data.createdAt.seconds * 1000;
                } else if (data.createdAt) {
                    createdAtMs = new Date(data.createdAt).getTime() || now;
                }

                const isStale = (now - createdAtMs) > TWELVE_HOURS_MS;

                list.push({
                    id,
                    scrimId: id,
                    ...data,
                    createdAtMs,
                    isStale: isStale || data.status === 'expired'
                });
            });

            activeScrimsList = list;
            updateTeamTabCounts();
            if (activeView === 'scrims') {
                renderScrimsBoard();
            }
        }, (error) => {
            console.warn("Scrims ordered subscription notice:", error.message || error);
            try {
                scrimsUnsubscribe = onSnapshot(collection(db, "scrims"), (snap) => {
                    const list = [];
                    snap.forEach(d => list.push({ id: d.id, scrimId: d.id, ...d.data() }));
                    list.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
                    activeScrimsList = list;
                    updateTeamTabCounts();
                    if (activeView === 'scrims') renderScrimsBoard();
                }, (fallbackErr) => {
                    console.warn("Scrims Firestore access notice (requires security rules in Firebase Console):", fallbackErr.message || fallbackErr);
                });
            } catch (e) {
                console.warn("Scrims listener fallback handled:", e);
            }
        });
    } catch (err) {
        console.error("Failed to initialize Scrims real-time feed:", err);
    }
}

// 2. SCRIM FILTERS
window.setScrimGameFilter = (game) => {
    scrimGameFilter = game;
    if (activeView === 'scrims') renderScrimsBoard();
};

window.setScrimFormatFilter = (fmt) => {
    scrimFormatFilter = fmt;
    if (activeView === 'scrims') renderScrimsBoard();
};

window.setScrimRankFilter = (rank) => {
    scrimRankFilter = rank;
    if (activeView === 'scrims') renderScrimsBoard();
};

// 3. RENDER SCRIM BOARD
async function renderScrimsBoard() {
    const board = qs('#recruitment-board');
    if (!board) return;

    const user = auth.currentUser;
    const countText = document.getElementById('filter-count-text');

    // Filter listings
    let filtered = activeScrimsList.filter(scrim => {
        // Exclude cancelled listings
        if (scrim.status === 'cancelled') return false;

        // Auto-archive client side: exclude stale listings (>12h) unless current user is host or accepted opponent
        if (scrim.isStale && (!user || (user.uid !== scrim.captainId && user.uid !== scrim.opponentCaptainId))) {
            return false;
        }

        // Game filter
        if (scrimGameFilter !== 'all') {
            const sg = (scrim.game || '').toLowerCase();
            const fg = scrimGameFilter.toLowerCase();
            if (!sg.includes(fg) && !fg.includes(sg)) return false;
        }

        // Format filter
        if (scrimFormatFilter !== 'all') {
            if (scrim.format !== scrimFormatFilter) return false;
        }

        // Rank filter
        if (scrimRankFilter !== 'all') {
            const sr = (scrim.rankTier || '').toLowerCase();
            const fr = scrimRankFilter.toLowerCase();
            if (!sr.includes(fr) && !fr.includes(sr)) return false;
        }

        // Search query
        if (scrimSearchQuery) {
            const q = scrimSearchQuery;
            const matchTime = (scrim.matchTime || '').toLowerCase();
            const teamName = (scrim.teamName || '').toLowerCase();
            const game = (scrim.game || '').toLowerCase();
            const rank = (scrim.rankTier || '').toLowerCase();
            if (!matchTime.includes(q) && !teamName.includes(q) && !game.includes(q) && !rank.includes(q)) {
                return false;
            }
        }

        return true;
    });

    if (countText) {
        countText.textContent = `Showing ${filtered.length} Live Scrim Match${filtered.length === 1 ? '' : 'es'}`;
    }

    if (filtered.length === 0) {
        board.className = "grid grid-cols-1 gap-4";
        board.innerHTML = `
            <div class="col-span-full py-16 text-center flex flex-col items-center justify-center border border-dashed border-white/10 rounded-2xl bg-zinc-950/40 p-8">
                <div class="w-14 h-14 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center mb-4 text-emerald-400">
                    <svg class="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
                </div>
                <h3 class="text-lg font-heading font-bold text-white uppercase tracking-wider mb-2">No Active Scrims Found</h3>
                <p class="text-neutral-400 text-xs max-w-md mx-auto mb-6 leading-relaxed">
                    Be the first team to schedule a practice match today! Broadcast your squad's target time and format to match against competitive opponents.
                </p>
                <button onclick="window.openPostScrimModal()" class="px-6 py-3 rounded-xl bg-gradient-to-r from-emerald-500 to-[#FFD700] hover:brightness-110 active:scale-95 text-black font-heading font-bold text-xs uppercase tracking-wider transition-all shadow-lg flex items-center gap-2 cursor-pointer">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg>
                    <span>Broadcast a Scrim Request</span>
                </button>
            </div>`;
        return;
    }

    board.className = "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 auto-rows-fr";
    board.innerHTML = '';

    for (const scrim of filtered) {
        const card = document.createElement('article');
        card.className = "scrim-card p-5 flex flex-col justify-between";
        card.dataset.scrimId = scrim.id;

        const gameBadge = formatScrimGameBadge(scrim.game);
        const isOpen = scrim.status === 'open';
        const isAccepted = scrim.status === 'accepted';
        const isHost = user && user.uid === scrim.captainId;
        const isOpponent = user && user.uid === scrim.opponentCaptainId;
        const canViewLobby = isHost || isOpponent || currentUserRole === 'admin';

        card.innerHTML = `
            <div>
                <!-- Header: Game + Status Badges -->
                <div class="flex items-center justify-between gap-2 mb-3">
                    <span class="font-mono-tag text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-md ${gameBadge.cssClass}">
                        ${escapeHtml(gameBadge.title)}
                    </span>
                    <span class="font-mono-tag text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-md flex items-center gap-1.5 ${isOpen ? 'scrim-badge-open' : 'scrim-badge-accepted'}">
                        <span class="w-1.5 h-1.5 rounded-full ${isOpen ? 'bg-emerald-400 animate-ping' : 'bg-yellow-400'}"></span>
                        <span>${isOpen ? 'LOBBY OPEN' : 'CONFIRMED'}</span>
                    </span>
                </div>

                <!-- Main Team / Squad Title -->
                <div class="mb-3">
                    <span class="text-[10px] font-mono-tag text-neutral-400 uppercase block">Host Squad</span>
                    <h3 class="font-heading font-bold text-lg text-white group-hover:text-[#FFD700] transition-colors truncate">
                        ${escapeHtml(scrim.teamName || 'Competitive Squad')}
                    </h3>
                </div>

                <!-- Match Specs Grid -->
                <div class="grid grid-cols-2 gap-2 mb-4">
                    <div class="bg-black/40 border border-white/5 rounded-lg p-2">
                        <span class="text-[9px] font-mono-tag text-neutral-500 uppercase block">Format</span>
                        <span class="text-xs font-bold text-neutral-200">${escapeHtml(scrim.format || '5v5 BO3')}</span>
                    </div>
                    <div class="bg-black/40 border border-white/5 rounded-lg p-2">
                        <span class="text-[9px] font-mono-tag text-neutral-500 uppercase block">Skill Tier</span>
                        <span class="text-xs font-bold text-[#FFD700]">${escapeHtml(scrim.rankTier || 'Mythic')}</span>
                    </div>
                </div>

                <!-- Match Time Callout -->
                <div class="bg-white/5 border border-white/5 rounded-xl p-3 mb-4 flex items-center gap-2.5">
                    <svg class="w-4 h-4 text-emerald-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                    <div class="min-w-0">
                        <span class="text-[9px] font-mono-tag text-neutral-400 uppercase block">Scheduled Time</span>
                        <span class="text-xs font-bold text-white truncate block">${escapeHtml(scrim.matchTime || 'Tonight')}</span>
                    </div>
                </div>
            </div>

            <!-- Footer Action Controls -->
            <div class="pt-3 border-t border-white/10 mt-auto">
                ${isOpen ? `
                    ${isHost ? `
                        <div class="flex items-center gap-2">
                            <span class="flex-1 text-center py-2 text-[10px] font-mono-tag text-neutral-400 bg-white/5 rounded-lg font-semibold">Your Scrim</span>
                            <button onclick="window.cancelScrim('${scrim.id}')" class="px-3 py-2 rounded-lg bg-red-950/40 hover:bg-red-900/60 text-red-400 border border-red-500/30 text-xs font-heading font-bold uppercase tracking-wider transition-all cursor-pointer">
                                Cancel
                            </button>
                        </div>
                    ` : user ? `
                        <button onclick="window.openAcceptScrimModal('${scrim.id}')" class="w-full py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-[#FFD700] hover:brightness-110 active:scale-95 text-black font-heading font-bold text-xs uppercase tracking-wider transition-all shadow-md flex items-center justify-center gap-1.5 cursor-pointer">
                            <span>Accept Scrim</span>
                        </button>
                    ` : `
                        <a href="/login" class="block w-full text-center py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-white font-heading font-bold text-xs uppercase tracking-wider transition-all border border-white/10">
                            Log In to Accept
                        </a>
                    `}
                ` : isAccepted ? `
                    ${canViewLobby ? `
                        <button onclick="window.openScrimDetailsModal('${scrim.id}')" class="w-full py-2.5 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 font-heading font-bold text-xs uppercase tracking-wider transition-all flex items-center justify-center gap-1.5 cursor-pointer">
                            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg>
                            <span>Lobby Details</span>
                        </button>
                    ` : `
                        <div class="text-center py-2 text-[10px] font-mono-tag text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg font-semibold">
                            Match Scheduled
                        </div>
                    `}
                ` : ''}
            </div>
        `;

        board.appendChild(card);
    }
}

// 4. POST SCRIM MODAL HANDLERS
window.handleScrimPostGameChange = async (gameTitle) => {
    const rankSelect = document.getElementById('scrim-post-rank');
    if (!rankSelect) return;
    const g = String(gameTitle || '').toLowerCase();
    
    let userRank = '';
    if (auth.currentUser) {
        try {
            const userSnap = await getDoc(doc(db, "users", auth.currentUser.uid));
            if (userSnap.exists()) {
                const uData = userSnap.data() || {};
                if (g.includes('val')) userRank = uData.valRank || '';
                else if (g.includes('mlbb') || g.includes('mobile legends')) userRank = uData.mlbbRank || '';
                else if (g.includes('hok') || g.includes('honor of kings')) userRank = uData.hokRank || '';
            }
        } catch(e) {}
    }

    if (g.includes('val')) {
        rankSelect.innerHTML = `
            <option value="Open / Any" ${!userRank ? 'selected' : ''}>Open / Any Rank (All Skill Tiers)</option>
            <option value="Radiant / Immortal" ${userRank.includes('Radiant') || userRank.includes('Immortal') ? 'selected' : ''}>Radiant / Immortal (Tier 1 Pro)</option>
            <option value="Ascendant / Diamond" ${userRank.includes('Ascendant') || userRank.includes('Diamond') ? 'selected' : ''}>Ascendant / Diamond (High Competitive)</option>
            <option value="Platinum / Gold" ${userRank.includes('Platinum') || userRank.includes('Gold') ? 'selected' : ''}>Platinum / Gold (Intermediate)</option>
            <option value="Silver / Bronze / Iron" ${userRank.includes('Silver') || userRank.includes('Bronze') || userRank.includes('Iron') ? 'selected' : ''}>Silver / Bronze / Iron (Beginner)</option>
            <option value="Tournament Ready">Tournament Ready (Custom Scrim)</option>
        `;
    } else if (g.includes('mlbb') || g.includes('mobile legends')) {
        rankSelect.innerHTML = `
            <option value="Open / Any" ${!userRank ? 'selected' : ''}>Open / Any Rank (All Skill Tiers)</option>
            <option value="Mythical Immortal / Glory" ${userRank.includes('Immortal') || userRank.includes('Glory') ? 'selected' : ''}>Mythical Immortal / Glory (Tier 1)</option>
            <option value="Mythic / Legend" ${userRank.includes('Mythic') || userRank.includes('Legend') ? 'selected' : ''}>Mythic / Legend (Competitive)</option>
            <option value="Epic / Grandmaster" ${userRank.includes('Epic') || userRank.includes('Grandmaster') ? 'selected' : ''}>Epic / Grandmaster (Intermediate)</option>
            <option value="Master / Elite / Warrior" ${userRank.includes('Master') || userRank.includes('Elite') || userRank.includes('Warrior') ? 'selected' : ''}>Master / Elite / Warrior (Beginner)</option>
            <option value="Tournament Ready">Tournament Ready (Custom Scrim)</option>
        `;
    } else if (g.includes('hok') || g.includes('honor of kings')) {
        rankSelect.innerHTML = `
            <option value="Open / Any" ${!userRank ? 'selected' : ''}>Open / Any Rank (All Skill Tiers)</option>
            <option value="Supreme / Grandmaster" ${userRank.includes('Supreme') || userRank.includes('Grandmaster') ? 'selected' : ''}>Supreme / Grandmaster (High Elo)</option>
            <option value="Master / Epic" ${userRank.includes('Master') || userRank.includes('Epic') ? 'selected' : ''}>Master / Epic (Competitive)</option>
            <option value="Diamond / Platinum" ${userRank.includes('Diamond') || userRank.includes('Platinum') ? 'selected' : ''}>Diamond / Platinum (Intermediate)</option>
            <option value="Gold / Silver / Bronze" ${userRank.includes('Gold') || userRank.includes('Silver') || userRank.includes('Bronze') ? 'selected' : ''}>Gold / Silver / Bronze (Beginner)</option>
            <option value="Tournament Ready">Tournament Ready (Custom Scrim)</option>
        `;
    } else {
        rankSelect.innerHTML = `
            <option value="Open / Any" selected>Open / Any Rank (All Levels)</option>
            <option value="Radiant / Immortal / Mythical Immortal">Radiant / Immortal / Mythical Immortal (Tier 1 Pro / High Elo)</option>
            <option value="Ascendant / Mythical Glory">Ascendant / Mythical Glory (Semi-Pro / High Comp)</option>
            <option value="Diamond / Mythic / Grandmaster">Diamond / Mythic / Grandmaster (Competitive)</option>
            <option value="Platinum / Legend / Master">Platinum / Legend / Master (Intermediate)</option>
            <option value="Gold / Epic">Gold / Epic (Casual Competitive)</option>
            <option value="Silver & Below / Elite">Silver & Below / Elite (Beginner / Learning)</option>
            <option value="Tournament Ready">Tournament Ready (Custom Scrim)</option>
        `;
    }
};

window.openPostScrimModal = async () => {
    const user = auth.currentUser;
    if (!user) {
        if (typeof window.showWarningToast === 'function') {
            window.showWarningToast("Sign In Required", "Please log in to broadcast a daily scrim request.");
        }
        setTimeout(() => { window.location.href = '/login'; }, 1200);
        return;
    }

    const teamInput = document.getElementById('scrim-post-team');
    const contactInput = document.getElementById('scrim-post-contact');
    const gameSelect = document.getElementById('scrim-post-game');

    // Auto-fill from user profile & teams
    try {
        const userSnap = await getDoc(doc(db, "users", user.uid));
        const uData = userSnap.exists() ? (userSnap.data() || {}) : {};

        if (contactInput && !contactInput.value) {
            contactInput.value = uData.discord || uData.discordTag || user.email || '';
        }

        if (teamInput && !teamInput.value) {
            let primaryTeamName = '';
            const userTeam = cachedRecruitmentPosts.find(p => p.type !== 'lft' && (p.authorId === user.uid || (Array.isArray(p.members) && p.members.some(m => (m.uid || m) === user.uid))));
            if (userTeam) primaryTeamName = userTeam.name;
            teamInput.value = primaryTeamName || uData.ign || uData.displayName || user.displayName || '';
        }

        // Auto-select primary game if not selected
        if (gameSelect && !gameSelect.value) {
            if (uData.valId) { gameSelect.value = 'Valorant'; }
            else if (uData.mlbbId) { gameSelect.value = 'MLBB'; }
            else if (uData.hokId) { gameSelect.value = 'Honor of Kings'; }
            if (gameSelect.value) {
                window.handleScrimPostGameChange(gameSelect.value);
            }
        }
    } catch(err) { console.warn("Failed to auto-fill scrim profile:", err); }

    // Initialize Date & Time Inputs
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    const dateInput = document.getElementById('scrim-post-date');
    const timeInput = document.getElementById('scrim-post-time');

    if (dateInput) {
        dateInput.min = todayStr;
        if (!dateInput.value) dateInput.value = todayStr;
    }

    if (timeInput && !timeInput.value) {
        // Default to upcoming top of the hour or 8:00 PM
        const nextHour = (now.getHours() + 1) % 24;
        const pad = (n) => String(n).padStart(2, '0');
        timeInput.value = `${pad(nextHour)}:00`;
    }

    // Detect timezone
    const tzLabel = document.getElementById('scrim-timezone-label');
    if (tzLabel) {
        try {
            const tzName = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Local';
            const offsetHours = -now.getTimezoneOffset() / 60;
            const sign = offsetHours >= 0 ? '+' : '';
            tzLabel.textContent = `${tzName} (GMT${sign}${offsetHours})`;
        } catch (e) {
            tzLabel.textContent = 'Local Time';
        }
    }

    updateScrimPreviewFormatted();

    // Attach real-time preview listeners
    if (dateInput && !dateInput._hasPreviewListener) {
        dateInput.addEventListener('input', updateScrimPreviewFormatted);
        dateInput._hasPreviewListener = true;
    }
    if (timeInput && !timeInput._hasPreviewListener) {
        timeInput.addEventListener('input', updateScrimPreviewFormatted);
        timeInput._hasPreviewListener = true;
    }

    animateGenericOpen('postScrimModal', 'postScrimBackdrop', 'postScrimPanel');
};

function formatScrimDateTime(dateStr, timeStr) {
    if (!dateStr || !timeStr) return '';
    try {
        const [year, month, day] = dateStr.split('-').map(Number);
        const [hours, minutes] = timeStr.split(':').map(Number);
        const targetDate = new Date(year, month - 1, day, hours, minutes);
        
        const now = new Date();
        const isToday = now.getFullYear() === targetDate.getFullYear() &&
                        now.getMonth() === targetDate.getMonth() &&
                        now.getDate() === targetDate.getDate();

        const tomorrow = new Date(now);
        tomorrow.setDate(now.getDate() + 1);
        const isTomorrow = tomorrow.getFullYear() === targetDate.getFullYear() &&
                           tomorrow.getMonth() === targetDate.getMonth() &&
                           tomorrow.getDate() === targetDate.getDate();

        const timeFormatted = targetDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
        
        if (isToday) {
            return `Today • ${timeFormatted}`;
        } else if (isTomorrow) {
            return `Tomorrow • ${timeFormatted}`;
        } else {
            const dateFormatted = targetDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            return `${dateFormatted} • ${timeFormatted}`;
        }
    } catch (e) {
        return `${dateStr} ${timeStr}`;
    }
}

function updateScrimPreviewFormatted() {
    const dateVal = document.getElementById('scrim-post-date')?.value;
    const timeVal = document.getElementById('scrim-post-time')?.value;
    const previewEl = document.getElementById('scrim-formatted-preview');
    if (previewEl) {
        previewEl.textContent = formatScrimDateTime(dateVal, timeVal);
    }
}

window.setScrimTimePreset = (preset) => {
    const timeInput = document.getElementById('scrim-post-time');
    const dateInput = document.getElementById('scrim-post-date');
    if (!timeInput) return;

    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];

    if (preset === 'now') {
        if (dateInput) dateInput.value = todayStr;
        const pad = (n) => String(n).padStart(2, '0');
        // Round to next 5 minutes
        const mins = Math.ceil(now.getMinutes() / 5) * 5;
        const d = new Date(now);
        d.setMinutes(mins);
        timeInput.value = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    } else {
        timeInput.value = preset;
    }
    updateScrimPreviewFormatted();
};

window.closePostScrimModal = () => {
    animateGenericClose('postScrimModal', 'postScrimBackdrop', 'postScrimPanel');
};

window.handlePostScrimSubmit = async (e) => {
    e.preventDefault();
    const user = auth.currentUser;
    if (!user) {
        if (typeof window.showErrorToast === 'function') {
            window.showErrorToast("Error", "You must be signed in to post a scrim.");
        }
        return;
    }

    const game = document.getElementById('scrim-post-game')?.value?.trim();
    const teamName = document.getElementById('scrim-post-team')?.value?.trim();
    const format = document.getElementById('scrim-post-format')?.value?.trim() || '5v5 BO3';
    const rankTier = document.getElementById('scrim-post-rank')?.value?.trim() || 'Open / Any';
    const dateVal = document.getElementById('scrim-post-date')?.value;
    const timeVal = document.getElementById('scrim-post-time')?.value;
    const captainContact = document.getElementById('scrim-post-contact')?.value?.trim();
    const btn = document.getElementById('btn-submit-scrim');

    if (!game || !teamName || !dateVal || !timeVal || !captainContact) {
        if (typeof window.showWarningToast === 'function') {
            window.showWarningToast("Missing Fields", "Please specify your squad name, match date, time, and contact tag.");
        }
        return;
    }

    const matchTime = formatScrimDateTime(dateVal, timeVal);

    try {
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<span class="animate-spin inline-block mr-1">⏳</span> Broadcasting...';
        }

        const expiresDate = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h expiration

        await addDoc(collection(db, "scrims"), {
            game,
            teamName,
            captainId: user.uid,
            captainEmail: user.email || '',
            captainName: user.displayName || teamName,
            captainContact,
            rankTier,
            matchDate: dateVal,
            matchTimeRaw: timeVal,
            matchTime,
            format,
            status: "open",
            opponentTeamName: null,
            opponentCaptainId: null,
            opponentContact: null,
            createdAt: serverTimestamp(),
            expiresAt: Timestamp.fromDate(expiresDate)
        });

        if (typeof window.showSuccessToast === 'function') {
            window.showSuccessToast("Scrim Broadcasted!", `Your ${game} scrim for ${matchTime} is now live.`);
        }

        // Reset form
        document.getElementById('postScrimForm')?.reset();
        window.closePostScrimModal();

        // Switch to scrims tab if not already on it
        if (activeView !== 'scrims') {
            window.setTab('scrims');
        } else {
            renderScrimsBoard();
        }

    } catch (err) {
        console.error("Error posting scrim:", err);
        const errMsg = String(err?.message || err || '');
        const isPermission = errMsg.toLowerCase().includes('permission') || err?.code === 'permission-denied';

        if (isPermission) {
            console.warn("FIRESTORE SECURITY RULES NOTICE: To allow scrim postings, publish the updated security rules for '/scrims' in Firebase Console > Firestore Database > Rules.");
            if (typeof window.showErrorToast === 'function') {
                window.showErrorToast("Security Rule Update Required", "Firestore security rules in Firebase Console need to allow the '/scrims' collection. See console or firestore.rules for deployment details.", 6000);
            }
        } else {
            if (typeof window.showErrorToast === 'function') {
                window.showErrorToast("Broadcast Failed", errMsg || "Failed to broadcast scrim.");
            }
        }
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<span>Broadcast Scrim</span>';
        }
    }
};

// 5. ACCEPT SCRIM MODAL & TRANSACTION
window.openAcceptScrimModal = async (scrimId) => {
    const user = auth.currentUser;
    if (!user) {
        if (typeof window.showWarningToast === 'function') {
            window.showWarningToast("Sign In Required", "Please log in to accept a scrim challenge.");
        }
        setTimeout(() => { window.location.href = '/login'; }, 1200);
        return;
    }

    const scrim = activeScrimsList.find(s => s.id === scrimId);
    if (!scrim) {
        if (typeof window.showErrorToast === 'function') {
            window.showErrorToast("Not Found", "This scrim listing is no longer available.");
        }
        return;
    }

    if (scrim.captainId === user.uid) {
        if (typeof window.showWarningToast === 'function') {
            window.showWarningToast("Self Match", "You cannot accept your own scrim posting.");
        }
        return;
    }

    // Populate preview card
    const hiddenId = document.getElementById('accept-scrim-id');
    const previewGame = document.getElementById('accept-preview-game');
    const previewTime = document.getElementById('accept-preview-time');
    const previewHost = document.getElementById('accept-preview-host');
    const previewFormat = document.getElementById('accept-preview-format');
    const previewRank = document.getElementById('accept-preview-rank');

    if (hiddenId) hiddenId.value = scrimId;
    if (previewGame) previewGame.textContent = scrim.game || 'ESPORTS';
    if (previewTime) previewTime.textContent = scrim.matchTime || 'Scheduled Time';
    if (previewHost) previewHost.textContent = scrim.teamName || 'Host Team';
    if (previewFormat) previewFormat.textContent = scrim.format || '5v5 BO3';
    if (previewRank) previewRank.textContent = scrim.rankTier || 'Any Rank';

    const oppTeamInput = document.getElementById('accept-opponent-team');
    const oppContactInput = document.getElementById('accept-opponent-contact');

    // Auto-fill from user profile & teams
    try {
        const userSnap = await getDoc(doc(db, "users", user.uid));
        const uData = userSnap.exists() ? (userSnap.data() || {}) : {};

        if (oppContactInput && !oppContactInput.value) {
            oppContactInput.value = uData.discord || uData.discordTag || user.email || '';
        }

        if (oppTeamInput && !oppTeamInput.value) {
            let primaryTeamName = '';
            const userTeam = cachedRecruitmentPosts.find(p => p.type !== 'lft' && (p.authorId === user.uid || (Array.isArray(p.members) && p.members.some(m => (m.uid || m) === user.uid))));
            if (userTeam) primaryTeamName = userTeam.name;
            oppTeamInput.value = primaryTeamName || uData.ign || uData.displayName || user.displayName || '';
        }
    } catch(err) { console.warn("Failed to auto-fill opponent details:", err); }

    animateGenericOpen('acceptScrimModal', 'acceptScrimBackdrop', 'acceptScrimPanel');
};

window.closeAcceptScrimModal = () => {
    animateGenericClose('acceptScrimModal', 'acceptScrimBackdrop', 'acceptScrimPanel');
};

window.handleAcceptScrimSubmit = async (e) => {
    e.preventDefault();
    const user = auth.currentUser;
    if (!user) {
        if (typeof window.showErrorToast === 'function') {
            window.showErrorToast("Error", "You must be signed in to accept a scrim.");
        }
        return;
    }

    const scrimId = document.getElementById('accept-scrim-id')?.value;
    const opponentTeamName = document.getElementById('accept-opponent-team')?.value?.trim();
    const opponentContact = document.getElementById('accept-opponent-contact')?.value?.trim();
    const btn = document.getElementById('btn-confirm-accept-scrim');

    if (!scrimId || !opponentTeamName || !opponentContact) {
        if (typeof window.showWarningToast === 'function') {
            window.showWarningToast("Missing Fields", "Please complete all fields to accept the challenge.");
        }
        return;
    }

    try {
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<span class="animate-spin inline-block mr-1">⏳</span> Confirming...';
        }

        const scrimRef = doc(db, "scrims", scrimId);

        // Atomic Transaction: Guarantee race-condition safety
        await runTransaction(db, async (transaction) => {
            const scrimDoc = await transaction.get(scrimRef);
            if (!scrimDoc.exists()) {
                throw new Error("This scrim listing no longer exists.");
            }

            const data = scrimDoc.data();
            if (data.status !== 'open') {
                throw new Error("This scrim has already been accepted or is no longer open.");
            }

            if (data.captainId === user.uid) {
                throw new Error("You cannot accept your own scrim request.");
            }

            transaction.update(scrimRef, {
                status: 'accepted',
                opponentCaptainId: user.uid,
                opponentTeamName: opponentTeamName,
                opponentContact: opponentContact,
                acceptedAt: serverTimestamp()
            });
        });

        if (typeof window.showSuccessToast === 'function') {
            window.showSuccessToast("Scrim Challenge Accepted!", "Match confirmed! Opening direct lobby coordination...");
        }

        window.closeAcceptScrimModal();
        document.getElementById('acceptScrimForm')?.reset();

        // Reveal lobby details modal
        setTimeout(() => {
            window.openScrimDetailsModal(scrimId);
        }, 300);

    } catch (err) {
        console.error("Accept Scrim Transaction Error:", err);
        if (typeof window.showErrorToast === 'function') {
            window.showErrorToast("Could Not Accept", err.message || "Failed to accept scrim challenge.");
        }
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<span>Confirm &amp; Accept</span>';
        }
    }
};

// 6. SCRIM MATCH LOBBY DETAILS MODAL
window.openScrimDetailsModal = async (scrimId) => {
    let scrim = activeScrimsList.find(s => s.id === scrimId);
    if (!scrim) {
        try {
            const snap = await getDoc(doc(db, "scrims", scrimId));
            if (snap.exists()) {
                scrim = { id: snap.id, ...snap.data() };
            }
        } catch (e) {
            console.error("Error fetching scrim details:", e);
        }
    }

    if (!scrim) {
        if (typeof window.showErrorToast === 'function') {
            window.showErrorToast("Error", "Could not load match lobby details.");
        }
        return;
    }

    const hostNameEl = document.getElementById('details-host-name');
    const oppNameEl = document.getElementById('details-opponent-name');
    const gameEl = document.getElementById('details-game');
    const formatEl = document.getElementById('details-format');
    const timeEl = document.getElementById('details-time');
    const hostContactEl = document.getElementById('details-host-contact');
    const oppContactEl = document.getElementById('details-opponent-contact');

    if (hostNameEl) hostNameEl.textContent = scrim.teamName || 'Host Team';
    if (oppNameEl) oppNameEl.textContent = scrim.opponentTeamName || 'Challenger Team';
    if (gameEl) gameEl.textContent = scrim.game || 'Esports';
    if (formatEl) formatEl.textContent = scrim.format || '5v5 BO3';
    if (timeEl) timeEl.textContent = scrim.matchTime || 'Scheduled';
    if (hostContactEl) hostContactEl.textContent = scrim.captainContact || 'Not provided';
    if (oppContactEl) oppContactEl.textContent = scrim.opponentContact || 'Not provided';

    animateGenericOpen('scrimDetailsModal', 'scrimDetailsBackdrop', 'scrimDetailsPanel');
};

window.closeScrimDetailsModal = () => {
    animateGenericClose('scrimDetailsModal', 'scrimDetailsBackdrop', 'scrimDetailsPanel');
};

// 7. CANCEL SCRIM
window.cancelScrim = async (scrimId) => {
    const user = auth.currentUser;
    if (!user) return;

    const confirmed = await (window.showCustomConfirm
        ? window.showCustomConfirm("Cancel Scrim Request", "Are you sure you want to remove your scrim listing from the matchmaking board?")
        : confirm("Are you sure you want to remove your scrim listing from the matchmaking board?"));
    if (!confirmed) return;

    try {
        await updateDoc(doc(db, "scrims", scrimId), {
            status: "cancelled",
            cancelledAt: serverTimestamp()
        });

        if (typeof window.showSuccessToast === 'function') {
            window.showSuccessToast("Scrim Cancelled", "Your listing has been removed.");
        }
    } catch (err) {
        console.error("Error cancelling scrim:", err);
        if (typeof window.showErrorToast === 'function') {
            window.showErrorToast("Error", "Failed to cancel scrim listing.");
        }
    }
};

// 8. CLIPBOARD COPY HELPER
window.copyToClipboardText = (text, btnElement) => {
    if (!text || text === '--') return;
    navigator.clipboard.writeText(text).then(() => {
        if (btnElement) {
            const originalText = btnElement.textContent;
            btnElement.textContent = "Copied!";
            btnElement.classList.add('bg-emerald-500', 'text-black');
            setTimeout(() => {
                btnElement.textContent = originalText;
                btnElement.classList.remove('bg-emerald-500', 'text-black');
            }, 2000);
        }
        if (typeof window.showSuccessToast === 'function') {
            window.showSuccessToast("Copied", `"${text}" copied to clipboard!`, 2000);
        }
    }).catch(err => {
        console.error("Clipboard copy error:", err);
    });
};

// 9. CENTRALIZED TEARDOWN CLEANUP
function cleanupAllTeamsListeners() {
    if (typeof chatUnsubscribe === 'function') { chatUnsubscribe(); chatUnsubscribe = null; }
    if (typeof kickUnsubscribe === 'function') { kickUnsubscribe(); kickUnsubscribe = null; }
    if (typeof scrimsUnsubscribe === 'function') { scrimsUnsubscribe(); scrimsUnsubscribe = null; }
    if (Array.isArray(cardListeners)) {
        cardListeners.forEach(u => { if (typeof u === 'function') u(); });
        cardListeners = [];
    }
}

window.addEventListener('beforeunload', cleanupAllTeamsListeners);
window.addEventListener('pagehide', cleanupAllTeamsListeners);