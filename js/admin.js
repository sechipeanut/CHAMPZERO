import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-auth.js";
import {
    doc,
    getDoc,
    setDoc,
    addDoc,
    updateDoc,
    deleteDoc,
    collection,
    getDocs,
    query,
    serverTimestamp,
    orderBy
} from "https://www.gstatic.com/firebasejs/11.1.0/firebase-firestore.js";
import { toDateInputFormat, calculateStatus, uploadImage } from './utils.js';

function qs(sel) { return document.querySelector(sel); }
function escapeHtml(str) { if (!str) return ''; return String(str).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])); }

// Focus management
let lastFocusedElement = null;

// State
let editState = { isEditing: false, collection: null, id: null, formId: null, modalId: null };
let currentUserId = null;
let allUsers = []; 
let currentRoleFilter = 'all';
window.usersLoaded = false;

// ======================
// LIVESTREAM MANAGEMENT (Restored)
// ======================

window.createLivestream = async function(eventId, eventName) {
    const confirmed = await window.showCustomConfirm("Create Livestream", `Create a new livestream for "${eventName}"?`);
    if (!confirmed) return;
    
    try {
        window.showSuccessToast("Processing", "Creating livestream...", 3000);
        
        const response = await fetch('/.netlify/functions/create-mux-stream', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ eventId, eventName })
        });
        
        if (!response.ok) throw new Error('Failed to create stream');
        
        const streamData = await response.json();
        
        // Update Firestore with stream info
        const eventRef = doc(db, 'events', eventId);
        await updateDoc(eventRef, {
            livestream: {
                streamId: streamData.streamId,
                streamKey: streamData.streamKey,
                playbackId: streamData.playbackId,
                status: streamData.status,
                createdAt: serverTimestamp()
            }
        });
        
        window.showSuccessToast("Success", "Livestream created successfully!", 3000);
        refreshAllLists();
        manageLivestream(eventId);
        
    } catch (error) {
        console.error('Error creating livestream:', error);
        window.showErrorToast("Error", "Failed to create livestream: " + error.message, 5000);
    }
};

