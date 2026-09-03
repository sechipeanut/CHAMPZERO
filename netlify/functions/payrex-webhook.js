// netlify/functions/payrex-webhook.js
// Secure PayRex Webhook Handler with Cryptographic Verification

const crypto = require('crypto');
const { initFirebaseAdmin } = require('./utils/firebase-admin');

exports.handler = async (event, context) => {
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

    try {
        const webhookSecret = process.env.PAYREX_WEBHOOK_SECRET;
        if (!webhookSecret || typeof webhookSecret !== 'string' || webhookSecret.trim().length === 0) {
            console.error('CRITICAL: PAYREX_WEBHOOK_SECRET is not configured on the server. Rejecting incoming webhook.');
            return {
                statusCode: 500,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ error: 'Server configuration error: Webhook verification secret missing' })
            };
        }

        const signatureHeader = event.headers['payrex-signature'] || 
                                event.headers['x-webhook-signature'] || 
                                event.headers['Payrex-Signature'];

        if (!signatureHeader || typeof signatureHeader !== 'string') {
            return {
                statusCode: 400,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ error: 'Bad Request: Missing or invalid webhook signature header' })
            };
        }

        if (!event.body) {
            return {
                statusCode: 400,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ error: 'Bad Request: Empty request payload' })
            };
        }

        // Strict Cryptographic HMAC SHA-256 Verification
        let isSignatureValid = false;
        try {
            if (signatureHeader.includes('v1=')) {
                const parts = signatureHeader.split(',').reduce((acc, part) => {
                    const [k, v] = part.split('=');
                    if (k && v) acc[k.trim()] = v.trim();
                    return acc;
                }, {});

                if (parts.v1 && parts.t) {
                    const timestamp = parseInt(parts.t, 10);
                    const currentTime = Math.floor(Date.now() / 1000);
                    // Prevent replay attacks with 5-minute threshold
                    if (!isNaN(timestamp) && Math.abs(currentTime - timestamp) <= 300) {
                        const timestampedPayload = `${parts.t}.${event.body}`;
                        const expectedTimestampedSig = crypto.createHmac('sha256', webhookSecret)
                            .update(timestampedPayload)
                            .digest('hex');

                        const bufProvided = Buffer.from(parts.v1, 'hex');
                        const bufExpected = Buffer.from(expectedTimestampedSig, 'hex');
                        if (bufProvided.length === bufExpected.length && crypto.timingSafeEqual(bufProvided, bufExpected)) {
                            isSignatureValid = true;
                        }
                    }
                }
            } else {
                const expectedSignature = crypto.createHmac('sha256', webhookSecret)
                    .update(event.body)
                    .digest('hex');

                const bufProvided = Buffer.from(signatureHeader.trim(), 'hex');
                const bufExpected = Buffer.from(expectedSignature, 'hex');
                if (bufProvided.length === bufExpected.length && crypto.timingSafeEqual(bufProvided, bufExpected)) {
                    isSignatureValid = true;
                }
            }
        } catch (sigErr) {
            console.error('Webhook cryptographic comparison error:', sigErr.message);
            isSignatureValid = false;
        }

        if (!isSignatureValid) {
            return {
                statusCode: 400,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ error: 'Bad Request: Invalid webhook signature' })
            };
        }

        const payload = JSON.parse(event.body || '{}');
        const eventType = payload.type || payload.event || '';
        const eventData = payload.data?.object || payload.data || {};
        const metadata = eventData.metadata || payload.metadata || {};

        const { admin, db } = initFirebaseAdmin();

        // 1. PAYMENT EVENT PROCESSING
        const isPaymentSuccessful = [
            'payment_intent.succeeded',
            'checkout_session.completed',
            'checkout.session.completed',
            'payment.paid',
            'payment.succeeded'
        ].includes(eventType);

        if (isPaymentSuccessful) {
            const { tournamentId, appId, organizerId, type, amount, orderId } = metadata;

            // Scenario A: Tournament Entry Application
            if (tournamentId && appId) {
                const appRef = db.collection('tournaments').doc(tournamentId).collection('applications').doc(appId);
                const tourneyRef = db.collection('tournaments').doc(tournamentId);

                await db.runTransaction(async (transaction) => {
                    const appDoc = await transaction.get(appRef);
                    if (!appDoc.exists) return;

                    const appData = appDoc.data();
                    if (appData.status === 'approved') return;

                    const source = appData.pendingData || appData;
                    const participants = (await transaction.get(tourneyRef)).data()?.participants || [];
                    const oldEntry = participants.find(p => p.applicationId === appId || p.registeredBy === appData.registeredBy);

                    if (oldEntry) {
                        transaction.update(tourneyRef, {
                            participants: admin.firestore.FieldValue.arrayRemove(oldEntry)
                        });
                    }

                    const newParticipantData = {
                        name: source.name,
                        captain: source.captain,
                        contact: source.contact,
                        members: source.members || [],
                        teamId: source.teamId || '',
                        registeredBy: appData.registeredBy,
                        applicationId: appId,
                        paymentMethod: 'PayRex',
                        paymentIntentId: eventData.id || ''
                    };

                    transaction.update(tourneyRef, {
                        participants: admin.firestore.FieldValue.arrayUnion(newParticipantData)
                    });

                    transaction.update(appRef, {
                        name: source.name,
                        captain: source.captain,
                        contact: source.contact,
                        members: source.members || [],
                        teamId: source.teamId || '',
                        status: 'approved',
                        hasPendingUpdate: false,
                        pendingData: null
                    });
                });

                console.log(`Successfully approved application ${appId} for tournament ${tournamentId}`);
            }
            
            // Scenario B: Organizer Escrow Top-Up Record
            else if (type === 'organizer_cashin' && organizerId) {
                const cashinAmount = parseFloat(amount || (eventData.amount ? eventData.amount / 100 : 0));
                if (cashinAmount > 0) {
                    await db.collection('cashins').add({
                        userId: organizerId,
                        uid: organizerId,
                        amount: cashinAmount,
                        channel: 'PayRex Checkout',
                        status: 'approved',
                        referenceNumber: eventData.id || `PRX_${Date.now()}`,
                        notes: metadata.notes || 'Automated PayRex escrow deposit',
                        createdAt: admin.firestore.FieldValue.serverTimestamp(),
                        verifiedAt: admin.firestore.FieldValue.serverTimestamp(),
                        verifiedBy: 'system_webhook'
                    });
                    console.log(`Successfully logged cash-in top-up for organizer ${organizerId}: ₱${cashinAmount}`);
                }
            }
            
            // Scenario C: Supporter Club Subscription
            else if (type === 'supporter_club' && metadata.donorUid) {
                const { tier, donorUid, donorName, donorAvatar, message } = metadata;
                const paidAmount = parseFloat(amount || (eventData.amount ? eventData.amount / 100 : 0));
                
                let supporterBadge = 'scout';
                if (tier === 'gold') supporterBadge = 'patron';
                else if (tier === 'silver') supporterBadge = 'elite';

                const durationDays = 30;
                const durationMs = durationDays * 24 * 60 * 60 * 1000;
                const now = Date.now();
                const expiresAt = now + durationMs;

                await db.collection('donations').add({
                    userId: donorUid,
                    userName: donorName || 'Anonymous Champion',
                    userAvatar: donorAvatar || 'pictures/cz_logo.png',
                    tier: tier || 'bronze',
                    badge: supporterBadge,
                    amount: paidAmount,
                    message: message || "Fueling the future of global grassroots esports!",
                    channel: 'PayRex Checkout',
                    timestamp: now,
                    expiresAt: expiresAt,
                    durationDays: durationDays,
                    createdAt: admin.firestore.FieldValue.serverTimestamp(),
                    paymentIntentId: eventData.id || ''
                });

                if (donorUid && donorUid !== 'anonymous') {
                    const userRef = db.collection('users').doc(donorUid);
                    await db.runTransaction(async (transaction) => {
                        const userDoc = await transaction.get(userRef);
                        let existingExpires = now;
                        
                        if (userDoc.exists) {
                            const ud = userDoc.data();
                            if (ud.supporterExpiresAt && ud.supporterExpiresAt > now) {
                                existingExpires = ud.supporterExpiresAt;
                            }
                        }
                        
                        transaction.set(userRef, {
                            isSupporter: true,
                            supporterTier: tier || 'bronze',
                            supporterBadge: supporterBadge,
                            supporterSince: now,
                            supporterExpiresAt: existingExpires + durationMs,
                            totalDonated: admin.firestore.FieldValue.increment(paidAmount),
                            supporterMessage: message || "",
                            showOnWallOfFame: true
                        }, { merge: true });
                    });
                }
            }

            // Scenario D: Shop Order Status Update
            else if (orderId) {
                const orderRef = db.collection('orders').doc(orderId);
                await orderRef.update({
                    status: 'paid',
                    paymentStatus: 'succeeded',
                    paymentIntentId: eventData.id || '',
                    paidAt: new Date().toISOString()
                });
                console.log(`Successfully updated order ${orderId} status to paid.`);
            }
        }

        return { statusCode: 200, body: JSON.stringify({ received: true }) };
    } catch (error) {
        console.error("Webhook Error:", error.message);
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};
