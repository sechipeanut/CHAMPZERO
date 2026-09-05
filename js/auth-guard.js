// js/auth-guard.js - Centralized Email Verification Guard & Anti-Spam Gate
import { auth, db } from './firebase-config.js';
import { onAuthStateChanged, sendEmailVerification } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-auth.js";
import { doc, getDoc, updateDoc } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-firestore.js";

let cachedVerificationStatus = false;
let isBannerDismissedThisSession = false;
let resendCooldownInterval = null;

/**
 * Checks whether the current user is email verified.
 * Accounts authenticated via Google OAuth are pre-verified by Google.
 * Fallback checks Firestore user document for manual admin verification.
 */
export function isEmailVerified(user = auth.currentUser, userDocData = null) {
    if (!user) return false;

    // 1. Google OAuth sign-in is inherently email-verified
    const isGoogle = user.providerData && user.providerData.some(p => p.providerId === 'google.com');
    if (isGoogle) return true;

    // 2. Firebase Auth native verification flag
    if (user.emailVerified === true) return true;

    // 3. Cached / Firestore manual verification flag
    if (userDocData && (userDocData.emailVerified === true || userDocData.isEmailVerified === true)) {
        return true;
    }

    return cachedVerificationStatus;
}

window.isEmailVerified = isEmailVerified;

/**
 * Intercepts an action if email verification is required.
 * If verified: invokes callback directly.
 * If unverified: opens the Verification Required Modal.
 */
export async function checkEmailVerification(actionName = "perform this action", onVerifiedCallback = null) {
    const user = auth.currentUser;
    if (!user) {
        if (typeof window.showWarningToast === 'function') {
            window.showWarningToast("Login Required", "Please log in to continue.");
        }
        return false;
    }

    // Refresh state from server to catch link clicks in another tab
    try {
        await user.reload();
    } catch (_) {}

    if (isEmailVerified(user)) {
        if (typeof onVerifiedCallback === 'function') {
            onVerifiedCallback();
        }
        return true;
    }

    // Check Firestore fallback in case admin manually verified
    try {
        const uSnap = await getDoc(doc(db, "users", user.uid));
        if (uSnap.exists() && uSnap.data().emailVerified === true) {
            cachedVerificationStatus = true;
            if (typeof onVerifiedCallback === 'function') {
                onVerifiedCallback();
            }
            return true;
        }
    } catch (_) {}

    showVerificationModal(actionName, onVerifiedCallback);
    return false;
}

window.checkEmailVerification = checkEmailVerification;

/**
 * Shows the Esports-themed Email Verification Required Modal
 */
export function showVerificationModal(actionName = "post or message", onVerifiedCallback = null) {
    let modal = document.getElementById('cz-verification-gate-modal');
    if (!modal) {
        injectVerificationGateHTML();
        modal = document.getElementById('cz-verification-gate-modal');
    }

    const actionTextEl = document.getElementById('cz-verify-gate-action');
    const emailTextEl = document.getElementById('cz-verify-gate-email');
    const user = auth.currentUser;

    if (actionTextEl) actionTextEl.textContent = actionName;
    if (emailTextEl && user) emailTextEl.textContent = user.email || 'your account email';

    // Store callback on window for post-verification execution
    window._pendingVerifiedActionCallback = onVerifiedCallback;

    if (modal) {
        modal.classList.remove('hidden');
        modal.classList.add('flex');
    }
}

window.showVerificationModal = showVerificationModal;

export function closeVerificationModal() {
    const modal = document.getElementById('cz-verification-gate-modal');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }
}

window.closeVerificationModal = closeVerificationModal;

/**
 * Resends the verification email with rate limiting
 */
export async function triggerResendVerificationEmail() {
    const user = auth.currentUser;
    if (!user) return;

    const resendBtns = document.querySelectorAll('.cz-resend-verify-btn');

    try {
        resendBtns.forEach(btn => {
            btn.disabled = true;
            btn.dataset.origText = btn.textContent;
            btn.textContent = "Sending link...";
        });

        const continueUrl = window.location.origin ? (window.location.origin + '/login') : 'https://champzero.com/login';
        try {
            await sendEmailVerification(user, {
                url: continueUrl,
                handleCodeInApp: false
            });
        } catch (linkErr) {
            console.warn("sendEmailVerification with continueUrl failed, trying fallback:", linkErr);
            await sendEmailVerification(user);
        }

        if (typeof window.showSuccessToast === 'function') {
            window.showSuccessToast("Email Transmitted! ✉️", `Verification link sent to ${user.email}. Check your inbox and spam folder.`, 5000);
        }

        // Start 30s countdown
        let cooldown = 30;
        if (resendCooldownInterval) clearInterval(resendCooldownInterval);
        
        resendCooldownInterval = setInterval(() => {
            cooldown--;
            resendBtns.forEach(btn => {
                btn.textContent = `Resend in ${cooldown}s`;
            });
            if (cooldown <= 0) {
                clearInterval(resendCooldownInterval);
                resendCooldownInterval = null;
                resendBtns.forEach(btn => {
                    btn.disabled = false;
                    btn.textContent = btn.dataset.origText || "Resend Verification Email";
                });
            }
        }, 1000);

    } catch (err) {
        console.error("Failed to resend verification email:", err);
        resendBtns.forEach(btn => {
            btn.disabled = false;
            btn.textContent = btn.dataset.origText || "Resend Verification Email";
        });

        const msg = err.code === 'auth/too-many-requests' 
            ? "Too many requests. Please wait a minute before requesting another link."
            : "Could not send verification email. Please try again later.";
        
        if (typeof window.showErrorToast === 'function') {
            window.showErrorToast("Notice", msg, 4000);
        } else {
            alert(msg);
        }
    }
}

