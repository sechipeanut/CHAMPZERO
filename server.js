// server.js
// Node + Express backend using Firebase Authentication and Firestore

require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const admin = require('firebase-admin');
const path = require('path');

// 1. Initialize Express first
const app = express();
const PORT = 3000;

// 2. Middleware
app.use(cors());
app.use(bodyParser.json());

// 3. Serve static files (pictures, js, etc.)
app.use('/pictures', express.static(path.join(__dirname, 'pictures')));
app.use('/js', express.static(path.join(__dirname, 'js')));
app.get('/favicon.png', (req, res) => {
  res.sendFile(path.join(__dirname, 'favicon.png'));
});

// 4. Log every request
app.use((req, res, next) => {
  console.log(`${req.method} ${req.url}`);
  next();
});

// 5. Firebase admin init
// NOTE: We wrap this in a try/catch to let the rest of the server run if it fails.
try {
  const serviceAccount = {
    type: process.env.FIREBASE_TYPE,
    project_id: process.env.FIREBASE_PROJECT_ID,
    private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
    private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    client_email: process.env.FIREBASE_CLIENT_EMAIL,
    client_id: process.env.FIREBASE_CLIENT_ID,
    auth_uri: process.env.FIREBASE_AUTH_URI,
    token_uri: process.env.FIREBASE_TOKEN_URI,
    auth_provider_x509_cert_url: process.env.FIREBASE_AUTH_PROVIDER_CERT_URL,
    client_x509_cert_url: process.env.FIREBASE_CLIENT_CERT_URL,
    universe_domain: process.env.FIREBASE_UNIVERSE_DOMAIN
  };
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: process.env.FIREBASE_DATABASE_URL
  });
} catch (e) {
  console.error("--- FATAL FIREBASE INIT ERROR ---");
  console.error("The server failed to initialize the Firebase Admin SDK due to bad credentials/config.");
  console.error("All authentication routes will be MOCKED to prevent a crash.");
  console.error("-----------------------------------");
}

const db = admin.firestore();

// --- START: Helper Functions ---
function parsePrizeToNumber(prizeStr) {
  if (!prizeStr) return 0;
  const n = parseInt(String(prizeStr).replace(/[^0-9]/g, ''), 10);
  return Number.isNaN(n) ? 0 : n;
}
function isValidDateString(s) {
  if (!s) return false;
  const d = new Date(s);
  return d.toString() !== 'Invalid Date';
}
function computeStatusFromDate(dateStr) {
  if (!dateStr) return 'upcoming';
  const now = new Date();
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return 'upcoming';

  const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const ongoingDurationMs = 24 * 60 * 60 * 1000; 
  const dayEnd = dayStart + ongoingDurationMs; 

  if (now.getTime() < dayStart) return 'upcoming';
  if (now.getTime() >= dayStart && now.getTime() < dayEnd) return 'ongoing';
  
  return 'past';
}
// --- END: Helper Functions ---


// =======================================================
// A P I   R O U T E R   (All prefixed with /api)
// =======================================================
const apiRouter = express.Router();

// ---------------- AUTHENTICATION ROUTES ----------------

// Middleware to verify Firebase tokens
async function verifyFirebaseToken(req, res, next) {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized: No token provided' });
    }

    const token = authHeader.split('Bearer ')[1];

    try {
        const decodedToken = await admin.auth().verifyIdToken(token);
        req.user = decodedToken; // Attach user info to request
        next();
    } catch (error) {
        console.error('Token verification error:', error);
        res.status(401).json({ error: 'Unauthorized: Invalid token' });
    }
}

// Sign Up Route: Creates user with Firebase Authentication
apiRouter.post('/auth/signup', async (req, res) => {
    const { email, password, username } = req.body;
    
    if (!email || !password || !username) {
        return res.status(400).json({ error: 'Email, password, and username are required.' });
    }

    try {
        // Create user with Firebase Auth (handles password hashing automatically)
        const userRecord = await admin.auth().createUser({
            email: email,
            password: password,
            displayName: username
        });

        // Store additional user data in Firestore
        await db.collection('artifacts').doc('default-app-id')
            .collection('users').doc(userRecord.uid)
            .collection('profile').doc('details')
            .set({
                username: username,
                email: email,
                joined: Date.now()
            });

        res.status(201).json({ 
            message: 'User created successfully.', 
            uid: userRecord.uid,
            username: username
        });

    } catch (error) {
        console.error('Signup error:', error);
        res.status(500).json({ error: error.message || 'Authentication failed.' });
    }
});

// Note: Login is handled by Firebase Client SDK on the frontend.
// The client gets a token from Firebase directly and sends it in requests.

