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
    serverTimestamp,
    orderBy 
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

// Store current logged-in user ID
let currentUserId = null;

// --- 1. ADMIN CHECK ---
onAuthStateChanged(auth, async (user) => {
    if (!user) {
        window.location.href = "login.html";
        return;
    }

    currentUserId = user.uid; // Store current user ID

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
            window.showErrorToast("Access Denied", "You do not have permission to access this page.", 3000);
            setTimeout(() => window.location.href = "home.html", 2000);
        }
    } catch (error) {
        console.error("Auth Error:", error);
        window.location.href = "home.html";
    }
});

// --- 2. CORE FUNCTIONS (Edit, Delete, Reset) ---

// DELETE ITEM
window.deleteItem = async function(collectionName, docId) {
    const confirmed = await window.showCustomConfirm("Delete Item?", "Are you sure you want to delete this? This action cannot be undone.");
    if(!confirmed) return;
    try {
        await deleteDoc(doc(db, collectionName, docId));
        window.showSuccessToast("Deleted", "Item deleted successfully.", 2000);
        refreshAllLists(); 
    } catch (error) {
        console.error("Delete Error:", error);
        window.showErrorToast("Delete Failed", error.message, 4000);
    }
}

// EDIT ITEM (Populate Form)
window.editItem = async function(collectionName, docId) {
    try {
        // 1. Fetch data
        const docRef = doc(db, collectionName, docId);
        const docSnap = await getDoc(docRef);
        
        if (!docSnap.exists()) {
            window.showErrorToast("Not Found", "Item not found in database.", 3000);
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
        window.showErrorToast("Error", "Failed to load item for editing.", 3000);
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
    refreshUsers(); // Added User fetch
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
                    data.updatedAt = serverTimestamp(); // Use serverTimestamp for updates
                    await updateDoc(docRef, data);
                    window.showSuccessToast("Updated", "Item updated successfully!", 2000);
                    resetFormState(formId); // Exit edit mode
                } else {
                    // --- CREATE NEW ---
                    data.createdAt = serverTimestamp(); // Use serverTimestamp for creation
                    await addDoc(collection(db, collectionName), data);
                    window.showSuccessToast("Created", successMsg, 2000);
                    form.reset();
                }

                refreshAllLists();
            } catch (err) {
                console.error(err);
                window.showErrorToast("Error", err.message, 4000);
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

// --- USER MANAGEMENT FUNCTIONS ---

let allUsers = []; // Cache for search
let currentRoleFilter = 'all'; // Current role filter

// Refresh Users List
window.refreshUsers = async function() {
    console.log("🔄 Fetching users from Firestore...");
    try {
        const usersCol = collection(db, 'users');
        const snapshot = await getDocs(usersCol);
        
        console.log(`✅ Found ${snapshot.size} users in Firestore`);
        
        allUsers = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));
        
        // Sort by createdAt if available, newest first
        allUsers.sort((a, b) => {
            const aTime = a.createdAt ? (a.createdAt.seconds || 0) : 0;
            const bTime = b.createdAt ? (b.createdAt.seconds || 0) : 0;
            return bTime - aTime;
        });
        
        console.log("📊 Displaying users in table...");
        updateUserCounts();
        applyCurrentFilters();
    } catch (error) {
        console.error("❌ Error fetching users:", error);
        window.showErrorToast("Error", "Failed to load users: " + error.message, 4000);
        qs('#users-table-body').innerHTML = '<tr><td colspan="6" class="text-center p-8 text-red-400">Error loading users</td></tr>';
    }
}

// Update user counts
function updateUserCounts() {
    const totalUsers = allUsers.length;
    const adminUsers = allUsers.filter(u => u.role === 'admin').length;
    const regularUsers = allUsers.filter(u => u.role !== 'admin').length;
    
    qs('#user-count').textContent = totalUsers;
    qs('#admin-count').textContent = adminUsers;
    qs('#regular-user-count').textContent = regularUsers;
}

// Filter users by role
window.filterUsersByRole = function(role) {
    currentRoleFilter = role;
    
    // Update tab styling
    document.querySelectorAll('.role-tab').forEach(tab => {
        tab.classList.remove('active');
    });
    qs(`#role-tab-${role}`)?.classList.add('active');
    
    // Apply filters
    applyCurrentFilters();
}

