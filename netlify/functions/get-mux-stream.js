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
    const { streamId } = event.queryStringParameters || {};

    if (!streamId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'streamId is required' })
      };
    }

    const mux = new Mux(process.env.MUX_TOKEN_ID, process.env.MUX_TOKEN_SECRET);
    const { Video } = mux;

    const liveStream = await Video.LiveStreams.get(streamId);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        streamId: liveStream.id,
        status: liveStream.status,
        playbackId: liveStream.playback_ids[0]?.id,
        streamKey: liveStream.stream_key,
      })
    };
  } catch (error) {
    console.error('Error retrieving Mux stream:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Failed to retrieve stream', details: error.message })
    };
  }
};
