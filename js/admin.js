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
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.1.0/firebase-firestore.js";
import { toDateInputFormat, calculateStatus } from './utils.js';
import { setCurrentUserId, openTournamentManager as tmOpenTournamentManager } from './tournament-admin.js';

function qs(sel) { return document.querySelector(sel); }
function escapeHtml(str) { if (!str) return ''; return String(str).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])); }

// Focus management
let lastFocusedElement = null;

// ======================
// LIVESTREAM MANAGEMENT
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
        const streamUrl = `rtmp://push-global.rtmp.franzvallesmedia.com/${livestream.streamKey}`;
        
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
                            <input type="text" readonly value="rtmp://push-global.rtmp.franzvallesmedia.com" class="flex-1 bg-black/30 border border-white/20 text-white px-3 py-2 rounded text-sm">
                            <button onclick="copyToClipboard('rtmp://push-global.rtmp.franzvallesmedia.com')" class="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded text-sm">Copy</button>
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
                    
                    <div class="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
                        <div class="flex items-start gap-3">
                            <span class="text-2xl">💡</span>
                            <div class="flex-1">
                                <div class="text-blue-400 font-semibold mb-1">How to Stream</div>
                                <ol class="text-sm text-gray-300 space-y-1">
                                    <li>1. Open OBS Studio or your streaming software</li>
                                    <li>2. Go to Settings → Stream</li>
                                    <li>3. Choose "Custom" as Service</li>
                                    <li>4. Copy the Stream URL above</li>
                                    <li>5. Copy the Stream Key above</li>
                                    <li>6. Start streaming!</li>
                                </ol>
                            </div>
                        </div>
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
    const confirmed = await window.showCustomConfirm("Delete Stream", "This will permanently delete the stream and its key. You'll need to create a new one. Continue?");
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
// END LIVESTREAM MANAGEMENT
// ======================

// Modal Management
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
        'notificationModal': '#notifForm'
    };
    if(formMap[modalId]) resetFormState(formMap[modalId]);
}

window.openTournamentModal = function () { openModal('tournamentModal'); }
window.openEventModal = function () { openModal('eventModal'); }
window.openJobModal = function () { openModal('jobModal'); }
window.openTalentModal = function () { openModal('talentModal'); }
window.openNotificationModal = function () { openModal('notificationModal'); }

// State
let editState = { isEditing: false, collection: null, id: null, formId: null, modalId: null };
let currentUserId = null;
let allUsers = []; 
let currentRoleFilter = 'all';

// --- 1. ADMIN CHECK ---
onAuthStateChanged(auth, async (user) => {
    if (!user) {
        window.location.href = "/login";
        return;
    }
    currentUserId = user.uid;
    setCurrentUserId(user.uid); // Set for tournament admin module

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
        'notificationModal': 'Edit Announcement'
    };
    if (modalId) qs(`#${modalId.replace('Modal', 'ModalTitle')}`).textContent = modalTitleMap[modalId];

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
        'notificationModal': 'Create Announcement'
    };
    if (editState.modalId) qs(`#${editState.modalId.replace('Modal', 'ModalTitle')}`).textContent = modalTitleMap[editState.modalId];

    if (form) {
        const btn = form.querySelector('button[type="submit"]');
        if (btn) btn.textContent = 'Save';
    }
    editState = { isEditing: false, collection: null, id: null, formId: null, modalId: null };
}

// --- 3. USER MANAGEMENT FUNCTIONS ---

