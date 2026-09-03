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
app.use(cors({ origin: true, credentials: true }));
app.use(bodyParser.json());

// Parse cookies from headers (Zero-dependency cookie parser)
app.use((req, res, next) => {
  const rawCookies = req.headers.cookie;
  req.cookies = {};
  if (rawCookies) {
    rawCookies.split(';').forEach(c => {
      const [key, ...v] = c.trim().split('=');
      if (key) req.cookies[key] = decodeURIComponent(v.join('='));
    });
  }
  next();
});

// Disable caching for development so browser always gets latest JS/HTML
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});

// 2.1 Security Blocking Middleware (Prevent access to sensitive, environment, and config endpoints)
app.use((req, res, next) => {
  const url = req.url || '';
  if (/\.env/i.test(url) || /serviceAccountKey.*\.json/i.test(url) || /scratch\//i.test(url) || /scripts\//i.test(url) || /\.git/i.test(url) || /firestore\.rules/i.test(url) || /ARCHITECTURE\.txt/i.test(url) || /^\/(api|\.netlify\/functions)\/firebase-config/i.test(url)) {
    return res.status(404).sendFile(path.join(__dirname, '404.html'));
  }
  next();
});

// 3. Serve static files (pictures, js, etc.)
app.use('/pictures', express.static(path.join(__dirname, 'pictures'), { maxAge: 0 }));
app.use('/js', express.static(path.join(__dirname, 'js'), { maxAge: 0 }));
app.use('/css', express.static(path.join(__dirname, 'css'), { maxAge: 0 }));
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

// ---------------- AUTHENTICATION & SESSION MANAGEMENT (BFF) ----------------

// Unified Middleware: Verifies HTTP-Only Session Cookie (__session) or Bearer Token
async function verifyFirebaseToken(req, res, next) {
    const sessionCookie = req.cookies?.__session;
    const authHeader = req.headers.authorization;

    // 1. Primary: Verify HTTP-only session cookie
    if (sessionCookie) {
        try {
            const decodedClaims = await admin.auth().verifySessionCookie(sessionCookie, true);
            req.user = decodedClaims;
            return next();
        } catch (cookieErr) {
            // Invalid or revoked session cookie; clear it
            res.setHeader('Set-Cookie', '__session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');
        }
    }

    // 2. Fallback: Bearer Token (for backward compatibility during migration)
    if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.split('Bearer ')[1].trim();
        try {
            const decodedToken = await admin.auth().verifyIdToken(token);
            req.user = decodedToken;
            return next();
        } catch (error) {
            return res.status(401).json({ error: 'Unauthorized: Invalid token' });
        }
    }

    return res.status(401).json({ error: 'Unauthorized: Active session required' });
}

// Helper to issue an encrypted HTTP-only session cookie
async function setSessionCookie(res, idToken) {
    const expiresIn = 5 * 24 * 60 * 60 * 1000; // 5 days in ms
    const sessionCookie = await admin.auth().createSessionCookie(idToken, { expiresIn });
    const isProduction = process.env.NODE_ENV === 'production';

    const cookieParts = [
        `__session=${sessionCookie}`,
        'Path=/',
        'HttpOnly',
        'SameSite=Strict',
        `Max-Age=${expiresIn / 1000}`
    ];
    if (isProduction) {
        cookieParts.push('Secure');
    }
    res.setHeader('Set-Cookie', cookieParts.join('; '));
    return sessionCookie;
}

