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
    query 
} from "https://www.gstatic.com/firebasejs/11.1.0/firebase-firestore.js";

function qs(sel) { return document.querySelector(sel); }
function escapeHtml(str) { if (!str) return ''; return String(str).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }

// State to track if we are editing
let editState = {
    isEditing: false,
    collection: null,
    id: null,
    formId: null
};

// --- 1. ADMIN CHECK ---
onAuthStateChanged(auth, async (user) => {
    if (!user) {
        window.location.href = "login.html";
        return;
    }

    try {
        const userRef = doc(db, "users", user.uid);
        const userSnap = await getDoc(userRef);
        const adminEmails = ["admin@champzero.com", "owner@champzero.com"];
        // Check both Role and specific email whitelist
        const isAdminRole = userSnap.exists() && userSnap.data().role === 'admin';
        
        if (isAdminRole || adminEmails.includes(user.email)) {
            console.log("Admin Authorized");
            refreshAllLists();
        } else {
            alert("Access Denied.");
            window.location.href = "home.html";
        }
    } catch (error) {
        console.error("Auth Error:", error);
        window.location.href = "home.html";
    }
});

// --- 2. CORE FUNCTIONS (Edit, Delete, Reset) ---

// DELETE ITEM
window.deleteItem = async function(collectionName, docId) {
    if(!confirm("Are you sure you want to delete this?")) return;
    try {
        await deleteDoc(doc(db, collectionName, docId));
        alert("Deleted successfully.");
        refreshAllLists(); 
    } catch (error) {
        console.error("Delete Error:", error);
        alert("Failed to delete: " + error.message);
    }
}

// EDIT ITEM (Populate Form)
window.editItem = async function(collectionName, docId) {
    try {
        // 1. Fetch data
        const docRef = doc(db, collectionName, docId);
        const docSnap = await getDoc(docRef);
        
        if (!docSnap.exists()) {
            alert("Item not found!");
            return;
        }

        const data = docSnap.data();
        
        // 2. Determine which form to fill based on collection
        if (collectionName === 'tournaments') {
            switchTab('tournaments');
            qs('#t-name').value = data.name;
            qs('#t-game').value = data.game;
            qs('#t-prize').value = data.prize;
            qs('#t-status').value = data.status;
            qs('#t-date').value = data.date;
            qs('#t-banner').value = data.banner;
            prepareEditMode('tournaments', docId, '#tournamentForm');
        } 
        else if (collectionName === 'events') {
            switchTab('events');
            qs('#e-name').value = data.name;
            qs('#e-date').value = data.date;
            qs('#e-desc').value = data.description;
            qs('#e-banner').value = data.banner;
            prepareEditMode('events', docId, '#eventForm');
        } 
        else if (collectionName === 'careers') {
            switchTab('jobs');
            qs('#j-title').value = data.title;
            qs('#j-location').value = data.location;
            qs('#j-type').value = data.type;
            prepareEditMode('careers', docId, '#jobForm');
        }
        else if (collectionName === 'talents') {
            switchTab('talents');
            qs('#tal-name').value = data.name;
            qs('#tal-role').value = data.role;
            qs('#tal-img').value = data.image;
            qs('#tal-link').value = data.socialLink;
            qs('#tal-bio').value = data.bio;
            prepareEditMode('talents', docId, '#talentForm');
        }
        else if (collectionName === 'notifications') {
            switchTab('notifications');
            qs('#n-title').value = data.title;
            qs('#n-type').value = data.type;
            qs('#n-message').value = data.message;
            prepareEditMode('notifications', docId, '#notifForm');
        }

        // Scroll to top to see the form
        window.scrollTo({ top: 0, behavior: 'smooth' });

    } catch (error) {
        console.error("Edit Fetch Error:", error);
        alert("Error loading item for edit.");
    }
}

// Helper to set UI to "Edit Mode"
function prepareEditMode(col, id, formSelector) {
    editState = { isEditing: true, collection: col, id: id, formId: formSelector };
    
    const form = qs(formSelector);
    const btn = form.querySelector('button[type="submit"]');
    
    // Change Button Visuals
    btn.textContent = "Update Item";
    btn.classList.remove('bg-[var(--gold)]', 'text-black');
    btn.classList.add('bg-blue-600', 'text-white');
    
    // Add Cancel Button if not exists
    let cancelBtn = form.querySelector('.cancel-edit-btn');
    if (!cancelBtn) {
        cancelBtn = document.createElement('button');
        cancelBtn.type = "button"; // Prevent submit
        cancelBtn.className = "cancel-edit-btn w-full mt-2 bg-gray-600 text-white font-bold px-6 py-2 rounded hover:bg-gray-500";
        cancelBtn.textContent = "Cancel Edit";
        cancelBtn.onclick = () => resetFormState(formSelector);
        form.appendChild(cancelBtn);
    }
}

