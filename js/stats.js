import { db } from './firebase-config.js'; 
import { doc, getDoc, collection, getDocs } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-firestore.js";

document.addEventListener('DOMContentLoaded', () => {
    initStats();
});

function initStats() {
    const statsSection = document.getElementById('stats-section');
    if (!statsSection) return;

    // Only start counting when the user scrolls to the section
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                fetchAndAnimateStats();
                observer.unobserve(entry.target);
            }
        });
    }, { threshold: 0.5 });

    observer.observe(statsSection);
}

async function fetchAndAnimateStats() {
    // 1. Start with 0
    let stats = {
        talents: 0,
        followers: 0,
        prizes: 0, // This will be calculated from tournaments
        tournaments: 0, // This will be counted from tournaments
        players: 0
    };

    try {
        // --- STEP A: Fetch "Manual" Stats (Followers/Talents) ---
        // We still get these from your settings doc because counting followers one by one is slow
        const summaryDoc = await getDoc(doc(db, "statistics", "homepage"));
        if (summaryDoc.exists()) {
            const summaryData = summaryDoc.data();
            stats.talents = summaryData.talents || 0;
            stats.followers = summaryData.followers || 0;
            stats.players = summaryData.players || 0;
        }

        // --- STEP B: Calculate "Real" Stats from Tournaments ---
        // This connects to the exact same database your Tournament Page uses
        const tournamentSnapshot = await getDocs(collection(db, "tournaments"));
        
        let calculatedPrize = 0;
        let calculatedCount = 0;

        tournamentSnapshot.forEach((doc) => {
            const data = doc.data();
            
            // 1. Count the tournament
            calculatedCount++; 

            // 2. Add up the prize money
            // We check both 'prizePool' and 'prize' in case you named it differently
            const rawPrize = data.prizePool || data.prize || "0";
            
            // CLEANER: This removes "PHP", "$", commas, and spaces to get a pure number
            // Example: "PHP 10,000" becomes 10000
            const cleanString = String(rawPrize).replace(/[^0-9.]/g, '');
            const prizeValue = parseFloat(cleanString);

            if (!isNaN(prizeValue)) {
                calculatedPrize += prizeValue;
            }
        });

        // Update the stats object with the real calculated numbers
        stats.tournaments = calculatedCount;
        stats.prizes = calculatedPrize;

    } catch (error) {
        console.error("Error calculating real stats:", error);
    }

    // 3. Animate the final numbers on the screen
    animateValue("stat-talents", 0, stats.talents, 2000);
    animateValue("stat-followers", 0, stats.followers, 2500, "+"); // Adds '+' prefix
    animateValue("stat-prizes", 0, stats.prizes, 3000, "₱");       // Adds '₱' prefix
    animateValue("stat-tournaments", 0, stats.tournaments, 1500);
    animateValue("stat-players", 0, stats.players, 2000);
}

// Animation Logic (Makes numbers count up smoothly)
function animateValue(id, start, end, duration, prefix = "") {
    const obj = document.getElementById(id);
    if (!obj) return;

    let startTimestamp = null;
    const step = (timestamp) => {
        if (!startTimestamp) startTimestamp = timestamp;
        const progress = Math.min((timestamp - startTimestamp) / duration, 1);
        const easeOutQuad = 1 - (1 - progress) * (1 - progress); 
        const current = Math.floor(easeOutQuad * (end - start) + start);
        
        let formatted = current.toLocaleString();
        
        if(current > 10000 && id === "stat-followers") {
             formatted = (current / 1000).toFixed(1) + "k";
        }

        obj.innerHTML = prefix + formatted;

        if (progress < 1) {
            window.requestAnimationFrame(step);
        } else {
            let final = end.toLocaleString();
            if(end > 10000 && id === "stat-followers") final = (end / 1000).toFixed(1) + "k";
            obj.innerHTML = prefix + final;
        }
    };
    window.requestAnimationFrame(step);
}