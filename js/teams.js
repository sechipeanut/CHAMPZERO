import { db, auth } from './firebase-config.js';
import {
    collection, getDocs, doc, addDoc, updateDoc, deleteDoc,
    serverTimestamp, arrayUnion, arrayRemove, getDoc, onSnapshot, query, orderBy, collectionGroup, where
} from "https://www.gstatic.com/firebasejs/11.1.0/firebase-firestore.js";

function qs(sel) { return document.querySelector(sel); }
function escapeHtml(str) { if (!str) return ''; return String(str).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])); }

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

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', async () => {
    qs('#team-search')?.addEventListener('input', (e) => {
        searchTerm = e.target.value.toLowerCase();
        renderTeams();
    });

    auth.onAuthStateChanged(async (user) => {
        if (user) {
            try {
                const snap = await getDoc(doc(db, "users", user.uid));
                if (snap.exists()) currentUserRole = snap.data().role;
                startKickListener(user.uid);
            } catch (e) { console.error("Error fetching role:", e); }
        } else { if (kickUnsubscribe) kickUnsubscribe(); }
        
        window.setTab('find-teams');
    });
    setupForms();
});

// --- RENDER LOGIC ---
window.setTab = (tabName) => {
    if (tabName === 'find-teams') { activeView = 'teams'; activeTeamFilter = 'available'; }
    else if (tabName === 'find-players') { activeView = 'players'; activeTeamFilter = 'available'; }
    else if (tabName === 'my-teams') { activeView = 'teams'; activeTeamFilter = 'mine'; }
    else if (tabName === 'my-lft') { activeView = 'players'; activeTeamFilter = 'mine'; }

    const tabs = ['find-teams', 'find-players', 'my-teams', 'my-lft'];
    tabs.forEach(t => {
        const btn = document.getElementById(`tab-${t}`);
        if (btn) {
            if (t === tabName) btn.className = "px-4 py-2 rounded-lg font-bold text-sm transition-all bg-[var(--gold)] text-black shadow-lg shadow-yellow-500/20";
            else btn.className = "px-4 py-2 rounded-lg font-bold text-sm transition-all bg-white/5 text-gray-400 hover:text-white hover:bg-white/10";
        }
    });
    renderTeams();
}

window.setGameFilter = (game) => { activeGameFilter = game; renderTeams(); }

async function renderTeams() {
    const board = qs('#recruitment-board');
    if (!board) return;
    
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
        actionBtn = `<button onclick="window.openManageModal('${post.id}')" class="w-full bg-[var(--gold)] text-black font-bold py-2.5 rounded-lg mt-auto hover:bg-yellow-400 transition-transform active:scale-95 shadow-lg">Manage Team</button>`;
    } else if (isFull) {
        actionBtn = `<button disabled class="w-full bg-red-900/20 text-red-500 font-bold py-2.5 rounded-lg mt-auto border border-red-900/50 cursor-not-allowed">Roster Full</button>`;
    } else {
        actionBtn = `<button onclick="window.openApplicationModal('${post.id}', '${escapeHtml(post.name)}')" class="w-full bg-indigo-600 text-white font-bold py-2.5 rounded-lg mt-auto hover:bg-indigo-500 transition-transform active:scale-95 shadow-lg shadow-indigo-500/20">Apply to Join</button>`;
    }

    const borderClass = post.isPremium ? "border-[var(--gold)] shadow-[0_0_20px_rgba(255,215,0,0.15)]" : "border-white/10 hover:border-[var(--gold)]";
    const verifiedBadge = post.isPremium ? `<span class="bg-[var(--gold)] text-black text-[10px] px-1.5 py-0.5 rounded ml-2 font-bold">VERIFIED</span>` : '';
    const rolesHtml = post.roles ? post.roles.map(r => `<span class="bg-indigo-900/50 text-indigo-200 text-[10px] px-2 py-1 rounded border border-indigo-700/50">${escapeHtml(r.trim())}</span>`).join('') : '';
    const contactBtn = (post.isPremium && post.contactLink && !isAuthor && !isMember) ? `<a href="${escapeHtml(post.contactLink)}" target="_blank" class="block w-full text-center text-[var(--gold)] text-xs font-bold border border-[var(--gold)] py-2 rounded-lg mb-3 hover:bg-[var(--gold)] hover:text-black transition-colors">Connect Directly ↗</a>` : '';

    // NOTE: We added data-id="${post.id}" to the article tag below
    return `
        <article data-id="${post.id}" class="bg-[var(--dark-card)] border rounded-xl overflow-hidden transition-all duration-300 flex flex-col hover:-translate-y-1 group relative ${borderClass}">
            <div class="h-40 bg-cover bg-center relative" style="background-image: url('${escapeHtml(post.image || 'pictures/cz_logo.png')}');">
                <div class="blimp-container"></div>
                
                <div class="absolute inset-0 bg-black/50 group-hover:bg-black/30 transition-colors"></div>
                <div class="absolute top-3 right-3 bg-black/60 px-2.5 py-1 rounded text-[10px] text-white font-bold backdrop-blur-sm border border-white/10 uppercase">${escapeHtml(post.game)}</div>
                <div class="absolute bottom-3 left-3 flex flex-wrap gap-1.5">${rolesHtml}</div>
            </div>
            <div class="p-5 flex-1 flex flex-col">
                <div class="flex justify-between items-start mb-3"><h3 class="text-xl font-bold text-white truncate flex items-center group-hover:text-[var(--gold)] transition-colors">${escapeHtml(post.name)} ${verifiedBadge}</h3></div>
                <div class="mb-5">
                    <div class="flex justify-between text-xs text-gray-400 mb-1.5 font-bold uppercase tracking-wider"><span>Roster</span><span class="${isFull ? 'text-red-400' : 'text-[var(--gold)]'}">${memberCount} / ${maxMembers}</span></div>
                    <div class="w-full bg-white/5 h-1.5 rounded-full overflow-hidden"><div class="bg-[var(--gold)] h-full transition-all duration-500" style="width: ${(memberCount / maxMembers) * 100}%"></div></div>
                </div>
                <p class="text-sm text-gray-400 line-clamp-2 mb-6 h-10 leading-relaxed">${escapeHtml(post.description)}</p>
                ${contactBtn}
                ${actionBtn}
            </div>
        </article>`;
}

