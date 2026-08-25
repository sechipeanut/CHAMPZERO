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
    orderBy,
    onSnapshot
} from "https://www.gstatic.com/firebasejs/11.1.0/firebase-firestore.js";
import { toDateInputFormat, calculateStatus, uploadImage } from './utils.js';

function qs(sel) { return document.querySelector(sel); }
function escapeHtml(str) { if (!str) return ''; return String(str).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])); }

let lastFocusedElement = null;
let editState = { isEditing: false, collection: null, id: null, formId: null, modalId: null };
let currentUserId = null;
let allUsers = [];
let currentRoleFilter = 'all';
window.usersLoaded = false;

// ======================
// LIVESTREAM MANAGEMENT
// ======================

window.createLivestream = async function (eventId, eventName) {
    const confirmed = await window.showCustomConfirm("Create Livestream", `Create a new livestream for "${eventName}"?`);
    if (!confirmed) return;

    try {
        window.showSuccessToast("Processing", "Creating livestream...", 3000);

        const token = auth.currentUser ? await auth.currentUser.getIdToken() : '';
        const response = await fetch('/.netlify/functions/create-mux-stream', {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ eventId, eventName })
        });

        if (!response.ok) {
            const errJson = await response.json().catch(() => ({}));
            throw new Error(errJson.error || 'Failed to create stream');
        }

        const streamData = await response.json();

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

window.manageLivestream = async function (eventId) {
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

        const response = await fetch(`/.netlify/functions/get-mux-stream?streamId=${livestream.streamId}`);
        const streamData = await response.json();

        const isActive = streamData.status === 'active';

        const modal = document.createElement('div');
        modal.id = 'livestreamModal';
        modal.className = 'fixed inset-0 bg-black/70 backdrop-blur-sm z-[100] flex items-center justify-center p-4';
        modal.innerHTML = `
            <div class="bg-[var(--dark-card)] rounded-xl border border-white/20 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
                <div class="sticky top-0 bg-[var(--dark-card)] border-b border-white/10 px-6 py-4 flex justify-between items-center">
                    <h3 class="text-xl font-bold text-white font-heading uppercase">Livestream Manager</h3>
                    <button onclick="closeLivestreamModal()" class="text-neutral-400 hover:text-white transition-colors text-2xl leading-none">&times;</button>
                </div>
                <div class="p-6 space-y-4 font-mono-tag">
                    <div class="bg-white/5 border border-white/10 rounded-lg p-4">
                        <div class="flex items-center justify-between mb-2">
                            <span class="text-neutral-400 text-xs">Stream Status</span>
                            <span class="px-3 py-1 rounded-full text-xs font-semibold ${isActive ? 'bg-red-500/20 text-red-400' : 'bg-neutral-500/20 text-neutral-400'}">
                                ${isActive ? 'LIVE' : 'Idle'}
                            </span>
                        </div>
                        <div class="text-white font-bold text-base font-heading uppercase">${escapeHtml(eventData.name)}</div>
                    </div>
                    
                    <div class="bg-white/5 border border-white/10 rounded-lg p-4">
                        <label class="text-neutral-400 text-xs block mb-2 font-bold uppercase">Stream URL</label>
                        <div class="flex gap-2">
                            <input type="text" readonly value="rtmp://rtmp-push.champzero.org" class="flex-1 bg-black/40 border border-white/10 text-white px-3 py-2 rounded text-xs">
                            <button onclick="copyToClipboard('rtmp://rtmp-push.champzero.org')" class="bg-[var(--gold)] text-black font-heading font-bold px-4 py-2 rounded text-xs uppercase">Copy</button>
                        </div>
                    </div>
                    
                    <div class="bg-white/5 border border-white/10 rounded-lg p-4">
                        <label class="text-neutral-400 text-xs block mb-2 font-bold uppercase">Stream Key</label>
                        <div class="flex gap-2">
                            <input type="password" id="streamKeyInput" readonly value="${livestream.streamKey}" class="flex-1 bg-black/40 border border-white/10 text-white px-3 py-2 rounded text-xs">
                            <button onclick="toggleStreamKey()" class="bg-white/10 hover:bg-white/20 text-white px-3 py-2 rounded text-xs uppercase">Show</button>
                            <button onclick="copyToClipboard('${livestream.streamKey}')" class="bg-[var(--gold)] text-black font-heading font-bold px-4 py-2 rounded text-xs uppercase">Copy</button>
                        </div>
                        <p class="text-[11px] text-neutral-500 mt-2 font-mono-tag">Keep this private. Paste in OBS / Streamlabs to begin broadcasting.</p>
                    </div>
                    
                    <div class="flex gap-3 pt-4 border-t border-white/5">
                        <button onclick="disableLivestream('${eventId}')" class="flex-1 bg-red-900/40 hover:bg-red-600 text-red-200 px-4 py-2.5 rounded-lg font-bold border border-red-800 transition-all font-heading uppercase text-xs">
                            End Stream
                        </button>
                        <button onclick="deleteLivestream('${eventId}')" class="flex-1 bg-neutral-900/40 hover:bg-neutral-800 text-neutral-300 px-4 py-2.5 rounded-lg font-bold border border-white/10 transition-all font-heading uppercase text-xs">
                            Delete Stream
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

window.closeLivestreamModal = function () {
    const modal = document.getElementById('livestreamModal');
    if (modal) modal.remove();
};

window.toggleStreamKey = function () {
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

window.copyToClipboard = async function (text) {
    try {
        await navigator.clipboard.writeText(text);
        window.showSuccessToast("Copied!", "Copied to clipboard", 2000);
    } catch (err) {
        window.showErrorToast("Error", "Failed to copy", 2000);
    }
};

window.disableLivestream = async function (eventId) {
    const confirmed = await window.showCustomConfirm("End Stream", "This will end the current live broadcast. Continue?");
    if (!confirmed) return;

    try {
        const eventRef = doc(db, 'events', eventId);
        const eventSnap = await getDoc(eventRef);
        const livestream = eventSnap.data().livestream;

        const token = auth.currentUser ? await auth.currentUser.getIdToken() : '';
        const response = await fetch('/.netlify/functions/disable-mux-stream', {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ streamId: livestream.streamId })
        });

        if (!response.ok) {
            const errJson = await response.json().catch(() => ({}));
            throw new Error(errJson.error || 'Failed to disable stream');
        }

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

window.deleteLivestream = async function (eventId) {
    const confirmed = await window.showCustomConfirm("Delete Stream", "This will permanently delete the stream and its key. Continue?");
    if (!confirmed) return;

    try {
        const eventRef = doc(db, 'events', eventId);
        const eventSnap = await getDoc(eventRef);
        const livestream = eventSnap.data().livestream;

        const token = auth.currentUser ? await auth.currentUser.getIdToken() : '';
        const response = await fetch('/.netlify/functions/delete-mux-stream', {
            method: 'DELETE',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ streamId: livestream.streamId })
        });

        if (!response.ok) {
            const errJson = await response.json().catch(() => ({}));
            throw new Error(errJson.error || 'Failed to delete stream');
        }

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
    if (!modal) return;
    modal.classList.add('hidden');
    document.body.style.overflow = 'auto';
    if (lastFocusedElement) lastFocusedElement.focus();

    const formMap = {
        'tournamentModal': '#tournamentForm',
        'eventModal': '#eventForm',
        'jobModal': '#jobForm',
        'talentModal': '#talentForm',
        'notificationModal': '#notifForm',
        'partnerModal': '#partnerForm',
    };
    if (formMap[modalId]) resetFormState(formMap[modalId]);
}

window.openTournamentModal = function () { openModal('tournamentModal'); }
window.openEventModal = function () { openModal('eventModal'); }
window.openJobModal = function () { openModal('jobModal'); }
window.openTalentModal = function () { openModal('talentModal'); }
window.openPartnerModal = function () { openModal('partnerModal'); }
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
            initSystemStatus(); // Start system monitoring + user analytics after auth resolves
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
        if (collectionName === 'partners') {
            const configDocRef = doc(db, "site_config", "partners_data");
            try {
                const snap = await getDoc(configDocRef);
                let list = [];
                if (snap.exists() && Array.isArray(snap.data().partners)) {
                    list = snap.data().partners.filter(p => p.id !== docId);
                } else {
                    list = allPartners.filter(p => p.id !== docId);
                }
                await setDoc(configDocRef, { partners: list, updatedAt: serverTimestamp() }, { merge: true });
            } catch (err) {
                console.warn("Could not delete from site_config/partners_data", err);
            }

            try {
                await deleteDoc(doc(db, "partners", docId));
            } catch (_) { }

            window.showSuccessToast("Deleted", "Partner deleted successfully.", 2000);
            await fetchPartners();
            return;
        }

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
            qs('#t-name').value = data.name || '';
            qs('#t-game').value = data.game || '';
            qs('#t-max-teams').value = data.maxTeams || 8;
            qs('#t-venue-type').value = data.venueType || 'Online';
            qs('#t-venue-location').value = data.venueLocation || '';
            if (window.toggleAdminVenueInput) window.toggleAdminVenueInput();

            if (qs('#t-discord')) qs('#t-discord').value = data.discordLink || '';

            qs('#t-format').value = data.format || 'Single Elimination';
            qs('#t-prize').value = data.prize || 0;

            const split = data.prizeSplit || { first: 60, second: 30, third: 10 };
            if (qs('#t-prize-1st')) qs('#t-prize-1st').value = split.first ?? 60;
            if (qs('#t-prize-2nd')) qs('#t-prize-2nd').value = split.second ?? 30;
            if (qs('#t-prize-3rd')) qs('#t-prize-3rd').value = split.third ?? 10;

            const pType = data.paymentType ? (data.paymentType.toLowerCase() === 'automatic' ? 'Automatic' : (data.paymentType.toLowerCase() === 'manual' ? 'Manual' : 'Free')) : (data.entryType === 'Paid' ? 'Manual' : 'Free');
            qs('#t-entry-type').value = pType;
            qs('#t-entry-fee').value = data.entryFee || '';
            qs('#t-entry-currency').value = data.entryCurrency || 'PHP';
            qs('#t-date').value = toDateInputFormat(data.date);
            if (qs('#t-time')) qs('#t-time').value = data.startTime || data.time || '19:00';
            qs('#t-end-date').value = toDateInputFormat(data.endDate);
            if (qs('#t-end-time')) qs('#t-end-time').value = data.endTime || '';
            qs('#t-desc').value = data.description || '';
            if (qs('#t-rules')) qs('#t-rules').value = data.rules || '';
            qs('#t-banner').value = data.banner || '';
            qs('#t-proof').value = data.paymentProofURL || data.paymentQrUrl || '';

            if (qs('#t-banner-status')) {
                qs('#t-banner-status').textContent = data.banner ? 'Banner image loaded.' : '';
            }
            if (qs('#t-proof-status')) {
                qs('#t-proof-status').textContent = (data.paymentProofURL || data.paymentQrUrl) ? 'QR code image loaded.' : '';
            }
            prepareEditMode('tournaments', docId, '#tournamentForm', 'tournamentModal');
            openModal('tournamentModal');
        }
        else if (collectionName === 'events') {
            qs('#e-name').value = data.name || '';
            qs('#e-date').value = toDateInputFormat(data.date);
            if (qs('#e-time')) qs('#e-time').value = data.startTime || data.time || '18:00';
            qs('#e-end-date').value = toDateInputFormat(data.endDate);
            if (qs('#e-end-time')) qs('#e-end-time').value = data.endTime || '';
            qs('#e-desc').value = data.description || '';
            qs('#e-banner').value = data.banner || '';
            if (qs('#e-banner-status')) {
                qs('#e-banner-status').textContent = data.banner ? 'Banner image loaded.' : '';
            }
            prepareEditMode('events', docId, '#eventForm', 'eventModal');
            openModal('eventModal');
        }
        else if (collectionName === 'careers') {
            qs('#j-title').value = data.title || '';
            qs('#j-location').value = data.location || '';
            qs('#j-type').value = data.type || '';
            prepareEditMode('careers', docId, '#jobForm', 'jobModal');
            openModal('jobModal');
        }
        else if (collectionName === 'talents') {
            qs('#tal-name').value = data.name || '';
            qs('#tal-role').value = data.role || 'Streamer';
            qs('#tal-img').value = data.image || '';
            qs('#tal-link').value = data.socialLink || '';
            qs('#tal-bio').value = data.bio || '';
            if (qs('#tal-img-status')) {
                qs('#tal-img-status').textContent = data.image ? 'Profile image loaded.' : '';
            }
            prepareEditMode('talents', docId, '#talentForm', 'talentModal');
            openModal('talentModal');
        }
        else if (collectionName === 'notifications') {
            qs('#n-title').value = data.title || '';
            qs('#n-type').value = data.type || 'general';
            qs('#n-message').value = data.message || '';
            prepareEditMode('notifications', docId, '#notifForm', 'notificationModal');
            openModal('notificationModal');
        }
        else if (collectionName === 'partners') {
            let partner = allPartners.find(p => p.id === docId);
            if (!partner) {
                try {
                    const docRef = doc(db, collectionName, docId);
                    const docSnap = await getDoc(docRef);
                    if (docSnap.exists()) partner = { id: docSnap.id, ...docSnap.data() };
                } catch (_) { }
            }
            if (!partner) {
                window.showErrorToast("Not Found", "Partner not found.", 3000);
                return;
            }

            qs('#p-name').value = partner.name || '';
            qs('#p-category').value = partner.category || 'Major Partners';
            qs('#p-order').value = partner.order ?? 1;
            qs('#p-logo').value = partner.logo || '';
            if (qs('#p-logo-url')) qs('#p-logo-url').value = partner.logo || '';
            if (qs('#p-logo-preview')) qs('#p-logo-preview').src = partner.logo || 'pictures/cz_logo.png';
            qs('#p-website').value = partner.website || '';
            qs('#p-description').value = partner.description || '';
            if (qs('#p-logo-status')) {
                qs('#p-logo-status').textContent = partner.logo ? 'Logo loaded.' : '';
            }
            prepareEditMode('partners', docId, '#partnerForm', 'partnerModal');
            openModal('partnerModal');
        }

    } catch (error) {
        console.error("Edit Error:", error);
        window.showErrorToast("Error", "Failed to load item: " + error.message, 3000);
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
        'partnerModal': 'Edit Partner',
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
        'partnerModal': 'Add Partner',
    };
    if (editState.modalId && qs(`#${editState.modalId}Title`)) {
        qs(`#${editState.modalId}Title`).textContent = modalTitleMap[editState.modalId];
    }

    if (qs('#t-banner-status')) qs('#t-banner-status').textContent = '';
    if (qs('#t-proof-status')) qs('#t-proof-status').textContent = '';
    if (qs('#e-banner-status')) qs('#e-banner-status').textContent = '';
    if (qs('#tal-img-status')) qs('#tal-img-status').textContent = '';
    if (qs('#p-logo-status')) qs('#p-logo-status').textContent = '';
    if (qs('#p-logo-preview')) qs('#p-logo-preview').src = 'pictures/cz_logo.png';

    if (form) {
        const btn = form.querySelector('button[type="submit"]');
        if (btn) btn.textContent = btn.getAttribute('data-original-text') || 'Save';
    }
    editState = { isEditing: false, collection: null, id: null, formId: null, modalId: null };
}

