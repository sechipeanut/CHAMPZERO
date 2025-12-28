import { db } from './firebase-config.js'; 
import { collection, query, orderBy, limit, onSnapshot, where } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-auth.js";

const auth = getAuth();

// Global cache
const feedData = {
    tournaments: [],
    events: [],
    careers: [],
    talents: [],
    announcements: [] 
};

// Track personal listener to unsubscribe on logout
let personalUnsubscribe = null;

document.addEventListener('DOMContentLoaded', () => {
    injectNotificationStyles(); 
    injectNotificationHTML(); 
    setupInteractions();        
    // Note: initRealTimeListeners is now called inside onAuthStateChanged
});

// 1. Inject Custom CSS
function injectNotificationStyles() {
    if (document.getElementById('cz-notif-styles')) return;

    const style = document.createElement('style');
    style.id = 'cz-notif-styles';
    style.textContent = `
        @keyframes bell-ring {
            0% { transform: rotate(0); }
            15% { transform: rotate(15deg); }
            30% { transform: rotate(-15deg); }
            45% { transform: rotate(10deg); }
            60% { transform: rotate(-10deg); }
            75% { transform: rotate(5deg); }
            85% { transform: rotate(-5deg); }
            100% { transform: rotate(0); }
        }
        
        #notif-btn {
            background: transparent !important;
            color: #9CA3AF; 
            transition: all 0.3s ease;
            outline: none !important;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
        }

        #notif-btn:hover, #notif-btn.bell-active {
            color: #FFD700 !important; 
            filter: drop-shadow(0 0 5px rgba(255, 215, 0, 0.5));
            animation: bell-ring 0.8s ease-in-out;
        }
        
        #notif-dropdown {
            opacity: 0;
            transform-origin: top right;
            transition: opacity 0.2s ease, transform 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275);
            pointer-events: none;
            z-index: 9999;
            background: #1A1A1F;
            border: 1px solid rgba(255,255,255,0.1);
            border-radius: 0.75rem;
            box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5);
        }

        .notif-dropdown-active {
            opacity: 1 !important;
            transform: scale(1) translateY(0) !important;
            pointer-events: auto !important;
        }

        @media (max-width: 639px) {
            #notif-dropdown {
                position: fixed; top: 70px; left: 50%; width: 90vw; max-width: 350px;
                transform: translateX(-50%) scale(0.95) translateY(-10px);
                transform-origin: top center;
            }
            .notif-dropdown-active {
                transform: translateX(-50%) scale(1) translateY(0) !important;
            }
        }

        @media (min-width: 640px) {
            #notif-dropdown {
                position: absolute; right: 0; top: 120%; width: 20rem;
                transform: scale(0.95) translateY(-10px);
            }
        }

        #notif-list::-webkit-scrollbar { width: 6px; }
        #notif-list::-webkit-scrollbar-track { background: #1A1A1F; }
        #notif-list::-webkit-scrollbar-thumb { background: #333; border-radius: 3px; }
        #notif-list::-webkit-scrollbar-thumb:hover { background: #FFD700; }
        
        .notif-item { display: block; text-decoration: none; }
    `;
    document.head.appendChild(style);
}

// 2. Inject HTML
function injectNotificationHTML() {
    if (document.getElementById('notif-btn')) return;

    const wrapper = document.getElementById('auth-controls-wrapper');
    if (!wrapper) return;

    wrapper.classList.add('flex', 'items-center', 'gap-4'); 

    const notifContainer = document.createElement('div');
    notifContainer.id = 'user-notifications'; 
    notifContainer.className = 'relative hidden'; 
    
    notifContainer.innerHTML = `
        <button id="notif-btn" class="p-2 relative">
            <svg xmlns="http://www.w3.org/2000/svg" class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
            </svg>
            <span id="notif-badge" class="hidden absolute top-1 right-1 h-2.5 w-2.5 bg-red-600 rounded-full border border-[var(--dark-bg)]"></span>
        </button>

        <div id="notif-dropdown" class="hidden">
            <div class="p-4 border-b border-white/10 flex justify-between items-center bg-[#15151a]">
                <h3 class="font-bold text-white text-sm">Notifications</h3>
                <span class="text-[10px] text-gray-500 bg-white/5 px-2 py-1 rounded">Recent Updates</span>
            </div>
            <div id="notif-list" class="max-h-[300px] overflow-y-auto">
                <div class="p-6 text-center text-gray-500 text-sm">Loading updates...</div>
            </div>
            <div class="p-3 border-t border-white/10 bg-[#15151a] text-center">
                <a href="/events" class="text-xs text-[var(--gold)] hover:underline">View All Events</a>
            </div>
        </div>
    `;

    wrapper.insertBefore(notifContainer, wrapper.firstChild);
    
    onAuthStateChanged(auth, (user) => {
        if (user) {
            notifContainer.classList.remove('hidden');
            initRealTimeListeners(user);
        } else {
            notifContainer.classList.add('hidden');
            if(personalUnsubscribe) {
                personalUnsubscribe();
                personalUnsubscribe = null;
            }
            feedData.announcements = [];
        }
    });
}

// 3. Interactions
function setupInteractions() {
    const btn = document.getElementById('notif-btn');
    const dropdown = document.getElementById('notif-dropdown');
    
    if(!btn || !dropdown) { setTimeout(setupInteractions, 100); return; }

    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (dropdown.classList.contains('hidden')) {
            dropdown.classList.remove('hidden');
            btn.classList.add('bell-active');
            setTimeout(() => {
                dropdown.classList.add('notif-dropdown-active');
                dropdown.classList.remove('hidden');
            }, 10);
            
            const badge = document.getElementById('notif-badge');
            if(badge) badge.classList.add('hidden');
            localStorage.setItem('cz_notif_last_read', new Date().toISOString());
        } else {
            closeDropdown();
        }
    });

    document.addEventListener('click', (e) => {
        if (!dropdown.contains(e.target) && !btn.contains(e.target)) closeDropdown();
    });

    function closeDropdown() {
        if (!dropdown.classList.contains('hidden')) {
            dropdown.classList.remove('notif-dropdown-active');
            btn.classList.remove('bell-active');
            setTimeout(() => dropdown.classList.add('hidden'), 200);
        }
    }
}