window.refreshUsers = async function() {
    const tbody = qs('#users-table-body');
    const searchVal = qs('#user-search')?.value.toLowerCase() || '';
    
    if(!tbody.innerHTML.includes('tr')) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-center p-8 text-gray-500">Loading users...</td></tr>';
    }

    try {
        const q = query(collection(db, "users"));
        const snapshot = await getDocs(q);
        
        allUsers = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        allUsers.sort((a, b) => {
            const dateA = a.createdAt ? a.createdAt.seconds : 0;
            const dateB = b.createdAt ? b.createdAt.seconds : 0;
            return dateB - dateA;
        });

        let filtered = allUsers.filter(u => {
            const nameMatch = (u.ign || u.username || u.displayName || u.email || '').toLowerCase().includes(searchVal);
            const roleMatch = currentRoleFilter === 'all' || (u.role || 'user') === currentRoleFilter;
            return nameMatch && roleMatch;
        });

        qs('#user-count').textContent = allUsers.length;
        qs('#admin-count').textContent = allUsers.filter(u => u.role === 'admin').length;
        qs('#regular-user-count').textContent = allUsers.filter(u => u.role !== 'admin').length;

        if (filtered.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="text-center p-8 text-gray-500">No users found.</td></tr>';
            return;
        }

        tbody.innerHTML = filtered.map(u => {
            const roleColor = u.role === 'admin' ? 'text-yellow-400 border-yellow-400/30' : 'text-blue-400 border-blue-400/30';
            const dateStr = u.createdAt ? new Date(u.createdAt.toDate()).toLocaleDateString() : 'N/A';
            const name = escapeHtml(u.ign || u.displayName || u.username || 'Unnamed');
            
            return `
            <tr class="border-b border-white/5 hover:bg-white/5 transition-colors">
                <td class="p-4 flex items-center gap-3">
                    <img src="${u.avatar || `https://ui-avatars.com/api/?name=${name}&background=random`}" class="w-8 h-8 rounded-full">
                    <span class="text-white font-medium">${name}</span>
                </td>
                <td class="p-4 text-gray-400 text-sm">${escapeHtml(u.email)}</td>
                <td class="p-4">
                    <span class="border ${roleColor} bg-opacity-10 px-2 py-1 rounded text-xs font-bold uppercase">${u.role || 'User'}</span>
                </td>
                <td class="p-4 text-gray-500 text-xs">${dateStr}</td>
                <td class="p-4 flex gap-2">
                    ${u.role !== 'admin' ? 
                        `<button onclick="updateUserRole('${u.id}', 'admin')" class="text-green-400 hover:text-green-300 text-xs border border-green-500/30 px-2 py-1 rounded">Promote</button>` : 
                        `<button onclick="updateUserRole('${u.id}', 'user')" class="text-yellow-400 hover:text-yellow-300 text-xs border border-yellow-500/30 px-2 py-1 rounded">Demote</button>`
                    }
                    <button onclick="deleteItem('users', '${u.id}')" class="text-red-400 hover:text-red-300 text-xs border border-red-500/30 px-2 py-1 rounded">Delete</button>
                </td>
            </tr>
            `;
        }).join('');

    } catch (error) {
        console.error("Error fetching users:", error);
        tbody.innerHTML = '<tr><td colspan="5" class="text-center p-8 text-red-500">Failed to load users.</td></tr>';
    }
}

window.filterUsersByRole = function(role) {
    currentRoleFilter = role;
    document.querySelectorAll('.role-tab').forEach(btn => btn.classList.remove('active', 'text-[var(--gold)]', 'border-[var(--gold)]'));
    document.getElementById(`role-tab-${role}`).classList.add('active', 'text-[var(--gold)]', 'border-[var(--gold)]');
    window.refreshUsers();
}

window.updateUserRole = async function(userId, newRole) {
    const confirmed = await window.showCustomConfirm("Change Role?", `Are you sure you want to change this user to ${newRole}?`);
    if (!confirmed) return;

    try {
        await updateDoc(doc(db, "users", userId), {
            role: newRole
        });
        window.showSuccessToast("Success", "User role updated.", 2000);
        
        const userIndex = allUsers.findIndex(u => u.id === userId);
        if (userIndex > -1) allUsers[userIndex].role = newRole;
        
        window.refreshUsers();
    } catch (error) {
        console.error("Role update failed:", error);
        window.showErrorToast("Error", "Failed to update role.", 3000);
    }
}

// --- 4. FETCH LISTS ---

async function refreshAllLists() {
    fetchTournaments();
    fetchEvents();
    fetchJobs();
    fetchMessages();
    fetchTalents();
    fetchNotifications();
    if(window.refreshUsers) window.refreshUsers();
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
                    <button onclick="openTournamentManager('${doc.id}')" class="bg-green-900/50 hover:bg-green-600 text-green-200 px-3 py-1 rounded text-sm border border-green-800">Manage</button>
                    <button onclick="editItem('tournaments', '${doc.id}')" class="bg-blue-900/50 hover:bg-blue-600 text-blue-200 px-3 py-1 rounded text-sm border border-blue-800">Edit</button>
                    <button onclick="deleteItem('tournaments', '${doc.id}')" class="bg-red-900/50 hover:bg-red-600 text-red-200 px-3 py-1 rounded text-sm border border-red-800">Delete</button>
                </div>
            </div>`;
    });
}

