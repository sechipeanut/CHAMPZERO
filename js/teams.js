import { db, auth } from './firebase-config.js';
import {
    collection, getDocs, doc, addDoc, updateDoc, deleteDoc,
    serverTimestamp, arrayUnion, arrayRemove, getDoc, onSnapshot, query, orderBy, collectionGroup, where, setDoc, increment 
} from "https://www.gstatic.com/firebasejs/11.1.0/firebase-firestore.js";
import { uploadImage } from './utils.js';

function qs(sel) { return document.querySelector(sel); }
function escapeHtml(str) { if (!str) return ''; return String(str).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])); }

// --- FEATURE FLAGS ---
const TEAM_RECRUITMENT_ENABLED = true; // Set to true to enable everyone to create a team

let currentUserRole = null;
let chatUnsubscribe = null;
let kickUnsubscribe = null;
let currentManageId = null;
let myTeamRole = null;
let activeTeamFilter = 'available';
let activeGameFilter = 'all';
let activeView = 'teams';
let searchTerm = '';

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
    console.log("🛠️ DOM Loaded: Initializing Teams & Recruitment...");

    auth.onAuthStateChanged(async (user) => {
        if (user) {
            console.log(`👤 Auth State: User ${user.uid} is logged in.`);
            try {
                const snap = await getDoc(doc(db, "users", user.uid));
                if (snap.exists()) currentUserRole = snap.data().role;
                startKickListener(user.uid);

                // --- SESSION RESTORATION LOGIC ---
                const savedTeamId = sessionStorage.getItem('active_chat_teamId');
                const savedLftId = sessionStorage.getItem('active_chat_lftId');

                if (savedTeamId) {
                    console.log(`🔄 Session Found: Attempting to reopen ID ${savedTeamId}`);
                    if (savedLftId) {
                        activeLftChatId = savedLftId;
                        window.startLftChat(savedTeamId, "User");
                    } else {
                        window.openManageModal(savedTeamId);
                    }
                }
            } catch (e) {
                console.error("❌ Error fetching role or session:", e);
            }
        } else {
            console.log("👤 Auth State: No user logged in.");
            if (kickUnsubscribe) kickUnsubscribe();
            currentUserRole = null;
        }
        renderTeams();
    });
    setupForms();
});

// --- RENDER LOGIC ---
// --- RENDER LOGIC ---
window.setTab = (tabName) => {
    if (tabName === 'find-teams') { activeView = 'teams'; activeTeamFilter = 'available'; }
    else if (tabName === 'find-players') { activeView = 'players'; activeTeamFilter = 'available'; }
    else if (tabName === 'my-teams') { activeView = 'teams'; activeTeamFilter = 'mine'; }
    else if (tabName === 'my-lft') { activeView = 'players'; activeTeamFilter = 'mine'; }
    else if (tabName === 'invites') { activeView = 'invites'; activeTeamFilter = 'none'; } // Handles the invites state

    // Updated list to include your invites tab button
    const tabs = ['find-teams', 'find-players', 'my-teams', 'my-lft', 'invites'];
    tabs.forEach(t => {
        const btn = document.getElementById(`tab-${t}`);
        if (btn) {
            if (t === tabName) btn.className = "px-4 py-2 rounded-lg font-bold text-sm transition-all bg-[var(--gold)] text-black shadow-lg shadow-yellow-500/20";
            else btn.className = "px-4 py-2 rounded-lg font-bold text-sm transition-all bg-white/5 text-gray-400 hover:text-white hover:bg-white/10";
        }
    });

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
}

window.setGameFilter = (game) => { activeGameFilter = game; renderTeams(); }