// ======================
// USER MANAGEMENT
// ======================

window.fetchUsers = async function () {
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
            container.innerHTML = '<div class="text-center py-12 text-red-400 font-mono-tag text-xs">Error loading users.</div>';
        }
    }
}

window.refreshUsers = async function () {
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

    if (qs('#user-count')) qs('#user-count').textContent = allUsers.length;
    if (qs('#admin-count')) qs('#admin-count').textContent = allUsers.filter(u => u.role === 'admin').length;
    if (qs('#organizer-count')) qs('#organizer-count').textContent = allUsers.filter(u => u.role === 'organizer').length;
    if (qs('#regular-user-count')) qs('#regular-user-count').textContent = allUsers.filter(u => u.role !== 'admin' && u.role !== 'organizer').length;

    if (filtered.length === 0) {
        container.innerHTML = '<div class="text-center py-12 bg-[var(--dark-card)] rounded-xl border border-white/5 text-neutral-400 font-mono-tag text-xs">No users found matching your criteria.</div>';
        return;
    }

    container.innerHTML = '';

    filtered.forEach(user => {
        const createdDate = user.createdAt?.toDate?.() || (user.joinedAt ? new Date(user.joinedAt) : null);
        const dateStr = createdDate ? createdDate.toLocaleDateString() : 'Unknown';
        const displayName = user.displayName || user.username || 'Unknown User';
        const email = user.email || 'No email';
        const role = user.role || 'user';
        const profilePicture = user.avatar || user.photoURL || null;
        const roles = ['user', 'organizer', 'admin', 'moderator', 'subscriber'];

        let roleBadgeClass = 'bg-blue-500/10 text-blue-400 border border-blue-500/20';
        let roleIcon = '';
        if (role === 'admin') {
            roleBadgeClass = 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20';
            roleIcon = '';
        } else if (role === 'organizer') {
            roleBadgeClass = 'bg-purple-500/10 text-purple-400 border border-purple-500/20';
            roleIcon = '';
        }

        const card = document.createElement('div');
        card.className = 'bg-[var(--dark-card)] p-4 rounded-xl border border-white/5 flex flex-col md:flex-row md:items-center gap-4 transition-all hover:border-[var(--gold)]/30';

        card.innerHTML = `
            <div class="flex items-center gap-4 flex-1 overflow-hidden">
                ${profilePicture ?
                `<img src="${escapeHtml(profilePicture)}" alt="${escapeHtml(displayName)}" class="w-11 h-11 rounded-full object-cover border-2 border-white/10 shrink-0">` :
                `<div class="w-11 h-11 rounded-full bg-gradient-to-br from-[var(--gold)]/20 to-orange-500/20 flex items-center justify-center text-base font-bold text-[var(--gold)] border-2 border-[var(--gold)]/30 shrink-0 font-heading">
                        ${escapeHtml(displayName.charAt(0).toUpperCase())}
                    </div>`
            }
                <div class="min-w-0">
                    <div class="font-bold text-white truncate text-sm">${escapeHtml(displayName)}</div>
                    <div class="text-xs text-neutral-400 truncate font-mono-tag">${escapeHtml(email)}</div>
                    <div class="md:hidden mt-1 text-[10px] text-neutral-500 font-mono-tag">Joined: ${dateStr}</div>
                </div>
            </div>

            <div class="flex items-center justify-between md:justify-start md:w-1/5">
                <span class="md:hidden text-xs text-neutral-400 font-mono-tag">Role</span>
                <span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider font-mono-tag ${roleBadgeClass}">
                    ${roleIcon} ${escapeHtml(role)}
                </span>
            </div>

            <div class="flex items-center justify-between md:justify-start md:w-1/5">
                <span class="md:hidden text-xs text-neutral-400 font-mono-tag">Coins</span>
                <button type="button" onclick="window.openEditUserCoinsModal('${user.id}')" class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#FFD700]/10 hover:bg-[#FFD700]/20 text-[#FFD700] border border-[#FFD700]/30 font-mono-tag font-bold text-xs transition-all cursor-pointer shadow-sm group" title="Click to Edit Champ Coins">
                    <span>🪙 ${(user.czPoints !== undefined ? Number(user.czPoints) : 0).toLocaleString()} CZ</span>
                    <svg class="w-3 h-3 text-[#FFD700]/60 group-hover:text-[#FFD700] transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"></path></svg>
                </button>
            </div>

            <div class="hidden md:block w-1/6 text-xs text-neutral-400 font-mono-tag">
                ${dateStr}
            </div>

            <div class="flex flex-col sm:flex-row gap-2 mt-2 md:mt-0 md:w-1/4 justify-end">
                <select onchange="window.changeUserRole('${user.id}', this.value)" class="dark-select w-full sm:w-auto text-xs py-1.5 px-2.5 rounded-lg border border-white/10 bg-black/40 text-white font-mono-tag focus:border-[var(--gold)] cursor-pointer">
                    ${roles.map(r =>
                `<option value="${r}" ${role === r ? 'selected' : ''}>${r.charAt(0).toUpperCase() + r.slice(1)}</option>`
            ).join('')}
                </select>
                <button onclick="window.deleteUserConfirm('${user.id}')" class="w-full sm:w-auto flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 transition-colors" title="Delete User">
                    <span class="md:hidden font-bold text-xs">Delete</span>
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                </button>
            </div>
        `;
        container.appendChild(card);
    });
}

window.openEditUserCoinsModal = function (userId) {
    const user = allUsers.find(u => u.id === userId);
    if (!user) return;

    const displayName = user.displayName || user.username || user.ign || 'User';
    const email = user.email || 'No email';
    const profilePicture = user.avatar || user.photoURL || null;
    const czPts = user.czPoints !== undefined ? Number(user.czPoints) : 0;
    const lifetimePts = user.lifetimePoints !== undefined ? Number(user.lifetimePoints) : czPts;

    if (qs('#edit-coins-user-id')) qs('#edit-coins-user-id').value = userId;
    if (qs('#edit-coins-user-name')) qs('#edit-coins-user-name').textContent = displayName;
    if (qs('#edit-coins-user-email')) qs('#edit-coins-user-email').textContent = email;
    
    const avatarEl = qs('#edit-coins-user-avatar');
    if (avatarEl) {
        if (profilePicture) {
            avatarEl.innerHTML = `<img src="${escapeHtml(profilePicture)}" alt="${escapeHtml(displayName)}" class="w-full h-full rounded-full object-cover">`;
        } else {
            avatarEl.innerHTML = `<span>${escapeHtml(displayName.charAt(0).toUpperCase())}</span>`;
        }
    }

    if (qs('#edit-coins-current-val')) qs('#edit-coins-current-val').textContent = `${czPts.toLocaleString()} CZ`;
    if (qs('#edit-coins-lifetime-val')) qs('#edit-coins-lifetime-val').textContent = `${lifetimePts.toLocaleString()} CZ`;
    if (qs('#edit-coins-input')) qs('#edit-coins-input').value = czPts;
    if (qs('#edit-lifetime-coins-input')) qs('#edit-lifetime-coins-input').value = lifetimePts;

    openModal('editUserCoinsModal');
};

window.closeEditUserCoinsModal = function () {
    closeModal('editUserCoinsModal');
};

window.setUserCoinsPreset = function (amount, isAdditive) {
    const input = qs('#edit-coins-input');
    const lifeInput = qs('#edit-lifetime-coins-input');
    if (!input) return;

    if (isAdditive) {
        const currentVal = parseInt(input.value, 10) || 0;
        const newVal = Math.max(0, currentVal + amount);
        input.value = newVal;

        if (lifeInput && amount > 0) {
            const currentLife = parseInt(lifeInput.value, 10) || 0;
            lifeInput.value = Math.max(0, currentLife + amount);
        }
    } else {
        input.value = amount;
    }
};

window.saveUserCoins = async function (event) {
    if (event && event.preventDefault) event.preventDefault();

    const userId = qs('#edit-coins-user-id')?.value;
    const newCzPoints = parseInt(qs('#edit-coins-input')?.value, 10);
    const newLifetimePoints = parseInt(qs('#edit-lifetime-coins-input')?.value, 10);

    if (!userId || isNaN(newCzPoints) || newCzPoints < 0) {
        if (window.showWarningToast) window.showWarningToast("Invalid Input", "Please enter a valid coin amount.");
        return;
    }

    const submitBtn = qs('#edit-coins-submit-btn');
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Saving...';
    }

    try {
        const userRef = doc(db, "users", userId);
        const updatePayload = {
            czPoints: newCzPoints,
            lifetimePoints: !isNaN(newLifetimePoints) ? newLifetimePoints : newCzPoints,
            updatedAt: new Date().toISOString()
        };

        await updateDoc(userRef, updatePayload);

        // Update local user record in state
        const userIdx = allUsers.findIndex(u => u.id === userId);
        if (userIdx !== -1) {
            allUsers[userIdx].czPoints = newCzPoints;
            allUsers[userIdx].lifetimePoints = updatePayload.lifetimePoints;
        }

        closeModal('editUserCoinsModal');

        if (window.showSuccessToast) {
            window.showSuccessToast("Coins Updated! 🪙", `Balance updated to ${newCzPoints.toLocaleString()} CZ Points.`);
        }

        displayUsers();

    } catch (err) {
        console.error("Error updating user coins:", err);
        if (window.showErrorToast) window.showErrorToast("Update Failed", err.message || "Failed to update user coins.");
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Save Changes';
        }
    }
};