window.manageLivestream = async function(eventId) {
    try {
        const eventRef = doc(db, 'events', eventId);
        const eventSnap = await getDoc(eventRef);
        
        if (!eventSnap.exists()) {
            window.showErrorToast("Error", "Event not found", 3000);
            return;
        }
        
        const eventData = eventSnap.data();
        const livestream = eventData.livestream;
        
        if (!livestream || !livestream.streamId) {
            window.showErrorToast("Error", "No livestream found for this event", 3000);
            return;
        }
        
        // Fetch current stream status from Mux
        const response = await fetch(`/.netlify/functions/get-mux-stream?streamId=${livestream.streamId}`);
        const streamData = await response.json();
        
        const isActive = streamData.status === 'active';
        
        const modal = document.createElement('div');
        modal.id = 'livestreamModal';
        modal.className = 'fixed inset-0 bg-black/70 backdrop-blur-sm z-[100] flex items-center justify-center p-4';
        modal.innerHTML = `
            <div class="bg-[var(--dark-card)] rounded-xl border border-white/20 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
                <div class="sticky top-0 bg-[var(--dark-card)] border-b border-white/10 px-6 py-4 flex justify-between items-center">
                    <h3 class="text-xl font-bold text-white">📡 Livestream Manager</h3>
                    <button onclick="closeLivestreamModal()" class="text-gray-400 hover:text-white transition-colors">
                        <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                    </button>
                </div>
                <div class="p-6 space-y-4">
                    <div class="bg-white/5 border border-white/10 rounded-lg p-4">
                        <div class="flex items-center justify-between mb-2">
                            <span class="text-gray-400 text-sm">Stream Status</span>
                            <span class="px-3 py-1 rounded-full text-sm font-semibold ${isActive ? 'bg-red-500/20 text-red-400' : 'bg-gray-500/20 text-gray-400'}">
                                ${isActive ? '🔴 LIVE' : '⚫ Idle'}
                            </span>
                        </div>
                        <div class="text-white font-bold text-lg">${escapeHtml(eventData.name)}</div>
                    </div>
                    
                    <div class="bg-white/5 border border-white/10 rounded-lg p-4">
                        <label class="text-gray-400 text-sm block mb-2">Stream URL</label>
                        <div class="flex gap-2">
                            <input type="text" readonly value="rtmp://rtmp-push.champzero.org" class="flex-1 bg-black/30 border border-white/20 text-white px-3 py-2 rounded text-sm">
                            <button onclick="copyToClipboard('rtmp://rtmp-push.champzero.org')" class="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded text-sm">Copy</button>
                        </div>
                    </div>
                    
                    <div class="bg-white/5 border border-white/10 rounded-lg p-4">
                        <label class="text-gray-400 text-sm block mb-2">Stream Key</label>
                        <div class="flex gap-2">
                            <input type="password" id="streamKeyInput" readonly value="${livestream.streamKey}" class="flex-1 bg-black/30 border border-white/20 text-white px-3 py-2 rounded text-sm font-mono">
                            <button onclick="toggleStreamKey()" class="bg-gray-600 hover:bg-gray-700 text-white px-4 py-2 rounded text-sm">Show</button>
                            <button onclick="copyToClipboard('${livestream.streamKey}')" class="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded text-sm">Copy</button>
                        </div>
                        <p class="text-xs text-gray-500 mt-2">⚠️ Keep this private! Use it in OBS/Streamlabs to start streaming.</p>
                    </div>
                    
                    <div class="flex gap-3 pt-4">
                        <button onclick="disableLivestream('${eventId}')" class="flex-1 bg-red-900/50 hover:bg-red-600 text-red-200 px-4 py-3 rounded-lg font-bold border border-red-800 transition-all">
                            🛑 End Stream
                        </button>
                        <button onclick="deleteLivestream('${eventId}')" class="flex-1 bg-gray-900/50 hover:bg-gray-600 text-gray-200 px-4 py-3 rounded-lg font-bold border border-gray-800 transition-all">
                            🗑️ Delete Stream
                        </button>
                    </div>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        
    } catch (error) {
        console.error('Error managing livestream:', error);
        window.showErrorToast("Error", "Failed to load livestream info: " + error.message, 5000);
    }
};

window.closeLivestreamModal = function() {
    const modal = document.getElementById('livestreamModal');
    if (modal) modal.remove();
};

window.toggleStreamKey = function() {
    const input = document.getElementById('streamKeyInput');
    const btn = event.target;
    if (input.type === 'password') {
        input.type = 'text';
        btn.textContent = 'Hide';
    } else {
        input.type = 'password';
        btn.textContent = 'Show';
    }
};

window.copyToClipboard = async function(text) {
    try {
        await navigator.clipboard.writeText(text);
        window.showSuccessToast("Copied!", "Copied to clipboard", 2000);
    } catch (err) {
        window.showErrorToast("Error", "Failed to copy", 2000);
    }
};

window.disableLivestream = async function(eventId) {
    const confirmed = await window.showCustomConfirm("End Stream", "This will end the current live broadcast. Continue?");
    if (!confirmed) return;
    
    try {
        const eventRef = doc(db, 'events', eventId);
        const eventSnap = await getDoc(eventRef);
        const livestream = eventSnap.data().livestream;
        
        const response = await fetch('/.netlify/functions/disable-mux-stream', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ streamId: livestream.streamId })
        });
        
        if (!response.ok) throw new Error('Failed to disable stream');
        
        await updateDoc(eventRef, {
            'livestream.status': 'idle'
        });
        
        window.showSuccessToast("Success", "Stream ended successfully", 3000);
        closeLivestreamModal();
        refreshAllLists();
        
    } catch (error) {
        console.error('Error disabling stream:', error);
        window.showErrorToast("Error", "Failed to end stream: " + error.message, 5000);
    }
};

window.deleteLivestream = async function(eventId) {
    const confirmed = await window.showCustomConfirm("Delete Stream", "This will permanently delete the stream and its key. Continue?");
    if (!confirmed) return;
    
    try {
        const eventRef = doc(db, 'events', eventId);
        const eventSnap = await getDoc(eventRef);
        const livestream = eventSnap.data().livestream;
        
        const response = await fetch('/.netlify/functions/delete-mux-stream', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ streamId: livestream.streamId })
        });
        
        if (!response.ok) throw new Error('Failed to delete stream');
        
        await updateDoc(eventRef, {
            livestream: null
        });
        
        window.showSuccessToast("Success", "Stream deleted successfully", 3000);
        closeLivestreamModal();
        refreshAllLists();
        
    } catch (error) {
        console.error('Error deleting stream:', error);
        window.showErrorToast("Error", "Failed to delete stream: " + error.message, 5000);
    }
};

// ======================
// MODAL & GENERAL ADMIN
// ======================

window.openModal = function (modalId) {
    lastFocusedElement = document.activeElement;
    document.getElementById(modalId).classList.remove('hidden');
    document.body.style.overflow = 'hidden';
}

window.closeModal = function (modalId) {
    const modal = document.getElementById(modalId);
    modal.classList.add('hidden');
    document.body.style.overflow = 'auto';
    if (lastFocusedElement) lastFocusedElement.focus();

    const formMap = {
        'tournamentModal': '#tournamentForm',
        'eventModal': '#eventForm',
        'jobModal': '#jobForm',
        'talentModal': '#talentForm',
        'notificationModal': '#notifForm',

    };
    if(formMap[modalId]) resetFormState(formMap[modalId]);
}

window.openTournamentModal = function () { openModal('tournamentModal'); }
window.openEventModal = function () { openModal('eventModal'); }
window.openJobModal = function () { openModal('jobModal'); }
window.openTalentModal = function () { openModal('talentModal'); }
window.openNotificationModal = function () { openModal('notificationModal'); }


// --- 1. ADMIN CHECK ---
onAuthStateChanged(auth, async (user) => {
    if (!user) {
        window.location.href = "/login";
        return;
    }
    currentUserId = user.uid;

    try {
        const userRef = doc(db, "users", user.uid);
        const userSnap = await getDoc(userRef);
        const adminEmails = ["admin@champzero.com", "owner@champzero.com"];
        const isAdminRole = userSnap.exists() && (userSnap.data().role === 'admin' || adminEmails.includes(user.email));

        if (isAdminRole) {
            document.getElementById('auth-loading-screen')?.classList.add('hidden');
            document.getElementById('admin-content')?.classList.remove('hidden');
            updateAdminHeader(user, userSnap.data());
            refreshAllLists();
        } else {
            window.location.href = "/access-denied";
        }
    } catch (error) {
        console.error("Auth Error:", error);
        window.location.href = "/access-denied";
    }
});

function updateAdminHeader(user, userData) {
    const displayNameEl = qs('#admin-display-name');
    if (displayNameEl) {
        const displayName = userData?.ign || userData?.displayName || userData?.username || user.email.split('@')[0];
        displayNameEl.textContent = displayName;
        displayNameEl.classList.remove('opacity-50');
    }
}

// --- 2. CORE FUNCTIONS ---

window.deleteItem = async function (collectionName, docId) {
    const confirmed = await window.showCustomConfirm("Delete Item?", "Are you sure? This cannot be undone.");
    if (!confirmed) return;
    try {
        await deleteDoc(doc(db, collectionName, docId));
        window.showSuccessToast("Deleted", "Item deleted successfully.", 2000);
        refreshAllLists();
    } catch (error) {
        window.showErrorToast("Delete Failed", error.message, 4000);
    }
}

window.editItem = async function (collectionName, docId) {
    try {
        const docRef = doc(db, collectionName, docId);
        const docSnap = await getDoc(docRef);

        if (!docSnap.exists()) {
            window.showErrorToast("Not Found", "Item not found.", 3000);
            return;
        }

        const data = docSnap.data();

        if (collectionName === 'tournaments') {
            qs('#t-name').value = data.name;
            qs('#t-game').value = data.game;
            qs('#t-format').value = data.format || 'Single Elimination';
            qs('#t-prize').value = data.prize;
            qs('#t-date').value = toDateInputFormat(data.date);
            qs('#t-end-date').value = toDateInputFormat(data.endDate);
            qs('#t-banner').value = data.banner;
            prepareEditMode('tournaments', docId, '#tournamentForm', 'tournamentModal');
            openModal('tournamentModal');
        }
        else if (collectionName === 'events') {
            qs('#e-name').value = data.name;
            qs('#e-date').value = toDateInputFormat(data.date);
            qs('#e-end-date').value = toDateInputFormat(data.endDate);
            qs('#e-desc').value = data.description;
            qs('#e-banner').value = data.banner;
            prepareEditMode('events', docId, '#eventForm', 'eventModal');
            openModal('eventModal');
        }
        else if (collectionName === 'careers') {
            qs('#j-title').value = data.title;
            qs('#j-location').value = data.location;
            qs('#j-type').value = data.type;
            prepareEditMode('careers', docId, '#jobForm', 'jobModal');
            openModal('jobModal');
        }
        else if (collectionName === 'talents') {
            qs('#tal-name').value = data.name;
            qs('#tal-role').value = data.role;
            qs('#tal-img').value = data.image;
            qs('#tal-link').value = data.socialLink;
            qs('#tal-bio').value = data.bio;
            prepareEditMode('talents', docId, '#talentForm', 'talentModal');
            openModal('talentModal');
        }
        else if (collectionName === 'notifications') {
            qs('#n-title').value = data.title;
            qs('#n-type').value = data.type;
            qs('#n-message').value = data.message;
            prepareEditMode('notifications', docId, '#notifForm', 'notificationModal');
            openModal('notificationModal');
        }

    } catch (error) {
        console.error("Edit Error:", error);
        window.showErrorToast("Error", "Failed to load item.", 3000);
    }
}

function prepareEditMode(col, id, formSelector, modalId) {
    editState = { isEditing: true, collection: col, id: id, formId: formSelector, modalId: modalId };
    const form = qs(formSelector);
    const btn = form.querySelector('button[type="submit"]');
    
    const modalTitleMap = {
        'tournamentModal': 'Edit Tournament',
        'eventModal': 'Edit Event',
        'jobModal': 'Edit Job',
        'talentModal': 'Edit Talent',
        'notificationModal': 'Edit Announcement',

    };
    if (modalId) qs(`#${modalId}Title`).textContent = modalTitleMap[modalId];

    if (btn) btn.textContent = 'Update';
}

function resetFormState(formSelector) {
    const selector = formSelector || editState.formId;
    if (!selector) return;
    const form = qs(selector);
    if (form) form.reset();

    const modalTitleMap = {
        'tournamentModal': 'Create Tournament',
        'eventModal': 'Create Event',
        'jobModal': 'Create Job',
        'talentModal': 'Add Talent',
        'notificationModal': 'Create Announcement',

    };
    if (editState.modalId) qs(`#${editState.modalId}Title`).textContent = modalTitleMap[editState.modalId];

    if (form) {
        const btn = form.querySelector('button[type="submit"]');
        if (btn) btn.textContent = 'Save';
    }
    editState = { isEditing: false, collection: null, id: null, formId: null, modalId: null };
}

// ======================
// USER MANAGEMENT
// ======================

window.fetchUsers = async function() {
    try {
        const q = query(collection(db, "users"));
        const snapshot = await getDocs(q);
        allUsers = [];
        
        snapshot.forEach(doc => {
            allUsers.push({ id: doc.id, ...doc.data() });
        });
        
        allUsers.sort((a, b) => {
            const dateA = a.createdAt ? a.createdAt.seconds : 0;
            const dateB = b.createdAt ? b.createdAt.seconds : 0;
            return dateB - dateA;
        });

        window.usersLoaded = true;
        displayUsers();
    } catch (error) {
        console.error('Error fetching users:', error);
        const container = qs('#users-list-view');
        if (container) {
            container.innerHTML = '<div class="text-center py-12 text-red-400">Error loading users.</div>';
        }
    }
}

window.refreshUsers = async function() {
    const btn = event?.target;
    if (btn && btn.tagName === 'BUTTON') {
        btn.disabled = true;
        btn.textContent = 'Refreshing...';
    }
    await window.fetchUsers();
    if (btn && btn.tagName === 'BUTTON') {
        btn.disabled = false;
        btn.textContent = 'Refresh';
    }
}

function displayUsers() {
    const container = qs('#users-list-view');
    if (!container) return;
    
    const searchTerm = qs('#user-search')?.value?.toLowerCase() || '';
    
    let filtered = allUsers.filter(user => {
        const matchesRole = currentRoleFilter === 'all' || (user.role || 'user') === currentRoleFilter;
        const matchesSearch = !searchTerm || 
            (user.username?.toLowerCase().includes(searchTerm)) ||
            (user.displayName?.toLowerCase().includes(searchTerm)) ||
            (user.email?.toLowerCase().includes(searchTerm));
        return matchesRole && matchesSearch;
    });
    
    // Update Stats
    if (qs('#user-count')) qs('#user-count').textContent = allUsers.length;
    if (qs('#admin-count')) qs('#admin-count').textContent = allUsers.filter(u => u.role === 'admin').length;
    if (qs('#regular-user-count')) qs('#regular-user-count').textContent = allUsers.filter(u => u.role !== 'admin').length;
    
    if (filtered.length === 0) {
        container.innerHTML = '<div class="text-center py-12 bg-[var(--dark-card)] rounded-xl border border-white/5 text-gray-400">No users found matching your criteria.</div>';
        return;
    }
    
    container.innerHTML = '';
    
    filtered.forEach(user => {
        const createdDate = user.createdAt?.toDate?.() || user.joinedAt ? new Date(user.joinedAt) : null;
        const dateStr = createdDate ? createdDate.toLocaleDateString() : 'Unknown';
        const displayName = user.displayName || user.username || 'Unknown User';
        const email = user.email || 'No email';
        const role = user.role || 'user';
        const profilePicture = user.avatar || user.photoURL || null;
        const roles = ['user', 'admin', 'subscriber', 'moderator', 'organizer'];
        
        // Mobile-First Card Design
        const card = document.createElement('div');
        card.className = 'bg-[var(--dark-card)] p-4 rounded-xl border border-white/5 flex flex-col md:flex-row md:items-center gap-4 transition-all hover:border-[var(--gold)]/30';
        
        card.innerHTML = `
            <div class="flex items-center gap-4 flex-1 overflow-hidden">
                ${profilePicture ? 
                    `<img src="${escapeHtml(profilePicture)}" alt="${escapeHtml(displayName)}" class="w-12 h-12 rounded-full object-cover border-2 border-white/10 shrink-0">` :
                    `<div class="w-12 h-12 rounded-full bg-gradient-to-br from-[var(--gold)]/20 to-orange-500/20 flex items-center justify-center text-lg font-bold text-[var(--gold)] border-2 border-[var(--gold)]/30 shrink-0">
                        ${escapeHtml(displayName.charAt(0).toUpperCase())}
                    </div>`
                }
                <div class="min-w-0">
                    <div class="font-bold text-white truncate text-base">${escapeHtml(displayName)}</div>
                    <div class="text-sm text-gray-400 truncate">${escapeHtml(email)}</div>
                    <div class="md:hidden mt-1 text-xs text-gray-500">Joined: ${dateStr}</div>
                </div>
            </div>

            <div class="flex items-center justify-between md:justify-start md:w-1/4">
                <span class="md:hidden text-sm text-gray-400 font-medium">Role</span>
                <span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wide ${role === 'admin' ? 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20' : 'bg-blue-500/10 text-blue-400 border border-blue-500/20'}">
                    ${role === 'admin' ? '👑' : '👤'} ${escapeHtml(role)}
                </span>
            </div>

            <div class="hidden md:block w-1/6 text-sm text-gray-400">
                ${dateStr}
            </div>

            <div class="flex flex-col sm:flex-row gap-2 mt-2 md:mt-0 md:w-1/4 justify-end">
                <select onchange="window.changeUserRole('${user.id}', this.value)" class="dark-select w-full sm:w-auto text-sm py-2 px-3 rounded-lg border border-white/10 bg-black/20 text-white focus:border-[var(--gold)] cursor-pointer">
                    ${roles.map(r => 
                        `<option value="${r}" ${role === r ? 'selected' : ''}>${r.charAt(0).toUpperCase() + r.slice(1)}</option>`
                    ).join('')}
                </select>
                <button onclick="window.deleteUserConfirm('${user.id}')" class="w-full sm:w-auto flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 transition-colors" title="Delete User">
                    <span class="md:hidden font-bold text-sm">Delete</span>
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                </button>
            </div>
        `;
        container.appendChild(card);
    });
}

window.changeUserRole = async function(userId, newRole) {
    if (userId === currentUserId && newRole !== 'admin') {
        window.showWarningToast("Not Allowed", "You cannot remove your own Admin access.", 3000);
        displayUsers(); 
        return;
    }

    const confirmed = await window.showCustomConfirm("Update Role?", `Change user to ${newRole.toUpperCase()}?`);
    if (!confirmed) {
        displayUsers(); 
        return;
    }
    
    try {
        // Optimistic Update: Change local state immediately so UI responds instantly
        const userIndex = allUsers.findIndex(u => u.id === userId);
        if (userIndex !== -1) allUsers[userIndex].role = newRole;
        displayUsers(); 

        await updateDoc(doc(db, "users", userId), { role: newRole });
        window.showSuccessToast("Success", `User is now a ${newRole}`, 2000);
    } catch (error) {
        console.error(error);
        window.showErrorToast("Error", "Failed to update role", 3000);
        window.fetchUsers(); // Revert to server data on error
    }
}

window.deleteUserConfirm = async function(userId) {
    if (userId === currentUserId) return;
    const confirmed = await window.showCustomConfirm("Delete User?", "This cannot be undone.");
    if (!confirmed) return;
    
    try {
        await deleteDoc(doc(db, "users", userId));
        window.showSuccessToast("Deleted", "User removed", 2000);
        window.fetchUsers();
    } catch (error) {
        window.showErrorToast("Error", "Failed to delete user", 3000);
    }
}

window.filterUsersByRole = function(role) {
    currentRoleFilter = role;
    document.querySelectorAll('.role-tab').forEach(tab => tab.classList.remove('active'));
    const activeTab = qs(`#role-tab-${role}`);
    if (activeTab) activeTab.classList.add('active');
    displayUsers();
}

if (qs('#user-search')) {
    qs('#user-search').addEventListener('input', () => displayUsers());
}

// --- 4. FETCH OTHER LISTS ---

async function fetchSiteConfig() {
    try {
        const docRef = doc(db, "site_config", "home_stats");
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
            const data = docSnap.data();
            if(qs('#cfg-talents')) qs('#cfg-talents').value = data.talentCount || "";
            if(qs('#cfg-followers')) qs('#cfg-followers').value = data.followerCount || "";
            if(qs('#cfg-prizes')) qs('#cfg-prizes').value = data.prizePool || "";
            if(qs('#cfg-tournaments')) qs('#cfg-tournaments').value = data.tournamentCount || "";
            if(qs('#cfg-players')) qs('#cfg-players').value = data.playerCount || "";
        }
    } catch (e) {
        console.error("Config Fetch Error", e);
    }
}

