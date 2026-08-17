import { db } from './firebase-config.js'; 
import { doc, onSnapshot } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-firestore.js";

document.addEventListener('DOMContentLoaded', () => {
    
    // --- 1. Animation Logic (Handles Numbers & Strings like "10k+") ---
    function animateCountUp(element, valueStr, isCurrency = false) {
        if(!element) return;
        
        const rawString = String(valueStr);
        const numericPart = parseFloat(rawString.replace(/[^0-9.-]+/g,""));
        let suffix = rawString.replace(/[0-9.,-]/g, '').replace('₱', '').trim();
        
        if (isNaN(numericPart)) {
            element.textContent = rawString; 
            return;
        }

        const duration = 2000;
        const startTime = performance.now();
        
        function updateCount(currentTime) {
            const elapsedTime = currentTime - startTime;
            if (elapsedTime >= duration) {
                element.textContent = (isCurrency ? '₱' : '') + numericPart.toLocaleString() + suffix;
                return;
            }
            
            const progress = elapsedTime / duration;
            const easeOut = 1 - Math.pow(1 - progress, 3);
            const currentVal = Math.floor(easeOut * numericPart);
            
            element.textContent = (isCurrency ? '₱' : '') + currentVal.toLocaleString() + suffix;
            requestAnimationFrame(updateCount);
        }
        requestAnimationFrame(updateCount);
    }

    // --- 2. Real-Time Stats Listener (Connects to Admin Config) ---
    function initStatsListener() {
        const stats = {
            talents: document.getElementById('stat-talents'),
            followers: document.getElementById('stat-followers'),
            prizes: document.getElementById('stat-prizes'),
            tournaments: document.getElementById('stat-tournaments'),
            players: document.getElementById('stat-players'),
        };
        
        if (!stats.talents) return;

        onSnapshot(doc(db, "site_config", "home_stats"), (docSnap) => {
            if (docSnap.exists()) {
                const data = docSnap.data();
                animateCountUp(stats.talents, data.talentCount || "0");
                animateCountUp(stats.followers, data.followerCount || "0");
                animateCountUp(stats.prizes, data.prizePool || "0", true);
                animateCountUp(stats.tournaments, data.tournamentCount || "0");
                animateCountUp(stats.players, data.playerCount || "0");
            } else {
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

    // --- 3. Real-Time Recent Activities Spotlight Listener ---
    function initActivitiesListener() {
        onSnapshot(doc(db, "site_config", "home_activities"), (docSnap) => {
            if (docSnap.exists()) {
                const data = docSnap.data();
                const activities = data.activities || [];

                activities.forEach((act, index) => {
                    const i = index + 1;
                    const titleEl = document.getElementById(`activity-title-${i}`);
                    const dateEl = document.getElementById(`activity-date-${i}`);
                    const tagEl = document.getElementById(`activity-tag-${i}`);
                    const linkEl = document.getElementById(`activity-link-${i}`);
                    const imgEl = document.getElementById(`activity-img-${i}`);
                    const descEl = document.getElementById(`activity-desc-${i}`);

                    if (titleEl) titleEl.textContent = act.title || 'Featured Activity';
                    if (dateEl) dateEl.textContent = act.date || '';
                    if (tagEl) tagEl.textContent = act.tag || 'Update';
                    if (linkEl && act.link) linkEl.href = act.link;
                    if (imgEl) {
                        if (act.img) imgEl.src = act.img;
                        if (act.position) imgEl.style.objectPosition = act.position;
                    }
                    if (descEl) descEl.textContent = act.desc || '';
                });
            }
        }, (error) => {
            console.error("Activities Listener Error:", error);
        });
    }

    // Initialize Listeners
    initStatsListener();
    initActivitiesListener();

    // --- 4. Fade In Animation (Visuals) ---
    const observer = new IntersectionObserver(entries => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('is-visible');
                observer.unobserve(entry.target);
            }
        });
    }, { threshold: 0.1 });

    document.querySelectorAll('.fade-in-section, .reveal').forEach(section => observer.observe(section));
});