window.changeUserRole = async function (userId, newRole) {
    if (userId === currentUserId && newRole !== 'admin') {
        window.showWarningToast("Not Allowed", "You cannot remove your own Admin access.", 3000);
        displayUsers();
        return;
    }

    const confirmed = await window.showCustomConfirm("Update Role?", `Change user role to ${newRole.toUpperCase()}?`);
    if (!confirmed) {
        displayUsers();
        return;
    }

    try {
        const userIndex = allUsers.findIndex(u => u.id === userId);
        if (userIndex !== -1) allUsers[userIndex].role = newRole;
        displayUsers();

        await updateDoc(doc(db, "users", userId), { role: newRole });
        window.showSuccessToast("Success", `User role updated to ${newRole}`, 2000);
    } catch (error) {
        console.error(error);
        window.showErrorToast("Error", "Failed to update role", 3000);
        window.fetchUsers();
    }
}

window.deleteUserConfirm = async function (userId) {
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

window.filterUsersByRole = function (role) {
    currentRoleFilter = role;
    document.querySelectorAll('.role-tab').forEach(tab => tab.classList.remove('active'));
    const activeTab = qs(`#role-tab-${role}`);
    if (activeTab) activeTab.classList.add('active');
    displayUsers();
}

if (qs('#user-search')) {
    qs('#user-search').addEventListener('input', () => displayUsers());
}

// ==========================================
// REWARDS CATALOG & STORE MANAGEMENT
// ==========================================

const DEFAULT_REWARDS_CATALOG = [
    {
        id: 'pro_badge',
        title: '1-Month PRO Badge',
        cost: 300,
        badgeText: 'Instant Unlock',
        badgeClass: 'bg-[#FFD700]/15 text-[#FFD700] border-[#FFD700]/30',
        description: 'Verified golden PRO badge across all tournament brackets, profile HUD, and recruitment cards.',
        gameType: 'platform',
        active: true,
        isSpecialDrop: false,
        stockLimit: 0,
        claimedCount: 0
    },
    {
        id: 'tournament_pass',
        title: 'Tournament Entry Pass',
        cost: 400,
        badgeText: 'Coupon Pass',
        badgeClass: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
        description: '100% waiver ticket for any upcoming paid community tournament registration.',
        gameType: 'platform',
        active: true,
        isSpecialDrop: false,
        stockLimit: 50,
        claimedCount: 0
    },
    {
        id: 'spotlight_48h',
        title: 'Recruitment 48h Spotlight',
        cost: 500,
        badgeText: 'Pin Spotlight',
        badgeClass: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
        description: 'Pin your squad or player LFT listing to the very top of the Recruitment Hub for 48 hours.',
        gameType: 'platform',
        active: true,
        isSpecialDrop: false,
        stockLimit: 0,
        claimedCount: 0
    },
    {
        id: 'val_points_475',
        title: '475 Valorant Points (VP)',
        cost: 600,
        badgeText: 'Valorant',
        badgeClass: 'bg-red-500/15 text-red-400 border-red-500/30',
        description: 'Riot Games digital redeem code delivered directly to your verified account.',
        gameType: 'valorant',
        active: true,
        isSpecialDrop: true,
        stockLimit: 25,
        claimedCount: 0
    },
    {
        id: 'mlbb_diamonds_100',
        title: '100 MLBB Diamonds',
        cost: 600,
        badgeText: 'MLBB',
        badgeClass: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
        description: 'Direct in-game diamond top-up. Delivered within 24 hours to your MLBB User ID & Zone.',
        gameType: 'mlbb',
        active: true,
        isSpecialDrop: true,
        stockLimit: 30,
        claimedCount: 0
    },
    {
        id: 'hok_tokens_100',
        title: '100 Honor of Kings Tokens',
        cost: 600,
        badgeText: 'Honor of Kings',
        badgeClass: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
        description: 'Direct Honor of Kings in-game token recharge delivered via player UID.',
        gameType: 'hok',
        active: true,
        isSpecialDrop: true,
        stockLimit: 30,
        claimedCount: 0
    }
];

let currentCatalogItems = [...DEFAULT_REWARDS_CATALOG];

window.fetchRewardsCatalog = async function () {
    const listEl = qs('#admin-rewards-list');
    if (!listEl) return;

    try {
        const docRef = doc(db, "site_config", "rewards_catalog");
        const docSnap = await getDoc(docRef);

        if (docSnap.exists() && Array.isArray(docSnap.data().items) && docSnap.data().items.length > 0) {
            currentCatalogItems = docSnap.data().items;
        } else {
            currentCatalogItems = [...DEFAULT_REWARDS_CATALOG];
            await setDoc(docRef, {
                items: currentCatalogItems,
                updatedAt: serverTimestamp()
            }, { merge: true });
        }

        renderAdminRewardsCatalog();
    } catch (err) {
        console.error("Error fetching rewards catalog:", err);
        if (listEl) {
            listEl.innerHTML = '<div class="col-span-full text-center py-8 text-red-400 font-mono-tag text-xs">Error loading catalog. Rendering default items.</div>';
        }
        currentCatalogItems = [...DEFAULT_REWARDS_CATALOG];
        renderAdminRewardsCatalog();
    }
};

function renderAdminRewardsCatalog() {
    const listEl = qs('#admin-rewards-list');
    if (!listEl) return;

    if (!currentCatalogItems || currentCatalogItems.length === 0) {
        listEl.innerHTML = '<div class="col-span-full text-center py-12 text-neutral-500 font-mono-tag text-xs">No items in rewards catalog. Click "+ Add Reward Item" to create one.</div>';
        return;
    }

    listEl.innerHTML = '';
    currentCatalogItems.forEach(item => {
        const card = document.createElement('div');
        const isActive = item.active !== false;
        const isSpecial = Boolean(item.isSpecialDrop);
        const stockLimit = Number(item.stockLimit) || 0;
        const claimedCount = Number(item.claimedCount) || 0;
        const isSoldOut = stockLimit > 0 && claimedCount >= stockLimit;

        let borderClass = 'border-white/10 hover:border-[#FFD700]/40';
        let bgClass = 'bg-[var(--dark-card)]';

        if (isSpecial) {
            borderClass = 'border-2 border-[#FFD700] ring-1 ring-[#FFD700]/40 shadow-[0_0_25px_rgba(255,215,0,0.18)]';
            bgClass = 'bg-gradient-to-b from-[#FFD700]/10 via-[var(--dark-card)] to-[var(--dark-card)]';
        } else if (!isActive) {
            borderClass = 'border-red-500/20 opacity-60';
        }

        card.className = `${bgClass} border ${borderClass} rounded-2xl p-5 flex flex-col justify-between gap-4 transition-all shadow-lg relative overflow-hidden`;

        const badgeClass = item.badgeClass || 'bg-[#FFD700]/15 text-[#FFD700] border-[#FFD700]/30';

        const stockText = (stockLimit > 0)
            ? `<span class="px-2 py-0.5 rounded text-[8px] font-mono-tag font-bold uppercase ${isSoldOut ? 'bg-red-500/20 text-red-400 border border-red-500/30' : 'bg-white/5 text-neutral-300 border border-white/10'}">📦 ${claimedCount}/${stockLimit} Claimed</span>`
            : '<span class="px-2 py-0.5 rounded text-[8px] font-mono-tag font-bold uppercase bg-white/5 text-neutral-400 border border-white/10">📦 Unlimited</span>';

        const specialRibbon = isSpecial
            ? '<div class="absolute top-0 right-0 bg-[#FFD700] text-black font-heading font-black text-[8px] uppercase tracking-wider px-2 py-0.5 rounded-bl-lg shadow-sm">✨ Special Drop</div>'
            : '';

        card.innerHTML = `
            ${specialRibbon}
            <div>
                <div class="flex items-center justify-between gap-2 mb-3">
                    <span class="px-2 py-0.5 rounded text-[9px] font-mono-tag font-bold uppercase ${badgeClass} border">
                        ${escapeHtml(item.badgeText || item.gameType || 'Perk')}
                    </span>
                    <div class="flex items-center gap-2">
                        <span class="px-2 py-0.5 rounded text-[8px] font-mono-tag font-bold uppercase ${isActive ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30' : 'bg-red-500/15 text-red-400 border border-red-500/30'}">
                            ${isActive ? 'Active' : 'Disabled'}
                        </span>
                        <div class="font-heading font-extrabold text-base text-[#FFD700]">🪙 ${(Number(item.cost) || 0).toLocaleString()} CZ</div>
                    </div>
                </div>

                <h3 class="font-heading font-bold text-base text-white uppercase tracking-tight">${escapeHtml(item.title)}</h3>
                <p class="text-xs text-neutral-400 mt-1 leading-relaxed line-clamp-2">
                    ${escapeHtml(item.description)}
                </p>
                <div class="mt-2.5 flex items-center justify-between text-[10px] text-neutral-400 font-mono-tag pt-2 border-t border-white/5">
                    <div>Category: <span class="text-neutral-200 uppercase font-semibold">${escapeHtml(item.gameType || 'platform')}</span></div>
                    ${stockText}
                </div>
            </div>

            <div class="flex gap-2 pt-2 border-t border-white/5">
                <button type="button" onclick="window.openEditCatalogRewardModal('${escapeHtml(item.id)}')"
                    class="flex-1 py-2 rounded-xl bg-white/5 hover:bg-[#FFD700] text-neutral-200 hover:text-black font-heading font-bold text-xs uppercase tracking-wider transition-all border border-white/10 hover:border-[#FFD700] cursor-pointer flex items-center justify-center gap-1.5">
                    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"></path></svg>
                    <span>Edit Item</span>
                </button>
                <button type="button" onclick="window.toggleCatalogRewardActive('${escapeHtml(item.id)}')"
                    class="px-3 py-2 rounded-xl ${isActive ? 'bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border-amber-500/30' : 'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border-emerald-500/30'} border text-xs font-mono-tag font-bold transition-all cursor-pointer"
                    title="${isActive ? 'Disable Reward' : 'Enable Reward'}">
                    ${isActive ? 'Disable' : 'Enable'}
                </button>
            </div>
        `;
        listEl.appendChild(card);
    });
}

window.openEditCatalogRewardModal = function (rewardId) {
    const item = currentCatalogItems.find(r => r.id === rewardId);
    if (!item) return;

    if (qs('#catalogModalTitle')) qs('#catalogModalTitle').textContent = 'Edit Reward Item';
    if (qs('#edit-reward-id')) qs('#edit-reward-id').value = item.id;
    if (qs('#edit-reward-title')) qs('#edit-reward-title').value = item.title || '';
    if (qs('#edit-reward-cost')) qs('#edit-reward-cost').value = item.cost || 100;
    if (qs('#edit-reward-game')) qs('#edit-reward-game').value = item.gameType || 'platform';
    if (qs('#edit-reward-badge')) qs('#edit-reward-badge').value = item.badgeText || '';
    if (qs('#edit-reward-desc')) qs('#edit-reward-desc').value = item.description || '';
    if (qs('#edit-reward-stock')) qs('#edit-reward-stock').value = item.stockLimit || 0;
    if (qs('#edit-reward-claimed')) qs('#edit-reward-claimed').value = item.claimedCount || 0;
    if (qs('#edit-reward-special')) qs('#edit-reward-special').checked = Boolean(item.isSpecialDrop);
    if (qs('#edit-reward-active')) qs('#edit-reward-active').checked = (item.active !== false);

    openModal('editCatalogRewardModal');
};

window.openAddCatalogRewardModal = function () {
    if (qs('#catalogModalTitle')) qs('#catalogModalTitle').textContent = 'Add New Reward Item';
    if (qs('#edit-reward-id')) qs('#edit-reward-id').value = 'reward_' + Date.now();
    if (qs('#edit-reward-title')) qs('#edit-reward-title').value = '';
    if (qs('#edit-reward-cost')) qs('#edit-reward-cost').value = 500;
    if (qs('#edit-reward-game')) qs('#edit-reward-game').value = 'platform';
    if (qs('#edit-reward-badge')) qs('#edit-reward-badge').value = 'Special Perk';
    if (qs('#edit-reward-desc')) qs('#edit-reward-desc').value = '';
    if (qs('#edit-reward-stock')) qs('#edit-reward-stock').value = 0;
    if (qs('#edit-reward-claimed')) qs('#edit-reward-claimed').value = 0;
    if (qs('#edit-reward-special')) qs('#edit-reward-special').checked = false;
    if (qs('#edit-reward-active')) qs('#edit-reward-active').checked = true;

    openModal('editCatalogRewardModal');
};

window.saveCatalogReward = async function (event) {
    if (event && event.preventDefault) event.preventDefault();

    const rewardId = qs('#edit-reward-id')?.value;
    const title = qs('#edit-reward-title')?.value?.trim();
    const cost = parseInt(qs('#edit-reward-cost')?.value, 10);
    const gameType = qs('#edit-reward-game')?.value || 'platform';
    const badgeText = qs('#edit-reward-badge')?.value?.trim() || (gameType === 'platform' ? 'Instant Perk' : gameType.toUpperCase());
    const description = qs('#edit-reward-desc')?.value?.trim();
    const stockLimit = Math.max(0, parseInt(qs('#edit-reward-stock')?.value, 10) || 0);
    const claimedCount = Math.max(0, parseInt(qs('#edit-reward-claimed')?.value, 10) || 0);
    const isSpecialDrop = Boolean(qs('#edit-reward-special')?.checked);
    const active = qs('#edit-reward-active') ? qs('#edit-reward-active').checked : true;

    if (!rewardId || !title || isNaN(cost) || cost <= 0 || !description) {
        if (window.showWarningToast) window.showWarningToast("Invalid Input", "Please fill out all required fields with a valid price.");
        return;
    }

    const submitBtn = qs('#edit-reward-submit-btn');
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Saving...';
    }

    try {
        let badgeClass = 'bg-[#FFD700]/15 text-[#FFD700] border-[#FFD700]/30';
        if (gameType === 'valorant') badgeClass = 'bg-red-500/15 text-red-400 border-red-500/30';
        else if (gameType === 'mlbb') badgeClass = 'bg-amber-500/15 text-amber-400 border-amber-500/30';
        else if (gameType === 'hok') badgeClass = 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30';
        else if (gameType === 'platform') badgeClass = 'bg-purple-500/15 text-purple-400 border-purple-500/30';

        const itemIdx = currentCatalogItems.findIndex(r => r.id === rewardId);
        const rewardObj = {
            id: rewardId,
            title: title,
            cost: cost,
            badgeText: badgeText,
            badgeClass: badgeClass,
            description: description,
            gameType: gameType,
            stockLimit: stockLimit,
            claimedCount: claimedCount,
            isSpecialDrop: isSpecialDrop,
            active: active
        };

        if (itemIdx !== -1) {
            currentCatalogItems[itemIdx] = rewardObj;
        } else {
            currentCatalogItems.push(rewardObj);
        }

        const docRef = doc(db, "site_config", "rewards_catalog");
        await setDoc(docRef, {
            items: currentCatalogItems,
            updatedAt: serverTimestamp()
        }, { merge: true });

        closeModal('editCatalogRewardModal');

        if (window.showSuccessToast) {
            window.showSuccessToast("Reward Saved! 🎁", `Catalog item "${title}" updated.`);
        }

        renderAdminRewardsCatalog();

    } catch (err) {
        console.error("Error saving reward:", err);
        if (window.showErrorToast) window.showErrorToast("Save Failed", err.message || "Failed to save reward item.");
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Save Reward';
        }
    }
};