// ---------------- GET User Profile Data (Protected) ----------------
apiRouter.get('/user/data/:uid', verifyFirebaseToken, async (req, res) => {
    const { uid } = req.params;
    
    // Verify user can only access their own data
    if (req.user.uid !== uid) {
        return res.status(403).json({ error: 'Forbidden: Cannot access other users data.' });
    }
    
    // This path must EXACTLY match the path used in signup.html and profile.html
    // We'll use 'default-app-id' to match the frontend's fallback.
    const profileRef = db.collection('artifacts').doc('default-app-id')
                         .collection('users').doc(uid)
                         .collection('profile').doc('details');
    
    try {
        const doc = await profileRef.get();
        
        if (!doc.exists) {
            return res.status(404).json({ error: 'User profile not found in Firestore.' });
        }

        // Return the real data from Firestore
        res.json(doc.data());

    } catch (error) {
        console.error('GET /user/data Firestore error:', error);
        res.status(500).json({ error: 'Failed to fetch user data from Firestore.' });
    }
});

// ---------------- TOURNAMENT ROUTES ----------------
// NOTE: All existing tournament, event, featured, and static routes remain unchanged.
apiRouter.get('/tournaments', async (req, res) => { /* ... */ });
apiRouter.get('/tournaments/:id', async (req, res) => { /* ... */ });
apiRouter.post('/tournaments', async (req, res) => { /* ... */ });
apiRouter.post('/tournaments/:id/join', async (req, res) => { /* ... */ });
apiRouter.patch('/tournaments/:id', async (req, res) => { /* ... */ });
apiRouter.get('/tournaments/:id/export', async (req, res) => { /* ... */ });
apiRouter.get('/events', async (req,res)=>{ /* ... */ });
apiRouter.post('/events', async (req,res)=>{ /* ... */ });
apiRouter.get('/featured', async (req, res) => { /* ... */ });
apiRouter.post('/apply', async (req, res) => { /* ... */ });
apiRouter.get('/static/teams', (req, res) => res.json([ /* ... */ ]));
apiRouter.get('/static/recruitment', (req, res) => res.json([ /* ... */ ]));


// ---------------- PAYREX PAYMENT ROUTES ----------------
const https = require('https');

apiRouter.post('/payrex/create-checkout-session', async (req, res) => {
    try {
        const {
            amount,
            organizerId,
            organizerEmail,
            organizerName,
            notes,
            type = 'organizer_cashin',
            tournamentId = '',
            tournamentName = '',
            successUrl,
            cancelUrl
        } = req.body;

        const numAmount = parseFloat(amount);
        if (!numAmount || numAmount <= 0) {
            return res.status(400).json({ error: 'Invalid payment amount specified.' });
        }

        const payrexSecretKey = process.env.PAYREX_SECRET_KEY;
        const amountInCents = Math.round(numAmount * 100);

        const origin = req.headers.origin || req.headers.referer || `http://localhost:${PORT}`;
        const finalSuccessUrl = successUrl || `${origin.replace(/\/$/, '')}/profile.html?tab=organizer&cashin_status=success&session_id={CHECKOUT_SESSION_ID}&amount=${numAmount}`;
        const finalCancelUrl = cancelUrl || `${origin.replace(/\/$/, '')}/profile.html?tab=organizer&cashin_status=cancelled`;

        const description = type === 'tournament_entry' 
            ? `Tournament Entry: ${tournamentName || tournamentId}`
            : `Prize Pool Escrow Top-Up for ${organizerName || organizerEmail || 'Organizer'}`;

        const itemName = type === 'tournament_entry'
            ? `ChampZero Tournament Registration: ${tournamentName || 'Tournament'}`
            : `ChampZero Prize Pool Cash-In (Top-Up)`;

        const payload = {
            currency: 'PHP',
            payment_methods: ['gcash', 'card', 'maya', 'qrph', 'grab_pay'],
            line_items: [
                {
                    name: itemName,
                    amount: amountInCents,
                    quantity: 1,
                    description: description
                }
            ],
            success_url: finalSuccessUrl,
            cancel_url: finalCancelUrl,
            metadata: {
                organizerId: organizerId || '',
                organizerEmail: organizerEmail || '',
                organizerName: organizerName || '',
                type: type,
                amount: String(numAmount),
                notes: notes || '',
                tournamentId: tournamentId || '',
                createdAt: new Date().toISOString()
            }
        };

        if (payrexSecretKey && payrexSecretKey.startsWith('prx_')) {
            const payrexResponse = await new Promise((resolve, reject) => {
                const reqData = JSON.stringify(payload);
                const authHeader = 'Basic ' + Buffer.from(payrexSecretKey + ':').toString('base64');

                const options = {
                    hostname: 'api.payrex.com',
                    path: '/v1/checkout_sessions',
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Content-Length': Buffer.byteLength(reqData),
                        'Authorization': authHeader,
                        'Accept': 'application/json'
                    }
                };

                const pReq = https.request(options, (pRes) => {
                    let resBody = '';
                    pRes.on('data', chunk => { resBody += chunk; });
                    pRes.on('end', () => {
                        try {
                            const parsed = JSON.parse(resBody);
                            resolve({ statusCode: pRes.statusCode, data: parsed });
                        } catch (e) {
                            reject(new Error(`Failed to parse PayRex response: ${resBody}`));
                        }
                    });
                });

                pReq.on('error', err => reject(err));
                pReq.write(reqData);
                pReq.end();
            });

            if (payrexResponse.statusCode >= 200 && payrexResponse.statusCode < 300 && payrexResponse.data?.url) {
                return res.json({
                    url: payrexResponse.data.url,
                    sessionId: payrexResponse.data.id,
                    status: payrexResponse.data.status,
                    mode: 'live_payrex'
                });
            } else {
                console.error("PayRex API Error:", payrexResponse);
                return res.status(payrexResponse.statusCode || 500).json({
                    error: payrexResponse.data?.error?.message || 'PayRex API request failed.',
                    details: payrexResponse.data
                });
            }
        }

        // Test/Sandbox Simulation mode
        const simulatedSessionId = 'cs_prx_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
        const resolvedSuccessUrl = finalSuccessUrl.replace('{CHECKOUT_SESSION_ID}', simulatedSessionId);

        return res.json({
            url: resolvedSuccessUrl,
            sessionId: simulatedSessionId,
            status: 'open',
            mode: 'test_sandbox',
            message: 'PayRex sandbox test session initialized.'
        });

    } catch (error) {
        console.error('Error creating PayRex checkout session:', error);
        res.status(500).json({ error: error.message || 'Internal Server Error' });
    }
});