async function refreshAllLists() {
    fetchTournaments();
    fetchEvents();
    fetchJobs();
    fetchMessages();
    fetchTalents();
    fetchNotifications();
    fetchSiteConfig();

    if(window.fetchUsers) window.fetchUsers();
}

async function fetchTournaments() {
    const list = qs('#tournaments-list');
    const q = query(collection(db, "tournaments"));
    const snapshot = await getDocs(q);
    list.innerHTML = snapshot.empty ? '<p class="text-gray-500 italic">No tournaments found.</p>' : '';
    snapshot.forEach(doc => {
        const data = doc.data();
        list.innerHTML += `
            <div class="admin-item">
                <div><div class="font-bold text-white">${escapeHtml(data.name)}</div><div class="text-sm text-gray-400">${escapeHtml(data.game)}</div></div>
                <div class="flex gap-2">
                    <button onclick="editItem('tournaments', '${doc.id}')" class="bg-blue-900/50 hover:bg-blue-600 text-blue-200 px-3 py-1 rounded text-sm border border-blue-800">Edit</button>
                    <button onclick="deleteItem('tournaments', '${doc.id}')" class="bg-red-900/50 hover:bg-red-600 text-red-200 px-3 py-1 rounded text-sm border border-red-800">Delete</button>
                </div>
            </div>`;
    });
}