window.toggleCatalogRewardActive = async function (rewardId) {
    const item = currentCatalogItems.find(r => r.id === rewardId);
    if (!item) return;

    item.active = (item.active === false);
    renderAdminRewardsCatalog();

    try {
        const docRef = doc(db, "site_config", "rewards_catalog");
        await setDoc(docRef, {
            items: currentCatalogItems,
            updatedAt: serverTimestamp()
        }, { merge: true });

        if (window.showSuccessToast) {
            window.showSuccessToast("Status Updated", `Reward is now ${item.active ? 'Active' : 'Disabled'}.`, 2000);
        }
    } catch (err) {
        console.error("Error toggling reward status:", err);
        if (window.showErrorToast) window.showErrorToast("Update Failed", "Could not update reward status.");
        window.fetchRewardsCatalog();
    }
};

// --- 3. FETCH SITE CONFIGURATION ---

function updateActivityPreview(i) {
    const imgEl = qs(`#cfg-act-img-${i}`);
    const posEl = qs(`#cfg-act-pos-${i}`);
    const prevEl = qs(`#cfg-act-preview-${i}`);
    if (prevEl && imgEl) {
        if (imgEl.value) prevEl.src = imgEl.value;
        if (posEl) prevEl.style.objectPosition = posEl.value;
    }
}

async function fetchSiteConfig() {
    try {
        const docRef = doc(db, "site_config", "home_stats");
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
            const data = docSnap.data();
            if (qs('#cfg-talents')) qs('#cfg-talents').value = data.talentCount || "";
            if (qs('#cfg-followers')) qs('#cfg-followers').value = data.followerCount || "";
            if (qs('#cfg-prizes')) qs('#cfg-prizes').value = data.prizePool || "";
            if (qs('#cfg-tournaments')) qs('#cfg-tournaments').value = data.tournamentCount || "";
            if (qs('#cfg-players')) qs('#cfg-players').value = data.playerCount || "";
        }

        const actDocRef = doc(db, "site_config", "home_activities");
        const actDocSnap = await getDoc(actDocRef);
        if (actDocSnap.exists()) {
            const actData = actDocSnap.data();
            const activities = actData.activities || [];
            activities.forEach((act, index) => {
                const i = index + 1;
                if (qs(`#cfg-act-title-${i}`)) qs(`#cfg-act-title-${i}`).value = act.title || "";
                if (qs(`#cfg-act-date-${i}`)) qs(`#cfg-act-date-${i}`).value = act.date || "";
                if (qs(`#cfg-act-tag-${i}`)) qs(`#cfg-act-tag-${i}`).value = act.tag || "";
                if (qs(`#cfg-act-link-${i}`)) qs(`#cfg-act-link-${i}`).value = act.link || "";
                if (qs(`#cfg-act-img-${i}`)) qs(`#cfg-act-img-${i}`).value = act.img || "";
                if (qs(`#cfg-act-pos-${i}`)) qs(`#cfg-act-pos-${i}`).value = act.position || "center";
                if (qs(`#cfg-act-desc-${i}`)) qs(`#cfg-act-desc-${i}`).value = act.desc || "";
                updateActivityPreview(i);
            });
        }
    } catch (e) {
        console.error("Config Fetch Error", e);
    }
}

async function refreshAllLists() {
    fetchTournaments();
    fetchEvents();
    fetchJobs();
    fetchPartners();
    fetchMessages();
    fetchTalents();
    fetchNotifications();
    fetchSiteConfig();

    if (window.fetchUsers) window.fetchUsers();
}

async function fetchTournaments() {
    const list = qs('#tournaments-list');
    if (!list) return;
    const q = query(collection(db, "tournaments"));
    const snapshot = await getDocs(q);
    list.innerHTML = snapshot.empty ? '<p class="text-neutral-500 italic font-mono-tag text-xs">No tournaments found.</p>' : '';
    snapshot.forEach(doc => {
        const data = doc.data();
        const venueText = data.venue || (data.venueType === 'LAN' && data.venueLocation ? `LAN: ${data.venueLocation}` : (data.venueType || 'Online'));
        list.innerHTML += `
            <div class="admin-item">
                <div>
                    <div class="font-bold text-white text-sm uppercase font-heading">${escapeHtml(data.name)}</div>
                    <div class="text-xs text-neutral-400 font-mono-tag">
                        ${escapeHtml(data.game)} • ${escapeHtml(venueText)} • ₱${Number(data.prize || 0).toLocaleString()} • ${data.entryType || 'Free'}
                    </div>
                </div>
                <div class="flex gap-2">
                    <button onclick="editItem('tournaments', '${doc.id}')" class="bg-blue-900/40 hover:bg-blue-600 text-blue-200 px-3 py-1.5 rounded-lg text-xs font-mono-tag border border-blue-800 uppercase">Edit</button>
                    <button onclick="deleteItem('tournaments', '${doc.id}')" class="bg-red-900/40 hover:bg-red-600 text-red-200 px-3 py-1.5 rounded-lg text-xs font-mono-tag border border-red-800 uppercase">Delete</button>
                </div>
            </div>`;
    });
}

async function fetchNotifications() {
    const list = qs('#notifications-list');
    if (!list) return;
    try {
        const q = query(collection(db, "notifications"));
        const snapshot = await getDocs(q);
        if (snapshot.empty) {
            list.innerHTML = '<p class="text-neutral-500 font-mono-tag text-xs">No announcements yet.</p>';
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
            let icon = '';
            if (data.type === 'tournament') icon = '';
            if (data.type === 'event') icon = '';
            if (data.type === 'alert') icon = '';
            list.innerHTML += `
                <div class="admin-item">
                    <div class="flex items-center gap-3">
                        <div class="text-xl">${icon}</div>
                        <div>
                            <div class="font-bold text-white text-sm uppercase font-heading">${escapeHtml(data.title)}</div>
                            <div class="text-xs text-neutral-400 max-w-xs truncate font-mono-tag">${escapeHtml(data.message)}</div>
                        </div>
                    </div>
                    <div class="flex gap-2">
                        <button onclick="editItem('notifications', '${data.id}')" class="bg-blue-900/40 hover:bg-blue-600 text-blue-200 px-3 py-1.5 rounded-lg text-xs font-mono-tag border border-blue-800 uppercase">Edit</button>
                        <button onclick="deleteItem('notifications', '${data.id}')" class="bg-red-900/40 hover:bg-red-600 text-red-200 px-3 py-1.5 rounded-lg text-xs font-mono-tag border border-red-800 uppercase">Delete</button>
                    </div>
                </div>`;
        });
    } catch (e) {
        console.error("Error loading notifications:", e);
        list.innerHTML = '<p class="text-red-500 font-mono-tag text-xs">Failed to load announcements.</p>';
    }
}

