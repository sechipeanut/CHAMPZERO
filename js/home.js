// js/home.js
import { auth, db } from './firebase-config.js'; // FIX: Removed "./js/" prefix
import { collection, getCountFromServer } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-firestore.js";

document.addEventListener('DOMContentLoaded', () => {
    
    // --- HOME: Stats Logic ---
    function animateCountUp(element, finalValue, isCurrency = false) {
        if(!element) return;
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
            const easeOut = 1 - Math.pow(1 - progress, 3);
            const currentVal = Math.floor(easeOut * finalValue);
            element.textContent = (isCurrency ? '₱' : '') + currentVal.toLocaleString();
            requestAnimationFrame(updateCount);
        }
        requestAnimationFrame(updateCount);
    }

    async function loadStatsBanner() {
        const stats = {
            talents: document.getElementById('stat-talents'),
            followers: document.getElementById('stat-followers'),
            prizes: document.getElementById('stat-prizes'),
            tournaments: document.getElementById('stat-tournaments'),
            players: document.getElementById('stat-players'),
        };
        
        // Safety check
        if (!stats.talents) return;

        try {
            // Attempt to get real counts from Firestore
            // Note: If you have security rules blocking reads, this might fail, triggering catch block
            const tournamentsSnap = await getCountFromServer(collection(db, "tournaments"));
            const playersSnap = await getCountFromServer(collection(db, "users"));
            // For talents, assuming a 'talents' collection exists:
            const talentsSnap = await getCountFromServer(collection(db, "talents"));

            const tournamentCount = tournamentsSnap.data().count;
            const playerCount = playersSnap.data().count;
            const talentCount = talentsSnap.data().count;
            
            // If DB is empty, use FALLBACK NUMBERS so users see animation
            if (tournamentCount === 0 && playerCount === 0) {
                console.log("DB Empty - Using Demo Stats");
                animateCountUp(stats.talents, 12);
                animateCountUp(stats.followers, 8500);
                animateCountUp(stats.prizes, 250000, true);
                animateCountUp(stats.tournaments, 5);
                animateCountUp(stats.players, 150);
            } else {
                const totalPrizes = tournamentCount * 10000; // Simulated prize pool logic
                const followers = 8500 + (tournamentCount * 150);
                
                animateCountUp(stats.talents, talentCount || 5);
                animateCountUp(stats.followers, followers);
                animateCountUp(stats.prizes, totalPrizes, true);
                animateCountUp(stats.tournaments, tournamentCount);
                animateCountUp(stats.players, playerCount);
            }

        } catch (err) {
            console.warn("Stats fetch failed (Using Fallback Demo Data):", err);
            // Fallback so the site still looks alive
            animateCountUp(stats.talents, 12);
            animateCountUp(stats.followers, 8500);
            animateCountUp(stats.prizes, 250000, true);
            animateCountUp(stats.tournaments, 5);
            animateCountUp(stats.players, 150);
        }
    }

    // Trigger animation when scrolled into view
    const observer = new IntersectionObserver(entries => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                if (entry.target.id === 'stats-section') {
                    loadStatsBanner();
                    observer.unobserve(entry.target);
                }
                // Handle generic fade-ins
                if (entry.target.classList.contains('fade-in-section')) {
                    entry.target.classList.add('is-visible');
                    observer.unobserve(entry.target);
                }
            }
        });
    }, { threshold: 0.1 });

    const statsSection = document.getElementById('stats-section');
    if(statsSection) observer.observe(statsSection);
    
    document.querySelectorAll('.fade-in-section').forEach(section => observer.observe(section));
});