// Apply current filters (role + search)
function applyCurrentFilters() {
    let filtered = allUsers;
    
    // Apply role filter
    if (currentRoleFilter !== 'all') {
        filtered = filtered.filter(user => {
            const userRole = user.role || 'user';
            return userRole === currentRoleFilter;
        });
    }
    
    // Apply search filter if search box has text
    const searchInput = qs('#user-search');
    if (searchInput && searchInput.value.trim()) {
        const searchTerm = searchInput.value.toLowerCase();
        filtered = filtered.filter(user => {
            const name = (user.displayName || user.username || '').toLowerCase();
            const email = (user.email || '').toLowerCase();
            return name.includes(searchTerm) || email.includes(searchTerm);
        });
    }
    
    displayUsers(filtered);
}

// Display Users in Table
function displayUsers(users) {
    console.log(`📋 displayUsers called with ${users?.length || 0} users`);
    const tbody = qs('#users-table-body');
    
    if (!tbody) {
        console.error("❌ Could not find #users-table-body element!");
        return;
    }
    
    if (!users || users.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center p-8 text-gray-500">No users found</td></tr>';
        return;
    }
    
    console.log("✏️ Rendering user rows...");
    tbody.innerHTML = users.map(user => {
        const displayName = user.displayName || user.username || 'N/A';
        const email = user.email || 'N/A';
        const role = user.role || 'user';
        const isAdmin = role === 'admin';
        const isSelf = user.id === currentUserId; // Check if this is the current user
        
        // Use createdAt if available, otherwise fall back to joinedAt
        const createdAt = user.createdAt ? formatDate(user.createdAt) : (user.joinedAt ? formatDate(user.joinedAt) : 'N/A');
        const lastSignIn = user.lastSignInTime ? formatDate(user.lastSignInTime) : 'Never';
        const emailVerified = user.emailVerified;
        
        return `
            <tr class="border-b border-white/5 hover:bg-white/5 transition">
                <td class="p-4">
                    <div class="flex items-center gap-3">
                        <div class="w-10 h-10 rounded-full bg-gradient-to-br from-yellow-400 to-orange-500 flex items-center justify-center text-black font-bold">
                            ${escapeHtml(displayName.charAt(0).toUpperCase())}
                        </div>
                        <div class="font-medium text-white">${escapeHtml(displayName)}${isSelf ? ' <span class="text-xs text-yellow-400">(You)</span>' : ''}</div>
                    </div>
                </td>
                <td class="p-4 text-gray-300">${escapeHtml(email)}</td>
                <td class="p-4">
                    <span class="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-semibold ${isAdmin ? 'bg-yellow-500/20 text-yellow-400' : 'bg-blue-500/20 text-blue-400'}">
                        ${isAdmin ? '👑' : '👤'} ${escapeHtml(role)}
                    </span>
                    ${emailVerified ? '<span class="ml-2 text-green-400 text-xs">✓ Verified</span>' : ''}
                </td>
                <td class="p-4 text-gray-400 text-sm">${createdAt}</td>
                <td class="p-4 text-gray-400 text-sm">${lastSignIn}</td>
                <td class="p-4">
                    <div class="flex gap-2">
                        <button onclick="viewUserDetails('${user.id}')" class="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white text-xs rounded font-medium transition">
                            View Profile
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

// Search Users - Initialize on DOM ready
function initUserSearch() {
    const searchInput = qs('#user-search');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            applyCurrentFilters();
        });
    }
}

// Initialize search after DOM loads
setTimeout(initUserSearch, 500);

// Format Date
function formatDate(timestamp) {
    if (!timestamp) return 'N/A';
    
    let date;
    if (timestamp.toDate) {
        date = timestamp.toDate();
    } else if (timestamp.seconds) {
        date = new Date(timestamp.seconds * 1000);
    } else {
        date = new Date(timestamp);
    }
    
    return date.toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'short', 
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

// View User Details with Custom Modal
window.viewUserDetails = async function(userId) {
    try {
        const userDoc = await getDoc(doc(db, 'users', userId));
        if (!userDoc.exists()) {
            window.showErrorToast("Not Found", "User not found.", 3000);
            return;
        }
        
        const user = userDoc.data();
        showUserDetailsModal(userId, user);
    } catch (error) {
        console.error("Error viewing user:", error);
        window.showErrorToast("Error", "Failed to load user details.", 3000);
    }
}

// Show User Details Modal
function showUserDetailsModal(userId, user) {
    const displayName = user.displayName || user.username || 'N/A';
    const email = user.email || 'N/A';
    const role = user.role || 'user';
    const isAdmin = role === 'admin';
    const isSelf = userId === currentUserId; // Check if viewing own profile
    
    // Create modal overlay
    const overlay = document.createElement('div');
    overlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.7);
        backdrop-filter: blur(4px);
        z-index: 10000;
        display: flex;
        align-items: center;
        justify-content: center;
        animation: fadeIn 0.2s ease;
        overflow-y: auto;
        padding: 20px;
    `;
    
    // Create modal
    const modal = document.createElement('div');
    modal.style.cssText = `
        background: #1A1A1F;
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 16px;
        max-width: 600px;
        width: 100%;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
        animation: scaleIn 0.2s ease;
        margin: auto;
    `;
    
    // Create content
    modal.innerHTML = `
        <style>
            @keyframes fadeIn {
                from { opacity: 0; }
                to { opacity: 1; }
            }
            @keyframes scaleIn {
                from { transform: scale(0.9); opacity: 0; }
                to { transform: scale(1); opacity: 1; }
            }
            .user-detail-row {
                display: flex;
                justify-content: space-between;
                padding: 12px 0;
                border-bottom: 1px solid rgba(255, 255, 255, 0.05);
            }
            .user-detail-label {
                color: #9CA3AF;
                font-size: 14px;
                font-weight: 500;
            }
            .user-detail-value {
                color: #fff;
                font-size: 14px;
                font-weight: 400;
                text-align: right;
                max-width: 60%;
                word-break: break-word;
            }
        </style>
        <div style="padding: 24px; border-bottom: 1px solid rgba(255, 255, 255, 0.1);">
            <div style="display: flex; align-items: center; gap: 16px; margin-bottom: 16px;">
                <div style="width: 64px; height: 64px; border-radius: 50%; background: linear-gradient(to br, #FFD700, #C99700); display: flex; align-items: center; justify-content: center; font-size: 28px; font-weight: bold; color: black;">
                    ${escapeHtml(displayName.charAt(0).toUpperCase())}
                </div>
                <div style="flex: 1;">
                    <h3 style="color: white; font-size: 24px; font-weight: 600; margin: 0;">${escapeHtml(displayName)}</h3>
                    <span style="display: inline-flex; align-items: center; gap: 6px; margin-top: 8px; padding: 4px 12px; border-radius: 12px; font-size: 12px; font-weight: 600; ${isAdmin ? 'background: rgba(255, 215, 0, 0.2); color: #FFD700;' : 'background: rgba(59, 130, 246, 0.2); color: #3B82F6;'}">
                        ${isAdmin ? '👑' : '👤'} ${escapeHtml(role.toUpperCase())}
                    </span>
                </div>
            </div>
        </div>
        <div style="padding: 24px;">
            <div class="user-detail-row">
                <span class="user-detail-label">User ID</span>
                <span class="user-detail-value" style="font-family: monospace; font-size: 12px;">${escapeHtml(userId)}</span>
            </div>
            <div class="user-detail-row">
                <span class="user-detail-label">Email</span>
                <span class="user-detail-value">${escapeHtml(email)}</span>
            </div>
            <div class="user-detail-row">
                <span class="user-detail-label">Email Verified</span>
                <span class="user-detail-value">${user.emailVerified ? '<span style="color: #10B981;">✓ Verified</span>' : '<span style="color: #EF4444;">✗ Not Verified</span>'}</span>
            </div>
            <div class="user-detail-row">
                <span class="user-detail-label">Account Created</span>
                <span class="user-detail-value">${formatDate(user.createdAt || user.joinedAt)}</span>
            </div>
            <div class="user-detail-row">
                <span class="user-detail-label">Last Sign In</span>
                <span class="user-detail-value">${formatDate(user.lastSignInTime) || 'Never'}</span>
            </div>
            ${user.rank ? `
            <div class="user-detail-row">
                <span class="user-detail-label">Rank</span>
                <span class="user-detail-value">${escapeHtml(user.rank)}</span>
            </div>` : ''}
            ${user.prizesEarned !== undefined ? `
            <div class="user-detail-row">
                <span class="user-detail-label">Prizes Earned</span>
                <span class="user-detail-value" style="color: #FFD700; font-weight: 600;">₱${user.prizesEarned.toLocaleString()}</span>
            </div>` : ''}
            ${user.bio ? `
            <div class="user-detail-row">
                <span class="user-detail-label">Bio</span>
                <span class="user-detail-value">${escapeHtml(user.bio)}</span>
            </div>` : ''}
            ${user.favoriteGame ? `
            <div class="user-detail-row">
                <span class="user-detail-label">Favorite Game</span>
                <span class="user-detail-value">${escapeHtml(user.favoriteGame)}</span>
            </div>` : ''}
        </div>
        <div style="padding: 20px 24px; border-top: 1px solid rgba(255, 255, 255, 0.1); display: flex; justify-content: space-between; align-items: center; gap: 12px;">
            <div style="flex: 1;">
                ${!isSelf ? `
                    ${!isAdmin ? `
                        <button id="make-admin-btn" style="
                            padding: 10px 20px;
                            border-radius: 8px;
                            border: none;
                            background: linear-gradient(to right, #D97706, #F59E0B);
                            color: white;
                            font-size: 14px;
                            font-weight: 600;
                            cursor: pointer;
                            transition: all 0.2s;
                        ">👑 Make Admin</button>
                    ` : `
                        <button id="remove-admin-btn" style="
                            padding: 10px 20px;
                            border-radius: 8px;
                            border: none;
                            background: #4B5563;
                            color: white;
                            font-size: 14px;
                            font-weight: 600;
                            cursor: pointer;
                            transition: all 0.2s;
                        ">Remove Admin</button>
                    `}
                ` : '<span style="color: #9CA3AF; font-size: 14px; font-style: italic;">This is your profile</span>'}
            </div>
            <button id="close-modal-btn" style="
                padding: 10px 24px;
                border-radius: 8px;
                border: none;
                background: linear-gradient(to right, #C99700, #FFD700);
                color: black;
                font-size: 14px;
                font-weight: 600;
                cursor: pointer;
                transition: all 0.2s;
            ">Close</button>
        </div>
    `;
    
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    
    // Handle close
    const cleanup = () => {
        overlay.style.animation = 'fadeIn 0.2s ease reverse';
        setTimeout(() => {
            document.body.removeChild(overlay);
        }, 200);
    };
    
    const closeBtn = modal.querySelector('#close-modal-btn');
    closeBtn.addEventListener('click', cleanup);
    closeBtn.addEventListener('mouseenter', () => {
        closeBtn.style.opacity = '0.9';
    });
    closeBtn.addEventListener('mouseleave', () => {
        closeBtn.style.opacity = '1';
    });
    
    // Handle role change buttons if not self
    if (!isSelf) {
        const makeAdminBtn = modal.querySelector('#make-admin-btn');
        const removeAdminBtn = modal.querySelector('#remove-admin-btn');
        
        if (makeAdminBtn) {
            makeAdminBtn.addEventListener('click', async () => {
                cleanup();
                await toggleUserRole(userId, 'admin');
            });
            makeAdminBtn.addEventListener('mouseenter', () => {
                makeAdminBtn.style.opacity = '0.9';
            });
            makeAdminBtn.addEventListener('mouseleave', () => {
                makeAdminBtn.style.opacity = '1';
            });
        }
        
        if (removeAdminBtn) {
            removeAdminBtn.addEventListener('click', async () => {
                cleanup();
                await toggleUserRole(userId, 'user');
            });
            removeAdminBtn.addEventListener('mouseenter', () => {
                removeAdminBtn.style.background = '#374151';
            });
            removeAdminBtn.addEventListener('mouseleave', () => {
                removeAdminBtn.style.background = '#4B5563';
            });
        }
    }
    
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
            cleanup();
        }
    });
}

// Toggle User Role
window.toggleUserRole = async function(userId, newRole) {
    // Prevent self-modification
    if (userId === currentUserId) {
        window.showErrorToast("Action Denied", "You cannot modify your own admin status.", 3000);
        return;
    }
    
    const action = newRole === 'admin' ? 'promote this user to admin' : 'remove admin privileges';
    const confirmed = await window.showCustomConfirm(
        "Change User Role?", 
        `Are you sure you want to ${action}?`
    );
    
    if (!confirmed) return;
    
    try {
        await updateDoc(doc(db, 'users', userId), {
            role: newRole,
            updatedAt: serverTimestamp()
        });
        
        window.showSuccessToast("Role Updated", `User role changed to ${newRole}.`, 2000);
        refreshUsers();
    } catch (error) {
        console.error("Error updating role:", error);
        window.showErrorToast("Error", "Failed to update user role: " + error.message, 4000);
    }
}

// Expose switchTab wrapper to load data when tab changes
const originalSwitchTab = window.switchTab;
window.switchTab = function(tabName) {
    if (typeof originalSwitchTab === 'function') {
        originalSwitchTab(tabName);
    }
    // Load users data when users tab is opened
    if (tabName === 'users') {
        refreshUsers();
    }
};