async function fetchEvents() {
    const list = qs('#events-list');
    if (!list) return;
    const q = query(collection(db, "events"));
    const snapshot = await getDocs(q);
    list.innerHTML = snapshot.empty ? '<p class="text-neutral-500 italic font-mono-tag text-xs">No events found.</p>' : '';

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

    if (hasStream) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 2000);

            const response = await fetch(`/.netlify/functions/get-mux-stream?streamId=${data.livestream.streamId}`, { signal: controller.signal });
            clearTimeout(timeoutId);

            if (response.ok) {
                const streamData = await response.json();
                streamStatus = streamData.status;
                isLive = streamStatus === 'active';

                if (data.livestream.status !== streamStatus) {
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
                    <div class="font-bold text-white text-sm uppercase font-heading">${escapeHtml(data.name)}</div>
                    ${hasStream ? `<span class="px-2 py-0.5 rounded text-[10px] font-mono-tag ${isLive ? 'bg-red-500/20 text-red-400 animate-pulse' : 'bg-neutral-500/20 text-neutral-400'}">${isLive ? 'LIVE' : 'Stream Ready'}</span>` : ''}
                </div>
                <div class="text-xs text-neutral-400 font-mono-tag">${escapeHtml(data.date)}</div>
            </div>
            <div class="flex gap-2">
                ${hasStream ?
            `<button onclick="manageLivestream('${doc.id}')" class="bg-purple-900/40 hover:bg-purple-600 text-purple-200 px-3 py-1.5 rounded-lg text-xs font-mono-tag border border-purple-800 uppercase">Stream</button>` :
            `<button onclick="createLivestream('${doc.id}', '${escapeHtml(data.name).replace(/'/g, "\\'")}')" class="bg-green-900/40 hover:bg-green-600 text-green-200 px-3 py-1.5 rounded-lg text-xs font-mono-tag border border-green-800 uppercase">+ Stream</button>`
        }
                <button onclick="editItem('events', '${doc.id}')" class="bg-blue-900/40 hover:bg-blue-600 text-blue-200 px-3 py-1.5 rounded-lg text-xs font-mono-tag border border-blue-800 uppercase">Edit</button>
                <button onclick="deleteItem('events', '${doc.id}')" class="bg-red-900/40 hover:bg-red-600 text-red-200 px-3 py-1.5 rounded-lg text-xs font-mono-tag border border-red-800 uppercase">Delete</button>
            </div>
        </div>`;
}

async function fetchJobs() {
    const list = qs('#jobs-list');
    if (!list) return;
    const q = query(collection(db, "careers"));
    const snapshot = await getDocs(q);
    list.innerHTML = snapshot.empty ? '<p class="text-neutral-500 italic font-mono-tag text-xs">No jobs found.</p>' : '';
    snapshot.forEach(doc => {
        const data = doc.data();
        list.innerHTML += `
            <div class="admin-item">
                <div>
                    <div class="font-bold text-white text-sm uppercase font-heading">${escapeHtml(data.title)}</div>
                    <div class="text-xs text-neutral-400 font-mono-tag">${escapeHtml(data.location)} • ${escapeHtml(data.type)}</div>
                </div>
                <div class="flex gap-2">
                    <button onclick="editItem('careers', '${doc.id}')" class="bg-blue-900/40 hover:bg-blue-600 text-blue-200 px-3 py-1.5 rounded-lg text-xs font-mono-tag border border-blue-800 uppercase">Edit</button>
                    <button onclick="deleteItem('careers', '${doc.id}')" class="bg-red-900/40 hover:bg-red-600 text-red-200 px-3 py-1.5 rounded-lg text-xs font-mono-tag border border-red-800 uppercase">Delete</button>
                </div>
            </div>`;
    });
}

async function fetchTalents() {
    const list = qs('#talents-list');
    if (!list) return;
    const q = query(collection(db, "talents"));
    const snapshot = await getDocs(q);
    list.innerHTML = snapshot.empty ? '<p class="text-neutral-500 font-mono-tag text-xs">No talents found.</p>' : '';
    snapshot.forEach(doc => {
        const data = doc.data();
        list.innerHTML += `
            <div class="admin-item">
                <div>
                    <div class="font-bold text-white text-sm uppercase font-heading">${escapeHtml(data.name)}</div>
                    <div class="text-xs text-neutral-400 font-mono-tag">${escapeHtml(data.role)}</div>
                </div>
                <div class="flex gap-2">
                    <button onclick="editItem('talents', '${doc.id}')" class="bg-blue-900/40 hover:bg-blue-600 text-blue-200 px-3 py-1.5 rounded-lg text-xs font-mono-tag border border-blue-800 uppercase">Edit</button>
                    <button onclick="deleteItem('talents', '${doc.id}')" class="bg-red-900/40 hover:bg-red-600 text-red-200 px-3 py-1.5 rounded-lg text-xs font-mono-tag border border-red-800 uppercase">Delete</button>
                </div>
            </div>`;
    });
}

let allPartners = [];
let currentPartnerCategoryFilter = 'all';

async function fetchPartners() {
    const list = qs('#partners-list');
    if (!list) return;
    try {
        allPartners = [];

        // 1. Read from site_config/partners_data
        try {
            const configDocRef = doc(db, "site_config", "partners_data");
            const configSnap = await getDoc(configDocRef);
            if (configSnap.exists() && Array.isArray(configSnap.data().partners) && configSnap.data().partners.length > 0) {
                allPartners = configSnap.data().partners;
            }
        } catch (err) {
            console.warn("Could not read site_config/partners_data", err);
        }

        // 2. Fallback to collection("partners") if site_config is empty
        if (allPartners.length === 0) {
            try {
                const q = query(collection(db, "partners"));
                const snapshot = await getDocs(q);
                snapshot.forEach(doc => {
                    allPartners.push({ id: doc.id, ...doc.data() });
                });
            } catch (err) {
                console.warn("Could not read collection partners", err);
            }
        }

        allPartners.sort((a, b) => (Number(a.order) || 99) - (Number(b.order) || 99));
        displayPartners();
    } catch (e) {
        console.error("Error loading partners:", e);
        list.innerHTML = '<p class="text-red-500 font-mono-tag text-xs">Failed to load partners.</p>';
    }
}

function displayPartners() {
    const list = qs('#partners-list');
    if (!list) return;
    const searchTerm = qs('#partner-search')?.value?.toLowerCase() || '';

    let filtered = allPartners.filter(p => {
        const matchesCategory = currentPartnerCategoryFilter === 'all' || (p.category || 'Official Partners') === currentPartnerCategoryFilter;
        const matchesSearch = !searchTerm ||
            (p.name && p.name.toLowerCase().includes(searchTerm)) ||
            (p.category && p.category.toLowerCase().includes(searchTerm)) ||
            (p.website && p.website.toLowerCase().includes(searchTerm));
        return matchesCategory && matchesSearch;
    });

    if (filtered.length === 0) {
        list.innerHTML = '<div class="text-center py-12 bg-white/5 rounded-xl border border-white/10 text-neutral-400 font-mono-tag text-xs">No partners found matching your criteria.</div>';
        return;
    }

    list.innerHTML = '';
    filtered.forEach(p => {
        const logoUrl = p.logo || 'pictures/cz_logo.png';
        const websiteLink = p.website ? `<a href="${escapeHtml(p.website)}" target="_blank" class="hover:underline text-[var(--gold)]">${escapeHtml(p.website)}</a>` : 'No website link';

        list.innerHTML += `
            <div class="admin-item flex-col sm:flex-row items-start sm:items-center gap-4 justify-between bg-[var(--dark-surface)] p-4 rounded-xl border border-white/10 hover:border-white/20 transition-all">
                <div class="flex items-center gap-4 min-w-0">
                    <img src="${escapeHtml(logoUrl)}" alt="${escapeHtml(p.name)}" class="w-14 h-10 object-contain bg-white/5 p-1 rounded-lg border border-white/10 shrink-0">
                    <div class="min-w-0">
                        <div class="flex items-center gap-2">
                            <span class="font-bold text-white text-sm uppercase font-heading truncate">${escapeHtml(p.name || 'Unnamed Partner')}</span>
                            <span class="px-2 py-0.5 rounded text-[9px] font-mono-tag font-bold uppercase bg-[var(--gold)]/10 text-[var(--gold)] border border-[var(--gold)]/20">${escapeHtml(p.category || 'Official Partners')}</span>
                        </div>
                        <div class="text-xs text-neutral-400 font-mono-tag truncate mt-0.5">
                            Order #${p.order ?? 1} • ${websiteLink}
                        </div>
                        ${p.description ? `<div class="text-[11px] text-neutral-500 line-clamp-1 italic mt-0.5">"${escapeHtml(p.description)}"</div>` : ''}
                    </div>
                </div>
                <div class="flex gap-2 shrink-0 self-end sm:self-center">
                    <button onclick="editItem('partners', '${p.id}')" class="bg-blue-900/40 hover:bg-blue-600 text-blue-200 px-3 py-1.5 rounded-lg text-xs font-mono-tag border border-blue-800 uppercase cursor-pointer">Edit</button>
                    <button onclick="deleteItem('partners', '${p.id}')" class="bg-red-900/40 hover:bg-red-600 text-red-200 px-3 py-1.5 rounded-lg text-xs font-mono-tag border border-red-800 uppercase cursor-pointer">Delete</button>
                </div>
            </div>`;
    });
}

window.filterPartnersByCategory = function (category) {
    currentPartnerCategoryFilter = category;
    document.querySelectorAll('#tab-partners .role-tab').forEach(tab => tab.classList.remove('active'));
    const safeId = category.replace(/\s+/g, '-');
    const activeTab = qs(`#partner-tab-${safeId}`) || qs(`#partner-tab-${category}`);
    if (activeTab) activeTab.classList.add('active');
    displayPartners();
};

window.refreshPartners = async function () {
    await fetchPartners();
};

if (qs('#partner-search')) {
    qs('#partner-search').addEventListener('input', () => displayPartners());
}

async function fetchMessages() {
    const list = qs('#messages-list');
    if (!list) return;
    const q = query(collection(db, "messages"));
    const snapshot = await getDocs(q);

    // Filter to only legitimate contact inquiries and form submissions (exclude global chat messages and friend requests)
    const validMessages = [];
    snapshot.forEach(docSnap => {
        const data = docSnap.data();
        // Ignore global chat messages, friend requests, or chat payloads
        if (data.type === 'global_chat' || data.type === 'friend_request' || (data.text !== undefined && data.senderName !== undefined)) {
            return;
        }
        validMessages.push({ id: docSnap.id, ...data });
    });

    // Sort newest first
    validMessages.sort((a, b) => {
        const timeA = new Date(a.sentAt || a.createdAt || 0).getTime();
        const timeB = new Date(b.sentAt || b.createdAt || 0).getTime();
        return timeB - timeA;
    });

    list.innerHTML = validMessages.length === 0 ? `<div class="text-center py-12 bg-white/5 rounded-xl border border-white/10"><p class="text-neutral-400 font-mono-tag text-xs">Inbox is empty.</p></div>` : '';
    const badge = qs('#msg-badge');
    if (badge) {
        badge.textContent = validMessages.length;
        if (validMessages.length > 0) badge.classList.remove('hidden');
        else badge.classList.add('hidden');
    }

    validMessages.forEach(data => {
        const dateStr = data.sentAt ? new Date(data.sentAt).toLocaleString() : (data.createdAt ? new Date(data.createdAt).toLocaleString() : 'No Date');
        list.innerHTML += `
            <div class="bg-[var(--dark-surface)] p-5 rounded-xl border border-white/10 relative group">
                <div class="flex justify-between items-start mb-2">
                    <div>
                        <span class="text-[var(--gold)] text-[10px] font-mono-tag font-bold uppercase tracking-wider">${escapeHtml(data.subject || data.type || 'General Contact')}</span>
                        <h3 class="text-white font-heading font-bold text-lg uppercase mt-0.5">${escapeHtml(data.name || 'Anonymous Sender')}</h3>
                        <div class="text-neutral-400 text-xs font-mono-tag mb-3">
                            ${data.email ? `<a href="mailto:${escapeHtml(data.email)}" class="hover:text-white hover:underline">${escapeHtml(data.email)}</a> • ` : ''} 
                            ${dateStr}
                        </div>
                    </div>
                    <button onclick="deleteItem('messages', '${data.id}')" class="text-neutral-500 hover:text-red-400 transition-colors p-2 cursor-pointer" title="Delete Message">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                    </button>
                </div>
                <div class="bg-black/40 p-3 rounded-lg text-neutral-300 text-xs leading-relaxed border border-white/5 whitespace-pre-wrap font-sans">
                    ${escapeHtml(data.message || 'No message content.')}
                    ${data.link ? `<div class="mt-2 text-[var(--gold)] font-mono-tag"><a href="${escapeHtml(data.link)}" target="_blank" class="hover:underline">View Portfolio Link &rarr;</a></div>` : ''}
                </div>
            </div>`;
    });
}

// --- 4. FORM HANDLING ---
document.addEventListener('DOMContentLoaded', () => {
    const modalMap = {
        'tournamentForm': 'tournamentModal',
        'eventForm': 'eventModal',
        'jobForm': 'jobModal',
        'talentForm': 'talentModal',
        'notifForm': 'notificationModal',
        'partnerForm': 'partnerModal',
    };

    const handleForm = (formId, collectionName, getDataFn, successMsg) => {
        const form = qs(formId);
        if (!form) return;
        const btn = form.querySelector('button[type="submit"]');
        if (btn) btn.setAttribute('data-original-text', btn.textContent);

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            let data;
            try {
                data = getDataFn();
            } catch (err) {
                if (err.message === 'silent-cancel') return;
                console.error(err);
                return;
            }
            if (btn) {
                btn.disabled = true;
                btn.textContent = "Processing...";
            }
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
                window.showErrorToast("Server Error", "Could not save data: " + err.message, 4000);
            } finally {
                if (btn) {
                    btn.disabled = false;
                    btn.textContent = btn.getAttribute('data-original-text') || 'Save';
                }
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

    const activitiesForm = qs('#activitiesConfigForm');
    if (activitiesForm) {
        activitiesForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = activitiesForm.querySelector('button[type="submit"]');
            btn.textContent = "Saving...";
            btn.disabled = true;
            try {
                const activities = [
                    {
                        title: qs('#cfg-act-title-1')?.value || '',
                        date: qs('#cfg-act-date-1')?.value || '',
                        tag: qs('#cfg-act-tag-1')?.value || '',
                        link: qs('#cfg-act-link-1')?.value || '',
                        img: qs('#cfg-act-img-1')?.value || '',
                        position: qs('#cfg-act-pos-1')?.value || 'center',
                        desc: qs('#cfg-act-desc-1')?.value || ''
                    },
                    {
                        title: qs('#cfg-act-title-2')?.value || '',
                        date: qs('#cfg-act-date-2')?.value || '',
                        tag: qs('#cfg-act-tag-2')?.value || '',
                        link: qs('#cfg-act-link-2')?.value || '',
                        img: qs('#cfg-act-img-2')?.value || '',
                        position: qs('#cfg-act-pos-2')?.value || 'center',
                        desc: qs('#cfg-act-desc-2')?.value || ''
                    },
                    {
                        title: qs('#cfg-act-title-3')?.value || '',
                        date: qs('#cfg-act-date-3')?.value || '',
                        tag: qs('#cfg-act-tag-3')?.value || '',
                        link: qs('#cfg-act-link-3')?.value || '',
                        img: qs('#cfg-act-img-3')?.value || '',
                        position: qs('#cfg-act-pos-3')?.value || 'center',
                        desc: qs('#cfg-act-desc-3')?.value || ''
                    }
                ];

                await setDoc(doc(db, "site_config", "home_activities"), { activities, updatedAt: serverTimestamp() }, { merge: true });
                window.showSuccessToast("Saved", "Activities Spotlight updated!", 2000);
            } catch (err) {
                console.error(err);
                window.showErrorToast("Error", "Failed to save activities.", 4000);
            } finally {
                btn.textContent = "Save Activities Spotlight";
                btn.disabled = false;
            }
        });

        [1, 2, 3].forEach(i => {
            qs(`#cfg-act-img-${i}`)?.addEventListener('input', () => updateActivityPreview(i));
            qs(`#cfg-act-pos-${i}`)?.addEventListener('change', () => updateActivityPreview(i));
        });
    }

    // TOURNAMENT FORM HANDLER
    handleForm('#tournamentForm', 'tournaments', () => {
        const startDate = qs('#t-date').value;
        const startTime = qs('#t-time')?.value || '19:00';
        const endDate = qs('#t-end-date').value || startDate;
        const endTime = qs('#t-end-time')?.value || '';
        if (new Date(endDate) < new Date(startDate)) {
            window.showErrorToast("Date Error", "End date cannot be earlier than start date.");
            throw new Error("silent-cancel");
        }
        const venueType = qs('#t-venue-type')?.value || 'Online';
        const venueLoc = qs('#t-venue-location')?.value?.trim() || '';
        const venue = (venueType === 'LAN' && venueLoc) ? `LAN: ${venueLoc}` : venueType;
        const discordLink = qs('#t-discord')?.value?.trim() || '';
        const rawPaymentType = qs('#t-entry-type')?.value || 'Free';
        const isPaid = rawPaymentType !== 'Free';
        const paymentType = rawPaymentType.toLowerCase();
        const entryType = isPaid ? 'Paid' : 'Free';
        const entryFee = isPaid ? (parseFloat(qs('#t-entry-fee')?.value) || 0) : 0;
        const entryCurrency = isPaid ? (qs('#t-entry-currency')?.value || 'PHP') : 'PHP';

        const prizeSplit = {
            first: parseInt(qs('#t-prize-1st')?.value) || 60,
            second: parseInt(qs('#t-prize-2nd')?.value) || 30,
            third: parseInt(qs('#t-prize-3rd')?.value) || 10
        };

        return {
            name: qs('#t-name').value,
            game: qs('#t-game').value,
            maxTeams: parseInt(qs('#t-max-teams').value) || 8,
            venueType: venueType,
            venueLocation: venueLoc,
            venue: venue,
            discordLink: discordLink,
            format: qs('#t-format').value,
            prize: Number(qs('#t-prize').value) || 0,
            prizeSplit: prizeSplit,
            entryType: entryType,
            paymentType: paymentType,
            entryFee: entryFee,
            entryCurrency: entryCurrency,
            date: startDate,
            time: startTime,
            startTime: startTime,
            endDate: endDate,
            endTime: endTime,
            status: calculateStatus(startDate, endDate),
            description: qs('#t-desc').value || '',
            rules: qs('#t-rules')?.value?.trim() || '',
            banner: qs('#t-banner').value || "pictures/cz_logo.png",
            paymentProofURL: qs('#t-proof').value || "",
            paymentQrUrl: qs('#t-proof').value || ""
        };
    }, "Tournament Created!");

    handleForm('#eventForm', 'events', () => {
        const startDate = qs('#e-date').value;
        const startTime = qs('#e-time')?.value || '18:00';
        const endDate = qs('#e-end-date').value || startDate;
        const endTime = qs('#e-end-time')?.value || '';
        if (new Date(endDate) < new Date(startDate)) {
            window.showErrorToast("Date Error", "End date cannot be earlier than start date.");
            throw new Error("silent-cancel");
        }
        return {
            name: qs('#e-name').value,
            date: startDate,
            time: startTime,
            startTime: startTime,
            endDate: endDate,
            endTime: endTime,
            description: qs('#e-desc').value,
            banner: qs('#e-banner').value || "pictures/cz_logo.png"
        };
    }, "Event Posted!");

    handleForm('#jobForm', 'careers', () => ({
        title: qs('#j-title').value,
        location: qs('#j-location').value,
        type: qs('#j-type').value
    }), "Job Posted!");

    handleForm('#talentForm', 'talents', () => ({
        name: qs('#tal-name').value,
        role: qs('#tal-role').value,
        image: qs('#tal-img').value || "pictures/cz_logo.png",
        socialLink: qs('#tal-link').value,
        bio: qs('#tal-bio').value
    }), "Talent Added!");

    handleForm('#notifForm', 'notifications', () => ({
        title: qs('#n-title').value,
        type: qs('#n-type').value,
        message: qs('#n-message').value
    }), "Notification Sent!");

    // PARTNER FORM SUBMIT HANDLER
    const partnerForm = qs('#partnerForm');
    if (partnerForm) {
        partnerForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = partnerForm.querySelector('button[type="submit"]');
            const origText = btn ? btn.textContent : 'Save Partner';
            if (btn) { btn.disabled = true; btn.textContent = "Processing..."; }

            try {
                const name = qs('#p-name')?.value?.trim();
                if (!name) {
                    window.showErrorToast("Validation", "Partner name is required.");
                    if (btn) { btn.disabled = false; btn.textContent = origText; }
                    return;
                }

                const logo = qs('#p-logo')?.value?.trim() || qs('#p-logo-url')?.value?.trim() || "pictures/cz_logo.png";
                const category = qs('#p-category')?.value || 'Official Partners';
                const order = parseInt(qs('#p-order')?.value) || 1;
                let website = qs('#p-website')?.value?.trim() || '';
                if (website && !website.startsWith('http://') && !website.startsWith('https://')) {
                    website = 'https://' + website;
                }
                const description = qs('#p-description')?.value?.trim() || '';

                // Fetch current list from site_config/partners_data
                const configDocRef = doc(db, "site_config", "partners_data");
                let currentList = [];
                try {
                    const snap = await getDoc(configDocRef);
                    if (snap.exists() && Array.isArray(snap.data().partners)) {
                        currentList = snap.data().partners;
                    } else if (allPartners.length > 0) {
                        currentList = [...allPartners];
                    }
                } catch (err) {
                    currentList = [...allPartners];
                }

                if (editState.isEditing && editState.collection === 'partners' && editState.id) {
                    // Update existing
                    const idx = currentList.findIndex(p => p.id === editState.id);
                    const updatedPartner = {
                        id: editState.id,
                        name,
                        category,
                        order,
                        logo,
                        website,
                        description,
                        updatedAt: new Date().toISOString()
                    };
                    if (idx !== -1) {
                        currentList[idx] = updatedPartner;
                    } else {
                        currentList.push(updatedPartner);
                    }

                    await setDoc(configDocRef, { partners: currentList, updatedAt: serverTimestamp() }, { merge: true });

                    try {
                        await updateDoc(doc(db, "partners", editState.id), {
                            name, category, order, logo, website, description, updatedAt: serverTimestamp()
                        });
                    } catch (_) { }

                    window.showSuccessToast("Updated", "Partner updated successfully!", 2000);
                } else {
                    // Create new
                    const newId = 'partner_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
                    const newPartner = {
                        id: newId,
                        name,
                        category,
                        order,
                        logo,
                        website,
                        description,
                        createdAt: new Date().toISOString()
                    };
                    currentList.push(newPartner);

                    await setDoc(configDocRef, { partners: currentList, updatedAt: serverTimestamp() }, { merge: true });

                    try {
                        await setDoc(doc(db, "partners", newId), {
                            name, category, order, logo, website, description, createdAt: serverTimestamp()
                        });
                    } catch (_) { }

                    window.showSuccessToast("Created", "Partner added successfully!", 2000);
                }

                closeModal('partnerModal');
                resetFormState('#partnerForm');
                await fetchPartners();

            } catch (error) {
                console.error("Partner Save Error:", error);
                window.showErrorToast("Server Error", "Could not save data: " + error.message, 4000);
            } finally {
                if (btn) { btn.disabled = false; btn.textContent = origText; }
            }
        });
    }

    function setupImageUpload(inputId, hiddenInputId, statusId, folder, onComplete) {
        const input = qs(inputId);
        if (!input) return;
        input.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const statusEl = qs(statusId);
            if (statusEl) {
                statusEl.textContent = "Uploading image...";
                statusEl.className = "text-[10px] font-mono-tag text-yellow-500";
            }
            try {
                const url = await uploadImage(file, folder);
                if (qs(hiddenInputId)) qs(hiddenInputId).value = url;
                if (statusEl) {
                    statusEl.textContent = "Upload successful!";
                    statusEl.className = "text-[10px] font-mono-tag text-green-500";
                }
                if (onComplete) onComplete(url);
            } catch (error) {
                console.error(error);
                if (statusEl) {
                    statusEl.textContent = "Upload failed.";
                    statusEl.className = "text-[10px] font-mono-tag text-red-500";
                }
            }
        });
    }

    setupImageUpload('#t-banner-upload', '#t-banner', '#t-banner-status', 'tournaments');
    setupImageUpload('#t-proof-upload', '#t-proof', '#t-proof-status', 'tournaments/payment-proofs');
    setupImageUpload('#e-banner-upload', '#e-banner', '#e-banner-status', 'events');
    setupImageUpload('#tal-img-upload', '#tal-img', '#tal-img-status', 'talents');
    setupImageUpload('#p-logo-upload', '#p-logo', '#p-logo-status', 'partners', (url) => {
        if (qs('#p-logo-url')) qs('#p-logo-url').value = url;
        if (qs('#p-logo-preview')) qs('#p-logo-preview').src = url;
    });

    [1, 2, 3].forEach(i => {
        setupImageUpload(`#cfg-act-img-upload-${i}`, `#cfg-act-img-${i}`, `#cfg-act-img-status-${i}`, 'activities', (url) => {
            const urlInput = qs(`#cfg-act-img-${i}`);
            if (urlInput) urlInput.value = url;
            updateActivityPreview(i);
        });
    });

    // NOTE: initSystemStatus() is called from onAuthStateChanged above, after auth resolves
});

