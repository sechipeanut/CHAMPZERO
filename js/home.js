import { db } from './firebase-config.js'; 
import { doc, onSnapshot } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-firestore.js";

function initHomePage() {
    
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
    function parseFirestoreValue(val) {
        if (!val) return null;
        if (val.stringValue !== undefined) return val.stringValue;
        if (val.integerValue !== undefined) return parseInt(val.integerValue, 10);
        if (val.doubleValue !== undefined) return parseFloat(val.doubleValue);
        if (val.booleanValue !== undefined) return val.booleanValue;
        if (val.timestampValue !== undefined) return val.timestampValue;
        if (val.nullValue !== undefined) return null;
        if (val.arrayValue !== undefined) return (val.arrayValue.values || []).map(v => parseFirestoreValue(v));
        if (val.mapValue !== undefined) {
            const out = {};
            const fields = val.mapValue.fields || {};
            for (const k in fields) out[k] = parseFirestoreValue(fields[k]);
            return out;
        }
        return val;
    }

    function parseFirestoreDoc(doc) {
        const id = doc.name ? doc.name.split('/').pop() : '';
        const data = { id };
        const fields = doc.fields || {};
        for (const key in fields) data[key] = parseFirestoreValue(fields[key]);
        return data;
    }

    function updateStatsUI(data) {
        const stats = {
            talents: document.getElementById('stat-talents'),
            followers: document.getElementById('stat-followers'),
            prizes: document.getElementById('stat-prizes'),
            tournaments: document.getElementById('stat-tournaments'),
            players: document.getElementById('stat-players'),
        };
        if (!stats.talents) return;
        animateCountUp(stats.talents, data?.talentCount || "0");
        animateCountUp(stats.followers, data?.followerCount || "0");
        animateCountUp(stats.prizes, data?.prizePool || "0", true);
        animateCountUp(stats.tournaments, data?.tournamentCount || "0");
        animateCountUp(stats.players, data?.playerCount || "0");
    }

    function updateActivitiesUI(activities) {
        (activities || []).forEach((act, index) => {
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

    // --- 2. Real-Time Stats Listener (Connects to Admin Config) ---
    function initStatsListener() {
        try {
            onSnapshot(doc(db, "site_config", "home_stats"), (docSnap) => {
                if (docSnap.exists()) updateStatsUI(docSnap.data());
            }, () => {
                fetch('https://firestore.googleapis.com/v1/projects/champzero-92951/databases/(default)/documents/site_config/home_stats')
                    .then(r => r.json())
                    .then(doc => updateStatsUI(parseFirestoreDoc(doc)))
                    .catch(() => {});
            });
        } catch {
            fetch('https://firestore.googleapis.com/v1/projects/champzero-92951/databases/(default)/documents/site_config/home_stats')
                .then(r => r.json())
                .then(doc => updateStatsUI(parseFirestoreDoc(doc)))
                .catch(() => {});
        }
    }

    // --- 3. Real-Time Recent Activities Spotlight Listener ---
    function initActivitiesListener() {
        try {
            onSnapshot(doc(db, "site_config", "home_activities"), (docSnap) => {
                if (docSnap.exists()) {
                    const data = docSnap.data();
                    updateActivitiesUI(data.activities || []);
                }
            }, () => {
                fetch('https://firestore.googleapis.com/v1/projects/champzero-92951/databases/(default)/documents/site_config/home_activities')
                    .then(r => r.json())
                    .then(doc => updateActivitiesUI(parseFirestoreDoc(doc).activities))
                    .catch(() => {});
            });
        } catch {
            fetch('https://firestore.googleapis.com/v1/projects/champzero-92951/databases/(default)/documents/site_config/home_activities')
                .then(r => r.json())
                .then(doc => updateActivitiesUI(parseFirestoreDoc(doc).activities))
                .catch(() => {});
        }
    }

    // Initialize Listeners
    initStatsListener();
    initActivitiesListener();

    // --- 4. Fade In Animation (Visuals) ---
    const observer = new IntersectionObserver(entries => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('opacity-100');
                entry.target.classList.remove('opacity-0', 'translate-y-4');
                observer.unobserve(entry.target);
            }
        });
    }, { threshold: 0.1 });

    document.querySelectorAll('.fade-in').forEach(el => {
        el.classList.add('transition-all', 'duration-700', 'opacity-0', 'translate-y-4');
        observer.observe(el);
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initHomePage);
} else {
    initHomePage();
}