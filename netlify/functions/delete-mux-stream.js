const Mux = require('@mux/mux-node');

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'DELETE, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'DELETE') {
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

    await Video.LiveStreams.del(streamId);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, message: 'Stream deleted successfully' })
    };
  } catch (error) {
    console.error('Error deleting Mux stream:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Failed to delete stream', details: error.message })
    };
  }
};
