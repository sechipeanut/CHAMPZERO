const admin = require('firebase-admin');

if (!admin.apps.length) {
  try {
    const privateKey = process.env.FIREBASE_PRIVATE_KEY 
      ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
      : undefined;

    if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && privateKey) {
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey: privateKey
        })
      });
    }
  } catch (initError) {
    console.error('Firebase initialization error in create-payrex-intent:', initError);
  }
}

exports.handler = async (event, context) => {
    // Set CORS headers
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }

    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, headers, body: 'Method Not Allowed' };
    }

    try {
        const payload = JSON.parse(event.body || '{}');
        const { tournamentId, appId, amount, currency, customerName, customerEmail } = payload;

        const PAYREX_SECRET_KEY = process.env.PAYREX_SECRET_KEY;
        if (!PAYREX_SECRET_KEY || PAYREX_SECRET_KEY.includes('REPLACE_WITH')) {
            return {
                statusCode: 500,
                headers: { ...headers, 'Content-Type': 'application/json' },
                body: JSON.stringify({ error: 'PayRex gateway is not configured on this environment.' })
            };
        }

        let verifiedAmount = parseFloat(amount);

        // Server-Side Verification: Query Firestore for tournament's true entryFee
        if (tournamentId && admin.apps.length) {
            try {
                const tourneyDoc = await admin.firestore().collection('tournaments').doc(tournamentId).get();
                if (tourneyDoc.exists) {
                    const tourneyData = tourneyDoc.data();
                    const officialFee = parseFloat(tourneyData.entryFee);
                    if (!isNaN(officialFee) && officialFee > 0) {
                        verifiedAmount = officialFee;
                    }
                }
            } catch (dbErr) {
                console.warn('Could not verify tournament price from Firestore, falling back to payload:', dbErr);
            }
        }

        if (!verifiedAmount || verifiedAmount <= 0) {
            return {
                statusCode: 400,
                headers: { ...headers, 'Content-Type': 'application/json' },
                body: JSON.stringify({ error: 'Invalid payment amount specified.' })
            };
        }

        const amountInCents = Math.round(verifiedAmount * 100);

        const auth = Buffer.from(PAYREX_SECRET_KEY + ':').toString('base64');
        const params = new URLSearchParams({
            amount: amountInCents,
            currency: currency || 'PHP',
            'metadata[tournamentId]': tournamentId || '',
            'metadata[appId]': appId || '',
            'metadata[customerName]': customerName || '',
            'metadata[customerEmail]': customerEmail || '',
            description: `ChampZero Tournament: ${tournamentId || 'Registration'}`
        });

        // Use standard node 18 fetch
        const response = await fetch('https://api.payrexhq.com/payment_intents', {
            method: 'POST',
            headers: {
                'Authorization': `Basic ${auth}`,
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: params
        });

        if (!response.ok) {
            const err = await response.text();
            console.error("PayRex API Error:", err);
            return {
                statusCode: response.status,
                headers: { ...headers, 'Content-Type': 'application/json' },
                body: JSON.stringify({ error: 'Failed to create payment intent with PayRex.' })
            };
        }

        const data = await response.json();

        return {
            statusCode: 200,
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({ client_secret: data.client_secret })
        };
    } catch (error) {
        console.error(error);
        return {
            statusCode: 500,
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: error.message })
        };
    }
};
