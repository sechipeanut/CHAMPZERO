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

            // Map tier to badge identifier
            let supporterBadge = 'scout';
            if (currentSelectedTier === 'gold') supporterBadge = 'patron';
            else if (currentSelectedTier === 'silver') supporterBadge = 'elite';

            // 1. Record donation in Firestore
            await addDoc(collection(db, "donations"), {
                userId: donorUid,
                userName: donorName,
                userAvatar: donorAvatar,
                tier: currentSelectedTier,
                badge: supporterBadge,
                amount: currentAmount,
                message: message || "Fueling the future of Southeast Asian esports!",
                channel: channel,
                timestamp: Date.now(),
                createdAt: serverTimestamp()
            });

            // 2. If logged in, update User profile with Supporter Badge & Perks
            if (currentUser) {
                const userRef = doc(db, "users", currentUser.uid);
                await setDoc(userRef, {
                    isSupporter: true,
                    supporterTier: currentSelectedTier,
                    supporterBadge: supporterBadge,
                    supporterSince: Date.now(),
                    totalDonated: increment(currentAmount),
                    supporterMessage: message || "",
                    showOnWallOfFame: true
                }, { merge: true });
            }

            window.closeDonationModal();

            if (window.toast) {
                window.toast.success(`Thank you, ${donorName}! Your ${currentTierTitle} perks and badges are now active.`);
            } else {
                alert(`Thank you, ${donorName}! Your supporter perks are active.`);
            }

            // Reset form
            form.reset();

        } catch (error) {
            console.error("Donation submission error:", error);
            if (window.toast) {
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

// 5. LIVE WALL OF FAME STREAM
function initWallOfFameListener() {
    const grid = document.getElementById('wall-of-fame-grid');
    if (!grid) return;

    try {
        const q = query(collection(db, "donations"), orderBy("timestamp", "desc"), limit(12));
        onSnapshot(q, (snapshot) => {
            if (snapshot.empty) {
                renderEmptyWallOfFame(grid);
                return;
            }

            const donations = [];
            snapshot.forEach(doc => donations.push({ id: doc.id, ...doc.data() }));
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

        return `
            <div class="clean-card p-5 rounded-2xl flex items-start gap-3.5 ${cardBorder}">
                <div class="w-11 h-11 rounded-xl bg-black/60 border border-white/10 overflow-hidden shrink-0 flex items-center justify-center p-0.5">
                    <img src="${escapeHtml(d.userAvatar || 'pictures/cz_logo.png')}" alt="Avatar" class="w-full h-full object-cover rounded-lg">
                </div>
                <div class="overflow-hidden flex-1">
                    <div class="flex items-center justify-between gap-1 mb-1">
                        <span class="font-heading font-bold text-sm text-white truncate">${escapeHtml(d.userName || 'Champion Backer')}</span>
                        <span class="font-mono-tag text-[9px] uppercase px-1.5 py-0.2 rounded border ${badgeClasses} shrink-0">
                            ${badgeTag}
                        </span>
                    </div>
                    <p class="text-xs text-neutral-300 italic line-clamp-2 leading-relaxed">
                        "${escapeHtml(d.message || 'For the next generation of champions!')}"
                    </p>
                    <div class="mt-2 flex items-center justify-between text-[10px] font-mono-tag text-neutral-500">
                        <span>₱${Number(d.amount || 0).toLocaleString()} Backed</span>
                        <span>${dateStr}</span>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

function renderEmptyWallOfFame(container) {
    container.innerHTML = `
        <div class="col-span-full clean-card p-8 rounded-2xl text-center">
            <p class="font-heading font-bold text-sm text-neutral-300 uppercase tracking-wide">Be the First Supporter</p>
            <p class="text-xs text-neutral-500 mt-1">Back ChampZero and your badge and dedication will be spotlighted on this Wall of Fame.</p>
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