// 4. Real-Time Data Listeners
function initRealTimeListeners(user) {
    const getDate = (d) => {
        // Look for any date field to ensure we get a valid date
        const val = d.createdAt || d.timestamp || d.date;
        if (!val) return new Date(); // Default to now if missing
        if (typeof val.toDate === 'function') return val.toDate();
        return new Date(val);
    };

    const processSnapshot = (snap, type, icon) => {
        return snap.docs.map(doc => {
            const d = doc.data();
            return {
                id: doc.id, type: type, icon: icon,
                title: d.name || d.title || "New Update",
                message: d.description || d.message || d.game || "Check details",
                dateObj: getDate(d), dateStr: getDate(d).toLocaleDateString()
            };
        });
    };

    // Standard Listeners (Public Data)
    onSnapshot(query(collection(db, "tournaments"), orderBy("createdAt", "desc"), limit(3)), (snap) => {
        feedData.tournaments = processSnapshot(snap, 'tournament', '🏆');
        renderUnifiedFeed();
    });

    onSnapshot(query(collection(db, "events"), orderBy("createdAt", "desc"), limit(3)), (snap) => {
        feedData.events = processSnapshot(snap, 'event', '🎉');
        renderUnifiedFeed();
    });
    
    onSnapshot(query(collection(db, "careers"), orderBy("createdAt", "desc"), limit(3)), (snap) => {
        feedData.careers = processSnapshot(snap, 'career', '💼');
        renderUnifiedFeed();
    });

    onSnapshot(query(collection(db, "talents"), orderBy("createdAt", "desc"), limit(3)), (snap) => {
        feedData.talents = processSnapshot(snap, 'talent', '⭐');
        renderUnifiedFeed();
    });

    // --- ANNOUNCEMENTS LISTENER (PERSONALIZED) ---
    // Only fetch notifications meant for this user
    if (user && !personalUnsubscribe) {
        const q = query(
            collection(db, "notifications"),
            where("targetUserId", "==", user.uid),
            limit(10)
        );

        personalUnsubscribe = onSnapshot(q, (snap) => {
            feedData.announcements = snap.docs.map(doc => {
                const d = doc.data();
                // Determine icon
                let icon = '📢'; 
                if(d.type === 'tournament') icon = '🏆';
                if(d.type === 'event') icon = '🎉';
                if(d.type === 'alert') icon = '⚠️';

                return {
                    id: doc.id, 
                    type: 'announcement',
                    icon: icon,
                    title: d.title || "Notification",
                    message: d.message || "",
                    dateObj: getDate(d), 
                    dateStr: getDate(d).toLocaleDateString()
                };
            });
            renderUnifiedFeed();
        });
    }
}

// 5. Render Feed
function renderUnifiedFeed() {
    const list = document.getElementById('notif-list');
    const badge = document.getElementById('notif-badge');
    if (!list) return;

    let combined = [
        ...feedData.announcements, 
        ...feedData.tournaments, 
        ...feedData.events, 
        ...feedData.careers, 
        ...feedData.talents
    ];

    // Sort by date (Newest first)
    combined.sort((a, b) => b.dateObj - a.dateObj);
    
    // Take top 5 items
    const finalFeed = combined.slice(0, 5);

    if (finalFeed.length === 0) {
        list.innerHTML = `<div class="p-6 text-center text-gray-500 text-sm">No new updates.</div>`;
        return;
    }

    let html = '';
    finalFeed.forEach(item => {
        let targetUrl = '#'; 
        if (item.type === 'tournament') targetUrl = `/tournaments?id=${item.id}`;
        if (item.type === 'event') targetUrl = `/events?id=${item.id}`;
        if (item.type === 'career') targetUrl = `/careers?id=${item.id}`;
        if (item.type === 'talent') targetUrl = `/rising?id=${item.id}`;
        
        // Manual announcements don't have a specific page
        if (item.type === 'announcement') targetUrl = '#'; 

        html += `
            <a href="${targetUrl}" class="notif-item p-4 border-b border-white/5 hover:bg-white/5 transition-colors cursor-pointer group">
                <div class="flex gap-3">
                    <div class="text-xl bg-white/5 h-10 w-10 flex items-center justify-center rounded-lg transition-colors group-hover:bg-[var(--gold)]/10 group-hover:text-[var(--gold)]">
                        ${item.icon}
                    </div>
                    <div>
                        <h4 class="text-sm font-semibold text-white group-hover:text-[var(--gold)] transition-colors">${item.title}</h4>
                        <p class="text-xs text-gray-400 mt-1 line-clamp-2">${item.message}</p>
                        <span class="text-[10px] text-gray-600 mt-2 block">${item.dateStr}</span>
                    </div>
                </div>
            </a>
        `;
    });

    list.innerHTML = html;

    const lastReadTime = localStorage.getItem('cz_notif_last_read');
    let hasUnread = true;
    if (lastReadTime && finalFeed.length > 0) {
        if (finalFeed[0].dateObj <= new Date(lastReadTime)) hasUnread = false;
    }

    if (badge && finalFeed.length > 0 && hasUnread) {
        badge.classList.remove('hidden');
    } else if (badge) {
        badge.classList.add('hidden');
    }
}