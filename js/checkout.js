import { db, auth } from './firebase-config.js';
import { doc, getDoc, updateDoc, deleteDoc, arrayUnion, arrayRemove } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-auth.js";
let payrex;
let elements;
let paymentElement;
let clientSecret;

// Use your actual PayRex Public Key here
const PAYREX_PUBLIC_KEY = 'pk_live_tY99ZmtRAKr3jTLsp1zwkwdnPpAd8aAo';

document.addEventListener('DOMContentLoaded', async () => {
    const params = new URLSearchParams(window.location.search);
    const tournamentId = params.get('t');
    const appId = params.get('app');
    const piClientSecret = params.get("payment_intent_client_secret");

    // --- GUARD 1: Missing parameters ---
    // If no order params and not a PayRex return, redirect away immediately.
    if (!tournamentId || !appId) {
        if (!piClientSecret) {
            window.location.replace('/tournaments?error=invalid_checkout');
        } else {
            showError("Invalid checkout URL. Missing tournament or application ID.");
        }
        return;
    }

    // --- GUARD 2: Require authentication ---
    // Wait briefly for Firebase Auth to initialize before checking.
    await new Promise((resolve) => {
        const unsubscribe = onAuthStateChanged(auth, (user) => {
            unsubscribe();
            resolve(user);
        });
    }).then(async (user) => {
        if (!user) {
            // Redirect to login, preserving the checkout URL so user can return.
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
            // Fetch tournament data
            const tRef = doc(db, "tournaments", tournamentId);
            const tSnap = await getDoc(tRef);
            if (!tSnap.exists()) throw new Error("Tournament not found.");
            const tournament = tSnap.data();

            // Fetch application data
            const appRef = doc(db, "tournaments", tournamentId, "applications", appId);
            const appSnap = await getDoc(appRef);
            if (!appSnap.exists()) throw new Error("Application not found.");
            const application = appSnap.data();

            // --- GUARD 3a: Ownership check ---
            // Only the user who submitted the registration can access this checkout.
            if (application.registeredBy && application.registeredBy !== user.uid) {
                window.location.replace('/tournaments?error=unauthorized_checkout');
                return;
            }

            // --- GUARD 3b: Status check ---
            // Check if already paid/approved
            if (application.status === 'approved') {
                document.getElementById('loading-spinner').classList.add('hidden');
                document.getElementById('checkout-subtitle').textContent = "This application has already been paid and approved.";
                return;
            }

            // Guard against accessing a cancelled or invalid status order
            if (application.status && !['pending_payment', 'pending', 'submitted'].includes(application.status)) {
                window.location.replace('/tournaments?error=order_unavailable');
                return;
            }

            // Render Summary
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
            document.getElementById('checkout-subtitle').textContent = "Complete payment to confirm and lock your spot in the official roster.";

            let billingDetails = {
                name: user.displayName || application.captain,
                email: user.email || application.contact
            };

            try {
                const userDoc = await getDoc(doc(db, "users", user.uid));
                if (userDoc.exists()) {
                    billingDetails.name = userDoc.data().displayName || billingDetails.name;
                    billingDetails.email = userDoc.data().email || billingDetails.email;
                }
            } catch (e) { console.warn(e); }

            await initializePayRex(tournamentId, appId, actualAmount, billingDetails);

        } catch (error) {
            console.error(error);
            showError(error.message);
        }
    });
});

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
            throw new Error(err.error || "Failed to initialize payment");
        }

        const data = await response.json();
        clientSecret = data.client_secret || data.clientSecret;

        // If in test sandbox mode or fallback
        if (data.mode === 'test_sandbox' || (clientSecret && clientSecret.includes('sandbox'))) {
            document.getElementById('loading-spinner').classList.add('hidden');
            const formContainer = document.getElementById('payment-form-container');
            if (formContainer) {
                formContainer.innerHTML = `
                    <div class="space-y-4">
                        <div class="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 font-mono-tag text-xs space-y-2">
                            <div class="flex items-center gap-2 font-bold text-sm">
                                <span class="relative flex h-2 w-2"><span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span><span class="relative inline-flex rounded-full h-2 w-2 bg-amber-400"></span></span>
                                <span>PayRex Sandbox Mode (Localhost)</span>
                            </div>
                            <p class="text-neutral-300 text-xs font-sans">
                                PayRex checkout session initialized in test mode. Complete payment below to confirm your team entry in the tournament roster.
                            </p>
                        </div>

                        <button type="button" id="sandbox-pay-btn" onclick="window.confirmSandboxPayment('${tournamentId}', '${appId}', ${amount})" class="w-full py-3.5 rounded-xl bg-[#FFD700] hover:bg-[#FFF099] text-black font-heading font-extrabold uppercase text-xs tracking-wider cursor-pointer transition-all shadow-lg flex items-center justify-center gap-2">
                            <span>Complete Test Payment & Confirm Roster (₱${Number(amount).toFixed(2)})</span>
                        </button>
                    </div>
                `;
                formContainer.classList.remove('hidden');
            }
            return;
        }

        // Initialize PayRex SDK with Dark Night theme
        payrex = window.Payrex(PAYREX_PUBLIC_KEY);

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

        document.getElementById('loading-spinner').classList.add('hidden');
        document.getElementById('payment-form-container').classList.remove('hidden');

    } catch (error) {
        console.error("PayRex Init Error:", error);
        showError(error.message || "Payment system is currently unavailable. Please try again later.");
    }
}

