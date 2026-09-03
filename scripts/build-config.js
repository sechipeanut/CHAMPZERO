// scripts/build-config.js
// Automated CI/CD & local build-time environment variable injection for CHAMPZERO client bundle.

const fs = require('fs');
const path = require('path');

// Load .env locally if present
try {
    require('dotenv').config();
} catch (e) {
    // dotenv is optional in CI/CD where environment variables are directly injected
}

const config = {
    firebase: {
        apiKey: process.env.FIREBASE_API_KEY || '',
        authDomain: process.env.FIREBASE_AUTH_DOMAIN || (process.env.FIREBASE_PROJECT_ID ? `${process.env.FIREBASE_PROJECT_ID}.firebaseapp.com` : ''),
        databaseURL: process.env.FIREBASE_DATABASE_URL || (process.env.FIREBASE_PROJECT_ID ? `https://${process.env.FIREBASE_PROJECT_ID}-default-rtdb.asia-southeast1.firebasedatabase.app` : ''),
        projectId: process.env.FIREBASE_PROJECT_ID || '',
        storageBucket: process.env.FIREBASE_STORAGE_BUCKET || (process.env.FIREBASE_PROJECT_ID ? `${process.env.FIREBASE_PROJECT_ID}.firebasestorage.app` : ''),
        messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || '',
        appId: process.env.FIREBASE_APP_ID || '',
        measurementId: process.env.FIREBASE_MEASUREMENT_ID || ''
    },
    payrex: {
        publicKey: process.env.PAYREX_PUBLIC_KEY || ''
    }
};

const outputDir = path.join(__dirname, '..', 'js');
if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
}

const targetPath = path.join(outputDir, 'env-config.js');
const fileContent = `// Auto-generated build-time client configuration. DO NOT EDIT DIRECTLY.
// Generated at: ${new Date().toISOString()}
window.__CZ_CONFIG__ = Object.freeze(${JSON.stringify(config, null, 4)});
`;

fs.writeFileSync(targetPath, fileContent, 'utf8');
console.log(`[build-config] Successfully wrote client config to: ${targetPath}`);
