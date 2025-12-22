import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-auth.js";
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-firestore.js";

function qs(sel) { return document.querySelector(sel); }

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

// 2. FETCH & POPULATE FORM
async function loadUserProfile(uid, email) {
    try {
        const docRef = doc(db, "users", uid);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
            const data = docSnap.data();
            
            // Fill Form Inputs
            qs('#ign').value = data.ign || '';
            qs('#realName').value = data.realName || '';
            qs('#avatarUrl').value = data.avatar || '';
            qs('#valId').value = data.valId || '';
            qs('#mlbbId').value = data.mlbbId || '';
            qs('#bio').value = data.bio || '';

            // Update Visual Header
            qs('#display-name-header').textContent = data.ign || data.displayName || "New Champion";
            if(data.avatar) qs('#profile-avatar').src = data.avatar;
        } else {
            // New User - No data yet
            qs('#display-name-header').textContent = "New Champion";
        }
    } catch (error) {
        console.error("Error fetching profile:", error);
    }
}

// 3. SAVE PROFILE DATA
const form = qs('#profileForm');
if(form) {
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const btn = form.querySelector('button[type="submit"]');
        const originalText = btn.textContent;
        btn.disabled = true;
        btn.textContent = "Saving...";

        const user = auth.currentUser;
        if (!user) return;

        // Gather Data
        const profileData = {
            ign: qs('#ign').value,
            displayName: qs('#ign').value, // Keep displayName in sync with ign
            realName: qs('#realName').value,
            avatar: qs('#avatarUrl').value,
            valId: qs('#valId').value,
            mlbbId: qs('#mlbbId').value,
            bio: qs('#bio').value,
            email: user.email, // Keep email in sync
            updatedAt: new Date().toISOString()
        };

        try {
            // Use setDoc with merge: true to update or create
            await setDoc(doc(db, "users", user.uid), profileData, { merge: true });
            
            // Show success message
            window.showSuccessToast("Success!", "Profile Updated Successfully!", 2000);
            
            // Redirect to profile page
            setTimeout(() => {
                window.location.href = "/profile";
            }, 1000);
        } catch (error) {
            console.error("Save Error:", error);
            window.showErrorToast("Error", "Failed to save profile: " + error.message, 4000);
        } finally {
            btn.disabled = false;
            btn.textContent = originalText;
        }
    });
}
