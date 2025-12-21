// js/auth.js
import { auth, db } from './firebase-config.js';
import { 
    createUserWithEmailAndPassword, 
    signInWithEmailAndPassword, 
    updateProfile,
    GoogleAuthProvider,
    signInWithPopup
} from "https://www.gstatic.com/firebasejs/11.1.0/firebase-auth.js";
import { doc, setDoc, getDoc, updateDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-firestore.js";

// Helper: Ensure a user profile exists in the database
async function ensureUserProfile(user) {
    const userRef = doc(db, "users", user.uid);
    const userSnap = await getDoc(userRef);
    
    if (!userSnap.exists()) {
        await setDoc(userRef, {
            username: user.displayName || user.email.split('@')[0],
            displayName: user.displayName || user.email.split('@')[0],
            email: user.email,
            rank: "Unranked",
            createdAt: serverTimestamp(),
            joinedAt: new Date().toISOString(),
            prizesEarned: 0,
            role: "user",
            emailVerified: user.emailVerified || false,
            lastSignInTime: serverTimestamp()
        });
    } else {
        // Update last sign in time on every login
        await updateDoc(userRef, {
            lastSignInTime: serverTimestamp(),
            emailVerified: user.emailVerified || false
        });
    }
}

document.addEventListener('DOMContentLoaded', () => {
    console.log("Auth script loaded");

    // --- 1. LOGIN FORM ---
    const loginForm = document.getElementById('loginForm');
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault(); // STOP PAGE REFRESH
            
            const email = document.getElementById('email').value;
            const password = document.getElementById('password').value;
            const btn = loginForm.querySelector('button[type="submit"]');

            try {
                btn.textContent = "Logging in...";
                btn.disabled = true;
                
                const creds = await signInWithEmailAndPassword(auth, email, password);
                await ensureUserProfile(creds.user); // Check/Create Profile
                
                window.showSuccessToast("Success!", "Login Successful!", 2000);
                setTimeout(() => window.location.href = "/profile", 1000);
            } catch (error) {
                console.error(error);
                window.showErrorToast("Login Failed", error.message, 4000);
                btn.textContent = "Log In";
                btn.disabled = false;
            }
        });
    }

    // --- 2. SIGNUP FORM ---
    const signupForm = document.getElementById('signupForm');
    if (signupForm) {
        signupForm.addEventListener('submit', async (e) => {
            e.preventDefault(); // STOP PAGE REFRESH

            const username = document.getElementById('username').value;
            const email = document.getElementById('email').value;
            const password = document.getElementById('password').value;
            const confirm = document.getElementById('confirm-password').value;
            const btn = signupForm.querySelector('button[type="submit"]');

            if (password !== confirm) {
                window.showWarningToast("Validation Error", "Passwords do not match!", 3000);
                return;
            }

            try {
                btn.textContent = "Creating Account...";
                btn.disabled = true;

                // Create Auth User
                const userCredential = await createUserWithEmailAndPassword(auth, email, password);
                const user = userCredential.user;

                // Update Display Name
                await updateProfile(user, { displayName: username });

                // Create Firestore Document (This is what you saw working before!)
                await setDoc(doc(db, "users", user.uid), {
                    username: username,
                    displayName: username,
                    email: email,
                    rank: "Unranked",
                    createdAt: serverTimestamp(),
                    joinedAt: new Date().toISOString(),
                    prizesEarned: 0,
                    role: "user",
                    emailVerified: user.emailVerified || false,
                    lastSignInTime: serverTimestamp()
                });

                window.showSuccessToast("Success!", "Account Created Successfully!", 2000);
                setTimeout(() => window.location.href = "/profile", 1000);
            } catch (error) {
                console.error(error);
                window.showErrorToast("Signup Failed", error.message, 4000);
                btn.textContent = "Create Account";
                btn.disabled = false;
            }
        });
    }

    // --- 3. GOOGLE SIGN-IN ---
    const googleBtn = document.getElementById('google-btn');
    if (googleBtn) {
        googleBtn.addEventListener('click', async () => {
            console.log("Google button clicked");
            const provider = new GoogleAuthProvider();
            try {
                const result = await signInWithPopup(auth, provider);
                await ensureUserProfile(result.user);
                window.showSuccessToast("Welcome!", `Signed in as ${result.user.displayName}`, 2000);
                setTimeout(() => window.location.href = "/profile", 1000);
            } catch (error) {
                console.error(error);
                window.showErrorToast("Sign-In Error", error.message, 4000);
            }
        });
    }
});