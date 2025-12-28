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
let activeTeamFilter = 'available'; 
let activeGameFilter = 'all'; 
let activeView = 'teams'; 
let searchTerm = '';

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

// --- 2. CUSTOM ALERT ---
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
        
        // Default Tab Init
        window.setTab('find-teams');
    });
    setupForms();
});

// --- RENDER LOGIC ---
// REPLACES setView and setTeamFilter
window.setTab = (tabName) => {
    // 1. Update State
    if (tabName === 'find-teams') {
        activeView = 'teams';
        activeTeamFilter = 'available';
    } else if (tabName === 'find-players') {
        activeView = 'players';
        activeTeamFilter = 'available';
    } else if (tabName === 'my-teams') {
        activeView = 'teams';
        activeTeamFilter = 'mine';
    } else if (tabName === 'my-lft') {
        activeView = 'players';
        activeTeamFilter = 'mine';
    }

    // 2. Update UI (Styling)
    const tabs = ['find-teams', 'find-players', 'my-teams', 'my-lft'];
    tabs.forEach(t => {
        const btn = document.getElementById(`tab-${t}`);
        if (btn) {
            if (t === tabName) {
                // Active Style
                btn.className = "px-4 py-2 rounded-lg font-bold text-sm transition-all bg-[var(--gold)] text-black shadow-lg shadow-yellow-500/20";
            } else {
                // Inactive Style
                btn.className = "px-4 py-2 rounded-lg font-bold text-sm transition-all bg-white/5 text-gray-400 hover:text-white hover:bg-white/10";
            }
        }
    });

    // 3. Render
    renderTeams();
}

window.setGameFilter = (game) => {
    activeGameFilter = game;
    renderTeams();
}

async function renderTeams() {
    const board = qs('#recruitment-board');
    if (!board) return;
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

        posts.forEach((post) => {
            const isAuthor = myUid === post.authorId;
            const isMember = post.members && post.members.some(m => m.uid === myUid);
            const isJoined = isAuthor || isMember;

            if (activeTeamFilter === 'mine' && !isJoined) return;
            if (activeTeamFilter === 'available' && isJoined) return;
            if (activeGameFilter !== 'all' && post.game !== activeGameFilter) return;
            if (searchTerm) {
                const searchTarget = (post.name || post.ign || '').toLowerCase();
                if (!searchTarget.includes(searchTerm)) return;
            }
            
            count++;
            const cardHTML = activeView === 'teams' 
                ? renderTeamCard(post, isAuthor, isMember) 
                : renderPlayerCard(post, isAuthor);
            
            board.innerHTML += cardHTML;
        });

        if (count === 0) board.innerHTML = `<div class="col-span-full py-20 text-center"><p class="text-gray-500 italic">No listings found.</p></div>`;
    } catch (error) { 
        console.error("Render Error:", error); 
        board.innerHTML = '<div class="col-span-full py-20 text-center"><p class="text-red-500">Failed to load listings. Check console.</p></div>'; 
    }
}

