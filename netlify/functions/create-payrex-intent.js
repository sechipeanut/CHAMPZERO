// netlify/functions/create-payrex-intent.js
// Secure PayRex Payment Intent Creation

const { initFirebaseAdmin } = require('./utils/firebase-admin');

exports.handler = async (event, context) => {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Content-Type': 'application/json'
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }

    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method Not Allowed' }) };
    }

    try {
        const payload = JSON.parse(event.body || '{}');
        const { tournamentId, appId, amount, currency, customerName, customerEmail } = payload;

        const PAYREX_SECRET_KEY = process.env.PAYREX_SECRET_KEY;
        const PAYREX_PUBLIC_KEY = process.env.PAYREX_PUBLIC_KEY;

        if (!PAYREX_SECRET_KEY || !PAYREX_PUBLIC_KEY) {
            console.error('Missing PayRex environment variables on server.');
            return {
                statusCode: 500,
                headers,
                body: JSON.stringify({ error: 'Server configuration error: Payment gateway credentials missing.' })
            };
        }

        let verifiedAmount = parseFloat(amount) || 0;

        // Server-Side Verification against Firestore to prevent price tampering
        try {
            const { db } = initFirebaseAdmin();
            if (tournamentId) {
                const tourneyDoc = await db.collection('tournaments').doc(tournamentId).get();
                if (tourneyDoc.exists) {
                    const tourneyData = tourneyDoc.data();
                    const officialFee = parseFloat(tourneyData.entryFee);
                    if (!isNaN(officialFee) && officialFee > 0) {
                        verifiedAmount = officialFee;
                    }
                }
            }
        } catch (dbErr) {
            console.warn('Could not verify tournament price from Firestore, falling back to payload amount:', dbErr.message);
        }

        if (!verifiedAmount || verifiedAmount <= 0) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'Bad Request: Valid positive payment amount is required.' })
            };
        }

        const amountInCents = Math.round(verifiedAmount * 100);

        if (amountInCents < 2000) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ 
                    error: `PayRex requires a minimum transaction amount of ₱20.00 (Current: ₱${verifiedAmount.toFixed(2)}).` 
                })
            };
        }

        const params = new URLSearchParams({
            amount: amountInCents,
            currency: currency || 'PHP',
            description: `ChampZero Tournament Registration: ${tournamentId || 'Entry'}`
        });
        if (tournamentId) params.append('metadata[tournamentId]', tournamentId);
        if (appId) params.append('metadata[appId]', appId);
        if (customerName) params.append('metadata[customerName]', customerName);
        if (customerEmail) params.append('metadata[customerEmail]', customerEmail);
        params.append('payment_methods[]', 'gcash');
        params.append('payment_methods[]', 'maya');

        // Call PayRex REST API with Basic authentication
        const basicAuth = 'Basic ' + Buffer.from(PAYREX_SECRET_KEY + ':').toString('base64');
        const payrexResponse = await fetch('https://api.payrexhq.com/payment_intents', {
            method: 'POST',
            headers: {
                'Authorization': basicAuth,
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: params
        });

        const data = await payrexResponse.json();

        if (!payrexResponse.ok) {
            console.error('PayRex API error:', data);
            return {
                statusCode: payrexResponse.status || 500,
                headers,
                body: JSON.stringify({
                    error: data.error?.message || data.message || 'Payment intent creation failed with gateway.'
                })
            };
        }

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                clientSecret: data.client_secret || data.clientSecret,
                paymentIntentId: data.id,
                publicKey: PAYREX_PUBLIC_KEY
            })
        };

    } catch (error) {
        console.error('Error creating PayRex intent:', error.message);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: 'Internal Server Error while creating payment intent' })
        };
    }
};
