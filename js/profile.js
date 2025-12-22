import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-firestore.js";

function qs(sel) { return document.querySelector(sel); }

// Format date helper
function formatDate(dateString) {
    if (!dateString) return '--';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

// 1. AUTH PROTECTION & INITIAL LOAD
onAuthStateChanged(auth, async (user) => {
    if (!user) {
        window.location.href = "/login"; // Redirect if not logged in
        return;
    }

    // Set Header Email
    qs('#email-display').textContent = user.email;
    
    // Load Profile Data
    await loadUserProfile(user.uid, user.email);
});

// 2. FETCH & DISPLAY PROFILE DATA
async function loadUserProfile(uid, email) {
    try {
        const docRef = doc(db, "users", uid);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
            const data = docSnap.data();
            
            // Display Name & Avatar
            qs('#display-name-header').textContent = data.ign || data.displayName || "New Champion";
            if(data.avatar) {
                qs('#profile-avatar').src = data.avatar;
            }

            // Role Badge
            const roleBadge = qs('#role-badge');
            if (data.role === 'admin') {
                roleBadge.textContent = 'ADMIN';
                roleBadge.classList.remove('bg-[var(--gold)]/10', 'text-[var(--gold)]', 'border-[var(--gold)]/20');
                roleBadge.classList.add('bg-red-500/10', 'text-red-400', 'border-red-500/20');
            } else {
                roleBadge.textContent = 'MEMBER';
            }

            // Rank Display
            qs('#rank-display').textContent = data.rank || 'Unranked';

            // Stats
            qs('#tournaments-count').textContent = data.tournamentsPlayed || 0;
            qs('#prizes-earned').textContent = '$' + (data.prizesEarned || 0);
            qs('#win-rate').textContent = data.winRate ? data.winRate + '%' : '--';

            // Bio
            qs('#bio-display').textContent = data.bio || 'No bio provided yet.';

            // Game IDs
            qs('#ign-display').textContent = data.ign || '--';
            qs('#real-name-display').textContent = data.realName || '--';
            qs('#val-id-display').textContent = data.valId || 'Not set';
            qs('#mlbb-id-display').textContent = data.mlbbId || 'Not set';

            // Dates
            qs('#joined-display').textContent = formatDate(data.joinedAt || data.createdAt);
            qs('#updated-display').textContent = formatDate(data.updatedAt) || 'Never';

        } else {
            // New User - No data yet
            qs('#display-name-header').textContent = "New Champion";
            qs('#bio-display').textContent = "Welcome! Click 'Edit Profile' to get started.";
        }
    } catch (error) {
        console.error("Error fetching profile:", error);
        if (window.showErrorToast) {
            window.showErrorToast("Error", "Failed to load profile data", 3000);
        }
    }
}