// Session Login: Exchange client token or credentials for HTTP-only cookie
apiRouter.post('/auth/login', async (req, res) => {
    const { idToken, email, password } = req.body;

    try {
        let verifiedIdToken = idToken;

        // Verify credentials with Identity Toolkit if credentials provided directly
        if (!verifiedIdToken && email && password) {
            const apiKey = process.env.FIREBASE_WEB_API_KEY;
            if (!apiKey) {
                return res.status(500).json({ error: 'Server configuration error: Authentication service unconfigured.' });
            }

            const postData = JSON.stringify({ email, password, returnSecureToken: true });
            const response = await new Promise((resolve, reject) => {
                const reqHttps = https.request({
                    hostname: 'identitytoolkit.googleapis.com',
                    path: `/v1/accounts:signInWithPassword?key=${apiKey}`,
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Content-Length': Buffer.byteLength(postData)
                    }
                }, (r) => {
                    let body = '';
                    r.on('data', chunk => body += chunk);
                    r.on('end', () => {
                        try {
                            resolve({ status: r.statusCode, data: JSON.parse(body) });
                        } catch (e) {
                            reject(e);
                        }
                    });
                });
                reqHttps.on('error', reject);
                reqHttps.write(postData);
                reqHttps.end();
            });

            if (response.status !== 200 || !response.data?.idToken) {
                return res.status(401).json({ error: response.data?.error?.message || 'Invalid email or password.' });
            }

            verifiedIdToken = response.data.idToken;
        }

        if (!verifiedIdToken) {
            return res.status(400).json({ error: 'Missing authentication credentials or ID token.' });
        }

        await setSessionCookie(res, verifiedIdToken);
        const decoded = await admin.auth().verifyIdToken(verifiedIdToken);

        res.json({
            success: true,
            uid: decoded.uid,
            email: decoded.email,
            message: 'Session initialized successfully with HTTP-only cookie.'
        });

    } catch (error) {
        console.error('Session login error:', error.message);
        res.status(401).json({ error: 'Failed to create authenticated session.' });
    }
});

// Sign Up Route: Creates user & initializes profile
apiRouter.post('/auth/signup', async (req, res) => {
    const { email, password, username } = req.body;
    
    if (!email || !password || !username) {
        return res.status(400).json({ error: 'Email, password, and username are required.' });
    }

    try {
        const userRecord = await admin.auth().createUser({
            email: email,
            password: password,
            displayName: username
        });

        await db.collection('users').doc(userRecord.uid).set({
            username: username,
            displayName: username,
            email: email,
            role: 'user',
            czPoints: 0,
            createdAt: new Date().toISOString(),
            joined: Date.now()
        }, { merge: true });

        res.status(201).json({ 
            success: true,
            message: 'User created successfully.', 
            uid: userRecord.uid,
            username: username
        });

    } catch (error) {
        console.error('Signup error:', error.message);
        res.status(500).json({ error: error.message || 'Authentication failed.' });
    }
});

// Current Session State Check (Safe user metadata without secret keys)
apiRouter.get('/auth/session', verifyFirebaseToken, async (req, res) => {
    try {
        const userDoc = await db.collection('users').doc(req.user.uid).get();
        const userData = userDoc.exists ? userDoc.data() : {};

        res.json({
            authenticated: true,
            user: {
                uid: req.user.uid,
                email: req.user.email || userData.email || '',
                displayName: userData.displayName || userData.username || req.user.name || 'Champion',
                role: userData.role || req.user.role || 'user',
                avatar: userData.avatar || userData.photoURL || '',
                czPoints: userData.czPoints || 0
            }
        });
    } catch (err) {
        console.error('Session fetch error:', err.message);
        res.status(500).json({ error: 'Failed to retrieve session state' });
    }
});

// Session Logout: Revokes tokens and clears cookie
apiRouter.post('/auth/logout', async (req, res) => {
    const sessionCookie = req.cookies?.__session;
    if (sessionCookie) {
        try {
            const decoded = await admin.auth().verifySessionCookie(sessionCookie);
            await admin.auth().revokeRefreshTokens(decoded.uid);
        } catch (e) {
            // Continue clearing cookie
        }
    }

    res.setHeader('Set-Cookie', '__session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');
    res.json({ success: true, message: 'Logged out successfully.' });
});

// ---------------- GET User Profile Data (Protected) ----------------
apiRouter.get('/user/data/:uid', verifyFirebaseToken, async (req, res) => {
    const { uid } = req.params;
    
    // Verify user can only access their own data or is admin
    const isAdmin = req.user.role === 'admin' || req.user.admin === true;
    if (req.user.uid !== uid && !isAdmin) {
        return res.status(403).json({ error: 'Forbidden: Cannot access other users data.' });
    }
    
    try {
        const doc = await db.collection('users').doc(uid).get();
        
        if (!doc.exists) {
            return res.status(404).json({ error: 'User profile not found.' });
        }

        res.json(doc.data());

    } catch (error) {
        console.error('GET /user/data Firestore error:', error);
        res.status(500).json({ error: 'Failed to fetch user data from Firestore.' });
    }
});

// ---------------- SECURE DATA PROXY ROUTES (BFF) ----------------

