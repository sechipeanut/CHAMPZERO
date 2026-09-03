import { db, auth } from './firebase-config.js';
import { doc, getDoc, updateDoc, deleteDoc, arrayUnion, arrayRemove } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-auth.js";

let payrex;
let elements;
let paymentElement;
let clientSecret;
let payrexPublicKey = null;

// Helpers to access live Firebase instances
const getDb = () => db || window.db || window.czFirebase?.db;
const getAuth = () => auth || window.auth || window.czFirebase?.auth;

async function initCheckout() {
    console.log('[Checkout] Initializing checkout flow...');

    // 1. Ensure Firebase loader is completely settled
    if (window.czFirebase?.ready) {
        try {
            await window.czFirebase.ready;
        } catch (fbErr) {
            console.warn('[Checkout] czFirebase readiness error:', fbErr.message);
        }
    }

    const currentAuth = getAuth();
    const currentDb = getDb();

    const params = new URLSearchParams(window.location.search);
    const tournamentId = params.get('t');
    const appId = params.get('app');
    const piClientSecret = params.get("payment_intent_client_secret");

    // --- GUARD 1: Missing parameters ---
    if (!tournamentId || !appId) {
        if (!piClientSecret) {
            window.location.replace('/tournaments?error=invalid_checkout');
        } else {
            showError("Invalid checkout URL. Missing tournament or application ID.");
        }
        return;
    }

    // --- GUARD 2: Require authentication ---
    let user = currentAuth?.currentUser;
    if (!user && currentAuth) {
        user = await new Promise((resolve) => {
            const timer = setTimeout(() => {
                resolve(currentAuth?.currentUser || null);
            }, 3500);

            const unsubscribe = onAuthStateChanged(currentAuth, (u) => {
                clearTimeout(timer);
                unsubscribe();
                resolve(u);
            });
        });
    }

    if (!user) {
        console.warn('[Checkout] No active user detected. Redirecting to login...');
        const returnUrl = encodeURIComponent(window.location.pathname + window.location.search);
        window.location.replace(`/login?redirect=${returnUrl}`);
        return;
    }

    // Check if returning from a PayRex redirect (payment status check)
    if (piClientSecret) {
        await handlePaymentReturn(piClientSecret, tournamentId, appId);
        return;
    }

    try {
        if (!currentDb) {
            throw new Error("Database service is initializing. Please refresh in a moment.");
        }

        // Fetch tournament data
        const tRef = doc(currentDb, "tournaments", tournamentId);
        const tSnap = await getDoc(tRef);
        if (!tSnap.exists()) throw new Error("Tournament not found or no longer available.");
        const tournament = tSnap.data();

        // Fetch application data
        const appRef = doc(currentDb, "tournaments", tournamentId, "applications", appId);
        const appSnap = await getDoc(appRef);
        if (!appSnap.exists()) throw new Error("Registration application not found.");
        const application = appSnap.data();

        // --- GUARD 3a: Ownership check ---
        if (application.registeredBy && application.registeredBy !== user.uid) {
            window.location.replace('/tournaments?error=unauthorized_checkout');
            return;
        }

        // --- GUARD 3b: Status check ---
        if (application.status === 'approved') {
            document.getElementById('loading-spinner')?.classList.add('hidden');
            const subTitle = document.getElementById('checkout-subtitle');
            if (subTitle) subTitle.textContent = "This application has already been paid and approved.";
            return;
        }

        if (application.status && !['pending_payment', 'pending', 'submitted'].includes(application.status)) {
            window.location.replace('/tournaments?error=order_unavailable');
            return;
        }

        // Render Summary Data
        const actualAmount = application.entryFee !== undefined ? Number(application.entryFee) : Number(tournament.entryFee || 0);
        const platformFee = actualAmount * 0.05;
        const netRegistrationFee = actualAmount - platformFee;
        const teamSize = parseInt(tournament.teamSize) || (tournament.registrationType === 'solo' ? 1 : 5);
        const formatLabel = teamSize === 1 ? '1v1 Solo Tournament' : `${teamSize}v${teamSize} Team Tournament`;

        const tTitle = document.getElementById('summary-tournament');
        if (tTitle) tTitle.textContent = tournament.name || 'Tournament Registration';
        const tTeam = document.getElementById('summary-team');
        if (tTeam) tTeam.textContent = application.name || application.pendingData?.name || application.captain || "Registered Competitor";
        const tCap = document.getElementById('summary-captain');
        if (tCap) tCap.textContent = application.captain || application.contact || "Confirmed";
        const tFmt = document.getElementById('summary-format');
        if (tFmt) tFmt.textContent = formatLabel;
        const tSub = document.getElementById('summary-subtotal');
        if (tSub) tSub.textContent = `₱${netRegistrationFee.toFixed(2)}`;
        const tPlat = document.getElementById('summary-platform-fee');
        if (tPlat) tPlat.textContent = `₱${platformFee.toFixed(2)}`;
        const tTot = document.getElementById('summary-total');
        if (tTot) tTot.textContent = `₱${actualAmount.toFixed(2)}`;

        const payBtnText = document.getElementById('btn-pay-text');
        if (payBtnText) payBtnText.textContent = `Confirm & Pay ₱${actualAmount.toFixed(2)}`;

        document.getElementById('order-summary')?.classList.remove('hidden');
        const subTitle = document.getElementById('checkout-subtitle');
        if (subTitle) subTitle.textContent = "Complete payment to confirm and lock your spot in the official roster.";

        let billingDetails = {
            name: user.displayName || application.captain || 'Player',
            email: user.email || application.contact || ''
        };

        try {
            const userDoc = await getDoc(doc(currentDb, "users", user.uid));
            if (userDoc.exists()) {
                billingDetails.name = userDoc.data().displayName || billingDetails.name;
                billingDetails.email = userDoc.data().email || billingDetails.email;
            }
        } catch (e) {
            console.warn('[Checkout] User profile enrichment warning:', e.message);
        }

        await initializePayRex(tournamentId, appId, actualAmount, billingDetails);

    } catch (error) {
        console.error('[Checkout Error]', error);
        showError(error.message);
    }
}