window.triggerResendVerificationEmail = triggerResendVerificationEmail;

/**
 * Checks verification status without logging out
 */
export async function checkVerificationNow() {
    const user = auth.currentUser;
    if (!user) return;

    const checkBtns = document.querySelectorAll('.cz-check-verify-btn');
    checkBtns.forEach(btn => {
        btn.disabled = true;
        btn.textContent = "Checking...";
    });

    try {
        await user.reload();
        
        let verified = user.emailVerified === true;
        if (!verified) {
            const uSnap = await getDoc(doc(db, "users", user.uid));
            if (uSnap.exists() && uSnap.data().emailVerified === true) {
                verified = true;
            }
        }

        if (verified) {
            cachedVerificationStatus = true;
            // Synchronize Firestore flag
            try {
                await updateDoc(doc(db, "users", user.uid), {
                    emailVerified: true
                });
            } catch (_) {}

            if (typeof window.showSuccessToast === 'function') {
                window.showSuccessToast("Email Confirmed! 🛡️", "Your player account is verified. All restrictions lifted!", 3500);
            }

            closeVerificationModal();
            removeVerificationBanner();

            if (typeof window._pendingVerifiedActionCallback === 'function') {
                const cb = window._pendingVerifiedActionCallback;
                window._pendingVerifiedActionCallback = null;
                cb();
            }
        } else {
            if (typeof window.showWarningToast === 'function') {
                window.showWarningToast("Still Pending", "We haven't received your email confirmation yet. Please click the link in your email first.", 4000);
            }
        }
    } catch (err) {
        console.error("Error refreshing verification status:", err);
    } finally {
        checkBtns.forEach(btn => {
            btn.disabled = false;
            btn.textContent = "I've Verified - Check Again";
        });
    }
}

window.checkVerificationNow = checkVerificationNow;

/**
 * Injects HTML for the Verification Gate Modal
 */
function injectVerificationGateHTML() {
    if (document.getElementById('cz-verification-gate-modal')) return;

    const modalDiv = document.createElement('div');
    modalDiv.id = 'cz-verification-gate-modal';
    modalDiv.className = 'fixed inset-0 z-[3000] hidden items-center justify-center bg-black/85 backdrop-blur-md p-4 animate-fade-in';
    modalDiv.innerHTML = `
        <div class="relative w-full max-w-md rounded-2xl bg-[#0E0E14] border border-[#FFD700]/30 p-6 sm:p-8 shadow-[0_20px_60px_rgba(0,0,0,0.9)] overflow-hidden text-center">
            <!-- Decorative Accent -->
            <div class="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-transparent via-[#FFD700] to-transparent"></div>
            <div class="absolute -top-12 left-1/2 -translate-x-1/2 w-32 h-32 bg-[#FFD700]/10 rounded-full blur-2xl pointer-events-none"></div>

            <!-- Icon -->
            <div class="w-14 h-14 mx-auto mb-4 rounded-2xl bg-[#FFD700]/10 border border-[#FFD700]/30 flex items-center justify-center text-[#FFD700] shadow-[0_0_20px_rgba(255,215,0,0.15)]">
                <svg class="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"></path>
                </svg>
            </div>

            <h3 class="text-xl font-heading font-black text-white uppercase tracking-wider mb-2">
                Email Verification Required
            </h3>

            <p class="text-xs text-neutral-300 mb-3 leading-relaxed">
                To protect the community from match fraud and spam, you must verify your email before you can <span id="cz-verify-gate-action" class="text-[#FFD700] font-bold">perform this action</span>.
            </p>

            <div class="p-3 rounded-xl bg-black/50 border border-white/10 mb-5 text-left flex items-center gap-3">
                <div class="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center text-neutral-400 shrink-0">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 12a4 4 0 10-8 0 4 4 0 008 0zm0 0v1.5a2.5 2.5 0 005 0V12a9 9 0 10-9 9m4.5-1.206a8.959 8.959 0 01-4.5 1.207" /></svg>
                </div>
                <div class="min-w-0 flex-1">
                    <div class="text-[10px] uppercase font-mono-tag text-neutral-400">Account Email</div>
                    <div id="cz-verify-gate-email" class="text-xs font-mono font-bold text-white truncate">your email</div>
                </div>
            </div>

            <!-- Action Buttons -->
            <div class="space-y-2.5">
                <button type="button" onclick="window.checkVerificationNow()"
                    class="cz-check-verify-btn w-full py-3 px-4 rounded-xl bg-[#FFD700] hover:bg-[#FFF099] text-black font-heading font-black text-xs uppercase tracking-wider transition-all shadow-[0_0_20px_rgba(255,215,0,0.2)] active:scale-[0.98] cursor-pointer">
                    I've Verified - Check Again
                </button>

                <button type="button" onclick="window.triggerResendVerificationEmail()"
                    class="cz-resend-verify-btn w-full py-2.5 px-4 rounded-xl bg-white/5 hover:bg-white/10 text-neutral-200 border border-white/10 hover:border-white/20 font-mono-tag text-xs font-bold transition-all cursor-pointer">
                    Resend Verification Email
                </button>

                <button type="button" onclick="window.closeVerificationModal()"
                    class="w-full py-2 text-[11px] font-mono-tag text-neutral-500 hover:text-neutral-300 transition-colors cursor-pointer">
                    Cancel & Close
                </button>
            </div>
        </div>
    `;
    document.body.appendChild(modalDiv);
}