function renderPlayerCard(post, isAuthor) {
    const borderClass = post.isPremium ? "border-[var(--gold)] shadow-[0_0_20px_rgba(255,215,0,0.15)]" : "border-white/10 hover:border-[var(--gold)]";
    const verifiedBadge = post.isPremium ? `<span class="bg-[var(--gold)] text-black text-[10px] px-1.5 py-0.5 rounded ml-2 font-bold">PRO</span>` : '';
    const contactBtn = (post.isPremium && post.contactLink && !isAuthor) ? `<a href="${escapeHtml(post.contactLink)}" target="_blank" class="block w-full text-center text-[var(--gold)] text-xs font-bold border border-[var(--gold)] py-2 rounded-lg mb-3 hover:bg-[var(--gold)] hover:text-black transition-colors">Direct Message ↗</a>` : '';

    return `
        <article class="bg-[var(--dark-card)] border rounded-xl overflow-hidden transition-all duration-300 flex flex-col hover:-translate-y-1 ${borderClass}">
            <div class="p-6 flex items-center gap-4 border-b border-white/5 bg-gradient-to-r from-[var(--dark-bg)] to-white/5">
                <img src="${escapeHtml(post.image || 'https://ui-avatars.com/api/?name='+post.ign+'&background=random')}" class="w-14 h-14 rounded-md border border-[var(--gold)] object-cover shadow-lg">
                <div>
                    <h3 class="text-lg font-bold text-white flex items-center">${escapeHtml(post.ign)} ${verifiedBadge}</h3>
                    <span class="text-[10px] font-bold bg-white/10 text-gray-300 px-2 py-0.5 rounded uppercase tracking-wider">${escapeHtml(post.game)}</span>
                </div>
            </div>
            <div class="p-6 flex-1 flex flex-col">
                <div class="grid grid-cols-2 gap-4 mb-6">
                    <div class="bg-black/20 p-2 rounded-lg text-center border border-white/5"><p class="text-[10px] text-gray-500 uppercase font-bold">Rank</p><p class="text-sm text-[var(--gold)] font-bold truncate">${escapeHtml(post.rank)}</p></div>
                    <div class="bg-black/20 p-2 rounded-lg text-center border border-white/5"><p class="text-[10px] text-gray-500 uppercase font-bold">Role</p><p class="text-sm text-white font-bold truncate">${escapeHtml(post.role)}</p></div>
                </div>
                <div class="mb-6 flex-grow"><p class="text-sm text-gray-400 italic text-center">"${escapeHtml(post.description)}"</p></div>
                ${contactBtn}
                ${isAuthor ? `<button onclick="window.deleteListing('${post.id}')" class="w-full bg-red-900/30 text-red-200 font-bold py-2.5 rounded-lg text-sm hover:bg-red-900/50 transition-colors border border-red-900/30">Delete Listing</button>` : ''}
            </div>
        </article>`;
}

// --- UTILS ---
window.toggleFormType = (type) => {
    document.getElementById('create-type').value = type;
    const btnTeam = document.getElementById('btn-type-team');
    const btnLft = document.getElementById('btn-type-lft');
    const teamFields = document.getElementById('team-fields');
    const lftFields = document.getElementById('lft-fields');
    
    if (type === 'team') {
        btnTeam.classList.add('bg-[var(--gold)]', 'text-black', 'shadow-md');
        btnTeam.classList.remove('text-gray-400', 'hover:text-white');
        btnLft.classList.remove('bg-[var(--gold)]', 'text-black', 'shadow-md');
        btnLft.classList.add('text-gray-400', 'hover:text-white');
        teamFields.classList.remove('hidden');
        lftFields.classList.add('hidden');
    } else {
        btnLft.classList.add('bg-[var(--gold)]', 'text-black', 'shadow-md');
        btnLft.classList.remove('text-gray-400', 'hover:text-white');
        btnTeam.classList.remove('bg-[var(--gold)]', 'text-black', 'shadow-md');
        btnTeam.classList.add('text-gray-400', 'hover:text-white');
        lftFields.classList.remove('hidden');
        teamFields.classList.add('hidden');
    }
}

