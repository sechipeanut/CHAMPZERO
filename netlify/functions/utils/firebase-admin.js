// netlify/functions/utils/firebase-admin.js
// Centralized Firebase Admin SDK Loader

const admin = require('firebase-admin');

function initFirebaseAdmin() {
    if (admin.apps.length > 0) {
        return {
            admin,
            auth: admin.auth(),
            db: admin.firestore()
        };
    }

    try {
        let credentialConfig = null;

        // 1. Check for Base64 encoded Service Account
        if (process.env.FIREBASE_SERVICE_ACCOUNT_BASE64) {
            try {
                const decodedJson = Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64, 'base64').toString('utf8');
                credentialConfig = JSON.parse(decodedJson);
            } catch (b64Err) {
                throw new Error('Failed to parse FIREBASE_SERVICE_ACCOUNT_BASE64: ' + b64Err.message);
            }
        } 
        // 2. Fallback to individual environment variables
        else if (process.env.FIREBASE_PRIVATE_KEY && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PROJECT_ID) {
            const privateKey = process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n');
            credentialConfig = {
                projectId: process.env.FIREBASE_PROJECT_ID,
                clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
                privateKey: privateKey
            };
        }

        if (!credentialConfig) {
            throw new Error('Firebase Admin initialization error: Missing service account credentials. Provide either FIREBASE_SERVICE_ACCOUNT_BASE64 or FIREBASE_PRIVATE_KEY, FIREBASE_CLIENT_EMAIL, and FIREBASE_PROJECT_ID.');
        }

        admin.initializeApp({
            credential: admin.credential.cert(credentialConfig),
            databaseURL: process.env.FIREBASE_DATABASE_URL || `https://${process.env.FIREBASE_PROJECT_ID}-default-rtdb.asia-southeast1.firebasedatabase.app`
        });

        return {
            admin,
            auth: admin.auth(),
            db: admin.firestore()
        };
    } catch (err) {
        console.error('Firebase Admin initialization failure:', err.message);
        throw err;
    }
}

module.exports = { initFirebaseAdmin, admin };
