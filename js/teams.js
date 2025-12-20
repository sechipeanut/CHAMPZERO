// js/teams.js
import { db, auth } from './firebase-config.js';
import { 
    collection, getDocs, doc, addDoc, updateDoc, deleteDoc, 
    serverTimestamp, arrayUnion, arrayRemove, getDoc, onSnapshot, query, orderBy, collectionGroup, where
} from "https://www.gstatic.com/firebasejs/11.1.0/firebase-firestore.js";

// Helper for selecting elements
function qs(sel) { return document.querySelector(sel); }
// Helper for escaping HTML to prevent XSS
function escapeHtml(str) { if (!str) return ''; return String(str).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }

// Global Variables
let currentUserRole = null;
let chatUnsubscribe = null; 
let kickUnsubscribe = null; // New listener for kick notifications
let currentManageId = null; 

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
        if(callback) callback();
    }, 300);
}

// --- 2. CUSTOM POPUP LOGIC ---
window.showCustomAlert = (title, message) => {
    return new Promise((resolve) => {
        const titleEl = document.getElementById('alertTitle');
        const msgEl = document.getElementById('alertMessage');
        const btnContainer = document.getElementById('alertButtons');

        if(!document.getElementById('customAlertModal')) { alert(message); resolve(); return; }

        titleEl.textContent = title;
        msgEl.innerHTML = message; 
        btnContainer.innerHTML = '';

        const okBtn = document.createElement('button');
        okBtn.className = "px-6 py-2 bg-[var(--gold)] text-black rounded-lg text-sm font-bold hover:bg-yellow-400 transition-colors shadow-lg shadow-yellow-500/20";
        okBtn.textContent = "OK";
        okBtn.onclick = () => {
            animateGenericClose('customAlertModal', 'alertBackdrop', 'alertBox');
            resolve();
        };

        btnContainer.appendChild(okBtn);
        animateGenericOpen('customAlertModal', 'alertBackdrop', 'alertBox');
    });
};

window.showCustomConfirm = (title, message) => {
    return new Promise((resolve) => {
        const titleEl = document.getElementById('alertTitle');
        const msgEl = document.getElementById('alertMessage');
        const btnContainer = document.getElementById('alertButtons');

        if(!document.getElementById('customAlertModal')) { resolve(confirm(message)); return; }

        titleEl.textContent = title;
        msgEl.innerHTML = message;
        btnContainer.innerHTML = '';

        const cancelBtn = document.createElement('button');
        cancelBtn.className = "px-4 py-2 bg-white/5 border border-white/10 text-gray-300 rounded-lg text-sm hover:bg-white/10 transition-colors";
        cancelBtn.textContent = "Cancel";
        cancelBtn.onclick = () => {
            animateGenericClose('customAlertModal', 'alertBackdrop', 'alertBox');
            resolve(false);
        };

        const confirmBtn = document.createElement('button');
        confirmBtn.className = "px-4 py-2 bg-[var(--gold)] text-black rounded-lg text-sm font-bold hover:bg-yellow-400 transition-colors shadow-lg shadow-yellow-500/20";
        confirmBtn.textContent = "Confirm";
        confirmBtn.onclick = () => {
            animateGenericClose('customAlertModal', 'alertBackdrop', 'alertBox');
            resolve(true);
        };

        btnContainer.appendChild(cancelBtn);
        btnContainer.appendChild(confirmBtn);
        animateGenericOpen('customAlertModal', 'alertBackdrop', 'alertBox');
    });
};

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', async () => {
    auth.onAuthStateChanged(async (user) => {
        if (user) {
            try {
                const snap = await getDoc(doc(db, "users", user.uid));
                if (snap.exists()) currentUserRole = snap.data().role;
                
                // START LISTENING FOR KICK NOTIFICATIONS
                startKickListener(user.uid);
                
            } catch (e) { console.error("Error fetching user role:", e); }
        } else {
            if(kickUnsubscribe) kickUnsubscribe();
        }
        renderTeams();
    });
    setupForms();
});

