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
                    <button onclick="editItem('tournaments', '${doc.id}')" class="bg-blue-900/50 hover:bg-blue-600 text-blue-200 px-3 py-1 rounded text-sm border border-blue-800">Edit</button>
                    <button onclick="deleteItem('tournaments', '${doc.id}')" class="bg-red-900/50 hover:bg-red-600 text-red-200 px-3 py-1 rounded text-sm border border-red-800">Delete</button>
                </div>
            </div>`;
    });
}

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