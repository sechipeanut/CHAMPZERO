const Mux = require('@mux/mux-node');

exports.handler = async (event, context) => {
  // Set CORS headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
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

  try {
    const { eventId, eventName } = JSON.parse(event.body);

    if (!eventId || !eventName) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'eventId and eventName are required' })
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
