import { db, auth } from './firebase-config.js';
import {
    collection, getDocs, doc, addDoc, updateDoc, deleteDoc,
    serverTimestamp, arrayUnion, arrayRemove, getDoc, onSnapshot, query, orderBy, collectionGroup, where, setDoc
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

// --- UPDATED INITIALIZATION WITH DEBUG LOGS ---
document.addEventListener('DOMContentLoaded', async () => {
    console.log("DOM Loaded: Initializing Teams & Recruitment...");

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

const TAB_ACTIVE_CLASS = "px-5 py-2.5 rounded-xl font-heading font-bold text-xs uppercase tracking-wider transition-all bg-[#FFD700] text-black shadow-md cursor-pointer whitespace-nowrap border border-[#FFD700]";
const TAB_INACTIVE_CLASS = "px-5 py-2.5 rounded-xl font-heading font-bold text-xs uppercase tracking-wider transition-all bg-white/5 text-neutral-400 hover:text-white hover:bg-white/10 border border-white/10 hover:border-white/20 cursor-pointer whitespace-nowrap";

window.setTab = (tabName) => {
    if (tabName === 'find-teams') { activeView = 'teams'; activeTeamFilter = 'available'; }
    else if (tabName === 'find-players') { activeView = 'players'; activeTeamFilter = 'available'; }
    else if (tabName === 'my-teams') { activeView = 'teams'; activeTeamFilter = 'mine'; }
    else if (tabName === 'my-lft') { activeView = 'players'; activeTeamFilter = 'mine'; }

    const tabs = ['find-teams', 'find-players', 'my-teams', 'my-lft'];
    tabs.forEach(t => {
        const btn = document.getElementById(`tab-${t}`);
        if (btn) {
            btn.className = (t === tabName) ? TAB_ACTIVE_CLASS : TAB_INACTIVE_CLASS;
        }
    });
    renderTeams();
};

window.setGameFilter = (game) => { activeGameFilter = game; renderTeams(); }
window.setRosterFilter = (roster) => { activeRosterFilter = roster; renderTeams(); }
window.setRoleFilter = (role) => { activeRoleFilter = role; renderTeams(); }

window.resetFilters = () => {
    activeGameFilter = 'all';
    activeRosterFilter = 'all';
    activeRoleFilter = 'all';
    searchTerm = '';
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

    try {
        const querySnapshot = await getDocs(collection(db, "recruitment"));
        let posts = [];
        querySnapshot.forEach(doc => posts.push({ id: doc.id, ...doc.data() }));

        cachedRecruitmentPosts = posts;

        const targetType = activeView === 'teams' ? 'team' : 'lft';
        posts = posts.filter(p => (p.type === targetType) || (!p.type && activeView === 'teams'));
        posts.sort((a, b) => {
            if (a.isPremium !== b.isPremium) return b.isPremium ? 1 : -1;
            return (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0);
        });

        board.innerHTML = '';
        const myUid = auth.currentUser ? auth.currentUser.uid : null;
        let count = 0;
        let openCount = 0;

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

            // Check role for blimp permissions
            const myRole = isAuthor ? 'Captain' : (myMemberData ? myMemberData.role : 'Member');
            const canSeeApps = (myRole === 'Captain' || myRole === 'Vice Captain');

            const cardHTML = activeView === 'teams'
                ? renderTeamCard(post, isAuthor, isMember)
                : renderPlayerCard(post, isAuthor);

            board.innerHTML += cardHTML;

            // If we are part of this team, add to list for real-time monitoring
            if (isJoined && activeView === 'teams') {
                joinedTeamsToListen.push({
                    id: post.id,
                    canSeeApps: canSeeApps
                });
            }
        });

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

        if (count === 0) board.innerHTML = `
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

        // Start Real-time Listeners for Blimps
        subscribeToCardUpdates(joinedTeamsToListen);

    } catch (error) {
        console.error("Render Error:", error);
        board.innerHTML = '<div class="col-span-full py-20 text-center"><p class="text-red-500">Failed to load listings.</p></div>';
    }
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
    const borderClass = "border-white/10 hover:border-[#FFD700] hover:shadow-[0_0_25px_rgba(255,215,0,0.18)]";
    const verifiedBadge = post.isPremium ? `<span class="bg-[#FFD700] text-black text-[9px] font-mono-tag font-bold px-1.5 py-0.5 rounded uppercase">PRO</span>` : '';
    
    const rolesHtml = post.roles && post.roles.length > 0 
        ? post.roles.slice(0, 3).map(r => `<span class="bg-black/60 text-indigo-200 border border-indigo-500/30 text-[9px] font-mono-tag font-bold px-1.5 py-0.5 rounded uppercase tracking-wider">${escapeHtml(r.trim())}</span>`).join('') + (post.roles.length > 3 ? `<span class="text-[9px] text-neutral-400 font-mono-tag pl-0.5">+${post.roles.length - 3}</span>` : '')
        : `<span class="text-[9px] text-neutral-500 font-mono-tag">Any Role</span>`;

    let actionBtn = '';
    if (isAuthor || isMember) {
        actionBtn = `<button onclick="window.openManageModal('${post.id}')" class="flex-1 py-2 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 rounded-lg text-xs font-heading font-bold uppercase tracking-wider transition-all cursor-pointer">Manage</button>`;
    } else if (isFull) {
        actionBtn = `<button disabled class="flex-1 py-2 bg-neutral-900/80 text-neutral-500 border border-neutral-800 rounded-lg text-xs font-heading font-bold uppercase tracking-wider cursor-not-allowed">Full</button>`;
    } else {
        actionBtn = `<button onclick="window.openApplicationModal('${post.id}', '${escapeHtml(post.name)}')" class="flex-1 py-2 bg-[#FFD700] hover:bg-[#FFF099] text-black rounded-lg text-xs font-heading font-bold uppercase tracking-wider transition-all shadow-md hover:shadow-yellow-500/20 active:scale-95 flex items-center justify-center gap-1 cursor-pointer font-semibold"><span>Apply</span> &rarr;</button>`;
    }

    const statusBadge = isFull 
        ? `<span class="bg-red-500/20 text-red-400 border border-red-500/40 text-[9px] font-mono-tag font-bold px-2 py-0.5 rounded-full uppercase">Full</span>`
        : `<span class="bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 text-[9px] font-mono-tag font-bold px-2 py-0.5 rounded-full uppercase">${spotsLeft} Open</span>`;

    return `
        <article data-id="${post.id}" class="bg-[#0D0D12] border rounded-2xl overflow-hidden transition-all duration-300 min-h-[260px] group flex flex-col justify-between relative ${borderClass}">
            
            <!-- Card Top Header Banner -->
            <div class="relative h-28 w-full bg-cover bg-center overflow-hidden" style="background-image: url('${escapeHtml(post.image || 'pictures/cz_logo.png')}');">
                <div class="absolute inset-0 bg-gradient-to-t from-[#0D0D12] via-[#0D0D12]/60 to-black/50"></div>
                
                <div class="absolute top-2.5 left-2.5 right-2.5 flex items-center justify-between z-10">
                    <div class="flex items-center gap-1.5 min-w-0">
                        <span class="bg-black/80 backdrop-blur-md text-[#FFD700] border border-[#FFD700]/30 font-mono-tag font-bold text-[9px] px-2 py-0.5 rounded uppercase tracking-wider truncate">${escapeHtml(formatGameBadge(post.game || post.gameId))}</span>
                        <div class="blimp-container"></div>
                    </div>
                    ${statusBadge}
                </div>
            </div>

            <!-- Card Body Details -->
            <div class="px-4 pb-4 pt-1 flex-1 flex flex-col justify-between relative z-10 -mt-6">
                <div>
                    <div class="flex items-center justify-between gap-2 mb-1">
                        <h3 class="text-base font-heading font-bold text-white truncate group-hover:text-[#FFD700] transition-colors flex items-center gap-1.5">
                            ${escapeHtml(post.name)} ${verifiedBadge}
                        </h3>
                    </div>
                    
                    <p class="text-[10px] text-neutral-400 font-mono-tag truncate mb-2">
                        Captain: <span class="text-neutral-200 font-semibold">${escapeHtml(captain.name)}</span>
                    </p>

                    <div class="flex flex-wrap items-center gap-1 mb-3">
                        ${rolesHtml}
                    </div>
                </div>

                <div>
                    <div class="mb-3">
                        <div class="flex justify-between text-[9px] font-mono-tag text-neutral-400 mb-1 font-bold uppercase">
                            <span>Roster Slot</span>
                            <span class="${isFull ? 'text-red-400' : 'text-[#FFD700]'}">${memberCount} / ${maxMembers}</span>
                        </div>
                        <div class="w-full bg-black/60 h-1.5 rounded-full overflow-hidden border border-white/5">
                            <div class="bg-gradient-to-r from-amber-500 to-[#FFD700] h-full transition-all duration-500" style="width: ${Math.min(100, (memberCount / maxMembers) * 100)}%"></div>
                        </div>
                    </div>

                    <!-- Action Button Row -->
                    <div class="flex items-center gap-2 pt-2 border-t border-white/5">
                        <button onclick="window.openTeamDetailsModal('${post.id}')" class="flex-1 py-2 bg-white/5 hover:bg-white/15 text-neutral-200 border border-white/10 hover:border-white/30 rounded-lg text-xs font-heading font-bold uppercase tracking-wider transition-all cursor-pointer text-center">
                            Roster
                        </button>
                        ${actionBtn}
                    </div>
                </div>
            </div>
        </article>`;
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
    const borderClass = "border-white/10 hover:border-[#FFD700] hover:shadow-[0_0_25px_rgba(255,215,0,0.18)]";
    const verifiedBadge = post.isPremium ? `<span class="bg-[#FFD700] text-black text-[9px] font-mono-tag font-bold px-1.5 py-0.5 rounded uppercase">PRO</span>` : '';
    const avatarUrl = post.image || `https://ui-avatars.com/api/?name=${encodeURIComponent(post.ign || 'Player')}&background=111116&color=FFD700`;
    const gameBadge = formatGameBadge(post.game || post.gameId);
    const hasDesc = post.description && post.description.trim().length > 0;

    let actionBtn = '';
    if (isAuthor) {
        actionBtn = `
            <button onclick="window.openLftManageModal('${post.id}')" class="flex-1 py-2 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 rounded-lg text-xs font-heading font-bold uppercase tracking-wider transition-all cursor-pointer text-center">
                Manage
            </button>`;
    } else {
        actionBtn = `
            <button onclick="window.startLftChat('${post.id}', '${escapeHtml(post.ign)}')" class="flex-1 py-2 bg-[#FFD700] hover:bg-[#FFF099] text-black rounded-lg text-xs font-heading font-bold uppercase tracking-wider transition-all shadow-md hover:shadow-yellow-500/20 active:scale-95 flex items-center justify-center gap-1.5 cursor-pointer font-semibold">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor" class="w-3.5 h-3.5">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M6 12 3.269 3.125A59.769 59.769 0 0 1 21.485 12 59.768 59.768 0 0 1 3.27 20.875L5.999 12Zm0 0h7.5" />
                </svg>
                <span>Message</span>
            </button>`;
    }

    const deleteBtn = isAuthor ? `
        <button onclick="window.deleteListing('${post.id}')" title="Delete Listing" class="p-2 bg-red-950/40 hover:bg-red-900/50 text-red-400 border border-red-900/40 rounded-lg transition-colors cursor-pointer">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor" class="w-4 h-4">
                <path stroke-linecap="round" stroke-linejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
            </svg>
        </button>` : '';

    return `
        <article data-id="${post.id}" class="bg-[#0D0D12] border rounded-2xl p-4 transition-all duration-300 group flex flex-col justify-between relative ${borderClass}">
            <div class="blimp-container static mb-2"></div>

            <div>
                <!-- Top Header: Game Badge & LFT Status -->
                <div class="flex items-center justify-between gap-2 mb-3">
                    <span class="bg-black/80 text-[#FFD700] border border-[#FFD700]/30 font-mono-tag font-bold text-[9px] px-2 py-0.5 rounded uppercase tracking-wider truncate">
                        ${escapeHtml(gameBadge)}
                    </span>
                    <span class="bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 text-[9px] font-mono-tag font-bold px-2 py-0.5 rounded-full uppercase tracking-wider shrink-0">
                        FREE AGENT
                    </span>
                </div>

                <!-- Player Identity -->
                <div class="flex items-center gap-3 mb-3">
                    <img src="${escapeHtml(avatarUrl)}" class="w-12 h-12 rounded-xl border border-white/10 object-cover shadow-lg shrink-0 group-hover:border-[#FFD700]/50 transition-colors">
                    <div class="min-w-0 flex-1">
                        <h3 class="text-base font-heading font-bold text-white truncate group-hover:text-[#FFD700] transition-colors flex items-center gap-1.5">
                            ${escapeHtml(post.ign || 'Player')} ${verifiedBadge}
                        </h3>
                        ${post.discord ? `
                            <p class="text-[10px] text-neutral-400 font-mono-tag truncate mt-0.5">
                                Discord: <span class="text-neutral-200 font-semibold">${escapeHtml(post.discord)}</span>
                            </p>
                        ` : `
                            <p class="text-[10px] text-neutral-500 font-mono-tag">Looking for Squad</p>
                        `}
                    </div>
                </div>

                <!-- Tactical Stats HUD: Rank & Role -->
                <div class="grid grid-cols-2 gap-2 mb-3 bg-black/40 p-2.5 rounded-xl border border-white/5">
                    <div class="min-w-0">
                        <p class="text-[8px] text-neutral-500 uppercase font-mono-tag font-bold tracking-tight">Rank</p>
                        <p class="text-xs text-[#FFD700] font-heading font-bold truncate mt-0.5">${escapeHtml(post.rank || 'Unranked')}</p>
                    </div>
                    <div class="min-w-0">
                        <p class="text-[8px] text-neutral-500 uppercase font-mono-tag font-bold tracking-tight">Role</p>
                        <p class="text-xs text-white font-heading font-bold truncate mt-0.5">${escapeHtml(post.role || 'Flex')}</p>
                    </div>
                </div>

                <!-- Bio Summary -->
                ${hasDesc ? `
                    <p class="text-[11px] text-neutral-400 leading-relaxed bg-black/20 p-2.5 rounded-lg border border-white/5 line-clamp-2 mb-3 italic">
                        "${escapeHtml(post.description)}"
                    </p>
                ` : ''}
            </div>

            <!-- Footer Actions -->
            <div class="flex items-center gap-2 pt-3 border-t border-white/5">
                ${deleteBtn}
                ${actionBtn}
            </div>
        </article>`;
}

let activeLftChatId = null; // Stores the UID of the person the creator is chatting with

// 1. For a user to start a chat with the lister
window.startLftChat = async (listingId, ign) => {
    if (!auth.currentUser) return window.showCustomAlert("Login Required", "Please log in to message players.");

    currentManageId = listingId;
    activeLftChatId = auth.currentUser.uid;

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
    chatUnsubscribe = onSnapshot(q, (snapshot) => {
        chatContainer.innerHTML = backBtnHtml;
        let lastDateLabel = null;

        snapshot.forEach(doc => {
            const msg = doc.data();
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
                    <span class="font-bold text-[10px] opacity-75">${escapeHtml(msg.senderName)}</span>
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

            const newMember = {
                uid: applicantId,
                name: applicantName,
                role: 'Member', // Default role
                joinedAt: Date.now()
            };

            await updateDoc(teamRef, {
                members: arrayUnion(newMember),
                currentMembers: (data.members || []).length + 1
            });
            await updateDoc(appRef, { status: 'accepted' });
            await sendSystemMessage(currentManageId, `${applicantName} has joined the team`);
            await window.showCustomAlert("Success", "Player accepted into the roster!");
        } else {
            await updateDoc(appRef, { status: 'rejected' });
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

window.openApplicationModal = (teamId, teamName) => {
    if (!auth.currentUser) { window.showCustomAlert("Login Required", "Please log in to apply."); return; }
    document.getElementById('app-team-id').value = teamId;
    document.getElementById('app-team-name').textContent = teamName;
    document.getElementById('applicationModal').classList.remove('hidden');
}

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
            const memberName = members[index].name;
            await sendSystemMessage(currentManageId, `${memberName} has been promoted to Vice Captain`);

            // 3. Update UI
            renderRosterList(members);
            window.showCustomAlert("Success", "Member promoted to Vice Captain.");
        }
    } catch (error) { console.error(error); }
}

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
            const memberName = members[index].name;
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
        const kickedName = kickedMember ? kickedMember.name : 'A member';
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
        const leaverName = auth.currentUser.displayName || auth.currentUser.email.split('@')[0];
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
            if (activeLftChatId) {
                const chatDocRef = doc(db, "recruitment", currentManageId, "private_chats", activeLftChatId);

                await setDoc(chatDocRef, {
                    lastMessage: text,
                    lastMessageTime: serverTimestamp(),
                    participantId: activeLftChatId,
                    participantName: auth.currentUser.displayName || auth.currentUser.email.split('@')[0]
                }, { merge: true });

                await addDoc(collection(chatDocRef, "messages"), {
                    text: text,
                    senderId: auth.currentUser.uid,
                    senderName: auth.currentUser.displayName || auth.currentUser.email.split('@')[0],
                    createdAt: serverTimestamp()
                });
            }
            // 2. STANDARD TEAM CHAT LOGIC
            // If activeLftChatId is null, we are in a regular Team Dashboard
            else {
                await addDoc(collection(db, "recruitment", currentManageId, "messages"), {
                    text: text,
                    senderId: auth.currentUser.uid,
                    senderName: auth.currentUser.displayName || auth.currentUser.email.split('@')[0],
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

                await setDoc(chatDocRef, {
                    lastMessage: text,
                    lastMessageTime: serverTimestamp(),
                    participantId: activeLftChatId,
                    participantName: auth.currentUser.displayName || auth.currentUser.email.split('@')[0]
                }, { merge: true });

                await addDoc(collection(chatDocRef, "messages"), {
                    text: text,
                    senderId: auth.currentUser.uid,
                    senderName: auth.currentUser.displayName || auth.currentUser.email.split('@')[0],
                    createdAt: serverTimestamp()
                });

                await updateDoc(doc(db, "recruitment", currentManageId), { lastActive: serverTimestamp() });
            } catch (err) {
                console.error("LFT Chat error", err);
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

            try {
                await updateDoc(doc(db, "recruitment", id), { description: desc, maxMembers: max });
                window.showCustomAlert("Saved", "Team settings updated.");
            } catch (e) { console.error(e); }
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
function renderRosterList(members) {
    const list = document.getElementById('roster-list');
    list.innerHTML = '';

    // Only regular members see the Leave button in this list (Admins usually have a disband or separate logic, 
    // but Captain shouldn't leave their own team without disbanding or passing lead)
    if (myTeamRole === 'Member' || myTeamRole === 'Vice Captain') {
        const leaveContainer = document.createElement('div');
        leaveContainer.className = "mb-4 pb-4 border-b border-white/10 text-right";
        leaveContainer.innerHTML = `<button onclick="window.leaveTeam()" class="text-xs bg-red-900/80 text-white px-3 py-2 rounded-lg hover:bg-red-800 transition font-bold">Leave Team</button>`;
        list.appendChild(leaveContainer);
    }

    members.forEach(m => {
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
            // Captain Logic
            if (myTeamRole === 'Captain') {
                if (targetRole === 'Member') {
                    buttons += `<button onclick="window.promoteMember('${m.uid}')" class="text-xs bg-purple-600/20 text-purple-400 border border-purple-600/30 px-2 py-1.5 rounded hover:bg-purple-600/40 mr-2 transition font-bold">Promote</button>`;
                } else if (targetRole === 'Vice Captain') {
                    buttons += `<button onclick="window.demoteMember('${m.uid}')" class="text-xs bg-gray-600/20 text-gray-400 border border-gray-600/30 px-2 py-1.5 rounded hover:bg-gray-600/40 mr-2 transition font-bold">Demote</button>`;
                }
                buttons += `<button onclick="window.kickMember('${m.uid}', '${targetRole}')" class="text-xs bg-red-900/30 text-red-300 border border-red-900/50 px-2 py-1.5 rounded hover:bg-red-900/50 transition font-bold">Kick</button>`;
            }
            // Vice Captain Logic (Can only kick Members)
            else if (myTeamRole === 'Vice Captain' && targetRole === 'Member') {
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

    chatUnsubscribe = onSnapshot(q, (snapshot) => {
        chatContainer.innerHTML = '';
        let lastDateLabel = null;

        snapshot.forEach((doc) => {
            const msg = doc.data();
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
                        <span class="font-bold text-[10px] opacity-75 tracking-wide">${escapeHtml(msg.senderName)}</span>
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
                    <button onclick="window.handleApp('${d.id}', '${app.applicantId}', '${escapeHtml(app.applicantName)}', true)" class="flex-1 bg-green-600/20 text-green-400 border border-green-600/30 text-xs py-2 rounded font-bold hover:bg-green-600/30 transition">Accept</button>
                    <button onclick="window.handleApp('${d.id}', null, null, false)" class="flex-1 bg-red-600/20 text-red-400 border border-red-600/30 text-xs py-2 rounded font-bold hover:bg-red-600/30 transition">Reject</button>
                </div>`;
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