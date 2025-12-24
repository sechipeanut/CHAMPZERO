// netlify/functions/action.js
// Firebase Auth Action Handler
// This function routes Firebase authentication actions to the appropriate pages

exports.handler = async (event, context) => {
    const { mode, oobCode, continueUrl } = event.queryStringParameters || {};
    
    // Base URL (use the site URL in production)
    const baseUrl = process.env.URL || 'http://localhost:8888';
    
    // Build query string
    const params = new URLSearchParams();
    if (mode) params.append('mode', mode);
    if (oobCode) params.append('oobCode', oobCode);
    if (continueUrl) params.append('continueUrl', continueUrl);
    const queryString = params.toString();
    
    // Route based on mode
    let redirectUrl;
    switch (mode) {
        case 'resetPassword':
            redirectUrl = `${baseUrl}/reset-password.html?${queryString}`;
            break;
        case 'verifyEmail':
            redirectUrl = `${baseUrl}/verify-email.html?${queryString}`;
            break;
        case 'recoverEmail':
            // Handle email recovery if needed
            redirectUrl = `${baseUrl}/login.html`;
            break;
        default:
            // Unknown or missing mode, redirect to home
            redirectUrl = `${baseUrl}/`;
            break;
    }
    
    // Return 302 redirect
    return {
        statusCode: 302,
        headers: {
            Location: redirectUrl,
            'Cache-Control': 'no-cache, no-store, must-revalidate',
        },
        body: ''
    };
};
