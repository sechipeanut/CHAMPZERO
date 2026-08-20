const admin = require('firebase-admin');
const crypto = require('crypto');

// Initialize Firebase Admin (only once)
if (!admin.apps.length) {
  try {
    const privateKey = process.env.FIREBASE_PRIVATE_KEY 
      ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
      : undefined;

    if (!process.env.FIREBASE_PROJECT_ID || !process.env.FIREBASE_CLIENT_EMAIL || !privateKey) {
      throw new Error('Missing Firebase environment variables');
    }

    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: privateKey
      })
    });
  } catch (initError) {
    console.error('Firebase initialization error:', initError);
    throw initError;
  }
}

exports.handler = async (event, context) => {
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

    try {
        const webhookSecret = process.env.PAYREX_WEBHOOK_SECRET;
        const signatureHeader = event.headers['payrex-signature'] || event.headers['x-webhook-signature'];

        if (webhookSecret && signatureHeader) {
            // PayRex typically uses standard HMAC SHA256 of the raw body
            const hmac = crypto.createHmac('sha256', webhookSecret);
            hmac.update(event.body);
            const expectedSignature = hmac.digest('hex');

            // If signature is Stripe-like (t=...,v1=...), you would extract v1 here.
            // Assuming standard hex signature based on PayRex docs:
            let providedSignature = signatureHeader;
            if (signatureHeader.includes('v1=')) {
                // Parse Stripe-like signature if present
                const parts = signatureHeader.split(',').reduce((acc, part) => {
                    const [k, v] = part.split('=');
                    acc[k] = v;
                    return acc;
                }, {});
                if (parts.v1) {
                    providedSignature = parts.v1;
                    // Note: Stripe-like signatures include the timestamp in the payload string: `${t}.${event.body}`
                    // For PayRex, if they strictly follow Stripe, it would be:
                    const stripeHmac = crypto.createHmac('sha256', webhookSecret);
                    stripeHmac.update(`${parts.t}.${event.body}`);
                    const expectedStripeSig = stripeHmac.digest('hex');
                    
                    if (expectedStripeSig !== providedSignature && expectedSignature !== providedSignature) {
                        return { statusCode: 401, body: 'Invalid signature' };
                    }
                }
            } else {
                // Direct hex comparison
                try {
                    const isVerified = crypto.timingSafeEqual(
                        Buffer.from(providedSignature, 'hex'),
                        Buffer.from(expectedSignature, 'hex')
                    );
                    if (!isVerified) return { statusCode: 401, body: 'Invalid signature' };
                } catch (e) {
                    return { statusCode: 401, body: 'Invalid signature format' };
                }
            }
        }

        const payload = JSON.parse(event.body);

        // Very basic PayRex webhook handler
        if (payload.type === 'payment_intent.succeeded') {
            const paymentIntent = payload.data;
            const { tournamentId, appId } = paymentIntent.metadata || {};

            if (tournamentId && appId) {
                const db = admin.firestore();
                const appRef = db.collection('tournaments').doc(tournamentId).collection('applications').doc(appId);
                const tourneyRef = db.collection('tournaments').doc(tournamentId);

                // Run a transaction to safely approve the application and add to participants
                await db.runTransaction(async (transaction) => {
                    const appDoc = await transaction.get(appRef);
                    if (!appDoc.exists) throw new Error("Application not found");

                    const appData = appDoc.data();
                    if (appData.status === 'approved') {
                        console.log("Application already approved");
                        return; // Already processed
                    }

                    const source = appData.pendingData || appData;
                    const participants = (await transaction.get(tourneyRef)).data().participants || [];
                    const oldEntry = participants.find(p => p.applicationId === appId || p.registeredBy === appData.registeredBy);

                    if (oldEntry) {
                        transaction.update(tourneyRef, {
                            participants: admin.firestore.FieldValue.arrayRemove(oldEntry)
                        });
                    }

                    // Add to tournament participants array
                    const newParticipantData = {
                        name: source.name,
                        captain: source.captain,
                        contact: source.contact,
                        members: source.members,
                        teamId: source.teamId,
                        registeredBy: appData.registeredBy,
                        applicationId: appId,
                        paymentMethod: 'PayRex',
                        paymentIntentId: paymentIntent.id
                    };

                    transaction.update(tourneyRef, {
                        participants: admin.firestore.FieldValue.arrayUnion(newParticipantData)
                    });

                    // Update application status and promote fields to root level
                    transaction.update(appRef, {
                        name: source.name,
                        captain: source.captain,
                        contact: source.contact,
                        members: source.members,
                        teamId: source.teamId,
                        status: 'approved',
                        hasPendingUpdate: false,
                        pendingData: null
                    });
                });

                console.log(`Successfully approved application ${appId} for tournament ${tournamentId}`);
            } else {
                console.warn("Webhook received but missing metadata", paymentIntent.id);
            }
        }

        return { statusCode: 200, body: JSON.stringify({ received: true }) };
    } catch (error) {
        console.error("Webhook Error:", error);
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};
