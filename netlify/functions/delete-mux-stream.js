// netlify/functions/delete-mux-stream.js
// Secure Live Stream Deletion Endpoint (Admin Only)

const Mux = require('@mux/mux-node');
const { initFirebaseAdmin } = require('./utils/firebase-admin');

exports.handler = async (event, context) => {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'DELETE, OPTIONS',
        'Content-Type': 'application/json'
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }

    if (event.httpMethod !== 'DELETE') {
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

        const { streamId } = JSON.parse(event.body || '{}');
        if (!streamId) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'streamId is required' })
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
        await mux.Video.LiveStreams.del(streamId);

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ success: true, message: 'Stream deleted successfully' })
        };

    } catch (error) {
        console.error('Error deleting Mux stream:', error.message);
        return {
            statusCode: error.code && error.code.startsWith('auth/') ? 401 : 500,
            headers,
            body: JSON.stringify({ error: 'Failed to delete stream', details: error.message })
        };
    }
};