apiRouter.get('/data/tournaments', async (req, res) => {
    try {
        const snap = await db.collection('tournaments').get();
        const items = [];
        snap.forEach(doc => items.push({ id: doc.id, ...doc.data() }));
        res.json(items);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch tournaments' });
    }
});

apiRouter.get('/data/tournaments/:id', async (req, res) => {
    try {
        const doc = await db.collection('tournaments').doc(req.params.id).get();
        if (!doc.exists) return res.status(404).json({ error: 'Tournament not found' });
        res.json({ id: doc.id, ...doc.data() });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

apiRouter.get('/data/events', async (req, res) => {
    try {
        const snap = await db.collection('events').get();
        const items = [];
        snap.forEach(doc => items.push({ id: doc.id, ...doc.data() }));
        res.json(items);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

apiRouter.get('/data/teams', async (req, res) => {
    try {
        const snap = await db.collection('recruitment').get();
        const items = [];
        snap.forEach(doc => items.push({ id: doc.id, ...doc.data() }));
        res.json(items);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

apiRouter.get('/data/user/profile', verifyFirebaseToken, async (req, res) => {
    try {
        const doc = await db.collection('users').doc(req.user.uid).get();
        if (!doc.exists) return res.status(404).json({ error: 'Profile not found' });
        res.json({ id: doc.id, ...doc.data() });
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch profile' });
    }
});

apiRouter.patch('/data/user/profile', verifyFirebaseToken, async (req, res) => {
    try {
        const updates = req.body || {};
        delete updates.role;
        delete updates.uid;
        delete updates.id;
        delete updates.escrowBalance;

        updates.updatedAt = new Date().toISOString();
        await db.collection('users').doc(req.user.uid).update(updates);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

apiRouter.get('/data/chat/messages', async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit || '50', 10), 100);
        const snap = await db.collection('global_chat_messages')
            .orderBy('createdAt', 'desc')
            .limit(limit)
            .get();
        const messages = [];
        snap.forEach(doc => messages.push({ id: doc.id, ...doc.data() }));
        res.json(messages.reverse());
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch messages' });
    }
});

// ---------------- TOURNAMENT & DATABASE ROUTES ----------------
apiRouter.get('/tournaments', async (req, res) => {
    try {
        const snap = await db.collection('tournaments').get();
        const items = [];
        snap.forEach(doc => items.push({ id: doc.id, ...doc.data() }));
        res.json(items);
    } catch (err) {
        console.error('Error fetching tournaments in server.js:', err);
        res.status(500).json({ error: 'Failed to fetch tournaments' });
    }
});

apiRouter.get('/tournaments/:id', async (req, res) => {
    try {
        const doc = await db.collection('tournaments').doc(req.params.id).get();
        if (!doc.exists) return res.status(404).json({ error: 'Tournament not found' });
        res.json({ id: doc.id, ...doc.data() });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

apiRouter.get('/events', async (req, res) => {
    try {
        const snap = await db.collection('events').get();
        const items = [];
        snap.forEach(doc => items.push({ id: doc.id, ...doc.data() }));
        res.json(items);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

apiRouter.get('/talents', async (req, res) => {
    try {
        const snap = await db.collection('talents').get();
        const items = [];
        snap.forEach(doc => items.push({ id: doc.id, ...doc.data() }));
        res.json(items);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

apiRouter.get('/teams', async (req, res) => {
    try {
        const snap = await db.collection('recruitment').get();
        const items = [];
        snap.forEach(doc => items.push({ id: doc.id, ...doc.data() }));
        res.json(items);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ---------------- SOCIAL & FRIEND REQUEST ROUTES (PROTECTED) ----------------
apiRouter.post('/friends/request', verifyFirebaseToken, async (req, res) => {
    try {
        const { fromUid, fromName, fromAvatar, toUid, toName, toAvatar } = req.body;
        if (!fromUid || !toUid) {
            return res.status(400).json({ error: 'Missing fromUid or toUid' });
        }

        // Anti-IDOR: verify sender identity matches authenticated user
        if (req.user.uid !== fromUid) {
            return res.status(403).json({ error: 'Forbidden: Cannot send friend request on behalf of another user.' });
        }

        if (fromUid === toUid) {
            return res.status(400).json({ error: 'Cannot send a friend request to yourself.' });
        }

        const reqPayload = {
            type: "friend_request",
            fromUid: req.user.uid,
            fromName: fromName || req.user.name || 'Champion',
            fromAvatar: fromAvatar || '',
            toUid: String(toUid).trim(),
            toName: toName || 'Champion',
            toAvatar: toAvatar || '',
            status: 'pending',
            createdAt: new Date().toISOString()
        };

        const docRef = await db.collection('friend_requests').add(reqPayload);
        res.json({ success: true, id: docRef.id });
    } catch (err) {
        console.error('Server error sending friend request:', err);
        res.status(500).json({ error: err.message });
    }
});

apiRouter.post('/friends/respond', verifyFirebaseToken, async (req, res) => {
    try {
        const { reqId, status } = req.body;
        if (!reqId || !status) {
            return res.status(400).json({ error: 'Missing reqId or status' });
        }

        const allowedStatuses = ['accepted', 'rejected'];
        if (!allowedStatuses.includes(status)) {
            return res.status(400).json({ error: 'Invalid status value.' });
        }

        const docRef = db.collection('friend_requests').doc(reqId);
        const docSnap = await docRef.get();
        if (!docSnap.exists) {
            return res.status(404).json({ error: 'Friend request not found.' });
        }

        const data = docSnap.data();
        // Anti-IDOR: only the recipient (or an admin) can accept/reject the request
        const isAdmin = req.user.role === 'admin' || req.user.admin === true;
        if (data.toUid !== req.user.uid && !isAdmin) {
            return res.status(403).json({ error: 'Forbidden: You are not authorized to respond to this friend request.' });
        }

        await docRef.update({
            status,
            updatedAt: new Date().toISOString()
        });

        res.json({ success: true });
    } catch (err) {
        console.error('Server error responding to friend request:', err);
        res.status(500).json({ error: err.message });
    }
});

apiRouter.post('/friends/remove', verifyFirebaseToken, async (req, res) => {
    try {
        const { reqId } = req.body;
        if (!reqId) {
            return res.status(400).json({ error: 'Missing reqId' });
        }

        const docRef = db.collection('friend_requests').doc(reqId);
        const docSnap = await docRef.get();
        if (!docSnap.exists) {
            return res.status(404).json({ error: 'Friend request not found.' });
        }

        const data = docSnap.data();
        // Anti-IDOR: only participants (fromUid or toUid) or admin can remove/cancel the request
        const isAdmin = req.user.role === 'admin' || req.user.admin === true;
        if (data.fromUid !== req.user.uid && data.toUid !== req.user.uid && !isAdmin) {
            return res.status(403).json({ error: 'Forbidden: You are not authorized to remove this friend request.' });
        }

        await docRef.delete();
        res.json({ success: true });
    } catch (err) {
        console.error('Server error removing friend:', err);
        res.status(500).json({ error: err.message });
    }
});

apiRouter.post('/chat/send', verifyFirebaseToken, async (req, res) => {
    try {
        const msgPayload = req.body || {};
        const senderId = msgPayload.senderId || msgPayload.userId;

        // Anti-IDOR: senderId must match authenticated user
        if (senderId && senderId !== req.user.uid) {
            return res.status(403).json({ error: 'Forbidden: Cannot send messages on behalf of another user.' });
        }

        const messageText = msgPayload.text || msgPayload.message;
        if (!messageText || typeof messageText !== 'string' || messageText.trim().length === 0) {
            return res.status(400).json({ error: 'Message content cannot be empty.' });
        }

        const sanitizedPayload = {
            ...msgPayload,
            senderId: req.user.uid,
            userId: req.user.uid,
            senderEmail: req.user.email || '',
            text: messageText.trim(),
            createdAt: new Date().toISOString()
        };

        const docRef = await db.collection('global_chat_messages').add(sanitizedPayload);
        res.json({ success: true, id: docRef.id });
    } catch (err) {
        console.error('Server error sending chat message:', err);
        res.status(500).json({ error: err.message });
    }
});


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

        const payrexSecretKey = process.env.PAYREX_SECRET_KEY ? process.env.PAYREX_SECRET_KEY.trim() : '';
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
            payment_methods: ['gcash', 'maya'],
            line_items: [
                {
                    name: itemName,
                    amount: amountInCents,
                    quantity: 1,
                    description: description
                }
            ],
            payment_method_types: ['gcash', 'maya'],
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

        if (payrexSecretKey && !payrexSecretKey.includes('REPLACE_WITH') && payrexSecretKey.length > 5) {
            // Helper function to try request on a hostname
            const makePayRexRequest = (host) => {
                return new Promise((resolve, reject) => {
                    const reqData = JSON.stringify(payload);
                    const authHeader = 'Basic ' + Buffer.from(payrexSecretKey + ':').toString('base64');

                    const options = {
                        hostname: host,
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
                                resolve({ statusCode: pRes.statusCode, raw: resBody, error: e.message });
                            }
                        });
                    });

                    pReq.on('error', err => reject(err));
                    pReq.write(reqData);
                    pReq.end();
                });
            };

            let payrexResponse;
            try {
                payrexResponse = await makePayRexRequest('api.payrexhq.com');
                if (!payrexResponse || payrexResponse.statusCode >= 500) {
                    payrexResponse = await makePayRexRequest('api.payrex.com');
                }
            } catch (netErr) {
                try {
                    payrexResponse = await makePayRexRequest('api.payrex.com');
                } catch (fallbackErr) {
                    console.error("PayRex Network Error:", fallbackErr);
                }
            }

            if (payrexResponse && payrexResponse.statusCode >= 200 && payrexResponse.statusCode < 300 && payrexResponse.data?.url) {
                return res.json({
                    url: payrexResponse.data.url,
                    sessionId: payrexResponse.data.id,
                    status: payrexResponse.data.status,
                    mode: 'live_payrex'
                });
            } else if (payrexResponse && payrexResponse.data) {
                console.error("PayRex API Error:", payrexResponse);
                return res.status(payrexResponse.statusCode || 500).json({
                    error: payrexResponse.data?.error?.message || payrexResponse.data?.message || 'PayRex API request failed.',
                    details: payrexResponse.data
                });
            }
        }

        // Fail-Closed: No unauthenticated or mock sandbox approvals
        return res.status(500).json({
            error: 'Server configuration error: PayRex payment gateway credentials not configured or live gateway unreachable.'
        });

    } catch (error) {
        console.error('Error creating PayRex checkout session:', error);
        res.status(500).json({ error: error.message || 'Internal Server Error' });
    }
});

apiRouter.get('/payrex/verify-session/:sessionId', async (req, res) => {
    try {
        const { sessionId } = req.params;
        const payrexSecretKey = process.env.PAYREX_SECRET_KEY ? process.env.PAYREX_SECRET_KEY.trim() : '';

        if (!payrexSecretKey || payrexSecretKey.includes('REPLACE_WITH') || payrexSecretKey.length < 10) {
            return res.status(500).json({
                error: 'Server configuration error: PayRex payment gateway credentials not configured.'
            });
        }

        const makeVerifyRequest = (host) => {
            return new Promise((resolve, reject) => {
                const authHeader = 'Basic ' + Buffer.from(payrexSecretKey + ':').toString('base64');
                const options = {
                    hostname: host,
                    path: `/v1/checkout_sessions/${encodeURIComponent(sessionId)}`,
                    method: 'GET',
                    headers: {
                        'Authorization': authHeader,
                        'Accept': 'application/json'
                    },
                    timeout: 8000
                };

                const pReq = https.request(options, (pRes) => {
                    let resBody = '';
                    pRes.on('data', chunk => { resBody += chunk; });
                    pRes.on('end', () => {
                        try {
                            const parsed = JSON.parse(resBody);
                            resolve({ statusCode: pRes.statusCode, data: parsed });
                        } catch (e) {
                            resolve({ statusCode: pRes.statusCode, raw: resBody, error: e.message });
                        }
                    });
                });

                pReq.on('timeout', () => {
                    pReq.destroy();
                    reject(new Error('Gateway request timed out'));
                });

                pReq.on('error', err => reject(err));
                pReq.end();
            });
        };

        let payrexResponse;
        try {
            payrexResponse = await makeVerifyRequest('api.payrexhq.com');
            if (!payrexResponse || payrexResponse.statusCode >= 500) {
                payrexResponse = await makeVerifyRequest('api.payrex.com');
            }
        } catch (e) {
            try {
                payrexResponse = await makeVerifyRequest('api.payrex.com');
            } catch (err) {
                console.error("PayRex Verify Network Error:", err.message);
                return res.status(502).json({
                    isPaid: false,
                    error: 'Payment gateway communication failure. Could not verify payment status.'
                });
            }
        }

        if (payrexResponse && payrexResponse.statusCode >= 200 && payrexResponse.statusCode < 300 && payrexResponse.data) {
            const session = payrexResponse.data;
            const isPaid = session.payment_status === 'paid' || session.status === 'completed' || session.status === 'succeeded';
            return res.json({
                isPaid: isPaid,
                status: session.status || 'unknown',
                paymentStatus: session.payment_status || 'unpaid',
                amount: (session.line_items?.[0]?.amount || session.amount_total || 0) / 100,
                metadata: session.metadata || {},
                referenceNumber: session.payment_intent_id || session.id || sessionId
            });
        }

        // Fail-Closed: Return unconfirmed payment if gateway does not report completion
        return res.status(payrexResponse?.statusCode === 404 ? 404 : 400).json({
            isPaid: false,
            error: payrexResponse?.data?.error?.message || 'Payment session verification failed or session unconfirmed.'
        });

    } catch (error) {
        console.error('Error verifying PayRex session:', error.message);
        res.status(500).json({ isPaid: false, error: error.message || 'Internal Server Error' });
    }
});

// Attach the API router to the /api path
app.use('/api', apiRouter);

// Netlify functions compatibility adapter for local Express server
app.all('/.netlify/functions/:fnName', async (req, res) => {
    const fnName = req.params.fnName;
    const fnPath = path.join(__dirname, 'netlify', 'functions', `${fnName}.js`);
    
    const fs = require('fs');
    if (!fs.existsSync(fnPath)) {
        return res.status(404).json({ error: `Function ${fnName} not found` });
    }

    try {
        delete require.cache[require.resolve(fnPath)];
        const fnModule = require(fnPath);
        const handler = fnModule.handler || fnModule;

        const event = {
            httpMethod: req.method,
            path: req.path,
            headers: req.headers,
            queryStringParameters: req.query,
            body: typeof req.body === 'object' ? JSON.stringify(req.body) : req.body
        };

        const result = await handler(event, {});
        if (!result) {
            return res.status(200).end();
        }

        if (result.headers) {
            for (const [key, val] of Object.entries(result.headers)) {
                res.set(key, val);
            }
        }
        res.status(result.statusCode || 200);
        if (result.body) {
            try {
                const parsed = JSON.parse(result.body);
                res.json(parsed);
            } catch {
                res.send(result.body);
            }
        } else {
            res.end();
        }
    } catch (err) {
        console.error(`Error running function ${fnName}:`, err);
        res.status(500).json({ error: err.message });
    }
});


// =======================================================
// F R O N T E N D   F I L E   S E R V I N G (STRICT)
// =======================================================

const htmlFiles = [
    'index.html', 'home.html', 'tournaments.html', 'events.html', 'teams.html', 'rising.html', 
    'partners.html', 'about.html', 'support.html', 'contact.html', 'terms.html', 'refund-policy.html',
    'careers.html', 'login.html', 'signup.html', 'profile.html', 'edit-profile.html',
    'admin.html', 'checkout.html', 'livestream.html', 'forgot-password.html', 
    'reset-password.html', 'verify-email.html', 'access-denied.html', '404.html'
];

// Serve all explicit HTML files and clean extensionless URLs
htmlFiles.forEach(file => {
    const routeName = file.replace('.html', '');
    app.get(`/${file}`, (req, res) => {
        res.sendFile(path.join(__dirname, file));
    });
    app.get(`/${routeName}`, (req, res) => {
        res.sendFile(path.join(__dirname, file));
    });
});

// Dynamic fallback for any existing HTML file in workspace root
app.use((req, res, next) => {
    if (req.method !== 'GET') return next();
    const cleanPath = req.path.replace(/^\//, '').replace(/\/$/, '');
    if (!cleanPath) return next();

    // Prevent directory traversal or source/configuration file disclosure
    if (cleanPath.startsWith('.') || cleanPath.includes('..') || cleanPath.endsWith('.env') || cleanPath.endsWith('.js') || cleanPath.endsWith('.rules') || cleanPath.endsWith('.txt') || cleanPath.endsWith('.json') || cleanPath.endsWith('.md')) {
        return next();
    }

    const possibleFile = cleanPath.endsWith('.html') ? cleanPath : `${cleanPath}.html`;
    const fullPath = path.join(__dirname, possibleFile);
    const fs = require('fs');
    if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
        return res.sendFile(fullPath);
    }
    next();
});

// Serve root path as home.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'home.html')); 
});
app.get('/home', (req, res) => {
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
