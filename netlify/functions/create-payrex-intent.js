exports.handler = async (event, context) => {
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

    try {
        const payload = JSON.parse(event.body);
        const { tournamentId, appId, amount, currency, customerName, customerEmail } = payload;
        
        const PAYREX_SECRET_KEY = process.env.PAYREX_SECRET_KEY || 'sk_test_REPLACE_WITH_YOUR_SECRET_KEY';
        const amountInCents = Math.round(Number(amount) * 100);

        const auth = Buffer.from(PAYREX_SECRET_KEY + ':').toString('base64');
        const params = new URLSearchParams({
            amount: amountInCents,
            currency: currency || 'PHP',
            'metadata[tournamentId]': tournamentId,
            'metadata[appId]': appId,
            'metadata[customerName]': customerName || '',
            'metadata[customerEmail]': customerEmail || '',
            description: `ChampZero Tournament: ${tournamentId}`
        });

        // Use standard node 18 fetch
        const response = await fetch('https://api.payrexhq.com/payment_intents', {
            method: 'POST',
            headers: {
                'Authorization': `Basic ${auth}`,
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: params
        });

        if (!response.ok) {
            const err = await response.text();
            console.error("PayRex API Error:", err);
            return {
                statusCode: response.status,
                body: JSON.stringify({ error: 'Failed to create payment intent with PayRex.' })
            };
        }

        const data = await response.json();

        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ client_secret: data.client_secret })
        };
    } catch (error) {
        console.error(error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message })
        };
    }
};
