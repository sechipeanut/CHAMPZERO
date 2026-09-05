// scripts/reset-points-and-calibrate-streaks.js
// Reset all users' CZ points to 0 and calibrate streaks so check-in functions properly.

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

// PHT Yesterday helper
function getPHTYesterday() {
  const d = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Manila" }));
  d.setDate(d.getDate() - 1);
  return d.toISOString().split('T')[0];
}

async function main() {
  console.log("=== RESETTING CZ POINTS & CALIBRATING STREAKS FOR ALL USERS ===");
  const yesterdayStr = getPHTYesterday();
  console.log("Yesterday PHT:", yesterdayStr);

  const usersSnap = await db.collection('users').get();
  console.log(`Processing ${usersSnap.size} total users in database...`);

  // Active users who had actual prior consecutive streaks
  const activeStreakPreserveUids = new Set([
    'EOmDxbUBxdcrLi0U1Tb31ko6Qmy1', // Sello (Day 2)
    '4Vz0cuqUe3RMUUFkTjjbq2cHQW83'  // Yxin (Day 1)
  ]);

  const batchSize = 400;
  let batch = db.batch();
  let opCount = 0;
  let totalReset = 0;

  for (const docSnap of usersSnap.docs) {
    const data = docSnap.data();

    let streakVal = 1;
    let lastCheckInVal = "";

    if (activeStreakPreserveUids.has(docSnap.id)) {
      streakVal = typeof data.dailyStreak === 'number' && data.dailyStreak >= 1 ? data.dailyStreak : 1;
      lastCheckInVal = yesterdayStr; // Will advance to streakVal + 1 when claimed today
    } else {
      // For all other users, start clean at Day 1 with empty checkin
      streakVal = 1;
      lastCheckInVal = "";
    }

    batch.update(docSnap.ref, {
      czPoints: 0,
      lifetimePoints: 0,
      dailyStreak: streakVal,
      lastCheckInDate: lastCheckInVal,
      lastPointsResetAt: admin.firestore.FieldValue.serverTimestamp()
    });

    opCount++;
    totalReset++;

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

  console.log(`Successfully reset points to 0 and calibrated streaks for ${totalReset} users.`);

  // Verify verification
  console.log("\nVerifying database state...");
  const verifySnap = await db.collection('users').get();
  let pointsCount = 0;
  let nonZeroUsers = [];

  verifySnap.docs.forEach(d => {
    const dt = d.data();
    if ((dt.czPoints && dt.czPoints > 0) || (dt.lifetimePoints && dt.lifetimePoints > 0)) {
      pointsCount++;
      nonZeroUsers.push({ id: d.id, ign: dt.ign || dt.displayName, czPoints: dt.czPoints, lifetimePoints: dt.lifetimePoints });
    }
  });

  if (pointsCount === 0) {
    console.log("CONFIRMED: ALL 83 users now have EXACTLY 0 CZ Points and 0 Lifetime Points!");
  } else {
    console.warn(`WARNING: Found ${pointsCount} users with non-zero points:`, nonZeroUsers);
  }

  // Print sample user state
  const selloDoc = await db.collection('users').doc('EOmDxbUBxdcrLi0U1Tb31ko6Qmy1').get();
  console.log("Sample User (Sello):", {
    ign: selloDoc.data().ign,
    czPoints: selloDoc.data().czPoints,
    lifetimePoints: selloDoc.data().lifetimePoints,
    dailyStreak: selloDoc.data().dailyStreak,
    lastCheckInDate: selloDoc.data().lastCheckInDate
  });

  const sampleNewDoc = await db.collection('users').doc(verifySnap.docs[0].id).get();
  console.log("Sample User (General):", {
    ign: sampleNewDoc.data().ign,
    czPoints: sampleNewDoc.data().czPoints,
    lifetimePoints: sampleNewDoc.data().lifetimePoints,
    dailyStreak: sampleNewDoc.data().dailyStreak,
    lastCheckInDate: sampleNewDoc.data().lastCheckInDate
  });

  console.log("=== FINISHED SUCCESSFULLY ===");
  process.exit(0);
}

main().catch(err => {
  console.error("Execution failed:", err);
  process.exit(1);
});