window.confirmSandboxPayment = async function (tournamentId, appId, amount) {
    const btn = document.getElementById('sandbox-pay-btn');
    if (btn) {
        btn.disabled = true;
        btn.textContent = "Confirming Roster...";
    }
    const simulatedId = 'pi_test_' + Date.now();
    await approveApplication(tournamentId, appId, simulatedId);

    const statusEl = document.getElementById('checkout-subtitle');
    if (statusEl) {
        statusEl.textContent = "Payment successful! Redirecting to tournament...";
        statusEl.className = "text-green-400 mb-6 text-sm font-bold";
    }

    setTimeout(() => {
        window.location.href = `/tournaments?payment=success&t=${tournamentId}`;
    }, 1500);
};

// Pay action triggered by the button (per PayRex docs: payrex.attachPaymentMethod)
async function payAction() {
    const btn = document.getElementById('submit-button');
    const btnText = document.getElementById('btn-pay-text');
    const spinner = document.getElementById('btn-spinner');

    btn.disabled = true;
    btnText.classList.add('hidden');
    spinner.classList.remove('hidden');

    try {
        // return_url points back to this checkout page with t & app params.
        // PayRex will append payment_intent_client_secret to the URL.
        // On return, handlePaymentReturn() verifies status, approves in Firestore, then redirects.
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
        errorEl.textContent = err.message || "Payment failed. Please try again.";
        errorEl.classList.remove('hidden');

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
        if (tournamentId && appId) {
            const appRef = doc(db, "tournaments", tournamentId, "applications", appId);
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
        if (tournamentId && appId) {
            const appRef = doc(db, "tournaments", tournamentId, "applications", appId);
            await deleteDoc(appRef);
        }
    } catch (e) {
        console.error("Error cancelling registration:", e);
    }

    window.location.href = tournamentId ? `/tournaments?cancelled=registration&t=${tournamentId}` : '/tournaments';
}
window.cancelRegistrationAction = cancelRegistrationAction;

// -----------------------------------------------------------------------
// After PayRex redirects back, verify payment and approve in Firestore
// -----------------------------------------------------------------------
async function handlePaymentReturn(piClientSecret, tournamentId, appId) {
    const statusEl = document.getElementById('checkout-subtitle');
    const spinnerEl = document.getElementById('loading-spinner');

    statusEl.textContent = "Verifying your payment...";

    try {
        const payrexInstance = window.Payrex(PAYREX_PUBLIC_KEY);
        const paymentIntent = await payrexInstance.getPaymentIntent(piClientSecret);

        if (paymentIntent.status === "succeeded") {
            // Payment confirmed — approve the application in Firestore
            await approveApplication(tournamentId, appId, paymentIntent.id);

            spinnerEl?.classList.add('hidden');
            statusEl.textContent = "Payment successful! Redirecting to tournaments...";
            statusEl.className = "text-green-400 mb-6 text-sm font-bold";

            // Redirect to tournaments page after a short delay
            setTimeout(() => {
                window.location.href = `/tournaments?payment=success&t=${tournamentId}`;
            }, 2000);

        } else if (paymentIntent.status === "processing") {
            spinnerEl?.classList.add('hidden');
            statusEl.textContent = "Payment is still processing. You will be notified once confirmed.";
            statusEl.className = "text-yellow-400 mb-6 text-sm";
        } else {
            spinnerEl?.classList.add('hidden');
            statusEl.textContent = "Payment was not successful. Please try again.";
            statusEl.className = "text-red-400 mb-6 text-sm";
        }
    } catch (e) {
        console.error("Status check error:", e);
        spinnerEl?.classList.add('hidden');
        statusEl.textContent = "Could not verify payment. Please check your tournament registration.";
        statusEl.className = "text-red-400 mb-6 text-sm";
    }
}

// Approve the application and add to participants (mirrors the webhook logic)
async function approveApplication(tournamentId, appId, paymentIntentId) {
    try {
        const appRef = doc(db, "tournaments", tournamentId, "applications", appId);
        const appSnap = await getDoc(appRef);
        if (!appSnap.exists()) return;

        const appData = appSnap.data();
        if (appData.status === 'approved') return; // Already done (e.g. by webhook)

        const source = appData.pendingData || appData;

        // Add to tournament participants
        const tourneyRef = doc(db, "tournaments", tournamentId);
        const tourneySnap = await getDoc(tourneyRef);

        if (tourneySnap.exists()) {
            const participants = tourneySnap.data().participants || [];

            // Remove old entry if this application or user was already in participants
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

        // Mark application as approved and promote team fields to root level
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
    document.getElementById('loading-spinner').classList.add('hidden');
    document.getElementById('checkout-subtitle').textContent = msg;
    document.getElementById('checkout-subtitle').classList.add('text-red-500');
}
