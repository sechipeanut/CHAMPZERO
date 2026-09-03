// netlify/functions/create-mux-stream.js
// Secure Live Stream Creator (Admin Only)

const Mux = require('@mux/mux-node');
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

    const authHeader = event.headers.authorization || event.headers.Authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return {
            statusCode: 401,
            headers,
            body: JSON.stringify({ error: 'Unauthorized: Admin token required' })
        };
    }

    try {
        const { auth, db } = initFirebaseAdmin();
        const token = authHeader.split('Bearer ')[1].trim();
        const decodedToken = await auth.verifyIdToken(token);

        const userDoc = await db.collection('users').doc(decodedToken.uid).get();
        const isAdmin = (decodedToken.role === 'admin') || (userDoc.exists && (userDoc.data().role === 'admin' || userDoc.data().role === 'Admin'));

        if (!isAdmin) {
            return {
                statusCode: 403,
                headers,
                body: JSON.stringify({ error: 'Forbidden: Admin access required' })
            };
        }

        const { eventId, eventName } = JSON.parse(event.body || '{}');
        if (!eventId || !eventName) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'eventId and eventName are required' })
            };
        }

        const tokenId = process.env.MUX_TOKEN_ID;
        const tokenSecret = process.env.MUX_TOKEN_SECRET;

        if (!tokenId || !tokenSecret) {
            return {
                statusCode: 500,
                headers,
                body: JSON.stringify({ error: 'Server configuration error: Mux credentials missing' })
            };
        }

        const mux = new Mux(tokenId, tokenSecret);
        const liveStream = await mux.Video.LiveStreams.create({
            playback_policy: ['public'],
            new_asset_settings: {
                playback_policy: ['public'],
            },
            reconnect_window: 60,
            passthrough: String(eventId),
            reduced_latency: true,
        });

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                streamId: liveStream.id,
                streamKey: liveStream.stream_key,
                playbackId: liveStream.playback_ids[0].id,
                status: liveStream.status,
            })
        };

    } catch (error) {
        console.error('Error creating Mux stream:', error.message);
        return {
            statusCode: error.code && error.code.startsWith('auth/') ? 401 : 500,
            headers,
            body: JSON.stringify({ error: 'Failed to create stream', details: error.message })
        };
    }
};
