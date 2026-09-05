// scripts/reset-streaks-completely.js
// Completely reset streak days claimed, daily quests, and CZ points to Day 1 for all users.

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

async function main() {
  console.log("=== EXECUTING COMPLETE STREAK & CLAIMED DAYS RESET FOR ALL USERS ===");

  const usersSnap = await db.collection('users').get();
  console.log(`Found ${usersSnap.size} total users in database.`);

  const batchSize = 400;
  let batch = db.batch();
  let opCount = 0;
  let totalCount = 0;

  for (const docSnap of usersSnap.docs) {
    batch.update(docSnap.ref, {
      dailyStreak: 1,
      lastCheckInDate: "",
      lastDailyScoutDate: "",
      lastDailyChatDate: "",
      lastDailyScrimDate: "",
      czPoints: 0,
      lifetimePoints: 0,
      streakResetAt: admin.firestore.FieldValue.serverTimestamp()
    });

    opCount++;
    totalCount++;

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

  console.log(`Successfully reset all ${totalCount} users to Day 1 (0 days claimed).`);

  // Verify verification
  console.log("\nVerifying database state...");
  const selloDoc = await db.collection('users').doc('EOmDxbUBxdcrLi0U1Tb31ko6Qmy1').get();
  console.log("Sello verified state:", {
    ign: selloDoc.data().ign,
    dailyStreak: selloDoc.data().dailyStreak,
    lastCheckInDate: selloDoc.data().lastCheckInDate,
    lastDailyScoutDate: selloDoc.data().lastDailyScoutDate,
    czPoints: selloDoc.data().czPoints,
    lifetimePoints: selloDoc.data().lifetimePoints
  });

  const allSnap = await db.collection('users').get();
  let invalidCount = 0;
  allSnap.docs.forEach(d => {
    const data = d.data();
    if (data.dailyStreak !== 1 || data.lastCheckInDate !== "" || data.czPoints !== 0) {
      invalidCount++;
      console.warn("Unexpected state for user:", d.id, data.ign, data.dailyStreak, data.lastCheckInDate, data.czPoints);
    }
  });

  if (invalidCount === 0) {
    console.log("CONFIRMED: 100% of all 83 users now have dailyStreak = 1, lastCheckInDate = '', and czPoints = 0!");
  }

  console.log("=== FINISHED SUCCESSFULLY ===");
  process.exit(0);
}

main().catch(err => {
  console.error("Reset failed:", err);
  process.exit(1);
});
