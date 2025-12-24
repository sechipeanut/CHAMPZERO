import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-auth.js";
import {
    doc,
    getDoc,
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

    // Reset forms
    const formMap = {
        'tournamentModal': '#tournamentForm',
        'eventModal': '#eventForm',
        'jobModal': '#jobForm',
        'talentModal': '#talentForm',
        'notificationModal': '#notifForm'
    };
    resetFormState(formMap[modalId]);
}

window.openTournamentModal = function () { openModal('tournamentModal'); }
window.openEventModal = function () { openModal('eventModal'); }
window.openJobModal = function () { openModal('jobModal'); }
window.openTalentModal = function () { openModal('talentModal'); }
window.openNotificationModal = function () { openModal('notificationModal'); }

// State
let editState = { isEditing: false, collection: null, id: null, formId: null, modalId: null };
let currentUserId = null;

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
        const isAdminRole = userSnap.exists() && userSnap.data().role === 'admin';

        if (isAdminRole || adminEmails.includes(user.email)) {
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

// EDIT ITEM
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
            qs('#t-format').value = data.format || 'Single Elimination'; // POPULATE FORMAT
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
    
    // Update Title
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

    // Reset Title
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

// --- 3. FETCH LISTS ---

async function refreshAllLists() {
    fetchTournaments();
    fetchEvents();
    fetchJobs();
    fetchMessages();
    fetchTalents();
    fetchNotifications();
    // Users are loaded lazily when the tab is clicked
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

// (Other fetch functions: fetchEvents, fetchJobs, fetchTalents, fetchNotifications, fetchMessages omitted for brevity as they remain unchanged)
async function fetchEvents() {
    const list = qs('#events-list');
    const q = query(collection(db, "events"));
    const snapshot = await getDocs(q);
    list.innerHTML = snapshot.empty ? '<p class="text-gray-500 italic">No events found.</p>' : '';
    snapshot.forEach(doc => {
        const data = doc.data();
        list.innerHTML += `
            <div class="admin-item">
                <div><div class="font-bold text-white">${escapeHtml(data.name)}</div><div class="text-sm text-gray-400">${escapeHtml(data.date)}</div></div>
                <div class="flex gap-2">
                    <button onclick="editItem('events', '${doc.id}')" class="bg-blue-900/50 hover:bg-blue-600 text-blue-200 px-3 py-1 rounded text-sm border border-blue-800">Edit</button>
                    <button onclick="deleteItem('events', '${doc.id}')" class="bg-red-900/50 hover:bg-red-600 text-red-200 px-3 py-1 rounded text-sm border border-red-800">Delete</button>
                </div>
            </div>`;
    });
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

async function fetchNotifications() {
    const list = qs('#notifications-list');
    const q = query(collection(db, "notifications"));
    const snapshot = await getDocs(q);
    list.innerHTML = snapshot.empty ? '<p class="text-gray-500">No announcements yet.</p>' : '';
    snapshot.forEach(doc => {
        const data = doc.data();
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
                    <button onclick="editItem('notifications', '${doc.id}')" class="bg-blue-900/50 hover:bg-blue-600 text-blue-200 px-3 py-1 rounded text-sm border border-blue-800">Edit</button>
                    <button onclick="deleteItem('notifications', '${doc.id}')" class="bg-red-900/50 hover:bg-red-600 text-red-200 px-3 py-1 rounded text-sm border border-red-800">Delete</button>
                </div>
            </div>`;
    });
}

async function fetchMessages() {
    const list = qs('#messages-list');
    const q = query(collection(db, "messages"));
    const snapshot = await getDocs(q);
    list.innerHTML = snapshot.empty ? `<div class="text-center py-12 bg-white/5 rounded-lg border border-white/10"><p class="text-gray-400">Inbox is empty.</p></div>` : '';

    // Update Badge
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

    // --- Updated Tournament Logic with Format ---
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
            format: qs('#t-format').value, // SAVE FORMAT
            prize: Number(qs('#t-prize').value),
            status: status,
            date: startDate,
            endDate: endDate,
            banner: qs('#t-banner').value || "pictures/cz_logo.png"
        };
    }, "Tournament Created!");

    // (Other handleForm calls remain the same)
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