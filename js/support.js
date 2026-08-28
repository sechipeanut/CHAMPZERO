// js/support.js
// Supporter Donation Hub, Checkout Logic & Live Wall of Fame

import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-auth.js";
import { 
    collection, 
    addDoc, 
    doc, 
    getDoc, 
    setDoc, 
    updateDoc, 
    onSnapshot, 
    query, 
    orderBy, 
    limit, 
    increment,
    serverTimestamp 
} from "https://www.gstatic.com/firebasejs/11.1.0/firebase-firestore.js";

let currentUser = null;
let currentSelectedTier = 'gold';
let currentAmount = 299;
let currentTierTitle = 'Grand Champion Backer';

// Initialize Auth & Data Listeners
document.addEventListener('DOMContentLoaded', () => {
    onAuthStateChanged(auth, (user) => {
        currentUser = user;
    });

    initWallOfFameListener();
    initCheckoutForm();

    // Check for PayRex redirect statuses
    const params = new URLSearchParams(window.location.search);
    const status = params.get('status');
    const tier = params.get('tier') || 'Supporter';

    if (status === 'success') {
        setTimeout(() => {
            if (window.showSuccessToast) {
                window.showSuccessToast("Payment Confirmed!", `Your ${tier} membership is being activated. Badges will appear shortly.`);
            } else if (window.toast) {
                window.toast.success(`Payment confirmed! Your perks will be active shortly.`);
            } else {
                alert(`Payment confirmed! Your perks will be active shortly.`);
            }
            window.history.replaceState({}, document.title, window.location.pathname);
        }, 500);
    } else if (status === 'cancelled') {
        setTimeout(() => {
            if (window.showErrorToast) {
                window.showErrorToast("Payment Cancelled", "Your checkout session was cancelled.");
            } else if (window.toast) {
                window.toast.error("Checkout cancelled.");
            }
            window.history.replaceState({}, document.title, window.location.pathname);
        }, 500);
    }
});

// 1. OPEN DONATION CHECKOUT MODAL
window.openDonationCheckout = function(tierKey, amount, tierTitle) {
    currentSelectedTier = tierKey;
    currentAmount = Number(amount);
    currentTierTitle = tierTitle;

    const modal = document.getElementById('donationCheckoutModal');
    const badgeEl = document.getElementById('modal-tier-badge');
    const titleEl = document.getElementById('modal-tier-title');
    const priceEl = document.getElementById('modal-tier-price');

    if (badgeEl) {
        let badgeText = 'GOLD PATRON';
        let badgeClass = 'bg-[#FFD700]/20 text-[#FFD700] border border-[#FFD700]/40';
        if (tierKey === 'bronze') {
            badgeText = 'BRONZE SCOUT';
            badgeClass = 'bg-amber-700/20 text-amber-400 border border-amber-600/40';
        } else if (tierKey === 'silver') {
            badgeText = 'SILVER ELITE';
            badgeClass = 'bg-slate-400/20 text-slate-200 border border-slate-300/40';
        } else if (tierKey === 'custom') {
            badgeText = 'COMMUNITY TIP JAR';
            badgeClass = 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40';
        }

        badgeEl.textContent = badgeText;
        badgeEl.className = `font-mono-tag text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${badgeClass}`;
    }

    if (titleEl) titleEl.textContent = tierTitle;
    if (priceEl) priceEl.textContent = `₱${currentAmount.toLocaleString()}/mo`;

    if (modal) {
        modal.classList.remove('hidden');
        modal.classList.add('flex');
    }
};

// 2. CLOSE MODAL
window.closeDonationModal = function() {
    const modal = document.getElementById('donationCheckoutModal');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }
};

