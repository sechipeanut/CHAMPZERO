// server.js
// Node + Express backend using Firebase Realtime Database
// NOTE: AUTHENTICATION IS TEMPORARILY MOCKED TO BYPASS FIREBASE ADMIN CRASH

const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const admin = require('firebase-admin');
const path = require('path');

// ✅ Initialize Express first
const app = express();
const PORT = 3000;

// ✅ Middleware
app.use(cors());
app.use(bodyParser.json());

// ✅ Serve static files (pictures, js, etc.)
app.use('/pictures', express.static(path.join(__dirname, 'pictures')));
app.use('/js', express.static(path.join(__dirname, 'js')));

// ✅ Log every request
app.use((req, res, next) => {
  console.log(`${req.method} ${req.url}`);
  next();
});

// ✅ Firebase admin init (CRASHING SECTION)
// NOTE: We wrap this in a try/catch to let the rest of the server run if it fails.
try {
  const serviceAccount = require('./firebase-key.json');
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: "https://champzero-92951-default-rtdb.asia-southeast1.firebasedatabase.app"
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

// ---------------- MOCK AUTHENTICATION ROUTES (TEMPORARY) ----------------

// MOCK Sign Up Route: Skips Firebase Auth. Writes directly to Realtime DB (INSECURE).
apiRouter.post('/auth/signup', async (req, res) => {
    const { email, password, username } = req.body;
    
    if (!email || !password || !username) {
        return res.status(400).json({ error: 'Email, password, and username are required.' });
    }

    try {
        const mockUid = 'user_' + Date.now(); 

        await db.ref(`users/${mockUid}`).set({
            username: username,
            email: email,
            // WARNING: Password is NOT stored securely in this mock.
            joined: Date.now(),
        });
        
        const mockToken = `MOCK_TOKEN_${mockUid}`;

        res.status(201).json({ 
            message: 'User created successfully (MOCK).', 
            uid: mockUid,
            token: mockToken,
            username: username
        });

    } catch (error) {
        console.error('MOCK signup failed:', error);
        res.status(500).json({ error: 'MOCK authentication failed due to database write error.' });
    }
});

// MOCK Login Route: Checks against the mock users in the Realtime DB.
apiRouter.post('/auth/login', async (req, res) => {
    const { email, password } = req.body;
    
    if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required.' });
    }

    try {
        // Find user by email in the Realtime Database
        const userSnap = await db.ref('users').orderByChild('email').equalTo(email).once('value');
        const userFound = userSnap.val();
        
        if (!userFound) {
            return res.status(400).json({ error: 'Invalid email or password (MOCK).' });
        }
        
        const userId = Object.keys(userFound)[0];
        const userData = userFound[userId];
        
        // MOCK password check: Since we can't securely hash passwords, we just check if it exists.
        if (password !== userData.password && userData.password) {
            return res.status(400).json({ error: 'Invalid email or password (MOCK).' });
        }

        const mockToken = `MOCK_TOKEN_${userId}`;

        res.json({ 
            message: 'Login successful (MOCK).', 
            uid: userId, 
            token: mockToken,
            username: userData.username
        });

    } catch (error) {
        console.error('MOCK login failed:', error);
        res.status(500).json({ error: error.message || 'MOCK Authentication failed.' });
    }
});

// ---------------- NEW: GET User Profile Data ----------------
apiRouter.get('/user/data/:uid', async (req, res) => {
    const { uid } = req.params;
    
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


// Attach the API router to the /api path
app.use('/api', apiRouter);


// =======================================================
// F R O N T E N D   F I L E   S E R V I N G (STRICT)
// =======================================================

const htmlFiles = ['home.html', 'tournaments.html', 'events.html', 'teams.html', 'rising.html', 'partners.html', 'shop.html', 'about.html', 'contact.html', 'terms.html', 'careers.html', 'login.html', 'signup.html', 'profile.html', 'admin.html', 'leaderboard.html', 'forgot-password.html', '404.html'];

// Serve all explicit HTML files directly
htmlFiles.forEach(file => {
    app.get(`/${file}`, (req, res) => {
        res.sendFile(path.join(__dirname, file));
    });
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