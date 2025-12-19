import { db } from './firebase-config.js'; 
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-firestore.js";

document.addEventListener('DOMContentLoaded', () => {
    initStats();
});

function initStats() {
    const statsSection = document.getElementById('stats-section');
    if (!statsSection) return;

    // Trigger animation when section comes into view
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                fetchAndAnimateStats();
                observer.unobserve(entry.target); // Only run once
            }
        });
    }, { threshold: 0.5 });

    observer.observe(statsSection);
}

async function fetchAndAnimateStats() {
    // Default "Starter" numbers (Used if DB is empty or fails)
    let stats = {
        talents: 12,
        followers: 1500,
        prizes: 50000, // in pesos or currency
        tournaments: 8,
        players: 120
    };

    try {
        // 1. Try to fetch real stats from Firestore
        // You need to create a collection named 'statistics' and a document named 'homepage'
        const docRef = doc(db, "statistics", "homepage");
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
            const data = docSnap.data();
            // Merge DB data with defaults (in case some fields are missing)
            stats = { ...stats, ...data };
        } else {
            console.log("No stats document found. Using default starter values.");
        }

    } catch (error) {
        console.error("Error fetching stats:", error);
    }

    // 2. Animate the numbers
    animateValue("stat-talents", 0, stats.talents, 2000);
    animateValue("stat-followers", 0, stats.followers, 2500, "+");
    animateValue("stat-prizes", 0, stats.prizes, 3000, "₱");
    animateValue("stat-tournaments", 0, stats.tournaments, 1500);
    animateValue("stat-players", 0, stats.players, 2000);
}

// Animation Logic
function animateValue(id, start, end, duration, prefix = "") {
    const obj = document.getElementById(id);
    if (!obj) return;

    let startTimestamp = null;
    const step = (timestamp) => {
        if (!startTimestamp) startTimestamp = timestamp;
        const progress = Math.min((timestamp - startTimestamp) / duration, 1);
        
        // Easing function for smooth effect
        const easeOutQuad = 1 - (1 - progress) * (1 - progress); 
        
        const current = Math.floor(easeOutQuad * (end - start) + start);
        
        // Format numbers (e.g. 1,200 instead of 1200)
        let formatted = current.toLocaleString();
        
        // Handle "k" formatting for large numbers if needed
        if(current > 10000 && id === "stat-followers") {
             formatted = (current / 1000).toFixed(1) + "k";
        }

        obj.innerHTML = prefix + formatted;

        if (progress < 1) {
            window.requestAnimationFrame(step);
        } else {
            // Ensure final number is exact
            let final = end.toLocaleString();
            if(end > 10000 && id === "stat-followers") final = (end / 1000).toFixed(1) + "k";
            obj.innerHTML = prefix + final;
        }
    };
    window.requestAnimationFrame(step);
}