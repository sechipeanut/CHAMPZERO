const admin = require('firebase-admin');
const Mux = require('@mux/mux-node');

if (!admin.apps.length) {
  try {
    const privateKey = process.env.FIREBASE_PRIVATE_KEY 
      ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
      : undefined;

    if (!process.env.FIREBASE_PROJECT_ID || !process.env.FIREBASE_CLIENT_EMAIL || !privateKey) {
      throw new Error('Missing Firebase environment variables');
    }

    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: privateKey
      })
    });
  } catch (initError) {
    console.error('Firebase initialization error in create-mux-stream:', initError);
  }
}

exports.handler = async (event, context) => {
  // Set CORS headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  // Handle preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
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
    const token = authHeader.split('Bearer ')[1];
    const decodedToken = await admin.auth().verifyIdToken(token);
    
    // Check if user is admin
    const userDoc = await admin.firestore().collection('users').doc(decodedToken.uid).get();
    const isAdmin = (decodedToken.role === 'admin') || (userDoc.exists && (userDoc.data().role === 'admin' || userDoc.data().role === 'Admin'));
    if (!isAdmin) {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ error: 'Forbidden: Admin access required' })
      };
    }

    const { eventId, eventName } = JSON.parse(event.body);

    if (!eventId || !eventName) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'eventId and eventName are required' })
      };
    }

    if (!process.env.MUX_TOKEN_ID || !process.env.MUX_TOKEN_SECRET) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Server configuration error: MUX credentials missing' })
      };
    }

    // Initialize Mux client
    const mux = new Mux(process.env.MUX_TOKEN_ID, process.env.MUX_TOKEN_SECRET);
    const { Video } = mux;

    // Create a live stream
    const liveStream = await Video.LiveStreams.create({
      playback_policy: ['public'],
      new_asset_settings: {
        playback_policy: ['public'],
      },
      reconnect_window: 60,
      passthrough: eventId,
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
    console.error('Error creating Mux stream:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Failed to create stream', details: error.message })
    };
  }
};
