// netlify/functions/payrex-checkout.js
// PayRex Checkout Session Creator for Organizer Cash-In & Tournament Payments

const https = require('https');
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
        console.error('Firebase initialization error in payrex-checkout:', initError);
    }
}

exports.handler = async (event, context) => {
    // Handle CORS preflight
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization',
                'Access-Control-Allow-Methods': 'POST, OPTIONS'
            },
            body: ''
        };
    }

    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            headers: { 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify({ error: 'Method Not Allowed' })
        };
    }

    try {
        const body = JSON.parse(event.body || '{}');
        let {
            amount,
            organizerId,
            organizerEmail,
            organizerName,
            notes,
            type = 'organizer_cashin',
            tournamentId = '',
            tournamentName = '',
            successUrl,
            cancelUrl
        } = body;

        let numAmount = parseFloat(amount);

        // Server-Side Verification for Tournament Entry Payments
        if (type === 'tournament_entry' && tournamentId && admin.apps.length) {
            try {
                const tourneyDoc = await admin.firestore().collection('tournaments').doc(tournamentId).get();
                if (tourneyDoc.exists) {
                    const tourneyData = tourneyDoc.data();
                    const officialFee = parseFloat(tourneyData.entryFee);
                    if (!isNaN(officialFee) && officialFee > 0) {
                        numAmount = officialFee;
                    }
                    if (!tournamentName && tourneyData.name) {
                        tournamentName = tourneyData.name;
                    }
                }
            } catch (dbErr) {
                console.warn('Could not verify tournament price from Firestore in payrex-checkout:', dbErr);
            }
        }

        if (!numAmount || numAmount <= 0) {
            return {
                statusCode: 400,
                headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
                body: JSON.stringify({ error: 'Invalid payment amount specified.' })
            };
        }

        const payrexSecretKey = process.env.PAYREX_SECRET_KEY ? process.env.PAYREX_SECRET_KEY.trim() : '';
        const amountInCents = Math.round(numAmount * 100);

        const origin = event.headers.origin || event.headers.referer || 'https://champzero.org';
        const finalSuccessUrl = successUrl || `${origin.replace(/\/$/, '')}/profile.html?tab=organizer&cashin_status=success&session_id={CHECKOUT_SESSION_ID}&amount=${numAmount}`;
        const finalCancelUrl = cancelUrl || `${origin.replace(/\/$/, '')}/profile.html?tab=organizer&cashin_status=cancelled`;

        const description = type === 'tournament_entry'
            ? `Tournament Entry: ${tournamentName || tournamentId}`
            : `Prize Pool Escrow Top-Up for ${organizerName || organizerEmail || 'Organizer'}`;

        const itemName = type === 'tournament_entry'
            ? `ChampZero Tournament Registration: ${tournamentName || 'Tournament'}`
            : `ChampZero Prize Pool Cash-In (Top-Up)`;

        const payload = {
            currency: 'PHP',
            payment_methods: ['gcash', 'maya'],
            line_items: [
                {
                    name: itemName,
                    amount: amountInCents,
                    quantity: 1,
                    description: description
                }
            ],
            success_url: finalSuccessUrl,
            cancel_url: finalCancelUrl,
            metadata: {
                organizerId: organizerId || 'unknown',
                organizerEmail: organizerEmail || 'unknown',
                organizerName: organizerName || 'Organizer',
                type: type,
                amount: String(numAmount),
                notes: notes && notes.trim() ? notes.trim() : 'Prize Pool Top-Up',
                createdAt: new Date().toISOString(),
                ...(tournamentId ? { tournamentId } : {})
            }
        };

        // If PayRex Secret Key is configured, make the live PayRex REST API request
        if (payrexSecretKey && !payrexSecretKey.includes('REPLACE_WITH') && payrexSecretKey.length > 5) {
            // api.payrexhq.com uses /checkout_sessions (no /v1/ prefix)
            // api.payrex.com fallback uses /v1/checkout_sessions
            const makePayRexRequest = (host, path) => {
                return new Promise((resolve, reject) => {
                    const reqData = JSON.stringify(payload);
                    const authHeader = 'Basic ' + Buffer.from(payrexSecretKey + ':').toString('base64');

                    const options = {
                        hostname: host,
                        path: path,
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Content-Length': Buffer.byteLength(reqData),
                            'Authorization': authHeader,
                            'Accept': 'application/json'
                        }
                    };

                    const req = https.request(options, (res) => {
                        let resBody = '';
                        res.on('data', chunk => { resBody += chunk; });
                        res.on('end', () => {
                            try {
                                const parsed = JSON.parse(resBody);
                                resolve({ statusCode: res.statusCode, data: parsed });
                            } catch (e) {
                                resolve({ statusCode: res.statusCode, raw: resBody, error: e.message });
                            }
                        });
                    });

                    req.on('error', err => reject(err));
                    req.write(reqData);
                    req.end();
                });
            };

            let payrexResponse;
            try {
                payrexResponse = await makePayRexRequest('api.payrexhq.com', '/checkout_sessions');
                if (!payrexResponse || payrexResponse.statusCode >= 500) {
                    payrexResponse = await makePayRexRequest('api.payrex.com', '/v1/checkout_sessions');
                }
            } catch (netErr) {
                try {
                    payrexResponse = await makePayRexRequest('api.payrex.com', '/v1/checkout_sessions');
                } catch (fallbackErr) {
                    console.error("PayRex Netlify Network Error:", fallbackErr);
                }
            }

            if (payrexResponse && payrexResponse.statusCode >= 200 && payrexResponse.statusCode < 300 && payrexResponse.data?.url) {
                return {
                    statusCode: 200,
                    headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        url: payrexResponse.data.url,
                        sessionId: payrexResponse.data.id,
                        status: payrexResponse.data.status,
                        mode: 'live_payrex'
                    })
                };
            } else if (payrexResponse && payrexResponse.data) {
                console.error("PayRex API Error:", JSON.stringify(payrexResponse));
                // PayRex may return { errors: [{ detail, code }] } or { error: { message } } or { message }
                const d = payrexResponse.data;
                const errMsg = d?.errors?.[0]?.detail
                    || d?.errors?.[0]?.message
                    || d?.error?.message
                    || d?.message
                    || 'PayRex API request failed.';
                return {
                    statusCode: payrexResponse.statusCode || 500,
                    headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        error: errMsg,
                        details: payrexResponse.data
                    })
                };
            }
        }

        // Test/Sandbox Simulation mode when PAYREX_SECRET_KEY is not yet populated
        const simulatedSessionId = 'cs_prx_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
        const resolvedSuccessUrl = finalSuccessUrl.replace('{CHECKOUT_SESSION_ID}', simulatedSessionId);

        return {
            statusCode: 200,
            headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
            body: JSON.stringify({
                url: resolvedSuccessUrl,
                sessionId: simulatedSessionId,
                status: 'open',
                mode: 'test_sandbox',
                message: 'PayRex sandbox test session initialized.'
            })
        };

    } catch (error) {
        console.error('Error handling PayRex checkout:', error);
        return {
            statusCode: 500,
            headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: error.message || 'Internal Server Error' })
        };
    }
};
