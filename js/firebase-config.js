// js/firebase-config.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyA9wAR0m7ttEswtxs9TNc35JS0gUcRTxGw",
  authDomain: "champzero-92951.firebaseapp.com",
  databaseURL: "https://champzero-92951-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "champzero-92951",
  storageBucket: "champzero-92951.firebasestorage.app",
  messagingSenderId: "655748212673",
  appId: "1:655748212673:web:9db0611c8fc7a8f130f140",
  measurementId: "G-FDFF1NLL6L"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

export { auth, db };