// --- NEW: KICK NOTIFICATION LISTENER ---
function startKickListener(uid) {
    // Queries all 'applications' across the DB where I am the applicant AND status is 'kicked'
    const q = query(collectionGroup(db, 'applications'), 
        where('applicantId', '==', uid), 
        where('status', '==', 'kicked')
    );

    kickUnsubscribe = onSnapshot(q, async (snapshot) => {
        for (const change of snapshot.docChanges()) {
            if (change.type === 'added') {
                const appDoc = change.doc;
                // Get the parent Team Document to find the Name
                // Structure: recruitment/{teamId}/applications/{appId} -> parent.parent is teamRef
                const teamRef = appDoc.ref.parent.parent; 
                
                if(teamRef) {
                    try {
                        const teamSnap = await getDoc(teamRef);
                        const teamName = teamSnap.exists() ? teamSnap.data().name : "Unknown Team";
                        
                        // Show the Alert
                        await window.showCustomAlert("Notification", `You have been kicked from <strong>${escapeHtml(teamName)}</strong>.`);
                        
                        // Clean up: Delete the application so notification doesn't show again
                        await deleteDoc(appDoc.ref);
                        
                        // Refresh UI if needed
                        renderTeams();
                    } catch(err) {
                        console.error("Error handling kick notification:", err);
                    }
                }
            }
        }
    });
}

// --- RENDER TEAMS LIST ---
async function renderTeams() {
    const board = qs('#recruitment-board');
    if (!board) return;
    board.innerHTML = '<div class="text-center py-12"><div class="animate-pulse flex flex-col items-center"><div class="h-4 w-4 bg-[var(--gold)] rounded-full mb-2"></div><p class="text-gray-500 text-sm">Loading listings...</p></div></div>';

    try {
        const querySnapshot = await getDocs(collection(db, "recruitment")); 
        
        let myApplications = {}; 
        if (auth.currentUser) {
            const appsQuery = query(collectionGroup(db, 'applications'), where('applicantId', '==', auth.currentUser.uid));
            const appsSnap = await getDocs(appsQuery);
            appsSnap.forEach(doc => {
                if(doc.ref.parent.parent) {
                    myApplications[doc.ref.parent.parent.id] = doc.id;
                }
            });
        }

        board.innerHTML = '';
        if (querySnapshot.empty) { board.innerHTML = '<p class="text-center text-gray-500 py-8">No active listings found.</p>'; return; }

        querySnapshot.forEach((docSnap) => {
            const post = docSnap.data();
            const docId = docSnap.id;
            
            const currentMembers = post.members ? post.members.length : (parseInt(post.currentMembers) || 0);
            const maxMembers = parseInt(post.maxMembers) || 5;
            const isFull = currentMembers >= maxMembers;
            
            const myUid = auth.currentUser ? auth.currentUser.uid : null;
            const isAuthor = myUid === post.authorId;
            const isAdmin = currentUserRole === 'admin';
            const isMember = post.members && post.members.some(m => m.uid === myUid);
            
            const appId = myApplications[docId];
            const hasApplied = !isMember && !!appId;

            const canManage = isAuthor || isAdmin;
            const imgUrl = post.image || `https://ui-avatars.com/api/?name=${encodeURIComponent(post.name)}&background=1A1A1F&color=FFD700&size=128`;

            const postEl = document.createElement('div');
            postEl.className = `bg-[var(--dark-card)] border ${isMember || isAuthor ? 'border-[var(--gold)]' : (isFull ? 'border-red-900/50 opacity-75' : 'border-white/10 hover:border-indigo-500')} rounded-xl p-6 flex flex-col md:flex-row items-start md:items-center gap-6 mb-4 transition-all duration-300 relative overflow-hidden`;
            
            let badge = '';
            if (isAuthor) badge = `<div class="absolute top-0 right-0 bg-[var(--gold)] text-black text-[10px] font-bold px-2 py-1 rounded-bl-lg">OWNER</div>`;
            else if (isMember) badge = `<div class="absolute top-0 right-0 bg-indigo-500 text-white text-[10px] font-bold px-2 py-1 rounded-bl-lg">MEMBER</div>`;

            let actionBtn = '';
            if (canManage) {
                 actionBtn = `<button onclick="window.openManageModal('${docId}', 'admin')" class="w-full md:w-auto px-6 py-2 bg-[var(--gold)] text-black rounded-lg text-sm font-bold hover:bg-yellow-400 transition-colors shadow-lg shadow-yellow-500/20">Manage Team</button>`;
            } else if (isMember) {
                 actionBtn = `<button onclick="window.openManageModal('${docId}', 'member')" class="w-full md:w-auto px-6 py-2 bg-indigo-600 text-white rounded-lg text-sm font-bold hover:bg-indigo-500 transition-colors shadow-lg shadow-indigo-500/20">View Team</button>`;
            } else if (hasApplied) {
                 actionBtn = `<button onclick="window.cancelApplication('${docId}', '${appId}')" class="w-full md:w-auto px-6 py-2 bg-red-900/50 border border-red-500/30 text-red-200 rounded-lg text-sm font-bold hover:bg-red-900 hover:text-white transition-colors">Cancel App</button>`;
            } else {
                 actionBtn = `<button onclick="${isFull ? '' : `window.openApplicationModal('${docId}', '${escapeHtml(post.name)}')`}" class="w-full md:w-auto px-6 py-2 rounded-lg text-sm font-bold transition-colors ${isFull ? 'bg-gray-700 text-gray-400 cursor-not-allowed' : 'bg-white/10 text-white hover:bg-white/20'}">${isFull ? 'Roster Full' : 'Apply to Join'}</button>`;
            }

            postEl.innerHTML = `
                ${badge}
                <div class="flex-shrink-0 w-full md:w-24 h-24 bg-black/20 rounded-lg overflow-hidden flex items-center justify-center">
                    <img src="${escapeHtml(imgUrl)}" alt="Team Logo" class="w-full h-full object-cover">
                </div>
                <div class="flex-1 w-full">
                    <div class="flex justify-between items-start">
                        <div>
                            <h3 class="font-bold text-white text-xl">${escapeHtml(post.name)}</h3>
                            <div class="text-xs text-[var(--gold)] uppercase font-bold mt-0.5">${escapeHtml(post.game)}</div>
                        </div>
                    </div>
                    <p class="text-sm text-gray-300 mt-2 line-clamp-2">"${escapeHtml(post.description)}"</p>
                    <div class="mt-4 flex flex-wrap gap-4 text-xs text-gray-400 items-center">
                        <div class="flex items-center gap-1">
                            <span class="${isFull ? 'text-red-400' : 'text-white'}">${currentMembers} / ${maxMembers} Members</span>
                        </div>
                    </div>
                </div>
                <div class="w-full md:w-auto mt-4 md:mt-0">${actionBtn}</div>
            `;
            board.appendChild(postEl);
        });
    } catch (error) { console.error(error); board.innerHTML = '<p class="text-red-500 text-center">Failed to load listings.</p>'; }
}

