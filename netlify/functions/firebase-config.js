// netlify/functions/firebase-config.js
// Endpoint disabled: Firebase credentials and configuration objects are completely hidden from public access.

exports.handler = async () => {
    return {
        statusCode: 404,
        headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store, no-cache, must-revalidate',
            'X-Content-Type-Options': 'nosniff'
        },
        body: JSON.stringify({ error: 'Not Found: Configuration endpoint has been permanently disabled.' })
    };
};
