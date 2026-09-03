// netlify/functions/payrex-verify.js
// Fail-closed PayRex Checkout Session Verification

const https = require('https');

exports.handler = async (event, context) => {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Content-Type': 'application/json'
    };

    // 1. Handle CORS Preflight
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }

    if (event.httpMethod !== 'GET' && event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            headers,
            body: JSON.stringify({ error: 'Method Not Allowed' })
        };
    }

    try {
        // 2. Validate Session ID Parameter
        let sessionId = event.queryStringParameters?.session_id;
        if (!sessionId && event.body) {
            try {
                const parsedBody = JSON.parse(event.body);
                sessionId = parsedBody.session_id;
            } catch {
                // Invalid JSON body
            }
        }

        if (!sessionId || typeof sessionId !== 'string' || sessionId.trim().length === 0) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'Bad Request: Valid session_id is required.' })
            };
        }

        sessionId = sessionId.trim();

        // 3. Fail-Closed Secret Key Check (No mock fallbacks)
        const payrexSecretKey = process.env.PAYREX_SECRET_KEY ? process.env.PAYREX_SECRET_KEY.trim() : '';

        if (!payrexSecretKey || payrexSecretKey.includes('REPLACE_WITH') || payrexSecretKey.length < 10) {
            console.error('CRITICAL: PAYREX_SECRET_KEY is not configured or invalid on the server.');
            return {
                statusCode: 500,
                headers,
                body: JSON.stringify({
                    error: 'Server configuration error: PayRex payment gateway credentials not configured.'
                })
            };
        }

        // 4. Query PayRex API
        const makeVerifyRequest = (host) => {
            return new Promise((resolve, reject) => {
                const authHeader = 'Basic ' + Buffer.from(payrexSecretKey + ':').toString('base64');
                const options = {
                    hostname: host,
                    path: `/v1/checkout_sessions/${encodeURIComponent(sessionId)}`,
                    method: 'GET',
                    headers: {
                        'Authorization': authHeader,
                        'Accept': 'application/json'
                    },
                    timeout: 8000
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

                req.on('timeout', () => {
                    req.destroy();
                    reject(new Error('Gateway request timed out'));
                });

                req.on('error', err => reject(err));
                req.end();
            });
        };

        let payrexResponse;
        try {
            payrexResponse = await makeVerifyRequest('api.payrexhq.com');
            if (!payrexResponse || payrexResponse.statusCode >= 500) {
                payrexResponse = await makeVerifyRequest('api.payrex.com');
            }
        } catch (netErr) {
            try {
                payrexResponse = await makeVerifyRequest('api.payrex.com');
            } catch (fallbackErr) {
                console.error("PayRex Network Error:", fallbackErr.message);
                return {
                    statusCode: 502,
                    headers,
                    body: JSON.stringify({
                        isPaid: false,
                        error: 'Payment gateway communication failure. Could not verify payment status.'
                    })
                };
            }
        }

        // 5. Evaluate Payment Confirmation
        if (payrexResponse && payrexResponse.statusCode >= 200 && payrexResponse.statusCode < 300 && payrexResponse.data) {
            const session = payrexResponse.data;
            const isPaid = session.payment_status === 'paid' || session.status === 'completed' || session.status === 'succeeded';

            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({
                    isPaid: isPaid,
                    status: session.status || 'unknown',
                    paymentStatus: session.payment_status || 'unpaid',
                    amount: (session.line_items?.[0]?.amount || session.amount_total || 0) / 100,
                    metadata: session.metadata || {},
                    referenceNumber: session.payment_intent_id || session.id || sessionId
                })
            };
        }

        // Non-200 from gateway or invalid session
        return {
            statusCode: payrexResponse?.statusCode === 404 ? 404 : 400,
            headers,
            body: JSON.stringify({
                isPaid: false,
                error: payrexResponse?.data?.error?.message || 'Payment session verification failed or session unconfirmed.'
            })
        };

    } catch (error) {
        console.error('Error verifying PayRex session:', error.message);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ isPaid: false, error: 'Internal Server Error while verifying session' })
        };
    }
};