// 3. CUSTOM DONATION HANDLER
window.handleCustomDonationSubmit = function() {
    const input = document.getElementById('custom-donation-input');
    const val = Number(input?.value || 0);

    if (!val || val < 50) {
        if (window.toast) {
            window.toast.warning('Minimum custom tip amount is ₱50.');
        } else {
            alert('Minimum custom tip amount is ₱50.');
        }
        return;
    }

    let tierKey = 'bronze';
    let tierTitle = 'Champion Scout Tier';

    if (val >= 299) {
        tierKey = 'gold';
        tierTitle = 'Grand Champion Patron';
    } else if (val >= 199) {
        tierKey = 'silver';
        tierTitle = 'Arena Elite Supporter';
    }

    window.openDonationCheckout(tierKey, val, tierTitle);
};

// 4. CHECKOUT FORM SUBMISSION & FIRESTORE SYNC
function initCheckoutForm() {
    const form = document.getElementById('donation-checkout-form');
    if (!form) return;

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const submitBtn = document.getElementById('donation-submit-btn');
        const originalBtnText = submitBtn ? submitBtn.innerHTML : '';
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.innerHTML = `
                <svg class="animate-spin -ml-1 mr-2 h-4 w-4 text-black inline-block" fill="none" viewBox="0 0 24 24">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
                </svg>
                Processing Contribution...
            `;
        }

        try {
            const messageInput = document.getElementById('donation-message-input');
            const message = (messageInput?.value || '').trim();
            const channel = form.querySelector('input[name="payment_channel"]:checked')?.value || 'gcash';

            let donorName = 'Anonymous Champion';
            let donorAvatar = 'pictures/cz_logo.png';
            let donorUid = currentUser ? currentUser.uid : null;

            if (currentUser) {
                try {
                    const userDoc = await getDoc(doc(db, "users", currentUser.uid));
                    if (userDoc.exists()) {
                        const ud = userDoc.data();
                        donorName = ud.ign || ud.displayName || currentUser.displayName || 'Champion';
                        donorAvatar = ud.avatar || 'pictures/cz_logo.png';
                    } else {
                        donorName = currentUser.displayName || 'Champion';
                    }
                } catch (err) {
                    console.warn("Could not fetch user profile details:", err);
                }
            }

            // Map tier to badge identifier (for legacy compat, although webhook handles logic now)
            let supporterBadge = 'scout';
            if (currentSelectedTier === 'gold') supporterBadge = 'patron';
            else if (currentSelectedTier === 'silver') supporterBadge = 'elite';

            const payload = {
                type: 'supporter_club',
                tier: currentSelectedTier,
                amount: currentAmount,
                message: message || "Fueling the future of global grassroots esports!",
                channel: channel,
                donorUid: donorUid || 'anonymous',
                donorName: donorName,
                donorAvatar: donorAvatar,
                successUrl: window.location.origin + "/support.html?status=success&tier=" + currentSelectedTier,
                cancelUrl: window.location.origin + "/support.html?status=cancelled"
            };

            // Call the Netlify serverless function for PayRex checkout
            const res = await fetch('/.netlify/functions/payrex-checkout', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const responseData = await res.json();

            if (!res.ok) {
                throw new Error(responseData?.error || `PayRex checkout request failed (HTTP ${res.status}).`);
            }

            if (responseData && responseData.url) {
                if (responseData.mode === 'test_sandbox') {
                    // Local Sandbox Simulation: Fulfill perks immediately since no webhook will fire
                    const durationDays = 30;
                    const durationMs = durationDays * 24 * 60 * 60 * 1000;
                    const now = Date.now();
                    const expiresAt = now + durationMs;

                    await addDoc(collection(db, "donations"), {
                        userId: donorUid || 'anonymous',
                        userName: donorName,
                        userAvatar: donorAvatar,
                        tier: currentSelectedTier,
                        badge: supporterBadge,
                        amount: currentAmount,
                        message: message || "Fueling the future of global grassroots esports!",
                        channel: 'PayRex Sandbox',
                        timestamp: now,
                        expiresAt: expiresAt,
                        durationDays: durationDays,
                        createdAt: serverTimestamp()
                    });

                    if (currentUser) {
                        let existingExpires = now;
                        try {
                            const uSnap = await getDoc(doc(db, "users", currentUser.uid));
                            if (uSnap.exists()) {
                                const ud = uSnap.data();
                                if (ud.supporterExpiresAt && ud.supporterExpiresAt > now) {
                                    existingExpires = ud.supporterExpiresAt;
                                }
                            }
                        } catch(e) {}

                        const userRef = doc(db, "users", currentUser.uid);
                        await setDoc(userRef, {
                            isSupporter: true,
                            supporterTier: currentSelectedTier,
                            supporterBadge: supporterBadge,
                            supporterSince: now,
                            supporterExpiresAt: existingExpires + durationMs,
                            totalDonated: increment(currentAmount),
                            supporterMessage: message || "",
                            showOnWallOfFame: true
                        }, { merge: true });
                    }
                }

                // Redirect to PayRex hosted checkout (or sandbox success URL)
                window.location.href = responseData.url;
                return;
            } else {
                throw new Error("No checkout URL returned from server.");
            }

            // The code below is left as a fallback but will not be reached if redirect succeeds
            // form.reset();


        } catch (error) {
            console.error("Donation submission error:", error);
            if (typeof window.showErrorToast === 'function') {
                window.showErrorToast("Error", "An error occurred while processing your contribution.");
            } else if (window.toast) {
                window.toast.error("An error occurred while processing your donation. Please try again.");
            } else {
                alert("An error occurred. Please try again.");
            }
        } finally {
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.innerHTML = originalBtnText;
            }
        }
    });
}