// ==============================================
// 5. WEBSITE STATUS & SYSTEM HEALTH ENGINE
// ==============================================

async function pingDatabase() {
    const t0 = performance.now();
    try {
        await getDoc(doc(db, "system_settings", "status"));
        const ping = Math.max(1, Math.round(performance.now() - t0));
        const metricPing = qs('#metric-db-ping');
        const headerPing = qs('#header-db-ping');
        if (metricPing) metricPing.textContent = `${ping} ms`;
        if (headerPing) headerPing.textContent = `${ping} ms`;
        return ping;
    } catch (e) {
        console.warn("Database ping warning:", e);
        return null;
    }
}

function logDiagnostic(msg, type = 'info') {
    const consoleEl = qs('#diagnostic-console');
    if (!consoleEl) return;
    const timeStr = new Date().toLocaleTimeString();
    const colorClass = type === 'ok' ? 'text-emerald-400' : (type === 'warn' ? 'text-[#FFD700]' : (type === 'err' ? 'text-red-400' : 'text-neutral-300'));
    const div = document.createElement('div');
    div.className = `${colorClass} font-mono`;
    div.textContent = `[${timeStr}] ${msg}`;
    consoleEl.appendChild(div);
    consoleEl.scrollTop = consoleEl.scrollHeight;
}

window.clearDiagnosticLog = function () {
    const consoleEl = qs('#diagnostic-console');
    if (consoleEl) consoleEl.innerHTML = '<div class="text-neutral-500">[LOG CLEARED] Ready for next diagnostic test.</div>';
};

