// netlify/functions/get-users.js
// Secure Administrative User Directory Endpoint

const { initFirebaseAdmin } = require('./utils/firebase-admin');

exports.handler = async (event, context) => {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Content-Type': 'application/json'
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }

    if (event.httpMethod !== 'GET') {
        return {
            statusCode: 405,
            headers,
            body: JSON.stringify({ error: 'Method Not Allowed' })
        };
    }

    const authHeader = event.headers.authorization || event.headers.Authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return {
            statusCode: 401,
            headers,
            body: JSON.stringify({ error: 'Unauthorized: Bearer token required' })
        };
    }

    try {
        const { admin, auth, db } = initFirebaseAdmin();
        const token = authHeader.split('Bearer ')[1].trim();
        const decodedToken = await auth.verifyIdToken(token);

        // Check if caller is verified admin in Firestore
        const callerDoc = await db.collection('users').doc(decodedToken.uid).get();
        const isCallerAdmin = decodedToken.role === 'admin' || (callerDoc.exists && (callerDoc.data().role === 'admin' || callerDoc.data().role === 'Admin'));

        if (!isCallerAdmin) {
            return {
                statusCode: 403,
                headers,
                body: JSON.stringify({ error: 'Forbidden: Administrative privileges required' })
            };
        }

        // Fetch and sanitize user records
        const usersSnapshot = await db.collection('users').get();
        const sanitizedUsers = [];

        usersSnapshot.forEach(doc => {
            const data = doc.data();
            sanitizedUsers.push({
                uid: doc.id,
                email: data.email || '',
                displayName: data.displayName || data.username || 'User',
                role: data.role || 'user',
                disabled: data.disabled || false,
                createdAt: data.createdAt || (data.joined ? new Date(data.joined).toISOString() : null)
            });
        });

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify(sanitizedUsers)
        };
    } catch (error) {
        console.error('Error in get-users:', error.message);
        return {
            statusCode: error.code && error.code.startsWith('auth/') ? 401 : 500,
            headers,
            body: JSON.stringify({ error: error.message || 'Failed to retrieve users directory' })
        };
    }
};