// Expose tournament manager to window
window.openTournamentManager = tmOpenTournamentManager;

// Updated Notifications Fetcher (Sorts by date, newest first)
async function fetchNotifications() {
    const list = qs('#notifications-list');
    
    try {
        // Fetch all notifications (removed orderBy to prevent missing index errors)
        const q = query(collection(db, "notifications"));
        const snapshot = await getDocs(q);
        
        if (snapshot.empty) {
            list.innerHTML = '<p class="text-gray-500">No announcements yet.</p>';
            return;
        }

        // Convert to array and sort in JS
        let notifs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        notifs.sort((a, b) => {
            const dateA = a.createdAt ? a.createdAt.seconds : 0;
            const dateB = b.createdAt ? b.createdAt.seconds : 0;
            return dateB - dateA; // Newest first
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
        // Show permission error if that's the cause
        if(e.code === 'permission-denied') {
            list.innerHTML = '<p class="text-red-500">Permission Error: Check Firestore Rules.</p>';
        } else {
            list.innerHTML = '<p class="text-red-500">Failed to load announcements.</p>';
        }
    }
}

async function fetchEvents() {
    const list = qs('#events-list');
    const q = query(collection(db, "events"));
    const snapshot = await getDocs(q);
    list.innerHTML = snapshot.empty ? '<p class="text-gray-500 italic">No events found.</p>' : '';
    
    // Fetch all events and check their stream status
    const eventPromises = [];
    snapshot.forEach(doc => {
        eventPromises.push(renderEventItem(doc));
    });
    
    const eventItems = await Promise.all(eventPromises);
    eventItems.forEach(item => {
        list.innerHTML += item;
    });
}

async function renderEventItem(doc) {
    const data = doc.data();
    const hasStream = data.livestream && data.livestream.streamId;
    let streamStatus = 'idle';
    let isLive = false;
    
    // Check actual stream status from Mux if stream exists
    if (hasStream) {
        try {
            const response = await fetch(`/.netlify/functions/get-mux-stream?streamId=${data.livestream.streamId}`);
            if (response.ok) {
                const streamData = await response.json();
                streamStatus = streamData.status;
                isLive = streamStatus === 'active';
                
                // Update Firestore if status changed
                if (data.livestream.status !== streamStatus) {
                    const eventRef = doc.ref;
                    await updateDoc(eventRef, { 'livestream.status': streamStatus });
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
                ${hasStream ? `<button onclick="manageLivestream('${doc.id}')" class="bg-purple-900/50 hover:bg-purple-600 text-purple-200 px-3 py-1 rounded text-sm border border-purple-800">Stream</button>` : `<button onclick="createLivestream('${doc.id}', '${escapeHtml(data.name).replace(/'/g, "\\'")}')\" class="bg-green-900/50 hover:bg-green-600 text-green-200 px-3 py-1 rounded text-sm border border-green-800">+ Stream</button>`}
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

// --- USER MANAGEMENT ---
let allUsers = [];
let currentRoleFilter = 'all';
window.usersLoaded = false;

async function fetchUsers() {
    try {
        const q = query(collection(db, "users"));
        const snapshot = await getDocs(q);
        allUsers = [];
        
        snapshot.forEach(doc => {
            allUsers.push({ id: doc.id, ...doc.data() });
        });
        
        window.usersLoaded = true;
        displayUsers();
    } catch (error) {
        console.error('Error fetching users:', error);
        const tbody = qs('#users-table-body');
        if (tbody) {
            tbody.innerHTML = '<tr><td colspan="4" class="text-center py-8 text-red-400">Error loading users. Check console for details.</td></tr>';
        }
    }
}
window.fetchUsers = fetchUsers;

function displayUsers() {
    const tbody = qs('#users-table-body');
    if (!tbody) return;
    
    const searchTerm = qs('#user-search')?.value?.toLowerCase() || '';
    
    // Filter by role and search
    let filtered = allUsers.filter(user => {
        const matchesRole = currentRoleFilter === 'all' || user.role === currentRoleFilter;
        const matchesSearch = !searchTerm || 
            (user.username?.toLowerCase().includes(searchTerm)) ||
            (user.displayName?.toLowerCase().includes(searchTerm)) ||
            (user.email?.toLowerCase().includes(searchTerm));
        return matchesRole && matchesSearch;
    });
    
    // Update counts
    const totalUsers = allUsers.length;
    const adminCount = allUsers.filter(u => u.role === 'admin').length;
    const regularUserCount = allUsers.filter(u => u.role === 'user' || !u.role).length;
    
    if (qs('#user-count')) qs('#user-count').textContent = totalUsers;
    if (qs('#admin-count')) qs('#admin-count').textContent = adminCount;
    if (qs('#regular-user-count')) qs('#regular-user-count').textContent = regularUserCount;
    
    // Display users
    if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="text-center py-8 text-gray-400">No users found.</td></tr>';
        return;
    }
    
    tbody.innerHTML = '';
    filtered.forEach(user => {
        const createdDate = user.createdAt?.toDate?.() || user.joinedAt ? new Date(user.joinedAt) : null;
        const dateStr = createdDate ? createdDate.toLocaleDateString() : 'Unknown';
        const displayName = user.displayName || user.username || 'Unknown User';
        const email = user.email || 'No email';
        const role = user.role || 'user';
        const profilePicture = user.avatar || user.photoURL || null;
        
        const row = document.createElement('tr');
        row.className = 'border-b border-white/5 hover:bg-white/5';
        row.innerHTML = `
            <td class="p-4">
                <div class="flex items-center gap-3">
                    ${profilePicture ? 
                        `<img src="${escapeHtml(profilePicture)}" alt="${escapeHtml(displayName)}" class="w-10 h-10 rounded-full object-cover border-2 border-white/10">` :
                        `<div class="w-10 h-10 rounded-full bg-gradient-to-br from-[var(--gold)]/20 to-orange-500/20 flex items-center justify-center text-lg font-bold text-white border-2 border-white/10">
                            ${escapeHtml(displayName.charAt(0).toUpperCase())}
                        </div>`
                    }
                    <div class="font-semibold text-white">${escapeHtml(displayName)}</div>
                </div>
            </td>
            <td class="p-4 text-gray-300 hidden md:table-cell">${escapeHtml(email)}</td>
            <td class="p-4">
                <span class="inline-flex items-center gap-1 px-2 py-1 rounded text-xs ${role === 'admin' ? 'bg-yellow-900/30 text-yellow-400' : 'bg-blue-900/30 text-blue-400'}">
                    ${role === 'admin' ? '👑' : '👤'} ${escapeHtml(role)}
                </span>
            </td>
            <td class="p-4">
                <button onclick="openUserDialog('${user.id}')" 
                        class="bg-blue-900/50 hover:bg-blue-600 text-blue-200 px-3 py-1.5 rounded text-sm border border-blue-800 transition-colors">
                    View Profile
                </button>
            </td>
        `;
        tbody.appendChild(row);
    });
}

window.openUserDialog = function(userId) {
    const user = allUsers.find(u => u.id === userId);
    if (!user) return;
    
    const displayName = user.displayName || user.username || 'Unknown User';
    const email = user.email || 'No email';
    const role = user.role || 'user';
    const emailVerified = user.emailVerified;
    const createdDate = user.createdAt?.toDate?.() || user.joinedAt ? new Date(user.joinedAt) : null;
    const createdStr = createdDate ? createdDate.toLocaleString('en-US', { 
        month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true 
    }) : 'Unknown';
    const lastSignIn = user.lastSignInTime?.toDate?.();
    const lastSignInStr = lastSignIn ? lastSignIn.toLocaleString('en-US', { 
        month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true 
    }) : 'N/A';
    const rank = user.rank || 'Unranked';
    const prizesEarned = user.prizesEarned || 0;
    const bio = user.bio || 'No bio provided';
    const profilePicture = user.avatar || user.photoURL || null;
    
    const isCurrentUser = userId === currentUserId;
    
    const modal = document.getElementById('userModal');
    const content = modal.querySelector('.user-dialog-content');
    
    content.innerHTML = `
        <div class="text-center border-b border-white/10 pb-6 mb-6">
            ${profilePicture ? 
                `<img src="${escapeHtml(profilePicture)}" alt="${escapeHtml(displayName)}" class="w-20 h-20 rounded-full object-cover border-4 border-[var(--gold)]/20 mx-auto mb-3">` :
                `<div class="w-20 h-20 bg-gradient-to-br from-[var(--gold)]/20 to-orange-500/20 rounded-full flex items-center justify-center text-4xl font-bold text-white mx-auto mb-3 border-4 border-[var(--gold)]/20">
                    ${escapeHtml(displayName.charAt(0).toUpperCase())}
                </div>`
            }
            <h3 class="text-2xl font-bold text-white mb-2">${escapeHtml(displayName)}</h3>
            <span class="inline-flex items-center gap-1 px-3 py-1 rounded-full text-sm ${role === 'admin' ? 'bg-yellow-900/30 text-yellow-400' : 'bg-blue-900/30 text-blue-400'}">
                ${role === 'admin' ? '👑 ADMIN' : '👤 USER'}
            </span>
        </div>
        
        <div class="space-y-3 mb-6">
            <div class="flex justify-between py-2 border-b border-white/5">
                <span class="text-gray-400">User ID</span>
                <span class="text-white text-sm font-mono">${escapeHtml(userId)}</span>
            </div>
            <div class="flex justify-between py-2 border-b border-white/5">
                <span class="text-gray-400">Email</span>
                <span class="text-white">${escapeHtml(email)}</span>
            </div>
            <div class="flex justify-between py-2 border-b border-white/5">
                <span class="text-gray-400">Email Verified</span>
                <span class="${emailVerified ? 'text-green-400' : 'text-red-400'}">${emailVerified ? '✓ Verified' : '✗ Not Verified'}</span>
            </div>
            <div class="flex justify-between py-2 border-b border-white/5">
                <span class="text-gray-400">Account Created</span>
                <span class="text-white">${createdStr}</span>
            </div>
            <div class="flex justify-between py-2 border-b border-white/5">
                <span class="text-gray-400">Last Sign In</span>
                <span class="text-white">${lastSignInStr}</span>
            </div>
            <div class="flex justify-between py-2 border-b border-white/5">
                <span class="text-gray-400">Rank</span>
                <span class="text-white">${escapeHtml(rank)}</span>
            </div>
            <div class="flex justify-between py-2 border-b border-white/5">
                <span class="text-gray-400">Prizes Earned</span>
                <span class="text-[var(--gold)] font-semibold">₱${prizesEarned}</span>
            </div>
            <div class="flex justify-between py-2 border-b border-white/5">
                <span class="text-gray-400">Bio</span>
                <span class="text-white text-right max-w-xs">${escapeHtml(bio)}</span>
            </div>
        </div>
        
        ${!isCurrentUser ? `
            <div class="flex flex-col sm:flex-row gap-3 pt-4 border-t border-white/10">
                <button onclick="toggleUserRole('${userId}', '${role}')" 
                        class="flex-1 bg-blue-900/50 hover:bg-blue-600 text-blue-200 px-4 py-2.5 rounded-lg font-semibold border border-blue-800 transition-colors">
                    ${role === 'admin' ? 'Demote to User' : 'Promote to Admin'}
                </button>
                <button onclick="deleteUserConfirm('${userId}')" 
                        class="flex-1 bg-red-900/50 hover:bg-red-600 text-red-200 px-4 py-2.5 rounded-lg font-semibold border border-red-800 transition-colors">
                    Delete User
                </button>
            </div>
            <div class="pt-3">
                <button onclick="closeModal('userModal')" 
                        class="w-full bg-[var(--gold)] hover:bg-yellow-400 text-black px-4 py-2.5 rounded-lg font-bold transition-colors">
                    Close
                </button>
            </div>
        ` : `
            <div class="text-center text-gray-400 text-sm py-4 border-t border-white/10 mb-3">
                This is your account. You cannot modify your own role or delete yourself.
            </div>
            <button onclick="closeModal('userModal')" 
                    class="w-full bg-[var(--gold)] hover:bg-yellow-400 text-black px-4 py-2.5 rounded-lg font-bold transition-colors">
                Close
            </button>
        `}
    `;
    
    openModal('userModal');
}

window.filterUsersByRole = function(role) {
    currentRoleFilter = role;
    
    // Update active tab
    document.querySelectorAll('.role-tab').forEach(tab => tab.classList.remove('active'));
    const activeTab = qs(`#role-tab-${role}`);
    if (activeTab) activeTab.classList.add('active');
    
    displayUsers();
}

window.refreshUsers = async function() {
    const btn = event?.target;
    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Refreshing...';
    }
    
    await fetchUsers();
    
    if (btn) {
        btn.disabled = false;
        btn.textContent = 'Refresh';
    }
}

window.toggleUserRole = async function(userId, currentRole) {
    if (userId === currentUserId) {
        window.showWarningToast("Not Allowed", "You cannot change your own role.", 3000);
        return;
    }
    
    const newRole = currentRole === 'admin' ? 'user' : 'admin';
    const action = newRole === 'admin' ? 'promote' : 'demote';
    
    const confirmed = await window.showCustomConfirm(
        `${action.charAt(0).toUpperCase() + action.slice(1)} User?`,
        `Are you sure you want to ${action} this user to ${newRole}?`
    );
    
    if (!confirmed) return;
    
    try {
        const userRef = doc(db, "users", userId);
        await updateDoc(userRef, { role: newRole });
        window.showSuccessToast("Success", `User ${action}d to ${newRole}.`, 2000);
        closeModal('userModal');
        await fetchUsers();
    } catch (error) {
        console.error('Error updating role:', error);
        window.showErrorToast("Error", "Failed to update user role.", 4000);
    }
}

window.deleteUserConfirm = async function(userId) {
    if (userId === currentUserId) {
        window.showWarningToast("Not Allowed", "You cannot delete your own account from here.", 3000);
        return;
    }
    
    const confirmed = await window.showCustomConfirm(
        "Delete User?",
        "Are you sure? This will permanently delete the user's account and data."
    );
    
    if (!confirmed) return;
    
    try {
        await deleteDoc(doc(db, "users", userId));
        window.showSuccessToast("Deleted", "User deleted successfully.", 2000);
        closeModal('userModal');
        await fetchUsers();
    } catch (error) {
        console.error('Error deleting user:', error);
        window.showErrorToast("Error", "Failed to delete user. They may need to be deleted from Firebase Auth as well.", 4000);
    }
}

// Search functionality
if (qs('#user-search')) {
    qs('#user-search').addEventListener('input', () => {
        displayUsers();
    });
}

// --- 4. FORM HANDLING ---
document.addEventListener('DOMContentLoaded', () => {

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
                    const modalMap = { 'tournamentForm': 'tournamentModal', 'eventForm': 'eventModal', 'jobForm': 'jobModal', 'talentForm': 'talentModal', 'notifForm': 'notificationModal' };
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

    // --- NEW: Handle Config Form ---
    const configForm = qs('#configForm');
    if (configForm) {
        configForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = configForm.querySelector('button[type="submit"]');
            btn.textContent = "Updating...";
            btn.disabled = true;

            try {
                // Use '|| 0' to handle empty strings safely (prevent NaN)
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
                // Show specific error message
                window.showErrorToast("Error", "Failed to update stats: " + err.message, 4000);
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
        const status = calculateStatus(startDate, endDate);

        return {
            name: qs('#t-name').value,
            game: qs('#t-game').value,
            format: qs('#t-format').value,
            prize: Number(qs('#t-prize').value),
            status: status,
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
});