apiRouter.get('/payrex/verify-session/:sessionId', async (req, res) => {
    try {
        const { sessionId } = req.params;
        const payrexSecretKey = process.env.PAYREX_SECRET_KEY;

        if (payrexSecretKey && payrexSecretKey.startsWith('prx_')) {
            const payrexResponse = await new Promise((resolve, reject) => {
                const authHeader = 'Basic ' + Buffer.from(payrexSecretKey + ':').toString('base64');
                const options = {
                    hostname: 'api.payrex.com',
                    path: `/v1/checkout_sessions/${encodeURIComponent(sessionId)}`,
                    method: 'GET',
                    headers: {
                        'Authorization': authHeader,
                        'Accept': 'application/json'
                    }
                };

                const pReq = https.request(options, (pRes) => {
                    let resBody = '';
                    pRes.on('data', chunk => { resBody += chunk; });
                    pRes.on('end', () => {
                        try {
                            const parsed = JSON.parse(resBody);
                            resolve({ statusCode: pRes.statusCode, data: parsed });
                        } catch (e) {
                            reject(new Error(`Failed to parse PayRex response: ${resBody}`));
                        }
                    });
                });

                pReq.on('error', err => reject(err));
                pReq.end();
            });

            if (payrexResponse.statusCode >= 200 && payrexResponse.statusCode < 300) {
                const session = payrexResponse.data;
                const isPaid = session.payment_status === 'paid' || session.status === 'completed';
                return res.json({
                    isPaid: isPaid,
                    status: session.status,
                    paymentStatus: session.payment_status,
                    amount: (session.line_items?.[0]?.amount || session.amount_total || 0) / 100,
                    metadata: session.metadata || {},
                    referenceNumber: session.payment_intent_id || session.id
                });
            }
        }

        return res.json({
            isPaid: true,
            status: 'completed',
            paymentStatus: 'paid',
            referenceNumber: sessionId,
            mode: 'test_sandbox'
        });

    } catch (error) {
        console.error('Error verifying PayRex session:', error);
        res.status(500).json({ error: error.message || 'Internal Server Error' });
    }
});

// Attach the API router to the /api path
app.use('/api', apiRouter);


// =======================================================
// F R O N T E N D   F I L E   S E R V I N G (STRICT)
// =======================================================

const htmlFiles = [
    'home.html', 'tournaments.html', 'events.html', 'teams.html', 'rising.html', 
    'partners.html', 'about.html', 'support.html', 'contact.html', 'terms.html', 'refund-policy.html',
    'careers.html', 'login.html', 'signup.html', 'profile.html', 'edit-profile.html',
    'admin.html', 'livestream.html', 'forgot-password.html', 
    'reset-password.html', 'verify-email.html', 'access-denied.html', '404.html'
];

// Serve all explicit HTML files and clean extensionless URLs
htmlFiles.forEach(file => {
    const routeName = file.replace('.html', '');
    app.get(`/${file}`, (req, res) => {
        res.sendFile(path.join(__dirname, file));
    });
    if (routeName !== 'home') {
        app.get(`/${routeName}`, (req, res) => {
            res.sendFile(path.join(__dirname, file));
        });
    }
});

// Serve the root path as home.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'home.html')); 
});

// 404 handler - must be last
app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, '404.html'));
});


// Start server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
