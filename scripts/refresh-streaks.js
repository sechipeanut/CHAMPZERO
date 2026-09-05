// scripts/refresh-streaks.js
// Script to refresh all users' daily check-in streaks and dispatch global & personal notifications.

require('dotenv').config();
const admin = require('firebase-admin');

const serviceAccount = {
  type: process.env.FIREBASE_TYPE,
  project_id: process.env.FIREBASE_PROJECT_ID,
  private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
  private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  client_email: process.env.FIREBASE_CLIENT_EMAIL,
  client_id: process.env.FIREBASE_CLIENT_ID
};

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

// PHT date helpers
function getPHTYesterday() {
  const d = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Manila" }));
  d.setDate(d.getDate() - 1);
  return d.toISOString().split('T')[0];
}

async function main() {
  console.log("=== STARTING STREAK REFRESH & NOTIFICATION DISPATCH ===");
  const yesterdayStr = getPHTYesterday();
  console.log("Setting lastCheckInDate to yesterday (PHT):", yesterdayStr);

  const usersSnap = await db.collection('users').get();
  console.log(`Found ${usersSnap.size} total users.`);

  // 1. Batch update all users to refresh their daily check-in availability
  const batchSize = 400;
  let batch = db.batch();
  let opCount = 0;
  let updatedUsers = 0;

  for (const docSnap of usersSnap.docs) {
    const data = docSnap.data();
    const currentStreak = typeof data.dailyStreak === 'number' && data.dailyStreak >= 1 ? data.dailyStreak : 1;

    // Reset lastCheckInDate to yesterday so isAlreadyClaimed is false,
    // and when user claims, their streak increments by 1.
    // If streak was undefined, initialize to 1.
    batch.update(docSnap.ref, {
      lastCheckInDate: yesterdayStr,
      dailyStreak: currentStreak,
      lastStreakRefreshAt: admin.firestore.FieldValue.serverTimestamp()
    });

    opCount++;
    updatedUsers++;

    if (opCount >= batchSize) {
      await batch.commit();
      console.log(`Committed batch of ${opCount} updates.`);
      batch = db.batch();
      opCount = 0;
    }
  }

  if (opCount > 0) {
    await batch.commit();
    console.log(`Committed final batch of ${opCount} updates.`);
  }

  console.log(`Successfully refreshed streaks for ${updatedUsers} users.`);

  // 2. Create Global Announcement Notification
  const globalNotifRef = await db.collection('notifications').add({
    isGlobal: true,
    isPublic: true,
    title: "Daily Streaks Refreshed! ⚡",
    message: "All player daily check-ins and Arena streaks have been refreshed for today. Visit your player profile rewards vault now to claim your CZ points and build your 7-day streak!",
    tag: "STREAK REFRESH",
    type: "announcement",
    link: "/profile?tab=rewards",
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    timestamp: Date.now()
  });

  console.log("Created Global Announcement notification with ID:", globalNotifRef.id);

  // 3. Dispatch Personal Notification to all users
  let notifBatch = db.batch();
  let notifCount = 0;
  let personalCount = 0;

  for (const docSnap of usersSnap.docs) {
    const userNotifRef = db.collection('users').doc(docSnap.id).collection('notifications').doc();
    notifBatch.set(userNotifRef, {
      title: "Daily Streak Refreshed! ⚡",
      message: "Your daily check-in has been refreshed! Head over to your profile rewards vault now to claim your daily CZ points and progress your 7-day Arena streak.",
      type: "player_alert",
      tag: "STREAK REFRESH",
      link: "/profile?tab=rewards",
      read: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      timestamp: Date.now()
    });

    notifCount++;
    personalCount++;

    if (notifCount >= batchSize) {
      await notifBatch.commit();
      console.log(`Committed batch of ${notifCount} personal notifications.`);
      notifBatch = db.batch();
      notifCount = 0;
    }
  }

  if (notifCount > 0) {
    await notifBatch.commit();
    console.log(`Committed final batch of ${notifCount} personal notifications.`);
  }

  console.log(`Successfully dispatched personal notifications to ${personalCount} users.`);
  console.log("=== COMPLETED STREAK REFRESH & NOTIFICATION DISPATCH ===");
  process.exit(0);
}

main().catch(err => {
  console.error("Error executing streak refresh:", err);
  process.exit(1);
});