// 5. LIVE WALL OF FAME STREAM (Only active, non-expired backers)
let isAdminUser = false;

function initWallOfFameListener() {
    const grid = document.getElementById('wall-of-fame-grid');
    if (!grid) return;

    // Check admin status
    onAuthStateChanged(auth, async (user) => {
        if (user) {
            try {
                const uDoc = await getDoc(doc(db, "users", user.uid));
                if (uDoc.exists()) {
                    isAdminUser = uDoc.data().role === 'admin';
                }
            } catch(e) {}
        } else {
            isAdminUser = false;
        }
    });

    try {
        const q = query(collection(db, "donations"), orderBy("timestamp", "desc"), limit(24));
        onSnapshot(q, (snapshot) => {
            if (snapshot.empty) {
                renderEmptyWallOfFame(grid);
                return;
            }

            const now = Date.now();
            const donations = [];
            snapshot.forEach(doc => {
                const data = doc.data();
                // Filter: Show only if not expired (or no expiresAt set)
                if (!data.expiresAt || data.expiresAt > now) {
                    donations.push({ id: doc.id, ...data });
                }
            });

            if (donations.length === 0) {
                renderEmptyWallOfFame(grid);
                return;
            }

            renderWallOfFameItems(grid, donations);
        }, (err) => {
            console.warn("Live donations feed status:", err);
            renderEmptyWallOfFame(grid);
        });
    } catch (e) {
        console.error("Wall of fame listener init error:", e);
        renderEmptyWallOfFame(grid);
    }
}