// Ensure execution whether DOMContentLoaded already fired or is still loading
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initCheckout);
} else {
    initCheckout();
}

async function initializePayRex(tournamentId, appId, amount, billingDetails) {
    try {
        const response = await fetch('/.netlify/functions/create-payrex-intent', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                tournamentId,
                appId,
                amount: amount,
                currency: 'PHP',
                customerName: billingDetails.name,
                customerEmail: billingDetails.email
            })
        });

        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.error || "Failed to initialize payment gateway");
        }

        const data = await response.json();
        clientSecret = data.clientSecret || data.client_secret;
        payrexPublicKey = data.publicKey || data.public_key || (window.__CZ_CONFIG__ && window.__CZ_CONFIG__.payrex && window.__CZ_CONFIG__.payrex.publicKey);

        if (!payrexPublicKey) {
            throw new Error("PayRex public key was not returned by the payment server.");
        }

        // Wait for external PayRex script to be available on window
        let attempts = 0;
        while (typeof window.Payrex !== 'function' && attempts < 30) {
            await new Promise(r => setTimeout(r, 100));
            attempts++;
        }

        if (typeof window.Payrex !== 'function') {
            throw new Error("PayRex SDK library is unavailable. Please check your internet connection.");
        }

        // Initialize PayRex SDK with dynamic key returned from backend BFF
        payrex = window.Payrex(payrexPublicKey);

        elements = payrex.elements({
            clientSecret,
            appearance: {
                theme: 'night',
                variables: {
                    colorPrimary: '#FFD700',
                    colorBackground: '#0d0d16',
                    colorText: '#f3f4f6',
                    colorDanger: '#ef4444',
                    fontFamily: 'Poppins, sans-serif',
                    borderRadius: '12px',
                    spacingUnit: '4px'
                },
                rules: {
                    '.Tab': {
                        backgroundColor: '#12121e',
                        border: '1px solid rgba(255, 255, 255, 0.12)',
                        color: '#9ca3af',
                        borderRadius: '10px'
                    },
                    '.Tab--selected': {
                        borderColor: '#FFD700',
                        backgroundColor: '#1a1a2c',
                        color: '#FFD700'
                    },
                    '.Block': {
                        backgroundColor: '#12121e',
                        border: '1px solid rgba(255, 255, 255, 0.12)',
                        borderRadius: '10px'
                    },
                    '.Input': {
                        backgroundColor: '#161626',
                        border: '1px solid rgba(255, 255, 255, 0.18)',
                        color: '#ffffff',
                        borderRadius: '8px'
                    },
                    '.Label': {
                        color: '#d1d5db',
                        fontWeight: '600'
                    }
                }
            }
        });

        // Create payment element with billing info defaults
        paymentElement = elements.create("payment", {
            layout: {
                type: 'tabs',
                defaultCollapsed: false
            },
            defaultValues: {
                billingDetails: {
                    name: billingDetails.name,
                    email: billingDetails.email
                }
            }
        });

        paymentElement.mount('#payment-element');

        document.getElementById('loading-spinner')?.classList.add('hidden');
        document.getElementById('payment-form-container')?.classList.remove('hidden');

    } catch (error) {
        console.error("PayRex Init Error:", error);
        showError(error.message || "Payment system is currently unavailable. Please try again later.");
    }
}

