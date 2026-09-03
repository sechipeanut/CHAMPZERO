const admin = require('firebase-admin');
const Mux = require('@mux/mux-node');

// Initialize Firebase Admin SDK (Fail-Closed)
if (!admin.apps.length) {
  try {
    const privateKey = process.env.FIREBASE_PRIVATE_KEY 
      ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
      : undefined;

    if (!process.env.FIREBASE_PROJECT_ID || !process.env.FIREBASE_CLIENT_EMAIL || !privateKey) {
      console.error('CRITICAL: Missing Firebase environment variables in get-mux-stream');
    } else {
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey: privateKey
        })
      });
    }
  } catch (initError) {
    console.error('Firebase initialization error in get-mux-stream:', initError.message);
  }
}

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json'
  };

  // 1. Handle CORS Preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  // 2. Strict Method Enforcement
  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method Not Allowed' })
    };
  }

  // 3. Fail-Closed Server Configuration Check
  if (!admin.apps.length) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal Server Error: Authentication provider uninitialized' })
    };
  }

  if (!process.env.MUX_TOKEN_ID || !process.env.MUX_TOKEN_SECRET) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal Server Error: Video streaming provider unconfigured' })
    };
  }

  // 4. Mandatory Authentication Verification
  const authHeader = event.headers.authorization || event.headers.Authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return {
      statusCode: 401,
      headers,
      body: JSON.stringify({ error: 'Unauthorized: Missing or malformed Bearer token' })
    };
  }

  const token = authHeader.split('Bearer ')[1].trim();
  if (!token) {
    return {
      statusCode: 401,
      headers,
      body: JSON.stringify({ error: 'Unauthorized: Empty token provided' })
    };
  }

  try {
    const decodedToken = await admin.auth().verifyIdToken(token);

    // 5. Role-Based Access Control (Admin Verification)
    let isAdmin = decodedToken.role === 'admin' || decodedToken.admin === true;
    if (!isAdmin) {
      const userDoc = await admin.firestore().collection('users').doc(decodedToken.uid).get();
      if (userDoc.exists) {
        const userRole = userDoc.data().role;
        isAdmin = userRole === 'admin' || userRole === 'Admin';
      }
    }

    if (!isAdmin) {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ error: 'Forbidden: Administrative privileges required' })
      };
    }

    // 6. Parameter Validation
    const { streamId } = event.queryStringParameters || {};
    if (!streamId || typeof streamId !== 'string' || streamId.trim().length === 0) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Bad Request: Valid streamId query parameter is required' })
      };
    }

    // 7. Mux API Retrieval & Secret Stream Key Redaction
    const mux = new Mux(process.env.MUX_TOKEN_ID, process.env.MUX_TOKEN_SECRET);
    const liveStream = await mux.Video.LiveStreams.get(streamId.trim());

    if (!liveStream) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: 'Stream not found' })
      };
    }

    // CRITICAL SECURITY FIX: Never expose liveStream.stream_key to the client.
    // Return exclusively sanitized playback and status metadata.
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        streamId: liveStream.id,
        status: liveStream.status,
        playbackId: liveStream.playback_ids?.[0]?.id || null,
        reconnectWindow: liveStream.reconnect_window || null
      })
    };

  } catch (error) {
    console.error('Secure Mux retrieval error:', error.message);
    if (error.code && error.code.startsWith('auth/')) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ error: 'Unauthorized: Invalid or expired token' })
      };
    }
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Failed to retrieve stream metadata' })
    };
  }
};
