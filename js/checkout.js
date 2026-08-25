import { db, auth } from './firebase-config.js';
import { doc, getDoc, updateDoc, arrayUnion, arrayRemove } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-firestore.js";
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

    if (!tournamentId || !appId) {
        showError("Invalid checkout URL. Missing tournament or application ID.");
        return;
    }

    // Check if returning from a PayRex redirect (payment status check)
    const piClientSecret = params.get("payment_intent_client_secret");
    if (piClientSecret) {
        await handlePaymentReturn(piClientSecret, tournamentId, appId);
        return; // Don't initialize the form again
    }

    try {
        // Fetch tournament data
        const tRef = doc(db, "tournaments", tournamentId);
        const tSnap = await getDoc(tRef);
        if (!tSnap.exists()) throw new Error("Tournament not found");
        const tournament = tSnap.data();

        // Fetch application data
        const appRef = doc(db, "tournaments", tournamentId, "applications", appId);
        const appSnap = await getDoc(appRef);
        if (!appSnap.exists()) throw new Error("Application not found");
        const application = appSnap.data();

        // Check if already paid/approved
        if (application.status === 'approved') {
            document.getElementById('checkout-subtitle').textContent = "This application has already been paid and approved.";
            document.getElementById('loading-spinner').classList.add('hidden');
            return;
        }

        // Render Summary
        document.getElementById('summary-tournament').textContent = tournament.name;
        document.getElementById('summary-team').textContent = application.name || application.pendingData?.name || "Unknown Team";
        document.getElementById('summary-total').textContent = `₱${Number(tournament.entryFee).toFixed(2)}`;
        document.getElementById('order-summary').classList.remove('hidden');
        document.getElementById('checkout-subtitle').textContent = "Complete your payment to confirm your registration.";

        // Wait for auth state to fetch user info for billing
        onAuthStateChanged(auth, async (user) => {
            if (user) {
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

                await initializePayRex(tournamentId, appId, tournament.entryFee, billingDetails);
            } else {
                showError("You must be logged in to checkout.");
            }
        });

    } catch (error) {
        console.error(error);
        showError(error.message);
    }
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
        clientSecret = data.client_secret;

        // Initialize PayRex SDK (per official docs)
        payrex = window.Payrex(PAYREX_PUBLIC_KEY);

        elements = payrex.elements({ clientSecret });

        // Create payment element with billing info defaults
        paymentElement = elements.create("payment", {
            layout: "accordion",
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
        showError("Payment system is currently unavailable. Please try again later.");
    }
}

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