// Pay action triggered by the button
async function payAction() {
    const btn = document.getElementById('submit-button');
    const btnText = document.getElementById('btn-pay-text');
    const spinner = document.getElementById('btn-spinner');

    btn.disabled = true;
    btnText.classList.add('hidden');
    spinner.classList.remove('hidden');

    try {
        const params = new URLSearchParams(window.location.search);
        await payrex.attachPaymentMethod({
            elements,
            options: {
                return_url: `${window.location.origin}/checkout.html?t=${params.get('t')}&app=${params.get('app')}`,
            },
        });
    } catch (err) {
        console.error("Payment error:", err);
        const errorEl = document.getElementById('error-message');
        if (errorEl) {
            errorEl.textContent = err.message || "Payment failed. Please try again.";
            errorEl.classList.remove('hidden');
        }

        btn.disabled = false;
        btnText.classList.remove('hidden');
        spinner.classList.add('hidden');
    }
}

window.payAction = payAction;

// Continue Later Action
async function continueLaterAction() {
    const params = new URLSearchParams(window.location.search);
    const tournamentId = params.get('t');
    const appId = params.get('app');

    const btn = document.getElementById('btn-continue-later');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<span>Saving...</span>`;
    }

    try {
        const currentDb = getDb();
        if (tournamentId && appId && currentDb) {
            const appRef = doc(currentDb, "tournaments", tournamentId, "applications", appId);
            await updateDoc(appRef, {
                status: 'pending_payment',
                paymentPending: true,
                updatedAt: new Date().toISOString()
            });
        }
    } catch (e) {
        console.warn("Could not mark status as pending_payment:", e);
    }

    window.location.href = tournamentId ? `/tournaments?saved=pending_payment&t=${tournamentId}` : '/tournaments';
}
window.continueLaterAction = continueLaterAction;

// Cancel Registration Action
async function cancelRegistrationAction() {
    const params = new URLSearchParams(window.location.search);
    const tournamentId = params.get('t');
    const appId = params.get('app');

    const confirmCancel = confirm("Are you sure you want to cancel and withdraw this registration?");
    if (!confirmCancel) return;

    const btn = document.getElementById('btn-cancel-reg');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<span>Cancelling...</span>`;
    }

    try {
        const currentDb = getDb();
        if (tournamentId && appId && currentDb) {
            const appRef = doc(currentDb, "tournaments", tournamentId, "applications", appId);
            await deleteDoc(appRef);
        }
    } catch (e) {
        console.error("Error cancelling registration:", e);
    }

    window.location.href = tournamentId ? `/tournaments?cancelled=registration&t=${tournamentId}` : '/tournaments';
}
window.cancelRegistrationAction = cancelRegistrationAction;

