import { db } from './firebase-config.js'; 
import { doc, onSnapshot } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-firestore.js";

document.addEventListener('DOMContentLoaded', () => {
    
    // --- 1. Animation Logic (Handles Numbers & Strings like "10k+") ---
    function animateCountUp(element, valueStr, isCurrency = false) {
        if(!element) return;
        
        // 1. Clean the input to find the number
        const rawString = String(valueStr);
        // Remove everything except numbers, dots, and minus signs to find the value to animate
        const numericPart = parseFloat(rawString.replace(/[^0-9.-]+/g,""));
        
        // 2. Isolate the suffix (e.g., "k", "+", "M") by removing the numbers/dots
        // We also strip the currency symbol if the user typed it, to avoid double symbols
        let suffix = rawString.replace(/[0-9.,-]/g, '').replace('₱', '').trim();
        
        // If no number found, just display the text as-is
        if (isNaN(numericPart)) {
            element.textContent = rawString; 
            return;
        }

        const duration = 2000;
        const startTime = performance.now();
        
        function updateCount(currentTime) {
            const elapsedTime = currentTime - startTime;
            if (elapsedTime >= duration) {
                // Final state
                element.textContent = (isCurrency ? '₱' : '') + numericPart.toLocaleString() + suffix;
                return;
            }
            
            // Animation math
            const progress = elapsedTime / duration;
            const easeOut = 1 - Math.pow(1 - progress, 3);
            const currentVal = Math.floor(easeOut * numericPart);
            
            element.textContent = (isCurrency ? '₱' : '') + currentVal.toLocaleString() + suffix;
            requestAnimationFrame(updateCount);
        }
        requestAnimationFrame(updateCount);
    }

    // --- 2. Real-Time Listener (Connects to Admin Config) ---
    function initStatsListener() {
        const stats = {
            talents: document.getElementById('stat-talents'),
            followers: document.getElementById('stat-followers'),
            prizes: document.getElementById('stat-prizes'),
            tournaments: document.getElementById('stat-tournaments'),
            players: document.getElementById('stat-players'),
        };
        
        // Safety check: Only run if elements exist
        if (!stats.talents) return;

        console.log("Connecting to live stats...");

        // LISTEN to 'site_config/home_stats' document
        onSnapshot(doc(db, "site_config", "home_stats"), (docSnap) => {
            if (docSnap.exists()) {
                const data = docSnap.data();
                
                // Animate to the values set in Admin (defaults to "0" if empty)
                animateCountUp(stats.talents, data.talentCount || "0");
                animateCountUp(stats.followers, data.followerCount || "0");
                animateCountUp(stats.prizes, data.prizePool || "0", true);
                animateCountUp(stats.tournaments, data.tournamentCount || "0");
                animateCountUp(stats.players, data.playerCount || "0");
            } else {
                console.warn("No stats config found.");
                animateCountUp(stats.talents, "0");
                animateCountUp(stats.followers, "0");
                animateCountUp(stats.prizes, "0", true);
                animateCountUp(stats.tournaments, "0");
                animateCountUp(stats.players, "0");
            }
        }, (error) => {
            console.error("Stats Error:", error);
        });
    }

    // Initialize
    initStatsListener();

    // --- 3. Fade In Animation (Visuals) ---
    const observer = new IntersectionObserver(entries => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('is-visible');
                observer.unobserve(entry.target);
            }
        });
    }, { threshold: 0.1 });

    document.querySelectorAll('.fade-in-section').forEach(section => observer.observe(section));
});