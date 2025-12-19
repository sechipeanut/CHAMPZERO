import { auth, db } from './firebase-config.js';
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-auth.js";
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-firestore.js";

function qs(sel) { return document.querySelector(sel); }

// 1. AUTH PROTECTION & INITIAL LOAD
onAuthStateChanged(auth, async (user) => {
    if (!user) {
        window.location.href = "login.html"; // Redirect if not logged in
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
            qs('#display-name-header').textContent = data.ign || "New Champion";
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
            
            // Visual Feedback
            qs('#display-name-header').textContent = profileData.ign || "User";
            if(profileData.avatar) qs('#profile-avatar').src = profileData.avatar;
            
            alert("Profile Updated Successfully!");
        } catch (error) {
            console.error("Save Error:", error);
            alert("Error saving profile: " + error.message);
        } finally {
            btn.disabled = false;
            btn.textContent = originalText;
        }
    });
}

// 4. LOGOUT LOGIC
const logoutBtn = qs('#logout-btn');
if(logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
        try {
            await signOut(auth);
            window.location.href = "login.html";
        } catch (error) {
            console.error("Logout Error:", error);
        }
    });
}