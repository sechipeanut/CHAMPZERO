import { db } from './firebase-config.js'; 
import { collection, getDocs } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-firestore.js";

document.addEventListener('DOMContentLoaded', () => {
    initStats();
});

function initStats() {
    const statsSection = document.getElementById('stats-section');
    if (!statsSection) return;

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                calculateAndAnimateStats();
                observer.unobserve(entry.target); 
            }
        });
    }, { threshold: 0.5 });

    observer.observe(statsSection);
}

async function calculateAndAnimateStats() {
    // Variables for our dynamic stats
    let totalPrizes = 0;
    let totalEventsHosted = 0;
    let totalPlayers = 0;
    let totalTalents = 0; // We can calculate this dynamically too

    // Static fallback for followers (unless you have a followers collection)
    const staticFollowers = 1500; 

    try {
        // --- 1. Calculate Prize Pool & Tournament Count ---
        const tourneySnapshot = await getDocs(collection(db, "tournaments"));
        let tournamentCount = 0;
        
        tourneySnapshot.forEach(doc => {
            const data = doc.data();
            tournamentCount++;
            
            // Clean and sum prize money
            let prizeVal = 0;
            if (typeof data.prize === 'number') {
                prizeVal = data.prize;
            } else if (typeof data.prize === 'string') {
                prizeVal = Number(data.prize.replace(/[^0-9.-]+/g,""));
            }
            if (!isNaN(prizeVal)) totalPrizes += prizeVal;
        });

        // --- 2. Calculate Event Count ---
        const eventSnapshot = await getDocs(collection(db, "events"));
        const eventCount = eventSnapshot.size;

        // Combine Tournaments + Events
        totalEventsHosted = tournamentCount + eventCount;

        // --- 3. Calculate Registered Players (Users) ---
        // This fetches the actual count of documents in your 'users' collection
        const usersSnapshot = await getDocs(collection(db, "users"));
        totalPlayers = usersSnapshot.size;

        // --- 4. Calculate Talents (Optional) ---
        // If you have a 'talents' collection, uncomment the lines below:
        // const talentsSnapshot = await getDocs(collection(db, "talents"));
        // totalTalents = talentsSnapshot.size;
        // If not, we use the fallback from the screenshot (2)
        totalTalents = 2; 

        // Rounding Logic for Prizes
        if (totalPrizes > 1000) {
            totalPrizes = Math.floor(totalPrizes / 1000) * 1000;
        }

    } catch (error) {
        console.error("Error calculating stats:", error);
    }

    // --- 5. Animate the numbers ---
    animateValue("stat-talents", 0, totalTalents, 2000);
    animateValue("stat-followers", 0, staticFollowers, 2500, "+");
    animateValue("stat-prizes", 0, totalPrizes, 3000, "₱", "+");
    animateValue("stat-tournaments", 0, totalEventsHosted, 2000);
    
    // Animate the real player count
    animateValue("stat-players", 0, totalPlayers, 2000);
}

// Animation Logic
function animateValue(id, start, end, duration, prefix = "", suffix = "") {
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

        obj.innerHTML = prefix + formatted + suffix;

        if (progress < 1) {
            window.requestAnimationFrame(step);
        } else {
            let final = end.toLocaleString();
            if(end > 10000 && id === "stat-followers") final = (end / 1000).toFixed(1) + "k";
            obj.innerHTML = prefix + final + suffix;
        }
    };
    window.requestAnimationFrame(step);
}