async function fetchNotifications() {
    const list = qs('#notifications-list');
    try {
        const q = query(collection(db, "notifications"));
        const snapshot = await getDocs(q);
        if (snapshot.empty) {
            list.innerHTML = '<p class="text-gray-500">No announcements yet.</p>';
            return;
        }
        let notifs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        notifs.sort((a, b) => {
            const dateA = a.createdAt ? a.createdAt.seconds : 0;
            const dateB = b.createdAt ? b.createdAt.seconds : 0;
            return dateB - dateA; 
        });
        list.innerHTML = '';
        notifs.forEach(data => {
            let icon = '📢';
            if (data.type === 'tournament') icon = '🏆';
            if (data.type === 'event') icon = '🎉';
            if (data.type === 'alert') icon = '⚠️';
            list.innerHTML += `
                <div class="admin-item">
                    <div class="flex items-center gap-3">
                        <div class="text-xl">${icon}</div>
                        <div>
                            <div class="font-bold text-white">${escapeHtml(data.title)}</div>
                            <div class="text-xs text-gray-400 max-w-xs truncate">${escapeHtml(data.message)}</div>
                        </div>
                    </div>
                    <div class="flex gap-2">
                        <button onclick="editItem('notifications', '${data.id}')" class="bg-blue-900/50 hover:bg-blue-600 text-blue-200 px-3 py-1 rounded text-sm border border-blue-800">Edit</button>
                        <button onclick="deleteItem('notifications', '${data.id}')" class="bg-red-900/50 hover:bg-red-600 text-red-200 px-3 py-1 rounded text-sm border border-red-800">Delete</button>
                    </div>
                </div>`;
        });
    } catch (e) {
        console.error("Error loading notifications:", e);
        list.innerHTML = '<p class="text-red-500">Failed to load announcements.</p>';
    }
}