window.openCreateModal = async () => {
    if (!auth.currentUser) { window.showCustomAlert("Login Required", "Please log in to post a listing."); return; }
    
    if (currentUserRole !== 'admin' && currentUserRole !== 'subscriber') {
        toggleFormType('lft');
        const btnTeam = document.getElementById('btn-type-team');
        btnTeam.classList.add('opacity-50', 'cursor-not-allowed');
        btnTeam.onclick = (e) => { e.stopPropagation(); window.showCustomAlert("Premium Feature", "Team Recruitment is available for Subscribers and Admins only."); };
    } else {
        const btnTeam = document.getElementById('btn-type-team');
        btnTeam.classList.remove('opacity-50', 'cursor-not-allowed');
        btnTeam.onclick = () => toggleFormType('team');
        toggleFormType('team'); 
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
    
    // --- INSTANT UI UPDATE: CLEAR RED BLIMP ---
    localStorage.setItem(`lastRead_${teamId}`, Date.now().toString());
    updateBlimpUI(teamId, 'red', false); 
    // ------------------------------------------

    document.getElementById('manageTeamModal').classList.remove('hidden');
    
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
    document.getElementById(`view-${tabName}`).classList.remove('hidden');
    ['chat','roster','applications','settings'].forEach(t => {
        const btn = document.getElementById(`tab-${t}`);
        if(btn) {
            btn.className = "flex-1 py-3 text-sm font-bold text-gray-400 hover:text-white hover:bg-white/5 transition-all";
            btn.style.borderBottom = "none";
        }
    });
    const activeBtn = document.getElementById(`tab-${tabName}`);
    if(activeBtn) {
        activeBtn.className = "flex-1 py-3 text-sm font-bold text-[var(--gold)] bg-white/5 transition-all";
        activeBtn.style.borderBottom = "2px solid var(--gold)";
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
    if(!await window.showCustomConfirm("Delete Listing?", "Are you sure?")) return;
    try { await deleteDoc(doc(db, "recruitment", docId)); await window.showCustomAlert("Deleted", "Listing removed."); renderTeams(); } catch(e) { console.error(e); }
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
        // Clean up applications for this user
        const appsRef = collection(db, "recruitment", currentManageId, "applications");
        const q = query(appsRef, where("applicantId", "==", uid));
        const appSnaps = await getDocs(q);
        await Promise.all(appSnaps.docs.map(d => updateDoc(d.ref, { status: 'kicked' })));
        
        // Remove from array
        const snap = await getDoc(teamRef);
        const mems = snap.data().members.filter(m => m.uid !== uid);
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
                    baseData.maxMembers = parseInt(document.getElementById('create-max').value);
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
    
    // Application Form Listener
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
    if (chatForm) {
        chatForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const input = document.getElementById('chat-input');
            const text = input.value.trim();
            if (!text || !currentManageId) return;
            input.value = '';
            try {
                await addDoc(collection(db, "recruitment", currentManageId, "messages"), {
                    text: text, senderId: auth.currentUser.uid, senderName: auth.currentUser.displayName || auth.currentUser.email.split('@')[0], createdAt: serverTimestamp()
                });
                await updateDoc(doc(db, "recruitment", currentManageId), { lastActive: serverTimestamp() });
            } catch (err) { console.error("Chat error", err); }
        });
    }
    
    // Edit Team Form Listener
    const editForm = document.getElementById('editTeamForm');
    if (editForm) {
        editForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const id = document.getElementById('edit-team-id').value;
            const desc = document.getElementById('edit-desc').value;
            const max = parseInt(document.getElementById('edit-max').value);
            
            try {
                await updateDoc(doc(db, "recruitment", id), { description: desc, maxMembers: max });
                window.showCustomAlert("Saved", "Team settings updated.");
            } catch(e) { console.error(e); }
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
        snapshot.forEach((doc) => {
            const msg = doc.data();
            const isMe = auth.currentUser && msg.senderId === auth.currentUser.uid;
            
            // --- 1. TIMESTAMP LOGIC ---
            // Handle case where serverTimestamp is null (latency) by using current time
            const dateObj = msg.createdAt ? msg.createdAt.toDate() : new Date();
            const timeString = dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

            // --- 2. RENDER LOGIC ---
            const bubble = document.createElement('div');

            if (msg.isSystem) {
                // SYSTEM MESSAGE STYLE (Centered, Gray)
                bubble.className = "flex justify-center my-4 opacity-75";
                bubble.innerHTML = `
                    <div class="bg-white/10 text-gray-300 text-[10px] px-3 py-1 rounded-full border border-white/5 font-bold uppercase tracking-wide">
                        ${escapeHtml(msg.text)} <span class="opacity-50 border-l border-white/20 pl-2 ml-2">${timeString}</span>
                    </div>`;
            } else {
                // USER MESSAGE STYLE (With Timestamp)
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