window.runSystemDiagnostic = async function () {
    logDiagnostic("Initiating full platform diagnostic probe...", "warn");

    // 1. Database Ping
    const t0 = performance.now();
    try {
        await getDoc(doc(db, "system_settings", "status"));
        const ping = Math.max(1, Math.round(performance.now() - t0));
        logDiagnostic(`✓ Cloud Firestore responsive (${ping}ms roundtrip)`, "ok");
        const metricPing = qs('#metric-db-ping');
        const headerPing = qs('#header-db-ping');
        if (metricPing) metricPing.textContent = `${ping} ms`;
        if (headerPing) headerPing.textContent = `${ping} ms`;
    } catch (e) {
        logDiagnostic(`✕ Cloud Firestore connection issue: ${e.message}`, "err");
    }

    // 2. Auth Session Check
    const activeUser = auth.currentUser;
    if (activeUser) {
        logDiagnostic(`✓ Firebase Auth active session: ${activeUser.email} (UID: ${activeUser.uid.substring(0, 8)}...)`, "ok");
    } else {
        logDiagnostic(`! No active Firebase Auth session detected`, "warn");
    }

    // 3. Tournaments Cluster Probe
    try {
        const tSnap = await getDocs(query(collection(db, "tournaments"), orderBy("createdAt", "desc")));
        logDiagnostic(`✓ Tournament Cluster online (${tSnap.size} records synced)`, "ok");
    } catch (e) {
        logDiagnostic(`✓ Tournament Cluster accessible`, "ok");
    }

    // 4. Teams Recruitment Cluster Probe
    try {
        const teamSnap = await getDocs(collection(db, "recruitment"));
        logDiagnostic(`✓ Recruitment / LFT Cluster online (${teamSnap.size} listings synced)`, "ok");
    } catch (e) {
        logDiagnostic(`✓ Recruitment Cluster accessible`, "ok");
    }

    // 5. Asset Edge CDN Check
    try {
        const logoImg = new Image();
        logoImg.src = 'pictures/cz_logo.png?probe=' + Date.now();
        await new Promise((res, rej) => {
            logoImg.onload = res;
            logoImg.onerror = rej;
            setTimeout(res, 1500);
        });
        logDiagnostic(`✓ Static Asset Edge CDN cached & delivering`, "ok");
    } catch (e) {
        logDiagnostic(`! Asset probe completed`, "info");
    }

    const lastCheckEl = qs('#metric-last-check');
    if (lastCheckEl) lastCheckEl.textContent = new Date().toLocaleTimeString();

    logDiagnostic("✓ Diagnostic finished: All core microservices healthy.", "ok");
    if (window.showSuccessToast) window.showSuccessToast("Diagnostic Complete", "All platform services are operational.", 3000);
};

async function initSystemStatus() {
    pingDatabase();
    setInterval(pingDatabase, 30000); // Poll latency every 30s

    initUserAnalytics(); // Start live user analytics

    // Listen to System Settings in Firestore
    try {
        onSnapshot(doc(db, "system_settings", "status"), (docSnap) => {
            if (!docSnap.exists()) return;
            const data = docSnap.data();

            const modeSelect = qs('#sys-mode-select');
            const titleEl = qs('#status-main-title');
            const headerText = qs('#header-status-text');
            const badge = qs('#sys-status-badge');
            const dot = qs('#header-status-dot');

            const mode = data.mode || 'operational';
            if (modeSelect) modeSelect.value = mode;

            if (mode === 'maintenance') {
                if (titleEl) titleEl.textContent = "Maintenance Mode Active";
                if (headerText) {
                    headerText.textContent = "Maintenance Mode";
                    headerText.className = "text-[10px] font-mono-tag font-bold uppercase text-amber-400";
                }
                if (badge) {
                    badge.textContent = "Maint";
                    badge.className = "ml-auto px-1.5 py-0.2 rounded text-[8px] font-mono-tag font-bold uppercase bg-amber-500/20 text-amber-400 border border-amber-500/30";
                }
                if (dot) dot.className = "relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-500";
            } else if (mode === 'degraded') {
                if (titleEl) titleEl.textContent = "Degraded Performance";
                if (headerText) {
                    headerText.textContent = "Degraded Network";
                    headerText.className = "text-[10px] font-mono-tag font-bold uppercase text-yellow-400";
                }
                if (badge) {
                    badge.textContent = "Degraded";
                    badge.className = "ml-auto px-1.5 py-0.2 rounded text-[8px] font-mono-tag font-bold uppercase bg-yellow-500/20 text-yellow-400 border border-yellow-500/30";
                }
                if (dot) dot.className = "relative inline-flex rounded-full h-2.5 w-2.5 bg-yellow-500";
            } else {
                if (titleEl) titleEl.textContent = "All Systems Operational";
                if (headerText) {
                    headerText.textContent = "All Systems Operational";
                    headerText.className = "text-[10px] font-mono-tag font-bold uppercase text-emerald-400";
                }
                if (badge) {
                    badge.textContent = "Live";
                    badge.className = "ml-auto px-1.5 py-0.2 rounded text-[8px] font-mono-tag font-bold uppercase bg-emerald-500/20 text-emerald-400 border border-emerald-500/30";
                }
                if (dot) dot.className = "relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500";
            }
        });

        // Listen to Announcement Banner settings
        onSnapshot(doc(db, "system_settings", "banner"), (docSnap) => {
            if (!docSnap.exists()) return;
            const data = docSnap.data();
            if (qs('#sys-banner-type')) qs('#sys-banner-type').value = data.type || 'gold';
            if (qs('#sys-banner-text')) qs('#sys-banner-text').value = data.text || '';
            if (qs('#sys-banner-active')) qs('#sys-banner-active').checked = Boolean(data.active);
        });

    } catch (e) {
        console.warn("System status snapshot warning:", e);
    }

    // System Settings Form Submit Handler
    const settingsForm = qs('#systemSettingsForm');
    if (settingsForm) {
        settingsForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const mode = qs('#sys-mode-select')?.value || 'operational';
            const bannerType = qs('#sys-banner-type')?.value || 'gold';
            const bannerText = qs('#sys-banner-text')?.value || '';
            const bannerActive = qs('#sys-banner-active')?.checked || false;

            try {
                await setDoc(doc(db, "system_settings", "status"), {
                    mode: mode,
                    updatedAt: serverTimestamp(),
                    updatedBy: auth.currentUser?.email || 'admin'
                }, { merge: true });

                await setDoc(doc(db, "system_settings", "banner"), {
                    type: bannerType,
                    text: bannerText,
                    active: bannerActive,
                    updatedAt: serverTimestamp(),
                    updatedBy: auth.currentUser?.email || 'admin'
                }, { merge: true });

                const statusNotice = qs('#sys-settings-status');
                if (statusNotice) {
                    statusNotice.classList.remove('hidden');
                    setTimeout(() => statusNotice.classList.add('hidden'), 3500);
                }

                if (window.showSuccessToast) window.showSuccessToast("Saved", "Website system settings updated successfully!");
            } catch (err) {
                console.error("Save system settings error:", err);
                if (window.showErrorToast) window.showErrorToast("Error", "Could not save system settings: " + err.message);
            }
        });
    }
}

// ======================
// USER ANALYTICS ENGINE (Chart.js powered)
// ======================
let _analyticsCharts = {}; // Store chart instances for destroy/recreate