// RESTORED: Sourced from OLD admin.js to include stream buttons
async function fetchEvents() {
    const list = qs('#events-list');
    const q = query(collection(db, "events"));
    const snapshot = await getDocs(q);
    list.innerHTML = snapshot.empty ? '<p class="text-gray-500 italic">No events found.</p>' : '';
    
    // Fetch all events and check their stream status asynchronously
    const eventPromises = [];
    snapshot.forEach(doc => {
        eventPromises.push(renderEventItem(doc));
    });
    
    const eventItems = await Promise.all(eventPromises);
    eventItems.forEach(item => {
        list.innerHTML += item;
    });
}

// RESTORED: Helper to render event item with stream controls
async function renderEventItem(doc) {
    const data = doc.data();
    const hasStream = data.livestream && data.livestream.streamId;
    let streamStatus = 'idle';
    let isLive = false;
    
    // Check actual stream status from Mux if stream exists
    if (hasStream) {
        try {
            // Using a timeout to prevent blocking loading for too long
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 2000);
            
            const response = await fetch(`/.netlify/functions/get-mux-stream?streamId=${data.livestream.streamId}`, { signal: controller.signal });
            clearTimeout(timeoutId);

            if (response.ok) {
                const streamData = await response.json();
                streamStatus = streamData.status;
                isLive = streamStatus === 'active';
                
                // Update Firestore if status changed locally to keep it somewhat synced
                if (data.livestream.status !== streamStatus) {
                    // Note: We don't await this to keep UI snappy
                    updateDoc(doc.ref, { 'livestream.status': streamStatus }).catch(console.error);
                }
            }
        } catch (err) {
            console.warn('Could not fetch stream status:', err);
            streamStatus = data.livestream?.status || 'idle';
            isLive = streamStatus === 'active';
        }
    }
    
    return `
        <div class="admin-item">
            <div>
                <div class="flex items-center gap-2">
                    <div class="font-bold text-white">${escapeHtml(data.name)}</div>
                    ${hasStream ? `<span class="px-2 py-0.5 rounded text-xs ${isLive ? 'bg-red-500/20 text-red-400 animate-pulse' : 'bg-gray-500/20 text-gray-400'}">📡 ${isLive ? 'LIVE' : 'Stream Ready'}</span>` : ''}
                </div>
                <div class="text-sm text-gray-400">${escapeHtml(data.date)}</div>
            </div>
            <div class="flex gap-2">
                ${hasStream ? 
                    `<button onclick="manageLivestream('${doc.id}')" class="bg-purple-900/50 hover:bg-purple-600 text-purple-200 px-3 py-1 rounded text-sm border border-purple-800">Stream</button>` : 
                    `<button onclick="createLivestream('${doc.id}', '${escapeHtml(data.name).replace(/'/g, "\\'")}')" class="bg-green-900/50 hover:bg-green-600 text-green-200 px-3 py-1 rounded text-sm border border-green-800">+ Stream</button>`
                }
                <button onclick="editItem('events', '${doc.id}')" class="bg-blue-900/50 hover:bg-blue-600 text-blue-200 px-3 py-1 rounded text-sm border border-blue-800">Edit</button>
                <button onclick="deleteItem('events', '${doc.id}')" class="bg-red-900/50 hover:bg-red-600 text-red-200 px-3 py-1 rounded text-sm border border-red-800">Delete</button>
            </div>
        </div>`;
}

async function fetchJobs() {
    const list = qs('#jobs-list');
    const q = query(collection(db, "careers"));
    const snapshot = await getDocs(q);
    list.innerHTML = snapshot.empty ? '<p class="text-gray-500 italic">No jobs found.</p>' : '';
    snapshot.forEach(doc => {
        const data = doc.data();
        list.innerHTML += `
            <div class="admin-item">
                <div><div class="font-bold text-white">${escapeHtml(data.title)}</div><div class="text-sm text-gray-400">${escapeHtml(data.location)}</div></div>
                <div class="flex gap-2">
                    <button onclick="editItem('careers', '${doc.id}')" class="bg-blue-900/50 hover:bg-blue-600 text-blue-200 px-3 py-1 rounded text-sm border border-blue-800">Edit</button>
                    <button onclick="deleteItem('careers', '${doc.id}')" class="bg-red-900/50 hover:bg-red-600 text-red-200 px-3 py-1 rounded text-sm border border-red-800">Delete</button>
                </div>
            </div>`;
    });
}

async function fetchTalents() {
    const list = qs('#talents-list');
    const q = query(collection(db, "talents"));
    const snapshot = await getDocs(q);
    list.innerHTML = snapshot.empty ? '<p class="text-gray-500">No talents found.</p>' : '';
    snapshot.forEach(doc => {
        const data = doc.data();
        list.innerHTML += `
            <div class="admin-item">
                <div><div class="font-bold text-white">${escapeHtml(data.name)}</div><div class="text-sm text-gray-400">${escapeHtml(data.role)}</div></div>
                <div class="flex gap-2">
                    <button onclick="editItem('talents', '${doc.id}')" class="bg-blue-900/50 hover:bg-blue-600 text-blue-200 px-3 py-1 rounded text-sm border border-blue-800">Edit</button>
                    <button onclick="deleteItem('talents', '${doc.id}')" class="bg-red-900/50 hover:bg-red-600 text-red-200 px-3 py-1 rounded text-sm border border-red-800">Delete</button>
                </div>
            </div>`;
    });
}

async function fetchMessages() {
    const list = qs('#messages-list');
    const q = query(collection(db, "messages"));
    const snapshot = await getDocs(q);
    list.innerHTML = snapshot.empty ? `<div class="text-center py-12 bg-white/5 rounded-lg border border-white/10"><p class="text-gray-400">Inbox is empty.</p></div>` : '';
    const badge = qs('#msg-badge');
    if (badge) {
        badge.textContent = snapshot.size;
        badge.classList.remove('hidden');
    }
    snapshot.forEach(doc => {
        const data = doc.data();
        const dateStr = data.sentAt ? new Date(data.sentAt).toLocaleString() : 'No Date';
        list.innerHTML += `
            <div class="message-card relative group">
                <div class="flex justify-between items-start mb-2">
                    <div>
                        <span class="text-[var(--gold)] text-xs font-bold uppercase tracking-wider">${escapeHtml(data.subject || data.type || 'No Subject')}</span>
                        <h3 class="text-white font-bold text-lg">${escapeHtml(data.name)}</h3>
                        <div class="text-gray-400 text-sm mb-4">
                            ${data.email ? `<a href="mailto:${escapeHtml(data.email)}" class="hover:text-white hover:underline">${escapeHtml(data.email)}</a> • ` : ''} 
                            ${dateStr}
                        </div>
                    </div>
                    <button onclick="deleteItem('messages', '${doc.id}')" class="text-gray-500 hover:text-red-500 transition-colors p-2" title="Delete Message">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                    </button>
                </div>
                <div class="bg-black/20 p-4 rounded text-gray-300 text-sm leading-relaxed border border-white/5">
                    ${escapeHtml(data.message || 'No message content.')}
                    ${data.link ? `<div class="mt-2 text-[var(--gold)]"><a href="${data.link}" target="_blank">View Portfolio Link</a></div>` : ''}
                </div>
            </div>`;
    });
}

// --- 5. FORM HANDLING ---
document.addEventListener('DOMContentLoaded', () => {
    const modalMap = {
        'tournamentForm': 'tournamentModal',
        'eventForm': 'eventModal',
        'jobForm': 'jobModal',
        'talentForm': 'talentModal',
        'notifForm': 'notificationModal',
    };

    const handleForm = (formId, collectionName, getDataFn, successMsg) => {
        const form = qs(formId);
        if (!form) return;
        const btn = form.querySelector('button[type="submit"]');
        btn.setAttribute('data-original-text', btn.textContent);
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            let data;
            try { data = getDataFn(); } catch (err) { if (err.message === 'silent-cancel') return; console.error(err); return; }
            btn.disabled = true;
            btn.textContent = "Processing...";
            try {
                if (editState.isEditing && editState.collection === collectionName && editState.formId === formId) {
                    const docRef = doc(db, collectionName, editState.id);
                    data.updatedAt = serverTimestamp();
                    await updateDoc(docRef, data);
                    window.showSuccessToast("Updated", "Changes saved successfully!", 2000);
                    if (editState.modalId) closeModal(editState.modalId);
                    resetFormState(formId);
                } else {
                    data.createdAt = serverTimestamp();
                    await addDoc(collection(db, collectionName), data);
                    window.showSuccessToast("Created", successMsg, 2000);
                    form.reset();

                    if (modalMap[form.id]) closeModal(modalMap[form.id]);
                }
                refreshAllLists();
            } catch (err) {
                console.error(err);
                window.showErrorToast("Server Error", "Could not save data.", 4000);
            } finally {
                btn.disabled = false;
                if (btn.textContent === "Processing...") btn.textContent = btn.getAttribute('data-original-text');
            }
        });
    };

    const configForm = qs('#configForm');
    if (configForm) {
        configForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = configForm.querySelector('button[type="submit"]');
            btn.textContent = "Updating...";
            btn.disabled = true;
            try {
                const stats = {
                    talentCount: qs('#cfg-talents').value || "0",
                    followerCount: qs('#cfg-followers').value || "0",
                    prizePool: qs('#cfg-prizes').value || "0",
                    tournamentCount: qs('#cfg-tournaments').value || "0",
                    playerCount: qs('#cfg-players').value || "0",
                    updatedAt: serverTimestamp()
                };
                await setDoc(doc(db, "site_config", "home_stats"), stats, { merge: true });
                window.showSuccessToast("Updated", "Home page stats updated!", 2000);
            } catch (err) {
                console.error(err);
                window.showErrorToast("Error", "Failed to update stats.", 4000);
            } finally {
                btn.textContent = "Update Statistics";
                btn.disabled = false;
            }
        });
    }

    handleForm('#tournamentForm', 'tournaments', () => {
        const startDate = qs('#t-date').value;
        const endDate = qs('#t-end-date').value || startDate;
        if (new Date(endDate) < new Date(startDate)) {
            window.showErrorToast("Date Error", "End date cannot be earlier than start date.");
            throw new Error("silent-cancel");
        }
        return {
            name: qs('#t-name').value,
            game: qs('#t-game').value,
            format: qs('#t-format').value,
            prize: Number(qs('#t-prize').value),
            status: calculateStatus(startDate, endDate),
            date: startDate,
            endDate: endDate,
            banner: qs('#t-banner').value || "pictures/cz_logo.png"
        };
    }, "Tournament Created!");

    handleForm('#eventForm', 'events', () => {
        const startDate = qs('#e-date').value;
        const endDate = qs('#e-end-date').value || startDate;
        if (new Date(endDate) < new Date(startDate)) {
            window.showErrorToast("Date Error", "End date cannot be earlier than start date.");
            throw new Error("silent-cancel");
        }
        return { name: qs('#e-name').value, date: startDate, endDate: endDate, description: qs('#e-desc').value, banner: qs('#e-banner').value || "pictures/cz_logo.png" };
    }, "Event Posted!");

    handleForm('#jobForm', 'careers', () => ({ title: qs('#j-title').value, location: qs('#j-location').value, type: qs('#j-type').value }), "Job Posted!");
    handleForm('#talentForm', 'talents', () => ({ name: qs('#tal-name').value, role: qs('#tal-role').value, image: qs('#tal-img').value || "pictures/cz_logo.png", socialLink: qs('#tal-link').value, bio: qs('#tal-bio').value }), "Talent Added!");
    handleForm('#notifForm', 'notifications', () => ({ title: qs('#n-title').value, type: qs('#n-type').value, message: qs('#n-message').value }), "Notification Sent!");

    // Helper for image uploads
    function setupImageUpload(inputId, hiddenInputId, statusId, folder) {
        const input = qs(inputId);
        if (!input) return;
        input.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const statusEl = qs(statusId);
            statusEl.textContent = "Uploading image...";
            statusEl.classList.replace('text-red-500', 'text-gray-500');
            statusEl.classList.replace('text-green-500', 'text-gray-500');
            try {
                const url = await uploadImage(file, folder);
                qs(hiddenInputId).value = url;
                statusEl.textContent = "Upload successful!";
                statusEl.classList.replace('text-gray-500', 'text-green-500');
            } catch (error) {
                console.error(error);
                statusEl.textContent = "Upload failed.";
                statusEl.classList.replace('text-gray-500', 'text-red-500');
            }
        });
    }

    setupImageUpload('#t-banner-upload', '#t-banner', '#t-banner-status', 'tournaments');
    setupImageUpload('#e-banner-upload', '#e-banner', '#e-banner-status', 'events');
    setupImageUpload('#tal-img-upload', '#tal-img', '#tal-img-status', 'talents');
});