// Helper to Reset UI to "Add Mode"
function resetFormState(formSelector) {
    const form = qs(formSelector);
    form.reset();
    
    const btn = form.querySelector('button[type="submit"]');
    // Reset Button Visuals
    btn.textContent = btn.getAttribute('data-original-text') || "Post Item";
    btn.classList.add('bg-[var(--gold)]', 'text-black');
    btn.classList.remove('bg-blue-600', 'text-white');

    // Remove Cancel Button
    const cancelBtn = form.querySelector('.cancel-edit-btn');
    if (cancelBtn) cancelBtn.remove();

    editState = { isEditing: false, collection: null, id: null, formId: null };
}

// --- 3. FETCH LISTS (Now with Edit Buttons) ---

async function refreshAllLists() {
    fetchTournaments();
    fetchEvents();
    fetchJobs();
    fetchMessages();
    fetchTalents();
    fetchNotifications(); // Added Notification fetch
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

// NEW: Fetch Notifications
async function fetchNotifications() {
    const list = qs('#notifications-list');
    const q = query(collection(db, "notifications"));
    const snapshot = await getDocs(q);
    list.innerHTML = snapshot.empty ? '<p class="text-gray-500">No announcements yet.</p>' : '';
    snapshot.forEach(doc => {
        const data = doc.data();
        let icon = '📢'; 
        if(data.type === 'tournament') icon = '🏆';
        if(data.type === 'event') icon = '🎉';
        if(data.type === 'alert') icon = '⚠️';

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
    if(badge) {
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


// --- 4. FORM HANDLING (Handles both ADD and EDIT) ---
document.addEventListener('DOMContentLoaded', () => {

    const handleForm = (formId, collectionName, getDataFn, successMsg) => {
        const form = qs(formId);
        if(!form) return;
        
        // Save original button text for reset
        const btn = form.querySelector('button[type="submit"]');
        btn.setAttribute('data-original-text', btn.textContent);

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            btn.disabled = true;
            btn.textContent = "Processing...";

            try {
                const data = getDataFn();
                
                if (editState.isEditing && editState.collection === collectionName && editState.formId === formId) {
                    // --- UPDATE EXISTING ---
                    const docRef = doc(db, collectionName, editState.id);
                    data.updatedAt = new Date().toISOString(); // Track updates
                    await updateDoc(docRef, data);
                    alert("Updated successfully!");
                    resetFormState(formId); // Exit edit mode
                } else {
                    // --- CREATE NEW ---
                    data.createdAt = new Date().toISOString();
                    // We use serverTimestamp in some places but your code style uses ISO string client-side
                    // which is fine for this scale.
                    await addDoc(collection(db, collectionName), data);
                    alert(successMsg);
                    form.reset();
                }

                refreshAllLists();
            } catch (err) {
                console.error(err);
                alert("Error: " + err.message);
            } finally {
                btn.disabled = false;
                // Text will be reset by resetFormState if edited, or manually here if added
                if(!editState.isEditing) btn.textContent = btn.getAttribute('data-original-text');
            }
        });
    };

    // Setup All Forms
    handleForm('#tournamentForm', 'tournaments', () => ({
        name: qs('#t-name').value,
        game: qs('#t-game').value,
        prize: Number(qs('#t-prize').value),
        status: qs('#t-status').value,
        date: qs('#t-date').value,
        banner: qs('#t-banner').value || "pictures/cz_logo.png"
    }), "Tournament Created!");

    handleForm('#eventForm', 'events', () => ({
        name: qs('#e-name').value,
        date: qs('#e-date').value,
        description: qs('#e-desc').value,
        banner: qs('#e-banner').value || "pictures/cz_logo.png"
    }), "Event Posted!");

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

    // NEW: Handle Notifications Form
    handleForm('#notifForm', 'notifications', () => ({
        title: qs('#n-title').value,
        type: qs('#n-type').value,
        message: qs('#n-message').value
    }), "Notification Sent!");

});