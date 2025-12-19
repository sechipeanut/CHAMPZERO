// js/home.js
import { db } from './firebase-config.js';
import { collection, getCountFromServer } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-firestore.js";

// --- ANIMATION LOGIC ---
function animateCountUp(element, finalValue, isCurrency = false) {
    let start = 0;
    const duration = 2000;
    const startTime = performance.now();

    function updateCount(currentTime) {
        const elapsedTime = currentTime - startTime;
        if (elapsedTime >= duration) {
            element.textContent = (isCurrency ? '₱' : '') + finalValue.toLocaleString();
            return;
        }
        const progress = elapsedTime / duration;
        // Ease-out effect
        const easeOut = 1 - Math.pow(1 - progress, 3);
        
        const currentVal = Math.floor(easeOut * finalValue);
        element.textContent = (isCurrency ? '₱' : '') + currentVal.toLocaleString();
        requestAnimationFrame(updateCount);
    }
    requestAnimationFrame(updateCount);
}

// --- FETCH DATA FROM FIREBASE ---
async function loadStatsBanner() {
    const stats = {
        talents: document.getElementById('stat-talents'),
        followers: document.getElementById('stat-followers'),
        prizes: document.getElementById('stat-prizes'),
        tournaments: document.getElementById('stat-tournaments'),
        players: document.getElementById('stat-players'),
    };

    if (!stats.talents) return; // Exit if elements don't exist

    try {
        // Fetch Counts from Collections
        // Note: For large apps, use a dedicated 'stats' document instead of counting every time.
        // For this starter, we count the documents directly.
        
        const tournamentsSnap = await getCountFromServer(collection(db, "tournaments"));
        const playersSnap = await getCountFromServer(collection(db, "users"));
        const talentsSnap = await getCountFromServer(collection(db, "rising_champs"));

        const tournamentCount = tournamentsSnap.data().count;
        const playerCount = playersSnap.data().count;
        const talentCount = talentsSnap.data().count;

        // Mocking Prize Pool & Followers for now (or fetch from a 'meta' doc)
        const totalPrizes = tournamentCount * 10000; 
        const followers = 8500 + (tournamentCount * 150);

        animateCountUp(stats.talents, talentCount || 5); // Default to 5 if 0
        animateCountUp(stats.followers, followers);
        animateCountUp(stats.prizes, totalPrizes, true);
        animateCountUp(stats.tournaments, tournamentCount);
        animateCountUp(stats.players, playerCount);

    } catch (err) {
        console.error("Stats error:", err);
        // Fallback to static numbers if DB fails
        animateCountUp(stats.talents, 12);
        animateCountUp(stats.tournaments, 5);
        animateCountUp(stats.players, 150);
    }
}

// --- OBSERVER TO TRIGGER ANIMATION ---
const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            if (entry.target.id === 'stats-section') {
                loadStatsBanner();
                observer.unobserve(entry.target);
            }
        }
    });
}, { threshold: 0.1 });

document.querySelectorAll('.fade-in-section').forEach(section => {
    observer.observe(section);
});