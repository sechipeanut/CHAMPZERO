const Mux = require('@mux/mux-node');

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const { playbackId } = event.queryStringParameters || {};

    if (!playbackId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'playbackId is required' })
      };
    }

    // Note: Mux Data API viewer count feature requires @mux/mux-node v8+
    // For SDK v7, we return a placeholder until upgrade
    // To enable real viewer counts:
    // 1. Upgrade to @mux/mux-node v8 or later
    // 2. Ensure Mux Data is enabled in your account
    // 3. Update this function to use the correct v8 Data API methods
    
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        viewerCount: 0,
        playbackId: playbackId,
        note: 'Viewer count feature requires SDK v8+ and Mux Data API'
      })
    };
  } catch (error) {
    console.error('Error fetching viewer count:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Failed to fetch viewer count', viewerCount: 0 })
    };
  }
};