// ==========================================
// 2. WINDOW FUNCTIONS
// ==========================================

window.openManageModal = async (teamId, mode) => {
    currentManageId = teamId;
    const modal = document.getElementById('manageTeamModal');
    modal.classList.remove('hidden');
    
    const adminTabs = document.querySelectorAll('.admin-only');
    adminTabs.forEach(el => el.style.display = (mode === 'admin') ? 'block' : 'none');

    try {
        const docRef = doc(db, "recruitment", teamId);
        const docSnap = await getDoc(docRef);
        
        if (docSnap.exists()) {
            const data = docSnap.data();
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
    } catch (err) { console.error(err); await window.showCustomAlert("Error", "Failed to open team manager."); }
}

window.closeManageModal = () => {
    document.getElementById('manageTeamModal').classList.add('hidden');
    if (chatUnsubscribe) chatUnsubscribe();
    currentManageId = null;
    renderTeams();
}

window.switchManageTab = (tabName) => {
    document.querySelectorAll('.manage-view').forEach(el => el.classList.add('hidden'));
    document.getElementById(`view-${tabName}`).classList.remove('hidden');
    
    const activeClass = "flex-1 py-3 md:py-4 text-xs md:text-sm font-bold text-[var(--gold)] border-b-2 border-[var(--gold)] hover:bg-white/5 transition-colors whitespace-nowrap px-2";
    const inactiveClass = "flex-1 py-3 md:py-4 text-xs md:text-sm font-bold text-gray-400 hover:text-white hover:bg-white/5 transition-colors whitespace-nowrap px-2";

    ['chat', 'roster', 'applications', 'settings'].forEach(t => {
        const btn = document.getElementById(`tab-${t}`);
        if(btn) {
            btn.className = (t === tabName) ? activeClass : inactiveClass;
        }
    });
}

window.cancelApplication = async (teamId, appId) => {
    const confirm = await window.showCustomConfirm("Cancel Application?", "Are you sure you want to withdraw your application?");
    if(!confirm) return;

    try {
        await deleteDoc(doc(db, "recruitment", teamId, "applications", appId));
        await window.showCustomAlert("Success", "Application cancelled successfully.");
        renderTeams();
    } catch (err) {
        console.error(err);
        await window.showCustomAlert("Error", "Failed to cancel: " + err.message);
    }
};

// --- UPDATED: LEAVE TEAM WITH BOLD NOTIFICATION ---
window.leaveTeam = async () => {
    const confirm = await window.showCustomConfirm("Leave Team?", "Are you sure you want to leave this team? This action cannot be undone.");
    if(!confirm) return;
    
    try {
        const teamRef = doc(db, "recruitment", currentManageId);
        
        // 1. Get Team Name FIRST (before leaving)
        const teamSnap = await getDoc(teamRef);
        const teamName = teamSnap.exists() ? teamSnap.data().name : "the team";

        // 2. Delete Application
        const appsRef = collection(db, "recruitment", currentManageId, "applications");
        const q = query(appsRef, where("applicantId", "==", auth.currentUser.uid));
        const appSnaps = await getDocs(q);
        await Promise.all(appSnaps.docs.map(d => deleteDoc(d.ref)));

        // 3. Remove from Roster
        if (teamSnap.exists()) {
            const data = teamSnap.data();
            const updatedMembers = data.members.filter(m => m.uid !== auth.currentUser.uid);
            const newCount = parseInt(updatedMembers.length);

            await updateDoc(teamRef, {
                members: updatedMembers,
                currentMembers: newCount
            });
            
            // 4. Show Bold Notification
            await window.showCustomAlert("Success", `You have left <strong>${escapeHtml(teamName)}</strong>.`);
            window.closeManageModal();
            renderTeams(); 
        }
    } catch (err) {
        console.error("Leave Team Error:", err);
        await window.showCustomAlert("Error", "Error leaving team: " + err.message);
    }
}

// --- UPDATED: KICK MEMBER (TRIGGERS NOTIFICATION) ---
window.kickMember = async (uid) => {
    const confirm = await window.showCustomConfirm("Kick Member?", "Are you sure you want to kick this user?");
    if(!confirm) return;
    
    try {
        const teamRef = doc(db, "recruitment", currentManageId);
        
        // 1. UPDATE Application status to 'kicked' (so the user gets notified)
        // instead of deleting it immediately.
        const appsRef = collection(db, "recruitment", currentManageId, "applications");
        const q = query(appsRef, where("applicantId", "==", uid));
        const appSnaps = await getDocs(q);
        
        // Update all matching applications to 'kicked' status
        await Promise.all(appSnaps.docs.map(d => updateDoc(d.ref, { status: 'kicked' })));

        // 2. Remove from Roster
        const snap = await getDoc(teamRef);
        const mems = snap.data().members.filter(m => m.uid !== uid);
        const newCount = parseInt(mems.length);
        
        await updateDoc(teamRef, { 
            members: mems, 
            currentMembers: newCount 
        });
        
        renderRosterList(mems, true);
    } catch (error) {
        console.error("Error kicking member:", error);
        await window.showCustomAlert("Error", "Failed to kick member: " + error.message);
    }
};

window.openApplicationModal = (teamId, teamName) => {
    if (!auth.currentUser) { 
        window.showCustomAlert("Login Required", "Please log in to apply."); 
        return; 
    }
    
    document.getElementById('app-team-id').value = teamId;
    document.getElementById('app-team-name').textContent = teamName;
    document.getElementById('applicationModal').classList.remove('hidden');
}

window.handleApp = async (appId, uid, name, accept) => {
    try {
        await updateDoc(doc(db, "recruitment", currentManageId, "applications", appId), { status: accept ? 'accepted' : 'rejected' });
        if(accept) {
            await updateDoc(doc(db, "recruitment", currentManageId), {
                members: arrayUnion({ uid, name, role: 'Member', joinedAt: Date.now() })
            });
        }
        loadApplications(currentManageId);
        const snap = await getDoc(doc(db, "recruitment", currentManageId));
        renderRosterList(snap.data().members, true);
    } catch (error) {
        console.error(error);
        await window.showCustomAlert("Error", "Error updating application: " + error.message);
    }
};

window.openCreateModal = async () => {
    if (!auth.currentUser) { 
        window.showCustomAlert("Login Required", "Please log in to post a listing."); 
        return; 
    }
    if (currentUserRole !== 'admin' && currentUserRole !== 'subscriber') {
        await window.showCustomAlert("Restricted Access", "Only Subscribers and Admins can post listings."); 
        return;
    }
    animateGenericOpen('createTeamModal', 'createTeamBackdrop', 'createTeamPanel');
}

window.closeCreateModal = () => { 
    animateGenericClose('createTeamModal', 'createTeamBackdrop', 'createTeamPanel', () => {
        qs('#createTeamForm').reset();
    });
}

// ==========================================
// 3. INTERNAL HELPERS
// ==========================================

function renderRosterList(members, isAdmin) {
    const list = document.getElementById('roster-list');
    list.innerHTML = '';
    
    if (!isAdmin) {
        const leaveContainer = document.createElement('div');
        leaveContainer.className = "mb-4 pb-4 border-b border-white/10 text-right";
        leaveContainer.innerHTML = `<button onclick="window.leaveTeam()" class="text-xs bg-red-900/80 text-white px-3 py-2 rounded hover:bg-red-800 transition">Leave Team</button>`;
        list.appendChild(leaveContainer);
    }

    members.forEach(m => {
        const isMe = auth.currentUser && m.uid === auth.currentUser.uid;
        const item = document.createElement('div');
        item.className = "flex justify-between items-center bg-black/20 p-3 rounded border border-white/5";
        item.innerHTML = `
            <div>
                <div class="font-bold text-white flex items-center gap-2">
                    ${escapeHtml(m.name)} 
                    ${isMe ? '<span class="text-[10px] bg-indigo-600 px-1 rounded text-white">YOU</span>' : ''}
                </div>
                <div class="text-xs text-gray-400">${m.role}</div>
            </div>
            ${isAdmin && !isMe ? `<button onclick="window.kickMember('${m.uid}')" class="text-xs bg-red-900/50 text-red-300 px-3 py-1 rounded hover:bg-red-900 transition">Kick</button>` : ''}
        `;
        list.appendChild(item);
    });
}

function startChatListener(teamId) {
    const chatContainer = document.getElementById('chat-messages');
    chatContainer.innerHTML = '<p class="text-center text-gray-500 mt-4">Loading messages...</p>';
    
    const q = query(collection(db, "recruitment", teamId, "messages"), orderBy("createdAt", "asc"));
    
    chatUnsubscribe = onSnapshot(q, (snapshot) => {
        chatContainer.innerHTML = '';
        if (snapshot.empty) {
            chatContainer.innerHTML = '<p class="text-center text-gray-500 mt-10">Start the conversation!</p>';
            return;
        }

        snapshot.forEach((doc) => {
            const msg = doc.data();
            const isMe = msg.senderId === auth.currentUser.uid;
            
            const bubble = document.createElement('div');
            bubble.className = `chat-bubble ${isMe ? 'mine' : 'theirs'} mb-2`;
            bubble.innerHTML = `
                <div class="font-bold text-[10px] opacity-75 mb-0.5">${escapeHtml(msg.senderName)}</div>
                <div>${escapeHtml(msg.text)}</div>
                <span class="chat-time">${new Date(msg.createdAt?.toDate()).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
            `;
            chatContainer.appendChild(bubble);
        });
        chatContainer.scrollTop = chatContainer.scrollHeight;
    });
}

function setupForms() {
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
                    text: text,
                    senderId: auth.currentUser.uid,
                    senderName: auth.currentUser.displayName || auth.currentUser.email.split('@')[0],
                    createdAt: serverTimestamp()
                });
            } catch (err) {
                console.error("Chat error", err);
                await window.showCustomAlert("Error", "Failed to send message.");
            }
        });
    }

    // Create Team Form
    const createForm = document.getElementById('createTeamForm');
    if(createForm) {
        createForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = createForm.querySelector('button[type="submit"]');
            const nameInput = document.getElementById('create-name').value; 
            btn.textContent = "Posting..."; btn.disabled = true;
            
            try {
                await addDoc(collection(db, "recruitment"), {
                    name: nameInput,
                    game: document.getElementById('create-game').value,
                    currentMembers: 1, 
                    maxMembers: parseInt(document.getElementById('create-max').value),
                    description: document.getElementById('create-desc').value,
                    image: document.getElementById('create-img').value,
                    authorId: auth.currentUser.uid,
                    authorEmail: auth.currentUser.email,
                    createdAt: serverTimestamp(),
                    members: [{ uid: auth.currentUser.uid, name: auth.currentUser.displayName || "Captain", role: 'Captain', joinedAt: Date.now() }] 
                });
                
                window.closeCreateModal(); 
                await window.showCustomAlert("Success", "Your team: <strong>" + escapeHtml(nameInput) + "</strong> has been created.");
                renderTeams();
            } catch(e) { console.error(e); await window.showCustomAlert("Error", e.message); } 
            finally { btn.textContent = "Post Listing"; btn.disabled = false; }
        });
    }

    // Application Form
    const appForm = document.getElementById('applicationForm');
    if(appForm) {
        appForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const teamId = document.getElementById('app-team-id').value;
            const note = document.getElementById('app-note').value;
            const btn = appForm.querySelector('button[type="submit"]');
            
            btn.textContent = "Sending..."; btn.disabled = true;

            try {
                await addDoc(collection(db, "recruitment", teamId, "applications"), {
                    applicantId: auth.currentUser.uid,
                    applicantName: auth.currentUser.displayName || auth.currentUser.email,
                    note: note, status: 'pending', appliedAt: serverTimestamp()
                });
                await window.showCustomAlert("Success", "Application sent successfully!");
                document.getElementById('applicationModal').classList.add('hidden');
                appForm.reset();
                renderTeams();
            } catch (error) {
                console.error(error);
                await window.showCustomAlert("Error", "Failed to apply: " + error.message);
            } finally {
                btn.textContent = "Send Application"; btn.disabled = false;
            }
        });
    }
}

