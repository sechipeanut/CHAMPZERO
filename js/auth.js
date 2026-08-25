// js/auth.js
import { auth, db } from './firebase-config.js';
import { 
    createUserWithEmailAndPassword, 
    signInWithEmailAndPassword, 
    updateProfile,
    GoogleAuthProvider,
    signInWithPopup,
    signInWithRedirect,
    getRedirectResult,
    sendEmailVerification,
    onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/11.1.0/firebase-auth.js";
import { doc, setDoc, getDoc, updateDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-firestore.js";

// Detect mobile/tablet to use redirect instead of popup (popup is blocked on mobile browsers)
function isMobileDevice() {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
           (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent)); // iPad detection
}

// Helper: Toast notification safe dispatcher
function notifyToast(type, title, message, duration = 4000) {
    if (type === 'success' && typeof window.showSuccessToast === 'function') {
        window.showSuccessToast(title, message, duration);
    } else if (type === 'error' && typeof window.showErrorToast === 'function') {
        window.showErrorToast(title, message, duration);
    } else if (type === 'warning' && typeof window.showWarningToast === 'function') {
        window.showWarningToast(title, message, duration);
    } else if (typeof window.showToast === 'function') {
        window.showToast(title, message, type, duration);
    } else {
        console.log(`[${type.toUpperCase()}] ${title}: ${message}`);
    }
}

// Helper: Translate raw Firebase Auth error codes to clean gamer-friendly messages
function getFriendlyErrorMessage(error) {
    if (!error) return "An unexpected error occurred. Please try again.";
    const code = error.code || '';
    const msg = error.message || '';

    switch (code) {
        case 'auth/email-already-in-use':
            return "This email address is already registered. Please log in instead.";
        case 'auth/invalid-email':
            return "Please enter a valid email address.";
        case 'auth/weak-password':
            return "Password is too weak. Please use at least 6 characters.";
        case 'auth/user-not-found':
        case 'auth/wrong-password':
        case 'auth/invalid-credential':
            return "Invalid email or password. Please check your credentials.";
        case 'auth/user-disabled':
            return "This player account has been disabled. Please contact support.";
        case 'auth/popup-closed-by-user':
            return "Sign-in popup was closed before completing authentication.";
        case 'auth/popup-blocked':
            return "Popup was blocked by your browser. Please allow popups for ChampZero.";
        case 'auth/unauthorized-continue-uri':
            return "Verification link domain configuration issue. Please check back shortly.";
        case 'auth/too-many-requests':
            return "Too many failed attempts. Access is temporarily disabled. Please try again later.";
        case 'auth/network-request-failed':
            return "Network connection issue. Please check your internet connection.";
        default:
            return msg.replace(/^Firebase:\s*/i, '').replace(/\(auth\/[^)]+\)\.?/i, '').trim() || "Authentication failed. Please try again.";
    }
}

// Helper: Ensure a comprehensive user profile exists in the database
async function ensureUserProfile(user, customUsername = '') {
    const userRef = doc(db, "users", user.uid);
    const userSnap = await getDoc(userRef);
    const resolvedName = customUsername || user.displayName || (user.email ? user.email.split('@')[0] : 'Champion');
    
    if (!userSnap.exists()) {
        await setDoc(userRef, {
            username: resolvedName,
            displayName: resolvedName,
            ign: resolvedName,
            email: user.email || '',
            rank: "Unranked",
            createdAt: serverTimestamp(),
            joinedAt: new Date().toISOString(),
            prizesEarned: 0,
            role: "user",
            emailVerified: user.emailVerified || false,
            lastSignInTime: serverTimestamp()
        });
    } else {
        const existingData = userSnap.data();
        const updates = {
            lastSignInTime: serverTimestamp(),
            emailVerified: user.emailVerified || false
        };
        // Preserve or fill IGN/displayName if missing
        if (!existingData.ign) updates.ign = existingData.displayName || resolvedName;
        if (!existingData.username) updates.username = existingData.displayName || resolvedName;
        
        await updateDoc(userRef, updates);
    }
}