async function renderTeams() {
    const board = qs('#recruitment-board');
    if (!board) return;

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

            if (invitesSnap.empty) {
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

            board.innerHTML = '<div class="col-span-full space-y-3">';
            const container = document.createElement('div');
            container.className = 'col-span-full space-y-3';

            invitesSnap.forEach(d => {
                const inv = d.data();
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
                        <button onclick="window.acceptInvite('${d.id}', '${escapeHtml(inv.teamId)}', '${escapeHtml(inv.teamName)}')" 
                            class="bg-green-600/20 text-green-400 border border-green-600/30 text-xs px-4 py-2 rounded-lg font-bold hover:bg-green-600/30 transition flex-1 sm:flex-none">
                            Accept
                        </button>
                        <button onclick="window.declineInvite('${d.id}')" 
                            class="bg-red-600/20 text-red-400 border border-red-600/30 text-xs px-4 py-2 rounded-lg font-bold hover:bg-red-600/30 transition">
                            Decline
                        </button>
                    </div>` : ''}
                `;
                container.appendChild(card);
            });

            board.innerHTML = '';
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

    try {
        const querySnapshot = await getDocs(collection(db, "recruitment"));
        let posts = [];
        querySnapshot.forEach(doc => posts.push({ id: doc.id, ...doc.data() }));

        const targetType = activeView === 'teams' ? 'team' : 'lft';
        posts = posts.filter(p => (p.type === targetType) || (!p.type && activeView === 'teams'));
        posts.sort((a, b) => {
            if (a.isPremium !== b.isPremium) return b.isPremium ? 1 : -1;
            return (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0);
        });

        board.innerHTML = '';
        const myUid = auth.currentUser ? auth.currentUser.uid : null;
        let count = 0;

        // We will collect joined teams to attach listeners later
        let joinedTeamsToListen = [];

        posts.forEach((post) => {
            const isAuthor = myUid === post.authorId;
            const myMemberData = post.members ? post.members.find(m => m.uid === myUid) : null;
            const isMember = !!myMemberData;
            const isJoined = isAuthor || isMember;

            if (activeTeamFilter === 'mine' && !isJoined) return;
            if (activeTeamFilter === 'available' && isJoined) return;
            if (activeGameFilter !== 'all' && post.game !== activeGameFilter) return;
            if (searchTerm) {
                const searchTarget = (post.name || post.ign || '').toLowerCase();
                if (!searchTarget.includes(searchTerm)) return;
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

        if (count === 0) board.innerHTML = `<div class="col-span-full py-20 text-center"><p class="text-gray-500 italic">No listings found.</p></div>`;

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

        // 2. Listen for APPLICATION updates (Blue Blimp)
        // Only if Captain or Vice Captain
        if (team.canSeeApps) {
            const q = query(collection(db, "recruitment", team.id, "applications"), where("status", "==", "pending"));
            const appUnsub = onSnapshot(q, (querySnap) => {
                const pendingCount = querySnap.size;
                const showBlue = pendingCount > 0;
                updateBlimpUI(team.id, 'blue', showBlue);
            });
            cardListeners.push(appUnsub);
        }
    });
}

function updateBlimpUI(teamId, color, show) {
    // Find the specific card
    const card = document.querySelector(`article[data-id="${teamId}"]`);
    if (!card) return;

    // Find or Create Container
    let container = card.querySelector('.blimp-container');
    if (!container) {
        // If container doesn't exist (because initially no blimps), create it dynamically
        // Use the same position as your CSS
        container = document.createElement('div');
        container.className = 'blimp-container absolute top-3 left-3 flex gap-2 z-20'; // Helper classes in case CSS fails
        // Append to the first child (the image div)
        card.firstElementChild.appendChild(container);
    }

    // Find specific blimp
    let blimp = container.querySelector(`.blimp.${color}`);

    if (show) {
        if (!blimp) {
            blimp = document.createElement('div');
            blimp.className = `blimp ${color}`;
            // Apply tooltip
            blimp.title = color === 'red' ? 'New Messages' : 'New Requests';
            container.appendChild(blimp);
        }
    } else {
        if (blimp) {
            blimp.remove();
        }
    }
}

function renderTeamCard(post, isAuthor, isMember) {
    const memberCount = post.members ? post.members.length : 0;
    const maxMembers = post.maxMembers || 5;
    const isFull = memberCount >= maxMembers;
    let actionBtn = '';

    if (isAuthor || isMember) {
        actionBtn = `<button onclick="window.openManageModal('${post.id}')" class="w-full bg-[var(--gold)] text-black font-bold py-1.5 rounded-md mt-2 hover:bg-yellow-400 transition-transform active:scale-95 shadow-lg text-xs">Manage Team</button>`;
    } else if (isFull) {
        actionBtn = `<button disabled class="w-full bg-red-900/20 text-red-500 font-bold py-1.5 rounded-md mt-2 border border-red-900/50 cursor-not-allowed text-xs">Roster Full</button>`;
    } 
    else if (post.applicationsOpen === false) {
    actionBtn = `<button disabled class="w-full bg-white/5 text-gray-500 font-bold py-1.5 rounded-md mt-2 border border-white/10 cursor-not-allowed text-xs">Not Accepting</button>`;
    }
    else {
        actionBtn = `<button onclick="window.openApplicationModal('${post.id}', '${escapeHtml(post.name)}')" class="w-full bg-indigo-600 text-white font-bold py-1.5 rounded-md mt-2 hover:bg-indigo-500 transition-transform active:scale-95 shadow-lg shadow-indigo-500/20 text-xs">Apply to Join</button>`;
    }

    const borderClass = post.isPremium ? "border-[var(--gold)] shadow-[0_0_20px_rgba(255,215,0,0.15)]" : "border-white/10 hover:border-[var(--gold)]";
    const verifiedBadge = post.isPremium ? `<span class="bg-[var(--gold)] text-black text-[9px] px-1 py-0.5 rounded ml-1.5 font-bold">VERIFIED</span>` : '';
    const rolesHtml = post.roles ? post.roles.map(r => `<span class="bg-indigo-900/50 text-indigo-200 text-[9px] px-1.5 py-0.5 rounded border border-indigo-700/50">${escapeHtml(r.trim())}</span>`).join('') : '';
    const contactBtn = (post.isPremium && post.contactLink && !isAuthor && !isMember) ? `<a href="${escapeHtml(post.contactLink)}" target="_blank" class="block w-full text-center text-[var(--gold)] text-[11px] font-bold border border-[var(--gold)] py-1.5 rounded-md mb-1 hover:bg-[var(--gold)] hover:text-black transition-colors">Connect Directly ↗</a>` : '';

    return `
        <article data-id="${post.id}" class="bg-[var(--dark-card)] border rounded-xl overflow-hidden transition-all duration-300 h-52 group relative ${borderClass}">
            <div class="absolute inset-0 bg-cover bg-center transition-transform duration-500 group-hover:scale-105" style="background-image: url('${escapeHtml(post.image || 'pictures/cz_logo.png')}');"></div>
            <div class="blimp-container"></div>
            
            <!-- Softer base gradient overlay so unhovered cards look identical -->
            <div class="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-transparent z-10 pointer-events-none"></div>
            
            <div class="absolute top-2.5 right-2.5 bg-black/60 px-2 py-0.5 rounded text-[9px] text-white font-bold backdrop-blur-sm border border-white/10 uppercase z-10">${escapeHtml(post.game)}</div>
            
            <!-- FIXED: Main wrapper now spans the full height, pinning the name header down. 
                 The background styling shifts cleanly to avoid any height alignment differences. -->
            <div class="absolute inset-0 p-4 flex flex-col justify-end z-20 transition-all duration-300 bg-black/0 group-hover:bg-black/40 group-hover:backdrop-blur-md">
                
                <!-- This container holds the Title info which stays firmly anchored at the bottom when not hovered -->
                <div>
                    <div class="flex flex-wrap gap-1 mb-1.5">${rolesHtml}</div>
                    <div class="flex justify-between items-start">
                        <h3 class="text-base font-bold text-white truncate flex items-center group-hover:text-[var(--gold)] transition-colors">${escapeHtml(post.name)} </h3>
                    </div>
                </div>
                
                <!-- FIXED: Instead of sliding the whole card panel, we smoothly transition the max-height and opacity 
                     of the extra details area below the title. This completely neutralizes structural height differences! -->
                <div class="w-full max-h-0 opacity-0 group-hover:max-h-[140px] group-hover:opacity-100 transition-all duration-300 ease-in-out overflow-hidden group-hover:mt-3">
                    <div class="mb-2">
                        <div class="flex justify-between text-[9px] text-gray-400 mb-1 font-bold uppercase tracking-wider">
                            <span>Roster</span>
                            <span class="${isFull ? 'text-red-400' : 'text-[var(--gold)]'}">${memberCount} / ${maxMembers}</span>
                        </div>
                        <div class="w-full bg-white/10 h-1 rounded-full overflow-hidden">
                            <div class="bg-[var(--gold)] h-full transition-all duration-500" style="width: ${(memberCount / maxMembers) * 100}%"></div>
                        </div>
                    </div>
                    
                    <p class="text-[11px] text-gray-300 line-clamp-1 mb-2 leading-relaxed">${escapeHtml(post.description)}</p>
                    
                    ${contactBtn}
                    ${actionBtn}
                </div>

            </div>
        </article>`;
}

function renderPlayerCard(post, isAuthor) {
    const borderClass = post.isPremium ? "border-[var(--gold)] shadow-[0_0_20px_rgba(255,215,0,0.15)]" : "border-white/10 hover:border-[var(--gold)]";
    const verifiedBadge = post.isPremium ? `<span class="bg-[var(--gold)] text-black text-[9px] px-1 py-0.5 rounded ml-1.5 font-bold">PRO</span>` : '';

    const adminLogsBtn = currentUserRole === 'admin' ? '' : ''; 

    let actionBtn = '';
    if (isAuthor) {
        actionBtn = `
            <button onclick="window.openLftManageModal('${post.id}')" title="Manage Messages" class="p-2 bg-[var(--gold)] text-black rounded-lg hover:bg-yellow-400 transition-transform active:scale-95 shadow-lg">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor" class="w-4 h-4">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 1 1-3 0m3 0a1.5 1.5 0 1 0-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-9.75 0h9.75" />
                </svg>
            </button>`;
    } else {
        actionBtn = `
            <button onclick="window.startLftChat('${post.id}', '${escapeHtml(post.ign)}')" title="Message Player" class="p-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-500 transition-transform active:scale-95 shadow-lg shadow-indigo-500/20">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor" class="w-4 h-4">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M6 12 3.269 3.125A59.769 59.769 0 0 1 21.485 12 59.768 59.768 0 0 1 3.27 20.875L5.999 12Zm0 0h7.5" />
                </svg>
            </button>`;
    }

    const deleteBtn = isAuthor ? `
        <button onclick="window.deleteListing('${post.id}')" title="Delete Listing" class="p-2 bg-red-950/40 text-red-400 border border-red-900/30 rounded-lg hover:bg-red-900/40 transition-colors">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor" class="w-4 h-4">
                <path stroke-linecap="round" stroke-linejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
            </svg>
        </button>` : '';

    const hasDescription = post.description && post.description.trim().length > 0;

    // Truncate helper for display safety
    const truncate = (str, n) => str && str.length > n ? str.substring(0, n) + '…' : (str || '');

    const infoPopoverHtml = `
        <div id="info-popover-${post.id}" class="absolute bottom-[calc(100%+8px)] right-0 w-52 bg-[#1a1a2e] border border-[var(--gold)]/40 rounded-xl shadow-2xl p-3 z-50 pointer-events-none opacity-0 transition-all duration-200 ease-out" style="transform: scale(0.95); transform-origin: bottom right;">
            <div class="flex items-center gap-2 mb-2.5 pb-2 border-b border-white/10">
                <img src="${escapeHtml(post.image || 'https://ui-avatars.com/api/?name=' + post.ign + '&background=random')}" class="w-8 h-8 rounded-md border border-[var(--gold)] object-cover shrink-0">
                <div class="min-w-0">
                    <p class="text-xs font-bold text-white truncate">${escapeHtml(truncate(post.ign, 18))}</p>
                    <span class="text-[9px] font-bold bg-white/10 text-gray-300 px-1.5 py-0.5 rounded uppercase tracking-wider">${escapeHtml(post.game)}</span>
                </div>
            </div>
            <div class="flex gap-2 mb-2">
                <div class="flex-1 bg-black/30 px-2 py-1.5 rounded-md text-center border border-white/5 min-w-0">
                    <p class="text-[8px] text-gray-500 uppercase font-bold tracking-tight">Rank</p>
                    <p class="text-[11px] text-[var(--gold)] font-bold truncate leading-none mt-0.5">${escapeHtml(truncate(post.rank, 16))}</p>
                </div>
                <div class="flex-1 bg-black/30 px-2 py-1.5 rounded-md text-center border border-white/5 min-w-0">
                    <p class="text-[8px] text-gray-500 uppercase font-bold tracking-tight">Role</p>
                    <p class="text-[11px] text-white font-bold truncate leading-none mt-0.5">${escapeHtml(truncate(post.role, 16))}</p>
                </div>
            </div>
            ${hasDescription ? `<p class="text-[10px] text-gray-400 italic leading-relaxed bg-black/20 rounded-lg px-2 py-1.5 border border-white/5 line-clamp-3">"${escapeHtml(truncate(post.description, 120))}"</p>` : ''}
        </div>`;

    const infoBtn = `
        <button
            onmouseenter="const p=document.getElementById('info-popover-${post.id}'); p.style.opacity='1'; p.style.transform='scale(1)'; p.style.pointerEvents='auto';"
            onmouseleave="const p=document.getElementById('info-popover-${post.id}'); p.style.opacity='0'; p.style.transform='scale(0.95)'; p.style.pointerEvents='none';"
            title="View Info" class="p-2 bg-white/10 text-gray-300 rounded-lg hover:bg-white/20 transition-transform active:scale-95 border border-white/10">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor" class="w-4 h-4">
                <path stroke-linecap="round" stroke-linejoin="round" d="m11.25 11.25.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z" />
            </svg>
        </button>`;

    return `
        <article data-id="${post.id}" class="bg-[var(--dark-card)] border rounded-xl transition-all duration-300 h-20 group flex flex-col justify-start relative ${borderClass}" style="overflow:visible;">
            <div class="blimp-container"></div>

            ${infoPopoverHtml}

            <div class="w-full flex items-center justify-between px-4 h-20 shrink-0 relative z-10 rounded-xl overflow-hidden">
                <div class="flex items-center gap-3 min-w-0">
                    <img src="${escapeHtml(post.image || 'https://ui-avatars.com/api/?name=' + post.ign + '&background=random')}" class="w-11 h-11 rounded-md border border-[var(--gold)] object-cover shadow-lg shrink-0">
                    <div class="min-w-0">
                        <h3 class="text-sm font-bold text-white flex items-center group-hover:text-[var(--gold)] transition-colors truncate">
                            ${escapeHtml(post.ign)} ${verifiedBadge}
                        </h3>
                        <span class="text-[9px] font-bold bg-white/10 text-gray-300 px-1.5 py-0.5 rounded uppercase tracking-wider block w-fit mt-0.5">${escapeHtml(post.game)}</span>
                    </div>
                </div>
                
                <div class="relative w-36 h-11 shrink-0 overflow-hidden">
                    <div class="absolute inset-0 flex gap-2 transition-all duration-300 transform translate-x-0 opacity-100 group-hover:-translate-x-4 group-hover:opacity-0 ease-in-out">
                        <div class="flex-1 bg-black/20 px-2 py-1 rounded-md text-center border border-white/5 min-w-0 flex flex-col justify-center">
                            <p class="text-[8px] text-gray-500 uppercase font-bold tracking-tight">Rank</p>
                            <p class="text-xs text-[var(--gold)] font-bold truncate leading-none mt-0.5">${escapeHtml(post.rank)}</p>
                        </div>
                        <div class="flex-1 bg-black/20 px-2 py-1 rounded-md text-center border border-white/5 min-w-0 flex flex-col justify-center">
                            <p class="text-[8px] text-gray-500 uppercase font-bold tracking-tight">Role</p>
                            <p class="text-xs text-white font-bold truncate leading-none mt-0.5">${escapeHtml(post.role)}</p>
                        </div>
                    </div>
                    
                    <div class="absolute inset-0 flex gap-2 items-center justify-end transition-all duration-300 transform translate-x-8 opacity-0 group-hover:translate-x-0 group-hover:opacity-100 ease-in-out">
                        ${adminLogsBtn}
                        ${deleteBtn}
                        ${infoBtn}
                        ${actionBtn}
                    </div>
                </div>
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
    document.getElementById(`lft-view-${tab}`).classList.remove('hidden');

    // Style the two tabs
    const tabs = ['inbox', 'chat'];
    tabs.forEach(t => {
        const btn = document.getElementById(`lft-tab-${t}`);
        btn.className = (t === tab)
            ? "flex-1 py-3 text-sm font-bold text-[var(--gold)] border-b-2 border-[var(--gold)] bg-white/5"
            : "flex-1 py-3 text-sm font-bold text-gray-400 hover:text-white hover:bg-white/5";
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
    document.getElementById('create-type').value = type;
    const btnTeam = document.getElementById('btn-type-team');
    const btnLft = document.getElementById('btn-type-lft');
    const teamFields = document.getElementById('team-fields');
    const lftFields = document.getElementById('lft-fields');
    const ignField = document.getElementById('lft-ign-field');

    if (type === 'team') {
        btnTeam.classList.add('bg-[var(--gold)]', 'text-black', 'shadow-md');
        btnTeam.classList.remove('text-gray-400', 'hover:text-white');
        btnLft.classList.remove('bg-[var(--gold)]', 'text-black', 'shadow-md');
        btnLft.classList.add('text-gray-400', 'hover:text-white');
        teamFields.classList.remove('hidden');
        lftFields.classList.add('hidden');
        ignField.classList.add('hidden'); 
    } else {
        btnLft.classList.add('bg-[var(--gold)]', 'text-black', 'shadow-md');
        btnLft.classList.remove('text-gray-400', 'hover:text-white');
        btnTeam.classList.remove('bg-[var(--gold)]', 'text-black', 'shadow-md');
        btnTeam.classList.add('text-gray-400', 'hover:text-white');
        lftFields.classList.remove('hidden');
        teamFields.classList.add('hidden');
        ignField.classList.remove('hidden');
    }
}

window.openCreateModal = async () => {
    if (!auth.currentUser) { window.showCustomAlert("Login Required", "Please log in to post a listing."); return; }

    const isAdminOrSub = currentUserRole === 'admin' || currentUserRole === 'subscriber';

    if (TEAM_RECRUITMENT_ENABLED) {
        // Flag ON: everyone can create a team
        const btnTeam = document.getElementById('btn-type-team');
        btnTeam.classList.remove('opacity-50', 'cursor-not-allowed');
        btnTeam.onclick = () => toggleFormType('team');
        toggleFormType('team');
    } else if (isAdminOrSub) {
        // Flag OFF but user is admin/subscriber: original premium behavior
        const btnTeam = document.getElementById('btn-type-team');
        btnTeam.classList.remove('opacity-50', 'cursor-not-allowed');
        btnTeam.onclick = () => toggleFormType('team');
        toggleFormType('team');
    } else {
        // Flag OFF and user is a regular member: block team creation
        toggleFormType('lft');
        const btnTeam = document.getElementById('btn-type-team');
        btnTeam.classList.add('opacity-50', 'cursor-not-allowed');
        btnTeam.onclick = (e) => { e.stopPropagation(); window.showCustomAlert("Premium Feature", "Team Recruitment is available for Subscribers and Admins only."); };
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
    document.getElementById(`view-${tabName}`).classList.remove('hidden');

    // Style tabs
    ['chat', 'roster', 'applications', 'settings'].forEach(t => {
        const btn = document.getElementById(`tab-${t}`);
        if (btn) {
            btn.className = "flex-1 py-3 text-sm font-bold text-gray-400 hover:text-white hover:bg-white/5 transition-all";
            btn.style.borderBottom = "none";
        }
    });
    const activeBtn = document.getElementById(`tab-${tabName}`);
    if (activeBtn) {
        activeBtn.className = "flex-1 py-3 text-sm font-bold text-[var(--gold)] bg-white/5 transition-all";
        activeBtn.style.borderBottom = "2px solid var(--gold)";
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

window.acceptInvite = async (inviteDocId, teamId, teamName) => {
    const user = auth.currentUser;
    if (!user) return;

    const confirmed = await window.showCustomConfirm("Accept Invite", `Join <strong>${teamName}</strong>?`);
    if (!confirmed) return;

    try {
        // Add the user to the team's members array
        await updateDoc(doc(db, "recruitment", teamId), {
            members: arrayUnion({ uid: user.uid, name: user.displayName || "Player", ign: playerIgn, role: "Member" }),
            currentMembers: increment(1)
        });

        // Mark invite as accepted
        await deleteDoc(doc(db, "users", user.uid, "invites", inviteDocId));

        await window.showCustomAlert("Joined!", `You are now a member of ${teamName}.`);
        renderTeams(); // Refresh the invites view

    } catch (e) {
        console.error("Accept invite error:", e);
        window.showCustomAlert("Error", "Failed to accept invite.");
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

window.acceptInvite = async (inviteDocId, teamId, teamName) => {
    const user = auth.currentUser;
    if (!user) return;

    const confirmed = await window.showCustomConfirm("Accept Invite", `Join <strong>${teamName}</strong>?`);
    if (!confirmed) return;

    try {
        const playerName = user.displayName || "Player";

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
                const baseData = {
                    type: type,
                    game: document.getElementById('create-game').value,
                    description: document.getElementById('create-desc').value,
                    image: document.getElementById('create-img').value,
                    contactLink: isPremium ? document.getElementById('create-link').value : null,
                    isPremium: isPremium,
                    authorId: auth.currentUser.uid,
                    authorEmail: auth.currentUser.email,
                    createdAt: serverTimestamp(),
                    lastActive: serverTimestamp()
                };

                if (type === 'team') {
                    const rolesInput = document.getElementById('create-roles').value;
                    baseData.name = document.getElementById('create-name').value;
                    baseData.maxMembers = Math.min(parseInt(document.getElementById('create-max').value) || 7, 7);
                    baseData.currentMembers = 1;
                    baseData.roles = rolesInput ? rolesInput.split(',').map(r => r.trim()).filter(r => r) : [];
                    baseData.members = [{ uid: auth.currentUser.uid, name: auth.currentUser.displayName || "Captain", role: 'Captain', joinedAt: Date.now() }];
                } else {
                    baseData.ign = document.getElementById('create-ign').value;
                    baseData.role = document.getElementById('create-main-role').value;
                    baseData.rank = document.getElementById('create-rank').value;
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

    // AUTO-FILL IGN FROM PROFILE BASED ON GAME SELECTION
    const gameSelect = document.getElementById('create-game');
    if (gameSelect) {
        gameSelect.addEventListener('change', async () => {
            const selectedGame = gameSelect.value;
            const ignInput = document.getElementById('create-ign');
            const ignHint = document.getElementById('ign-hint');
            const rankSel = document.getElementById('create-rank');
            const roleSel = document.getElementById('create-main-role');

            const currentType = document.getElementById('create-type').value;
            if (currentType !== 'lft') return;
            if (!selectedGame || !auth.currentUser) return;

            try {
                const userSnap = await getDoc(doc(db, "users", auth.currentUser.uid));
                if (!userSnap.exists()) return;
                const data = userSnap.data();

                // Autofill IGN
                const fetchedIgn = data[selectedGame] || '';
                if (fetchedIgn) {
                    ignInput.value = fetchedIgn;
                    ignHint.classList.remove('hidden');
                } else {
                    ignInput.value = '';
                    ignHint.classList.add('hidden');
                    await window.showCustomAlert(
                        "No Account Found",
                        `There is no User Account set yet. Please set it on your <a href="/edit-profile" class="text-[var(--gold)] underline">Profile</a>, or manually type your User Account below.`
                    );
                    ignInput.focus();
                }

                // Autofill Rank & Role from profile
                const rankMap = { valId: 'valRank', mlbbId: 'mlbbRank', hokId: 'hokRank' };
                const roleMap = { valId: 'valRole', mlbbId: 'mlbbRole', hokId: 'hokRole' };

                const fetchedRank = data[rankMap[selectedGame]] || '';
                const fetchedRole = data[roleMap[selectedGame]] || '';

                if (rankSel) rankSel.value = fetchedRank;
                if (roleSel) roleSel.value = fetchedRole;

            } catch (err) {
                console.error("Failed to fetch profile game ID:", err);
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
            const max = Math.min(parseInt(document.getElementById('edit-max').value) || 7, 7); // 👈 clamp to 7

            try {
                const toggleBtn = document.getElementById('toggle-applications');
                const applicationsOpen = toggleBtn ? toggleBtn.getAttribute('aria-checked') === 'true' : true;
                
                await updateDoc(doc(db, "recruitment", id), { description: desc, maxMembers: max, applicationsOpen });
                
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