async function loadApplications(teamId) {
    const list = document.getElementById('applications-list');
    list.innerHTML = '<p class="text-gray-500 text-center">Loading...</p>';
    const snap = await getDocs(collection(db, "recruitment", teamId, "applications"));
    list.innerHTML = '';
    let count = 0;
    snap.forEach(d => {
        const app = d.data();
        if(app.status === 'pending') {
            count++;
            const div = document.createElement('div');
            div.className = "bg-black/20 p-3 rounded border border-white/5";
            div.innerHTML = `
                <div class="font-bold text-sm text-white">${escapeHtml(app.applicantName)}</div>
                <div class="text-xs text-gray-400 italic mb-2">"${escapeHtml(app.note)}"</div>
                <div class="flex gap-2">
                    <button onclick="window.handleApp('${d.id}', '${app.applicantId}', '${escapeHtml(app.applicantName)}', true)" class="flex-1 bg-green-700 text-xs py-1 rounded text-white">Accept</button>
                    <button onclick="window.handleApp('${d.id}', null, null, false)" class="flex-1 bg-red-900 text-xs py-1 rounded text-white">Reject</button>
                </div>`;
            list.appendChild(div);
        }
    });
    if(count === 0) list.innerHTML = '<p class="text-gray-500 text-center py-4">No pending applications.</p>';
    const badge = document.getElementById('badge-apps');
    if(badge) { badge.textContent = count; badge.classList.toggle('hidden', count === 0); }
}