function renderTeamCard(post, isAuthor, isMember) {
    const memberCount = post.members ? post.members.length : 0;
    const maxMembers = post.maxMembers || 5;
    const isFull = memberCount >= maxMembers;
    let actionBtn = '';

    if (isAuthor) actionBtn = `<button onclick="window.openManageModal('${post.id}', 'admin')" class="w-full bg-[var(--gold)] text-black font-bold py-2.5 rounded-lg mt-auto hover:bg-yellow-400 transition-transform active:scale-95 shadow-lg">Manage Team</button>`;
    else if (isMember) actionBtn = `<button onclick="window.openManageModal('${post.id}', 'view')" class="w-full bg-white/10 text-white font-bold py-2.5 rounded-lg mt-auto hover:bg-white/20 transition-transform active:scale-95">View Team</button>`;
    else if (isFull) actionBtn = `<button disabled class="w-full bg-red-900/20 text-red-500 font-bold py-2.5 rounded-lg mt-auto border border-red-900/50 cursor-not-allowed">Roster Full</button>`;
    else actionBtn = `<button onclick="window.openApplicationModal('${post.id}', '${escapeHtml(post.name)}')" class="w-full bg-indigo-600 text-white font-bold py-2.5 rounded-lg mt-auto hover:bg-indigo-500 transition-transform active:scale-95 shadow-lg shadow-indigo-500/20">Apply to Join</button>`;

    const borderClass = post.isPremium ? "border-[var(--gold)] shadow-[0_0_20px_rgba(255,215,0,0.15)]" : "border-white/10 hover:border-[var(--gold)]";
    const verifiedBadge = post.isPremium ? `<span class="bg-[var(--gold)] text-black text-[10px] px-1.5 py-0.5 rounded ml-2 font-bold">VERIFIED</span>` : '';
    const rolesHtml = post.roles ? post.roles.map(r => `<span class="bg-indigo-900/50 text-indigo-200 text-[10px] px-2 py-1 rounded border border-indigo-700/50">${escapeHtml(r.trim())}</span>`).join('') : '';
    const contactBtn = (post.isPremium && post.contactLink && !isAuthor && !isMember) ? `<a href="${escapeHtml(post.contactLink)}" target="_blank" class="block w-full text-center text-[var(--gold)] text-xs font-bold border border-[var(--gold)] py-2 rounded-lg mb-3 hover:bg-[var(--gold)] hover:text-black transition-colors">Connect Directly ↗</a>` : '';

    return `
        <article class="bg-[var(--dark-card)] border rounded-xl overflow-hidden transition-all duration-300 flex flex-col hover:-translate-y-1 group relative ${borderClass}">
            <div class="h-40 bg-cover bg-center relative" style="background-image: url('${escapeHtml(post.image || 'pictures/cz_logo.png')}');">
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
    
    const activeClass = "bg-[var(--gold)] text-black shadow-md".split(" ");
    const inactiveClass = "text-gray-400 hover:text-white".split(" ");

    if (type === 'team') {
        btnTeam.classList.add(...activeClass);
        btnTeam.classList.remove(...inactiveClass);
        btnLft.classList.remove(...activeClass);
        btnLft.classList.add(...inactiveClass);
        teamFields.classList.remove('hidden');
        lftFields.classList.add('hidden');
    } else {
        btnLft.classList.add(...activeClass);
        btnLft.classList.remove(...inactiveClass);
        btnTeam.classList.remove(...activeClass);
        btnTeam.classList.add(...inactiveClass);
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

window.openManageModal = async (teamId, mode) => { 
    currentManageId = teamId;
    document.getElementById('manageTeamModal').classList.remove('hidden');
    document.querySelectorAll('.admin-only').forEach(el => el.style.display = (mode === 'admin') ? 'block' : 'none');
    try {
        const snap = await getDoc(doc(db, "recruitment", teamId));
        if (snap.exists()) {
            const data = snap.data();
            document.getElementById('manage-team-name').textContent = data.name;
            if (mode === 'admin') {
                document.getElementById('edit-team-id').value = teamId;
                document.getElementById('edit-desc').value = data.description;
                document.getElementById('edit-max').value = data.maxMembers;
                loadApplications(teamId);
            }
            renderRosterList(data.members || [], mode === 'admin');
            startChatListener(teamId);
            window.switchManageTab('chat');
        }
    } catch (err) { console.error(err); }
}

window.closeManageModal = () => { 
    document.getElementById('manageTeamModal').classList.add('hidden'); 
    if (chatUnsubscribe) chatUnsubscribe();
    renderTeams();
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
                role: 'Member',
                joinedAt: Date.now()
            };

            await updateDoc(teamRef, {
                members: arrayUnion(newMember),
                currentMembers: (data.members || []).length + 1
            });
            await updateDoc(appRef, { status: 'accepted' });
            await window.showCustomAlert("Success", "Player accepted into the roster!");
        } else {
            await updateDoc(appRef, { status: 'rejected' });
            await window.showCustomAlert("Rejected", "Application rejected.");
        }
        loadApplications(currentManageId);
        const updatedSnap = await getDoc(teamRef);
        renderRosterList(updatedSnap.data().members || [], true);

    } catch (error) {
        console.error("Handle App Error:", error);
        await window.showCustomAlert("Error", "Action failed: " + error.message);
    }
};

window.deleteListing = async (docId) => {
    if(!await window.showCustomConfirm("Delete Listing?", "Are you sure?")) return;
    try { await deleteDoc(doc(db, "recruitment", docId)); await window.showCustomAlert("Deleted", "Listing removed."); renderTeams(); } catch(e) { console.error(e); }
};

window.openApplicationModal = (teamId, teamName) => {
    if (!auth.currentUser) { window.showCustomAlert("Login Required", "Please log in to apply."); return; }
    document.getElementById('app-team-id').value = teamId;
    document.getElementById('app-team-name').textContent = teamName;
    document.getElementById('applicationModal').classList.remove('hidden');
}

window.kickMember = async (uid) => { 
    const confirm = await window.showCustomConfirm("Kick Member?", "Are you sure?");
    if (!confirm) return;
    try {
        const teamRef = doc(db, "recruitment", currentManageId);
        const appsRef = collection(db, "recruitment", currentManageId, "applications");
        const q = query(appsRef, where("applicantId", "==", uid));
        const appSnaps = await getDocs(q);
        await Promise.all(appSnaps.docs.map(d => updateDoc(d.ref, { status: 'kicked' })));
        
        const snap = await getDoc(teamRef);
        const mems = snap.data().members.filter(m => m.uid !== uid);
        await updateDoc(teamRef, { members: mems, currentMembers: mems.length });
        
        renderRosterList(mems, true);
    } catch (error) { console.error(error); }
};

window.leaveTeam = async () => {
    const confirm = await window.showCustomConfirm("Leave Team?", "Are you sure?");
    if (!confirm) return;
    try {
        const teamRef = doc(db, "recruitment", currentManageId);
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
}

// Helpers for Roster/Chat
function renderRosterList(members, isAdmin) {
    const list = document.getElementById('roster-list');
    list.innerHTML = '';
    
    if (!isAdmin) {
        const leaveContainer = document.createElement('div');
        leaveContainer.className = "mb-4 pb-4 border-b border-white/10 text-right";
        leaveContainer.innerHTML = `<button onclick="window.leaveTeam()" class="text-xs bg-red-900/80 text-white px-3 py-2 rounded-lg hover:bg-red-800 transition font-bold">Leave Team</button>`;
        list.appendChild(leaveContainer);
    }

    members.forEach(m => {
        const isMe = auth.currentUser && m.uid === auth.currentUser.uid;
        const item = document.createElement('div');
        item.className = "flex justify-between items-center bg-black/20 p-4 rounded-lg border border-white/5 hover:border-white/10 transition-colors";
        item.innerHTML = `<div><div class="font-bold text-white flex items-center gap-2 text-sm">${escapeHtml(m.name)} ${isMe ? '<span class="text-[10px] bg-indigo-600 px-1.5 py-0.5 rounded text-white font-bold tracking-wide">YOU</span>' : ''}</div><div class="text-xs text-gray-400 mt-0.5">${m.role}</div></div>${isAdmin && !isMe ? `<button onclick="window.kickMember('${m.uid}')" class="text-xs bg-red-900/30 text-red-300 border border-red-900/50 px-3 py-1.5 rounded-lg hover:bg-red-900/50 transition font-bold">Kick</button>` : ''}`;
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
            const isMe = msg.senderId === auth.currentUser.uid;
            const bubble = document.createElement('div');
            bubble.className = `chat-bubble ${isMe ? 'mine' : 'theirs'} mb-3 shadow-md`;
            bubble.innerHTML = `<div class="font-bold text-[10px] opacity-75 mb-1 tracking-wide">${escapeHtml(msg.senderName)}</div><div class="leading-relaxed">${escapeHtml(msg.text)}</div>`;
            chatContainer.appendChild(bubble);
        });
        chatContainer.scrollTop = chatContainer.scrollHeight;
    });
}

async function loadApplications(teamId) {
    const list = document.getElementById('applications-list');
    const snap = await getDocs(collection(db, "recruitment", teamId, "applications"));
    list.innerHTML = '';
    snap.forEach(d => {
        const app = d.data();
        if (app.status === 'pending') {
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
    if (list.innerHTML === '') list.innerHTML = '<p class="text-center text-gray-500 py-4 text-sm">No pending requests.</p>';
}