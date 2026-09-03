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

        const PAYREX_SECRET_KEY = process.env.PAYREX_SECRET_KEY || process.env.PAYREX_SK || process.env.PAYREX_API_KEY;
        let verifiedAmount = parseFloat(amount) || 0;

        if (!PAYREX_SECRET_KEY || PAYREX_SECRET_KEY.includes('REPLACE_WITH') || PAYREX_SECRET_KEY.length < 10) {
            return {
                statusCode: 500,
                headers: { ...headers, 'Content-Type': 'application/json' },
                body: JSON.stringify({ error: 'Server configuration error: Payment gateway credentials unconfigured.' })
            };
        }

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

        if (amountInCents < 2000) {
            return {
                statusCode: 400,
                headers: { ...headers, 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    error: `PayRex requires a minimum transaction amount of ₱20.00 (Current: ₱${verifiedAmount.toFixed(2)}). Please contact the tournament organizer to adjust the fee or use Manual Payment.` 
                })
            };
        }

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
        params.append('payment_methods[]', 'gcash');
        params.append('payment_methods[]', 'maya');

        // PayRex official endpoint
        let response;
        try {
            response = await fetch('https://api.payrexhq.com/payment_intents', {
                method: 'POST',
                headers: {
                    'Authorization': `Basic ${auth}`,
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: params
            });
            if (!response.ok && response.status >= 500) {
                response = await fetch('https://api.payrex.com/v1/payment_intents', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Basic ${auth}`,
                        'Content-Type': 'application/x-www-form-urlencoded'
                    },
                    body: params
                });
            }
        } catch (netErr) {
            response = await fetch('https://api.payrex.com/v1/payment_intents', {
                method: 'POST',
                headers: {
                    'Authorization': `Basic ${auth}`,
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: params
            });
        }

        if (!response.ok) {
            const err = await response.text();
            console.error("PayRex API Error:", err);
            return {
                statusCode: response.status,
                headers: { ...headers, 'Content-Type': 'application/json' },
                body: JSON.stringify({ error: 'Failed to create payment intent with PayRex: ' + err })
            };
        }

        const data = await response.json();

        return {
            statusCode: 200,
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({ client_secret: data.client_secret || data.clientSecret })
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