/**
 * Injects a persistent top notification banner below the header if email is unverified
 */
function renderVerificationBanner(user) {
    if (isBannerDismissedThisSession) return;
    if (document.getElementById('cz-unverified-top-banner')) return;
    if (!user || isEmailVerified(user)) return;

    const banner = document.createElement('div');
    banner.id = 'cz-unverified-top-banner';
    banner.className = 'w-full bg-gradient-to-r from-amber-950/80 via-amber-900/60 to-amber-950/80 border-b border-amber-500/30 text-amber-200 px-4 py-2.5 text-xs z-[999] transition-all relative';
    banner.innerHTML = `
        <div class="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2">
            <div class="flex items-center gap-2.5 text-center sm:text-left">
                <span class="w-5 h-5 rounded-full bg-amber-500/20 text-amber-400 flex items-center justify-center shrink-0">
                    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                </span>
                <span>
                    <strong class="text-white font-heading tracking-wide uppercase text-[11px]">Email Verification Pending:</strong>
                    <span class="text-amber-300/90 font-sans">Verify <strong class="text-white">${escapeHtml(user.email || 'your email')}</strong> to unlock posting scrims, creating squads, and tournament entry.</span>
                </span>
            </div>
            <div class="flex items-center gap-2 shrink-0">
                <button type="button" onclick="window.triggerResendVerificationEmail()" 
                    class="cz-resend-verify-btn px-3 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 text-[10px] font-mono-tag font-bold uppercase transition-all cursor-pointer">
                    Resend Link
                </button>
                <button type="button" onclick="window.checkVerificationNow()" 
                    class="cz-check-verify-btn px-3 py-1 rounded-lg bg-[#FFD700] hover:bg-[#FFF099] text-black text-[10px] font-heading font-black uppercase tracking-wider transition-all cursor-pointer shadow-sm">
                    I've Verified
                </button>
                <button type="button" onclick="window.dismissVerificationBanner()" title="Dismiss for session"
                    class="p-1 text-amber-400/60 hover:text-amber-200 transition-colors cursor-pointer ml-1">
                    &times;
                </button>
            </div>
        </div>
    `;

    const header = document.querySelector('header');
    if (header && header.parentNode) {
        header.insertAdjacentElement('afterend', banner);
    } else {
        document.body.prepend(banner);
    }
}

function removeVerificationBanner() {
    const b = document.getElementById('cz-unverified-top-banner');
    if (b) b.remove();
}

window.dismissVerificationBanner = function() {
    isBannerDismissedThisSession = true;
    removeVerificationBanner();
};

function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

// Global Auth State Monitor
onAuthStateChanged(auth, async (user) => {
    if (user) {
        injectVerificationGateHTML();
        
        let verified = isEmailVerified(user);
        if (!verified) {
            try {
                const uSnap = await getDoc(doc(db, "users", user.uid));
                if (uSnap.exists()) {
                    const data = uSnap.data();
                    if (data.emailVerified === true || data.isEmailVerified === true) {
                        cachedVerificationStatus = true;
                        verified = true;
                    }
                }
            } catch (_) {}
        }

        if (!verified) {
            renderVerificationBanner(user);
        } else {
            removeVerificationBanner();
        }
    } else {
        removeVerificationBanner();
        closeVerificationModal();
    }
});

// Periodic reload on window focus to automatically pick up verification link clicks in other tabs
window.addEventListener('focus', async () => {
    if (auth.currentUser && !isEmailVerified(auth.currentUser)) {
        try {
            await auth.currentUser.reload();
            if (auth.currentUser.emailVerified) {
                cachedVerificationStatus = true;
                removeVerificationBanner();
                closeVerificationModal();
            }
        } catch (_) {}
    }
});
