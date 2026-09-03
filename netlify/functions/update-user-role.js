// netlify/functions/update-user-role.js
// Secure Administrative Role Update Endpoint

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

        const payload = JSON.parse(event.body || '{}');
        const targetUid = payload.targetUid || payload.userId;
        const newRole = payload.newRole || payload.role;

        const allowedRoles = ['admin', 'moderator', 'player', 'user'];

        if (!targetUid || typeof targetUid !== 'string' || !newRole || !allowedRoles.includes(newRole)) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({
                    error: `Invalid payload. targetUid and newRole are required. Allowed roles: ${allowedRoles.join(', ')}`
                })
            };
        }

        // Update Firestore document
        await db.collection('users').doc(targetUid).update({
            role: newRole,
            roleUpdatedAt: new Date().toISOString(),
            roleUpdatedBy: decodedToken.uid
        });

        // Set Firebase Auth custom claims
        await auth.setCustomUserClaims(targetUid, { role: newRole });

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                message: `User ${targetUid} role successfully updated to ${newRole}`,
                targetUid,
                role: newRole
            })
        };

    } catch (error) {
        console.error('Error updating user role:', error.message);
        return {
            statusCode: error.code && error.code.startsWith('auth/') ? 401 : 500,
            headers,
            body: JSON.stringify({ error: error.message || 'Failed to update user role' })
        };
    }
};