// After PayRex redirects back, verify payment and approve in Firestore
async function handlePaymentReturn(piClientSecret, tournamentId, appId) {
    const statusEl = document.getElementById('checkout-subtitle');
    const spinnerEl = document.getElementById('loading-spinner');

    if (statusEl) statusEl.textContent = "Verifying your payment...";

    try {
        if (!payrexPublicKey) {
            payrexPublicKey = (window.__CZ_CONFIG__ && window.__CZ_CONFIG__.payrex && window.__CZ_CONFIG__.payrex.publicKey) || null;
            if (!payrexPublicKey) {
                const resp = await fetch('/.netlify/functions/create-payrex-intent', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ amount: 20 })
                });
                const d = await resp.json();
                payrexPublicKey = d.publicKey;
            }
        }

        const payrexInstance = window.Payrex(payrexPublicKey);
        const paymentIntent = await payrexInstance.getPaymentIntent(piClientSecret);

        if (paymentIntent.status === "succeeded") {
            await approveApplication(tournamentId, appId, paymentIntent.id);

            spinnerEl?.classList.add('hidden');
            if (statusEl) {
                statusEl.textContent = "Payment successful! Redirecting to tournaments...";
                statusEl.className = "text-green-400 mb-6 text-sm font-bold";
            }

            setTimeout(() => {
                window.location.href = `/tournaments?payment=success&t=${tournamentId}`;
            }, 2000);

        } else if (paymentIntent.status === "processing") {
            spinnerEl?.classList.add('hidden');
            if (statusEl) {
                statusEl.textContent = "Payment is still processing. You will be notified once confirmed.";
                statusEl.className = "text-yellow-400 mb-6 text-sm";
            }
        } else {
            spinnerEl?.classList.add('hidden');
            if (statusEl) {
                statusEl.textContent = "Payment was not successful. Please try again.";
                statusEl.className = "text-red-400 mb-6 text-sm";
            }
        }
    } catch (e) {
        console.error("Status check error:", e);
        spinnerEl?.classList.add('hidden');
        if (statusEl) {
            statusEl.textContent = "Could not verify payment. Please check your tournament registration.";
            statusEl.className = "text-red-400 mb-6 text-sm";
        }
    }
}

// Approve the application and add to participants
async function approveApplication(tournamentId, appId, paymentIntentId) {
    try {
        const currentDb = getDb();
        if (!currentDb) return;

        const appRef = doc(currentDb, "tournaments", tournamentId, "applications", appId);
        const appSnap = await getDoc(appRef);
        if (!appSnap.exists()) return;

        const appData = appSnap.data();
        if (appData.status === 'approved') return;

        const source = appData.pendingData || appData;

        // Add to tournament participants
        const tourneyRef = doc(currentDb, "tournaments", tournamentId);
        const tourneySnap = await getDoc(tourneyRef);

        if (tourneySnap.exists()) {
            const participants = tourneySnap.data().participants || [];
            const oldEntry = participants.find(p => p.applicationId === appId || p.registeredBy === appData.registeredBy);
            if (oldEntry) {
                await updateDoc(tourneyRef, { participants: arrayRemove(oldEntry) });
            }

            const newParticipantData = {
                name: source.name,
                captain: source.captain,
                contact: source.contact,
                members: source.members,
                teamId: source.teamId,
                registeredBy: appData.registeredBy,
                applicationId: appId,
                ...(source.entryFeeProofURL && { entryFeeProofURL: source.entryFeeProofURL }),
                paymentMethod: 'PayRex',
                paymentIntentId: paymentIntentId
            };

            await updateDoc(tourneyRef, { participants: arrayUnion(newParticipantData) });
        }

        // Mark application as approved
        const appUpdatePayload = {
            name: source.name,
            captain: source.captain,
            contact: source.contact,
            members: source.members,
            teamId: source.teamId,
            status: 'approved',
            hasPendingUpdate: false,
            pendingData: null
        };
        if (source.entryFeeProofURL) appUpdatePayload.entryFeeProofURL = source.entryFeeProofURL;

        await updateDoc(appRef, appUpdatePayload);
        console.log(`Application ${appId} approved via client-side payment verification.`);
    } catch (err) {
        console.error("Error approving application:", err);
    }
}

function showError(msg) {
    document.getElementById('loading-spinner')?.classList.add('hidden');
    const errorEl = document.getElementById('error-message');
    if (errorEl) {
        errorEl.textContent = msg;
        errorEl.classList.remove('hidden');
    }
}