function renderWallOfFameItems(container, items) {
    const now = Date.now();

    container.innerHTML = items.map(d => {
        const tier = d.tier || 'bronze';
        let badgeTag = 'SCOUT';
        let badgeClasses = 'bg-amber-700/20 text-amber-400 border-amber-600/30';
        let cardBorder = 'border-white/5';

        if (tier === 'gold') {
            badgeTag = 'PATRON VIP';
            badgeClasses = 'bg-[#FFD700]/20 text-[#FFD700] border-[#FFD700]/40';
            cardBorder = 'border-[#FFD700]/30 shadow-[0_0_15px_rgba(255,215,0,0.05)]';
        } else if (tier === 'silver') {
            badgeTag = 'ELITE';
            badgeClasses = 'bg-slate-400/20 text-slate-200 border-slate-300/30';
            cardBorder = 'border-slate-300/20';
        }

        const dateStr = d.timestamp ? new Date(d.timestamp).toLocaleDateString([], { month: 'short', day: 'numeric' }) : 'Recent';
        
        let daysLeftStr = '';
        if (d.expiresAt && d.expiresAt > now) {
            const days = Math.ceil((d.expiresAt - now) / (1000 * 60 * 60 * 24));
            daysLeftStr = `<span class="text-emerald-400">• ${days}d left</span>`;
        }

        return `
            <div class="clean-card p-5 rounded-2xl flex items-start gap-3.5 relative group ${cardBorder}">
                <div class="w-11 h-11 rounded-xl bg-black/60 border border-white/10 overflow-hidden shrink-0 flex items-center justify-center p-0.5">
                    <img src="${escapeHtml(d.userAvatar || 'pictures/cz_logo.png')}" alt="Avatar" class="w-full h-full object-cover rounded-lg">
                </div>
                <div class="overflow-hidden flex-1 min-w-0">
                    <div class="flex items-center justify-between gap-1 mb-1">
                        <span class="font-heading font-bold text-sm text-white truncate">${escapeHtml(d.userName || 'Champion Backer')}</span>
                        <div class="flex items-center gap-1.5 shrink-0">
                            <span class="font-mono-tag text-[9px] uppercase px-1.5 py-0.2 rounded border ${badgeClasses}">
                                ${badgeTag}
                            </span>
                            ${isAdminUser ? `
                                <button onclick="window.deleteSupporterFromWall('${d.id}')" title="Delete from Wall of Fame (Admin)" class="p-1 rounded-md bg-red-950/60 hover:bg-red-900 text-red-400 border border-red-500/40 text-[10px] transition-all cursor-pointer">
                                    <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                                </button>
                            ` : ''}
                        </div>
                    </div>
                    <p class="text-xs text-neutral-300 italic line-clamp-2 leading-relaxed">
                        "${escapeHtml(d.message || 'For the next generation of champions!')}"
                    </p>
                    <div class="mt-2 flex items-center justify-between text-[10px] font-mono-tag text-neutral-500">
                        <span>₱${Number(d.amount || 0).toLocaleString()} Backed</span>
                        <span class="flex items-center gap-1">${dateStr} ${daysLeftStr}</span>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

// 6. ADMIN DELETE SUPPORTER FROM WALL OF FAME
window.deleteSupporterFromWall = async (donationId) => {
    if (!donationId) return;

    const confirmed = await (window.showCustomConfirm 
        ? window.showCustomConfirm("Delete Supporter Listing?", "This will permanently remove this supporter contribution from the Wall of Fame.")
        : confirm("Remove this supporter listing from the Wall of Fame?"));
    
    if (!confirmed) return;

    try {
        const { deleteDoc, doc: fDoc } = await import("https://www.gstatic.com/firebasejs/11.1.0/firebase-firestore.js");
        await deleteDoc(fDoc(db, "donations", donationId));

        if (typeof window.showSuccessToast === 'function') {
            window.showSuccessToast("Removed", "Supporter entry deleted from the Wall of Fame.");
        } else {
            alert("Supporter entry deleted.");
        }
    } catch (err) {
        console.error("Error deleting donation:", err);
        if (typeof window.showErrorToast === 'function') {
            window.showErrorToast("Error", "Failed to delete supporter entry: " + err.message);
        } else {
            alert("Failed to delete entry: " + err.message);
        }
    }
};

function renderEmptyWallOfFame(container) {
    container.innerHTML = `
        <div class="col-span-full clean-card p-8 rounded-2xl text-center">
            <p class="font-heading font-bold text-sm text-neutral-300 uppercase tracking-wide">Be the First Active Supporter</p>
            <p class="text-xs text-neutral-500 mt-1">Back ChampZero and your badge and dedication will be spotlighted on this Wall of Fame during your active support period.</p>
        </div>
    `;
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}