// --- GLOBAL SESSION ROLE LISTENER ---
// Tracks user identity shifts across pages and caches their database roles
onAuthStateChanged(auth, async (user) => {
    if (user) {
        try {
            const userDocRef = doc(db, "users", user.uid);
            const docSnap = await getDoc(userDocRef);
            
            if (docSnap.exists()) {
                window.currentUserRole = docSnap.data().role || 'user';
            } else {
                window.currentUserRole = 'user';
            }
        } catch (error) {
            console.error("Error updating user role session context:", error);
            window.currentUserRole = 'user';
        }
    } else {
        window.currentUserRole = null;
    }
    
    // Dispatches a custom event to alert other modules (like tournaments.js) that permissions are resolved
    window.dispatchEvent(new CustomEvent('authRoleReady'));
});

document.addEventListener('DOMContentLoaded', async () => {
    // --- 0. HANDLE GOOGLE REDIRECT RESULT (Mobile sign-in returns here after redirect) ---
    const googleProvider = new GoogleAuthProvider();
    googleProvider.setCustomParameters({ prompt: 'select_account' });

    try {
        const redirectResult = await getRedirectResult(auth);
        if (redirectResult && redirectResult.user) {
            const user = redirectResult.user;
            await ensureUserProfile(user);
            notifyToast('success', "Welcome!", `Signed in as ${user.displayName || 'Champion'}`, 2500);
            setTimeout(() => window.location.href = "/profile", 1000);
        }
    } catch (redirectError) {
        console.error("Google redirect result error:", redirectError);
        if (redirectError.code && redirectError.code !== 'auth/popup-closed-by-user') {
            notifyToast('error', "Sign-In Error", getFriendlyErrorMessage(redirectError), 4000);
        }
    }

    // --- 1. LOGIN FORM ---
    const loginForm = document.getElementById('loginForm');
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const emailInput = document.getElementById('email');
            const passwordInput = document.getElementById('password');
            const email = emailInput ? emailInput.value.trim() : '';
            const password = passwordInput ? passwordInput.value : '';
            const btn = loginForm.querySelector('button[type="submit"]');

            if (!email || !password) {
                notifyToast('warning', "Required Fields", "Please enter both your email and password.");
                return;
            }

            try {
                if (btn) {
                    btn.textContent = "Authenticating...";
                    btn.disabled = true;
                }
                
                const creds = await signInWithEmailAndPassword(auth, email, password);
                const user = creds.user;
                
                // Check if email is verified (skip for Google sign-ins as they're auto-verified)
                const isGoogleUser = user.providerData && user.providerData.some(p => p.providerId === 'google.com');
                if (!user.emailVerified && !isGoogleUser) {
                    notifyToast('warning', "Email Verification Required", "Please verify your email address to unlock full tournament access.", 4000);
                    setTimeout(() => {
                        window.location.href = `/verify-email?email=${encodeURIComponent(user.email || '')}`;
                    }, 1200);
                    return;
                }
                
                await ensureUserProfile(user);
                
                notifyToast('success', "Welcome Back!", "Login successful. Entering the arena...", 2000);
                setTimeout(() => window.location.href = "/profile", 1000);
            } catch (error) {
                console.error("Login error:", error);
                notifyToast('error', "Login Failed", getFriendlyErrorMessage(error), 4500);
                if (btn) {
                    btn.textContent = "Log In";
                    btn.disabled = false;
                }
            }
        });
    }

    // --- 2. SIGNUP FORM ---
    const signupForm = document.getElementById('signupForm');
    if (signupForm) {
        signupForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            const usernameInput = document.getElementById('username');
            const emailInput = document.getElementById('email');
            const passwordInput = document.getElementById('password');
            const confirmInput = document.getElementById('confirm-password');
            const termsCheckbox = document.getElementById('terms');

            const username = usernameInput ? usernameInput.value.trim() : '';
            const email = emailInput ? emailInput.value.trim() : '';
            const password = passwordInput ? passwordInput.value : '';
            const confirm = confirmInput ? confirmInput.value : '';
            const btn = signupForm.querySelector('button[type="submit"]');

            if (!username || !email || !password) {
                notifyToast('warning', "Validation Error", "Please fill in all required fields.", 3000);
                return;
            }

            if (password.length < 6) {
                notifyToast('warning', "Password Too Short", "Password must be at least 6 characters long.", 3500);
                return;
            }

            if (password !== confirm) {
                notifyToast('warning', "Validation Error", "Passwords do not match! Please check and try again.", 3500);
                return;
            }

            if (termsCheckbox && !termsCheckbox.checked) {
                notifyToast('warning', "Terms & Privacy", "Please agree to the Terms & Privacy Policy to proceed.", 3500);
                return;
            }

            try {
                if (btn) {
                    btn.textContent = "Creating Account...";
                    btn.disabled = true;
                }

                // Step 1: Create Auth User in Firebase
                const userCredential = await createUserWithEmailAndPassword(auth, email, password);
                const user = userCredential.user;

                // Step 2: Update Display Name in Auth Profile
                try {
                    await updateProfile(user, { displayName: username });
                } catch (pErr) {
                    console.warn("Could not set display name on auth profile:", pErr);
                }

                // Step 3: CRITICAL - Guarantee Firestore User Document Creation BEFORE external actions
                await setDoc(doc(db, "users", user.uid), {
                    username: username,
                    displayName: username,
                    ign: username,
                    email: email,
                    rank: "Unranked",
                    createdAt: serverTimestamp(),
                    joinedAt: new Date().toISOString(),
                    prizesEarned: 0,
                    role: "user",
                    emailVerified: false,
                    lastSignInTime: serverTimestamp()
                });

                // Step 4: Dispatch Verification Email with Safe Fallback
                let emailSent = false;
                try {
                    // Try with custom continue URL
                    const continueUrl = window.location.origin ? (window.location.origin + '/login') : 'https://champzero.com/login';
                    await sendEmailVerification(user, {
                        url: continueUrl,
                        handleCodeInApp: false
                    });
                    emailSent = true;
                } catch (emailErr) {
                    console.warn("Standard sendEmailVerification with continueUrl failed, attempting fallback:", emailErr);
                    try {
                        // Fallback without actionCodeSettings
                        await sendEmailVerification(user);
                        emailSent = true;
                    } catch (fallbackErr) {
                        console.warn("Fallback verification email send failed:", fallbackErr);
                    }
                }

                if (emailSent) {
                    notifyToast('success', "Account Created!", "Registration complete! Please check your email to verify your account.", 4500);
                } else {
                    notifyToast('success', "Account Created!", "Registration complete! You can now access your player profile.", 4500);
                }

                setTimeout(() => {
                    window.location.href = `/verify-email?fromSignup=true&email=${encodeURIComponent(email)}`;
                }, 1500);

            } catch (error) {
                console.error("Signup failed:", error);
                notifyToast('error', "Registration Failed", getFriendlyErrorMessage(error), 5000);
                if (btn) {
                    btn.textContent = "Create Account";
                    btn.disabled = false;
                }
            }
        });
    }

    // --- 3. GOOGLE SIGN-IN ---
    const googleBtn = document.getElementById('google-btn');
    if (googleBtn) {
        googleBtn.addEventListener('click', async () => {
            const provider = new GoogleAuthProvider();
            provider.setCustomParameters({ prompt: 'select_account' });
            
            // Disable button to prevent double-clicks
            googleBtn.disabled = true;
            const originalHTML = googleBtn.innerHTML;
            googleBtn.innerHTML = '<span style="opacity:0.7">Connecting to Google...</span>';

            if (isMobileDevice()) {
                // Mobile: use redirect flow (popups are blocked on mobile browsers)
                try {
                    await signInWithRedirect(auth, provider);
                    // Page will navigate away — no code after this runs
                } catch (error) {
                    console.error("Google redirect sign-in error:", error);
                    notifyToast('error', "Sign-In Error", getFriendlyErrorMessage(error), 4000);
                    googleBtn.disabled = false;
                    googleBtn.innerHTML = originalHTML;
                }
            } else {
                // Desktop: use popup flow
                try {
                    const result = await signInWithPopup(auth, provider);
                    await ensureUserProfile(result.user);
                    notifyToast('success', "Welcome!", `Signed in as ${result.user.displayName || 'Champion'}`, 2500);
                    setTimeout(() => window.location.href = "/profile", 1000);
                } catch (error) {
                    console.error("Google sign-in error:", error);
                    googleBtn.disabled = false;
                    googleBtn.innerHTML = originalHTML;
                    if (error.code !== 'auth/popup-closed-by-user' && error.code !== 'auth/cancelled-popup-request') {
                        notifyToast('error', "Sign-In Error", getFriendlyErrorMessage(error), 4000);
                    }
                }
            }
        });
    }
});