// netlify/functions/payrex-checkout.js
// PayRex Checkout Session Creator for Organizer Cash-In & Tournament Payments

const https = require('https');
const { initFirebaseAdmin } = require('./utils/firebase-admin');

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
        if (type === 'tournament_entry' && tournamentId) {
            try {
                const { db } = initFirebaseAdmin();
                const tourneyDoc = await db.collection('tournaments').doc(tournamentId).get();
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

        let description, itemName;
        if (type === 'tournament_entry') {
            description = `Tournament Entry: ${tournamentName || tournamentId}`;
            itemName = `ChampZero Tournament Registration: ${tournamentName || 'Tournament'}`;
        } else if (type === 'supporter_club') {
            description = `Supporter Club Membership: ${body.tier || 'bronze'} tier`;
            itemName = `ChampZero Supporter Club (${body.tier || 'bronze'})`;
        } else {
            description = `Prize Pool Escrow Top-Up for ${organizerName || organizerEmail || 'Organizer'}`;
            itemName = `ChampZero Prize Pool Cash-In (Top-Up)`;
        }

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
                type: type,
                amount: String(numAmount),
                createdAt: new Date().toISOString(),
                ...(type === 'supporter_club' ? {
                    tier: body.tier || 'bronze',
                    donorUid: body.donorUid || 'anonymous',
                    donorName: String(body.donorName || 'Champion').substring(0, 100),
                    donorAvatar: String(body.donorAvatar || '').substring(0, 150),
                    message: String(body.message || 'Backing grassroots esports!').substring(0, 200)
                } : {
                    organizerId: organizerId || 'unknown',
                    organizerEmail: organizerEmail || 'unknown',
                    organizerName: organizerName || 'Organizer',
                    notes: notes && notes.trim() ? notes.trim() : 'Prize Pool Top-Up',
                    ...(tournamentId ? { tournamentId } : {})
                })
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

        // Fail-Closed: No unauthenticated or mock sandbox sessions
        return {
            statusCode: 500,
            headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
            body: JSON.stringify({
                error: 'Server configuration error: PayRex payment gateway credentials not configured or live gateway unreachable.'
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