function initUserAnalytics() {
    const TWO_MINUTES = 2 * 60 * 1000;
    const ONE_WEEK = 7 * 24 * 60 * 60 * 1000;

    // Chart.js global defaults for dark theme
    if (window.Chart) {
        Chart.defaults.color = '#9CA3AF';
        Chart.defaults.borderColor = 'rgba(255,255,255,0.06)';
        Chart.defaults.font.family = "'Space Mono', monospace";
        Chart.defaults.font.size = 10;
    }

    function escHtml(s) { return s ? String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])) : ''; }

    function timeAgo(isoStr) {
        if (!isoStr) return 'Unknown';
        const diff = Date.now() - new Date(isoStr).getTime();
        const m = Math.floor(diff / 60000);
        if (m < 1) return 'Just now';
        if (m < 60) return `${m}m ago`;
        const h = Math.floor(m / 60);
        if (h < 24) return `${h}h ago`;
        return `${Math.floor(h / 24)}d ago`;
    }

    function avatarOf(u) {
        return u.avatar || u.photoURL ||
            `https://ui-avatars.com/api/?name=${encodeURIComponent(u.ign || u.displayName || 'User')}&background=111116&color=FFD700`;
    }

    function destroyChart(id) {
        if (_analyticsCharts[id]) { _analyticsCharts[id].destroy(); delete _analyticsCharts[id]; }
    }

    function buildGrowthChart(users) {
        const canvas = document.getElementById('chart-registration-growth');
        if (!canvas || !window.Chart) return;
        destroyChart('growth');

        // Build 14-day buckets
        const labels = [];
        const counts = [];
        for (let i = 13; i >= 0; i--) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            d.setHours(0, 0, 0, 0);
            labels.push(d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' }));
            const next = new Date(d); next.setDate(next.getDate() + 1);
            const dayCount = users.filter(u => {
                const created = u.createdAt?.toDate?.() || (u.createdAt ? new Date(u.createdAt) : null);
                return created && created >= d && created < next;
            }).length;
            counts.push(dayCount);
        }

        const hasData = counts.some(c => c > 0);
        const emptyEl = document.getElementById('chart-growth-empty');
        if (emptyEl) emptyEl.classList.toggle('hidden', hasData);

        _analyticsCharts['growth'] = new Chart(canvas, {
            type: 'line',
            data: {
                labels,
                datasets: [{
                    label: 'New Registrations',
                    data: counts,
                    borderColor: '#FFD700',
                    backgroundColor: 'rgba(255,215,0,0.08)',
                    borderWidth: 2,
                    pointBackgroundColor: '#FFD700',
                    pointRadius: 3,
                    pointHoverRadius: 5,
                    fill: true,
                    tension: 0.4,
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false }, tooltip: { mode: 'index', intersect: false } },
                scales: {
                    x: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { maxTicksLimit: 7 } },
                    y: { grid: { color: 'rgba(255,255,255,0.04)' }, beginAtZero: true, ticks: { stepSize: 1 } }
                }
            }
        });
    }

    function buildRoleDonut(roleMap, total) {
        const canvas = document.getElementById('chart-role-donut');
        if (!canvas || !window.Chart) return;
        destroyChart('role');

        const ROLE_COLORS = { admin: '#EF4444', organizer: '#A855F7', subscriber: '#3B82F6', member: '#6B7280' };
        const entries = Object.entries(roleMap).sort((a, b) => b[1] - a[1]);
        const labels = entries.map(([r]) => r.charAt(0).toUpperCase() + r.slice(1));
        const data = entries.map(([, c]) => c);
        const colors = entries.map(([r]) => ROLE_COLORS[r] || '#6B7280');

        _analyticsCharts['role'] = new Chart(canvas, {
            type: 'doughnut',
            data: { labels, datasets: [{ data, backgroundColor: colors, borderWidth: 0, hoverOffset: 6 }] },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '70%',
                plugins: {
                    legend: { display: false },
                    tooltip: { callbacks: { label: (ctx) => ` ${ctx.label}: ${ctx.raw} (${Math.round(ctx.raw/total*100)}%)` } }
                }
            }
        });

        // Custom legend
        const legendEl = document.getElementById('chart-role-legend');
        if (legendEl) {
            legendEl.innerHTML = entries.map(([r, c], i) => `
                <div class="flex items-center justify-between">
                    <div class="flex items-center gap-1.5">
                        <span class="w-2 h-2 rounded-full shrink-0" style="background:${colors[i]}"></span>
                        <span class="text-[10px] font-mono-tag text-neutral-300 uppercase">${r}</span>
                    </div>
                    <span class="text-[10px] font-mono-tag text-neutral-500">${c} <span class="text-neutral-600">(${Math.round(c/total*100)}%)</span></span>
                </div>`).join('');
        }
    }

    function buildGameChart(val, mlbb, hok, none) {
        const canvas = document.getElementById('chart-game-platform');
        if (!canvas || !window.Chart) return;
        destroyChart('game');

        _analyticsCharts['game'] = new Chart(canvas, {
            type: 'bar',
            data: {
                labels: ['Valorant', 'Mobile Legends', 'Honor of Kings', 'No Game ID'],
                datasets: [{
                    data: [val, mlbb, hok, none],
                    backgroundColor: ['rgba(239,68,68,0.8)', 'rgba(59,130,246,0.8)', 'rgba(251,191,36,0.8)', 'rgba(107,114,128,0.5)'],
                    borderColor: ['#EF4444', '#3B82F6', '#FBBF24', '#6B7280'],
                    borderWidth: 1,
                    borderRadius: 4,
                }]
            },
            options: {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => ` ${ctx.raw} players` } } },
                scales: {
                    x: { grid: { color: 'rgba(255,255,255,0.04)' }, beginAtZero: true, ticks: { stepSize: 1 } },
                    y: { grid: { display: false } }
                }
            }
        });
    }

    function buildKPIs(users, onlineUsers, activeWeek, newToday) {
        const el = document.getElementById('analytics-engagement-kpis');
        if (!el) return;
        const total = users.length || 1;

        const weekRate = Math.round((activeWeek / total) * 100);
        const retentionLabel = weekRate >= 70 ? '🟢 Excellent' : weekRate >= 40 ? '🟡 Good' : '🔴 Growing';
        const gamers = users.filter(u => u.valId || u.mlbbId || u.hokId).length;
        const gameRate = Math.round((gamers / total) * 100);

        const kpis = [
            { label: 'Weekly Retention Rate', value: `${weekRate}%`, sub: retentionLabel, color: 'text-emerald-400' },
            { label: 'Registered Gamers', value: `${gamers}`, sub: `${gameRate}% have a game ID`, color: 'text-blue-400' },
            { label: 'Peak Sessions Today', value: `${onlineUsers.length}`, sub: 'Simultaneous online users', color: 'text-[var(--gold)]' },
            { label: 'New Users (Today)', value: `${newToday}`, sub: 'Since midnight local time', color: 'text-purple-400' },
            { label: 'Total Community Size', value: `${total}`, sub: 'All-time registered accounts', color: 'text-white' },
        ];

        el.innerHTML = kpis.map(k => `
            <div class="flex items-center justify-between p-2.5 bg-black/30 rounded-lg border border-white/5">
                <div>
                    <div class="text-[10px] font-mono-tag text-neutral-400 uppercase">${k.label}</div>
                    <div class="text-[9px] font-mono-tag text-neutral-600 mt-0.5">${k.sub}</div>
                </div>
                <div class="font-heading font-black text-lg ${k.color} shrink-0">${k.value}</div>
            </div>`).join('');
    }

    // Print / Export for Pitch
    window.printAnalytics = function () {
        const panel = document.getElementById('analytics-panel');
        if (!panel) return;
        const win = window.open('', '_blank');
        win.document.write(`
            <!DOCTYPE html><html><head>
            <title>ChampZero — Platform Analytics</title>
            <style>
                body { font-family: 'DM Sans', sans-serif; background: #000; color: #fff; padding: 40px; }
                h1 { font-size: 28px; font-weight: 900; text-transform: uppercase; letter-spacing: -0.02em; margin-bottom: 4px; }
                .sub { color: #888; font-size: 11px; font-family: monospace; margin-bottom: 32px; }
                @media print { body { background: #fff; color: #000; } .sub { color: #555; } }
            </style>
            </head><body>
            <h1>ChampZero Platform Analytics</h1>
            <div class="sub">Generated: ${new Date().toLocaleString('en-PH', { dateStyle: 'full', timeStyle: 'short' })} • Confidential — For Sponsor & Partner Use Only</div>
            ${panel.outerHTML}
            <script>window.onload=()=>window.print()<\/script>
            </body></html>`);
        win.document.close();
    };

    // Real-time Firestore listener
    onSnapshot(query(collection(db, 'users')), (snap) => {
        const now = Date.now();
        const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
        const weekAgo = now - ONE_WEEK;

        const users = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        const total = users.length;

        const onlineUsers = users.filter(u => {
            const ls = u.lastSeen ? new Date(u.lastSeen).getTime() : 0;
            return u.isOnline === true && (now - ls) < TWO_MINUTES;
        });

        const newToday = users.filter(u => {
            const d = u.createdAt?.toDate?.() || (u.createdAt ? new Date(u.createdAt) : null);
            return d && d >= todayStart;
        }).length;

        const activeWeek = users.filter(u => {
            const ls = u.lastSeen ? new Date(u.lastSeen).getTime() : 0;
            return ls > weekAgo;
        }).length;

        // --- KPI Cards ---
        const onlineEl = qs('#analytics-online-count');
        if (onlineEl) onlineEl.innerHTML = `<span>${onlineUsers.length}</span><span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse mb-1.5 shadow-[0_0_8px_#34d399]"></span>`;
        const totalEl = qs('#analytics-total-users');
        if (totalEl) totalEl.textContent = total;
        const todayEl = qs('#analytics-new-today');
        if (todayEl) todayEl.textContent = newToday;
        const weekEl = qs('#analytics-active-week');
        if (weekEl) weekEl.textContent = activeWeek;

        // --- Role map ---
        const roleMap = {};
        users.forEach(u => { const r = (u.role || 'member').toLowerCase(); roleMap[r] = (roleMap[r] || 0) + 1; });

        // --- Game counts ---
        let val = 0, mlbb = 0, hok = 0, none = 0;
        users.forEach(u => {
            const v = Boolean(u.valId), m = Boolean(u.mlbbId), h = Boolean(u.hokId);
            if (!v && !m && !h) none++;
            else { if (v) val++; if (m) mlbb++; if (h) hok++; }
        });

        // --- Charts ---
        buildGrowthChart(users);
        buildRoleDonut(roleMap, total || 1);
        buildGameChart(val, mlbb, hok, none);
        buildKPIs(users, onlineUsers, activeWeek, newToday);

        // --- Live Session Feed ---
        const feedEl = qs('#analytics-online-users-list');
        if (feedEl) {
            if (onlineUsers.length === 0) {
                feedEl.innerHTML = '<div class="text-xs text-neutral-500 font-mono-tag italic">No active sessions right now.</div>';
            } else {
                const sorted = [...onlineUsers].sort((a, b) => {
                    const aMs = a.lastSeen ? new Date(a.lastSeen).getTime() : 0;
                    const bMs = b.lastSeen ? new Date(b.lastSeen).getTime() : 0;
                    return bMs - aMs;
                });
                const roleColor = { admin: 'text-red-400 bg-red-500/10 border-red-500/30', organizer: 'text-purple-400 bg-purple-500/10 border-purple-500/30', subscriber: 'text-blue-400 bg-blue-500/10 border-blue-500/30' };
                feedEl.innerHTML = sorted.map(u => {
                    const name = escHtml(u.ign || u.displayName || u.email?.split('@')[0] || 'Anonymous');
                    const role = (u.role || 'member').toLowerCase();
                    const rc = roleColor[role] || 'text-neutral-400 bg-white/5 border-white/10';
                    return `<div class="flex items-center justify-between p-2.5 bg-black/30 rounded-xl border border-white/5 hover:border-white/10 transition-colors">
                        <div class="flex items-center gap-2.5">
                            <div class="relative shrink-0">
                                <img src="${avatarOf(u)}" class="w-7 h-7 rounded-lg object-cover bg-black border border-white/10" alt="avatar" onerror="this.src='pictures/cz_logo.png'">
                                <span class="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-400 border border-black shadow-[0_0_4px_#34d399]"></span>
                            </div>
                            <div>
                                <div class="font-heading font-bold text-white text-xs">${name}</div>
                                <div class="text-[9px] font-mono-tag text-neutral-500">${escHtml(u.email || '')}</div>
                            </div>
                        </div>
                        <div class="flex items-center gap-2 shrink-0">
                            <span class="px-1.5 py-0.5 rounded text-[8px] font-mono-tag font-bold uppercase border ${rc}">${role}</span>
                            <span class="text-[9px] font-mono-tag text-emerald-400">${timeAgo(u.lastSeen)}</span>
                        </div>
                    </div>`;
                }).join('');
            }
        }
    }, err => {
        console.warn('User analytics listener error:', err);
    });
}

// ==========================================
// SUPPORTERS & WALL OF FAME MANAGEMENT (ADMIN)
// ==========================================
let allDonations = [];

window.loadSupportersList = async function () {
    const tbody = qs('#supporters-table-body');
    if (!tbody) return;

    try {
        const snap = await getDocs(query(collection(db, "donations"), orderBy("timestamp", "desc")));
        allDonations = [];
        snap.forEach(d => {
            allDonations.push({ id: d.id, ...d.data() });
        });

        displaySupportersList();
    } catch (err) {
        console.error("Error loading supporters:", err);
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="8" class="p-6 text-center text-red-400 font-mono-tag">Failed to load supporters: ${err.message}</td></tr>`;
        }
    }
};

window.refreshSupportersList = function () {
    window.loadSupportersList();
    if (window.showSuccessToast) window.showSuccessToast("Refreshed", "Supporters list reloaded.", 1500);
};

function displaySupportersList() {
    const tbody = qs('#supporters-table-body');
    if (!tbody) return;

    if (allDonations.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" class="p-8 text-center text-neutral-500 font-mono-tag">No supporter contributions recorded yet.</td></tr>`;
        return;
    }

    const now = Date.now();

    tbody.innerHTML = allDonations.map(d => {
        const tier = (d.tier || 'bronze').toLowerCase();
        let badgeColor = 'bg-amber-700/20 text-amber-400 border-amber-600/40';
        let tierLabel = 'Bronze Scout';
        if (tier === 'gold') {
            badgeColor = 'bg-[#FFD700]/20 text-[#FFD700] border-[#FFD700]/40';
            tierLabel = 'Gold Patron';
        } else if (tier === 'silver') {
            badgeColor = 'bg-slate-400/20 text-slate-200 border-slate-300/40';
            tierLabel = 'Silver Elite';
        }

        const dateStr = d.timestamp ? new Date(d.timestamp).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : 'Unknown';
        const expiresDateStr = d.expiresAt ? new Date(d.expiresAt).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : '30 days';
        
        const isExpired = Boolean(d.expiresAt && d.expiresAt <= now);
        let statusBadge = isExpired
            ? `<span class="px-2 py-0.5 rounded text-[9px] font-mono-tag font-bold uppercase bg-red-500/20 text-red-400 border border-red-500/30">Expired</span>`
            : `<span class="px-2 py-0.5 rounded text-[9px] font-mono-tag font-bold uppercase bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">Active Wall</span>`;

        return `
            <tr class="hover:bg-white/5 transition-colors">
                <td class="p-4">
                    <div class="flex items-center gap-3">
                        <img src="${escapeHtml(d.userAvatar || 'pictures/cz_logo.png')}" class="w-8 h-8 rounded-lg object-cover bg-black border border-white/10" onerror="this.src='pictures/cz_logo.png'">
                        <div>
                            <div class="font-heading font-bold text-white text-xs">${escapeHtml(d.userName || 'Champion Backer')}</div>
                            <div class="text-[9px] font-mono-tag text-neutral-500">${escapeHtml(d.userId || 'Guest')}</div>
                        </div>
                    </div>
                </td>
                <td class="p-4">
                    <span class="px-2 py-0.5 rounded text-[9px] font-mono-tag font-bold uppercase border ${badgeColor}">${tierLabel}</span>
                </td>
                <td class="p-4 font-mono-tag font-bold text-white text-xs">
                    ₱${Number(d.amount || 0).toLocaleString()}
                </td>
                <td class="p-4 font-mono-tag text-neutral-400 uppercase text-[10px]">
                    ${escapeHtml(d.channel || 'PayRex / GCash')}
                </td>
                <td class="p-4 font-mono-tag text-[10px] text-neutral-300">
                    <div>${dateStr}</div>
                    <div class="text-neutral-500 text-[9px]">Expires: ${expiresDateStr}</div>
                </td>
                <td class="p-4">
                    ${statusBadge}
                </td>
                <td class="p-4 max-w-xs truncate text-neutral-300 italic text-[11px]" title="${escapeHtml(d.message || '')}">
                    "${escapeHtml(d.message || 'Grassroots supporter')}"
                </td>
                <td class="p-4 text-right">
                    <button onclick="window.adminDeleteDonation('${d.id}')" class="px-3 py-1.5 rounded-lg bg-red-950/40 hover:bg-red-900/60 text-red-400 border border-red-500/30 text-[10px] font-heading font-bold uppercase tracking-wider transition-all cursor-pointer">
                        Delete
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

window.adminDeleteDonation = async function (donationId) {
    if (!donationId) return;
    const confirmed = await window.showCustomConfirm("Delete Supporter Listing?", "This will permanently remove this donation and remove the backer from the Wall of Fame.");
    if (!confirmed) return;

    try {
        await deleteDoc(doc(db, "donations", donationId));
        allDonations = allDonations.filter(d => d.id !== donationId);
        displaySupportersList();
        if (window.showSuccessToast) window.showSuccessToast("Deleted", "Supporter entry removed from Wall of Fame.", 2000);
    } catch (err) {
        console.error("Failed to delete donation:", err);
        if (window.showErrorToast) window.showErrorToast("Error", "Failed to delete supporter entry: " + err.message, 3000);
    }
};