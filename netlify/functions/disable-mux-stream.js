const Mux = require('@mux/mux-node');

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

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

  try {
    const { streamId } = JSON.parse(event.body);

    if (!streamId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'streamId is required' })
      };
    }

    const mux = new Mux(process.env.MUX_TOKEN_ID, process.env.MUX_TOKEN_SECRET);
    const { Video } = mux;

    // Signal the stream to complete/end (this ends the current session)
    // The stream key remains valid for future broadcasts
    await Video.LiveStreams.signalComplete(streamId);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, message: 'Stream disabled successfully' })
    };
  } catch (error) {
    console.error('Error disabling Mux stream:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Failed to disable stream', details: error.message })
    };
  }
};
