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
            filter: drop-shadow(0 0 8px rgba(255, 215, 0, 0.7));
            animation: bell-ring 0.8s ease-in-out;
        }
        
        #notif-dropdown {
            opacity: 0;
            transform-origin: top right;
            transition: opacity 0.2s ease, transform 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275);
            pointer-events: none;
            z-index: 9999;
            background: #0D0D12;
            border: 1px solid rgba(255, 255, 255, 0.12);
            border-radius: 1rem;
            overflow: hidden;
            box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.9), 0 0 0 1px rgba(255, 255, 255, 0.05);
            backdrop-filter: blur(20px);
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
                position: absolute; right: 0; top: calc(100% + 12px); width: 22rem;
                transform: scale(0.95) translateY(-8px);
            }
        }

        #notif-list::-webkit-scrollbar { width: 5px; }
        #notif-list::-webkit-scrollbar-track { background: #0D0D12; }
        #notif-list::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 3px; }
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
            <div class="p-4 border-b border-white/10 flex justify-between items-center bg-[#111116]">
                <div>
                    <span class="text-[9px] font-mono-tag uppercase tracking-widest text-[#FFD700] block">// UPDATES</span>
                    <h3 class="font-heading font-bold text-white text-sm uppercase">Notifications</h3>
                </div>
                <span class="text-[10px] font-mono-tag text-neutral-400 bg-white/5 px-2 py-1 rounded border border-white/5 uppercase">Recent</span>
            </div>
            <div id="notif-list" class="max-h-[320px] overflow-y-auto">
                <div class="p-6 text-center text-neutral-500 font-mono-tag text-xs">Loading updates...</div>
            </div>
            <div class="p-3 border-t border-white/10 bg-[#111116] text-center">
                <a href="/events" class="font-heading font-bold text-xs uppercase tracking-wider text-[#FFD700] hover:text-white transition-colors">View All Events</a>
            </div>
        </div>
    `;

    wrapper.insertBefore(notifContainer, wrapper.firstChild);

    // Inject announcement detail modal (once)
    if (!document.getElementById('announcement-modal')) {
        const modal = document.createElement('div');
        modal.id = 'announcement-modal';
        modal.style.cssText = 'display:none; position:fixed; inset:0; z-index:99999; background:rgba(0,0,0,0.8); backdrop-filter:blur(6px); align-items:center; justify-content:center; padding:1rem;';
        modal.innerHTML = `
            <div id="announcement-modal-panel" style="background:#0D0D12; border:1px solid rgba(255,255,255,0.12); border-radius:1rem; overflow:hidden; max-width:480px; width:100%; box-shadow:0 25px 50px rgba(0,0,0,0.8); transform:scale(0.95); opacity:0; transition:transform 0.2s cubic-bezier(0.175,0.885,0.32,1.275), opacity 0.2s ease;">
                <div style="padding:1.25rem 1.5rem; border-bottom:1px solid rgba(255,255,255,0.08); display:flex; align-items:center; justify-content:space-between; background:#15151a; border-radius:1rem 1rem 0 0;">
                    <div style="display:flex; align-items:center; gap:0.75rem;">
                        <span id="announcement-modal-icon" style="font-size:1.5rem;"></span>
                        <h3 id="announcement-modal-title" style="font-weight:700; color:#fff; font-size:1rem; margin:0;"></h3>
                    </div>
                    <button id="announcement-modal-close" style="background:transparent; border:none; color:#9CA3AF; cursor:pointer; font-size:1.25rem; line-height:1; padding:0.25rem;" aria-label="Close">&times;</button>
                </div>
                <div style="padding:1.5rem;">
                    <p id="announcement-modal-message" style="color:#D1D5DB; font-size:0.9rem; line-height:1.7; white-space:pre-wrap; margin:0;"></p>
                    <span id="announcement-modal-date" style="display:block; margin-top:1rem; font-size:0.7rem; color:#4B5563;"></span>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        const panel = modal.querySelector('#announcement-modal-panel');
        const closeBtn = modal.querySelector('#announcement-modal-close');

        const closeModal = () => {
            panel.style.transform = 'scale(0.95)';
            panel.style.opacity = '0';
            setTimeout(() => { modal.style.display = 'none'; }, 200);
        };

        closeBtn.addEventListener('click', closeModal);
        modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && modal.style.display === 'flex') closeModal(); });
    }
    
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

    const ICONS = {
        tournament: `<svg class="w-4 h-4 text-[#FFD700]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16.5 18.75h-9m9 0a3 3 0 0 1 3-3h1.5a1.5 1.5 0 0 0 1.5-1.5v-2.25a1.5 1.5 0 0 0-1.5-1.5h-1.5a3 3 0 0 1-3-3V6a3 3 0 0 0-3-3h-3a3 3 0 0 0-3 3v1.5a3 3 0 0 1-3 3H3a1.5 1.5 0 0 0-1.5 1.5v2.25A1.5 1.5 0 0 0 3 15.75h1.5a3 3 0 0 1 3 3m9 0v3m-9-3v3m0 0h9"/></svg>`,
        event: `<svg class="w-4 h-4 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5"/></svg>`,
        career: `<svg class="w-4 h-4 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20.25 14.15v4.25c0 1.094-.787 2.036-1.872 2.18-2.087.277-4.216.42-6.378.42s-4.291-.143-6.378-.42c-1.085-.144-1.872-1.086-1.872-2.18v-4.25m16.5 0a2.18 2.18 0 0 0 .75-1.661V8.706c0-1.081-.768-2.015-1.837-2.175a48.114 48.114 0 0 0-3.413-.387m4.5 8.006c-.194.165-.42.295-.673.38A23.978 23.978 0 0 1 12 15.75c-2.648 0-5.195-.429-7.577-1.22a2.016 2.016 0 0 1-.673-.38m0 0A2.18 2.18 0 0 1 3 12.489V8.706c0-1.081.768-2.015 1.837-2.175a48.111 48.111 0 0 1 3.413-.387m7.5 0V5.25A2.25 2.25 0 0 0 13.5 3h-3a2.25 2.25 0 0 0-2.25 2.25v.894m7.5 0a48.667 48.667 0 0 0-7.5 0"/></svg>`,
        talent: `<svg class="w-4 h-4 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11.48 3.499a.562.562 0 0 1 1.04 0l2.125 5.111a.563.563 0 0 0 .475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 0 0-.182.557l1.285 5.385a.562.562 0 0 1-.84.61l-4.725-2.885a.562.562 0 0 0-.586 0L6.982 20.54a.562.562 0 0 1-.84-.61l1.285-5.386a.562.562 0 0 0-.182-.557l-4.204-3.602a.562.562 0 0 1 .321-.988l5.518-.442a.563.563 0 0 0 .475-.345L11.48 3.5Z"/></svg>`,
        announcement: `<svg class="w-4 h-4 text-sky-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0"/></svg>`
    };

    // Standard Listeners (Public Data)
    onSnapshot(query(collection(db, "tournaments"), orderBy("createdAt", "desc"), limit(3)), (snap) => {
        feedData.tournaments = processSnapshot(snap, 'tournament', ICONS.tournament);
        renderUnifiedFeed();
    }, (err) => console.warn("Tournaments notif error:", err));

    onSnapshot(query(collection(db, "events"), orderBy("createdAt", "desc"), limit(3)), (snap) => {
        feedData.events = processSnapshot(snap, 'event', ICONS.event);
        renderUnifiedFeed();
    }, (err) => console.warn("Events notif error:", err));
    
    onSnapshot(query(collection(db, "careers"), orderBy("createdAt", "desc"), limit(3)), (snap) => {
        feedData.careers = processSnapshot(snap, 'career', ICONS.career);
        renderUnifiedFeed();
    }, (err) => console.warn("Careers notif error:", err));

    onSnapshot(query(collection(db, "talents"), orderBy("createdAt", "desc"), limit(3)), (snap) => {
        feedData.talents = processSnapshot(snap, 'talent', ICONS.talent);
        renderUnifiedFeed();
    }, (err) => console.warn("Talents notif error:", err));

    // --- ANNOUNCEMENTS LISTENER (PERSONALIZED) ---
    // Only fetch notifications meant for this user
    if (user && !personalUnsubscribe) {
        const q = query(
            collection(db, "specific-notifications"),
            where("targetUserId", "array-contains", user.uid),
            orderBy("createdAt", "desc"),
            limit(10)
        );

        personalUnsubscribe = onSnapshot(q, (snap) => {
            const items = snap.docs.map(doc => {
                const d = doc.data();
                let icon = ICONS.announcement; 
                if(d.type === 'tournament') icon = ICONS.tournament;
                if(d.type === 'event') icon = ICONS.event;

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
            items.sort((a, b) => b.dateObj - a.dateObj);
            feedData.announcements = items.slice(0, 10);
            renderUnifiedFeed();
        }, (err) => {
            console.warn("Specific notifications notif error:", err);
        });
    }
}

// 5. Announcement Detail Modal
function showAnnouncementModal(item) {
    const modal = document.getElementById('announcement-modal');
    const panel = document.getElementById('announcement-modal-panel');
    if (!modal || !panel) return;

    document.getElementById('announcement-modal-icon').innerHTML = item.icon;
    document.getElementById('announcement-modal-title').textContent = item.title;
    document.getElementById('announcement-modal-message').textContent = item.message;
    document.getElementById('announcement-modal-date').textContent = item.dateStr;

    modal.style.display = 'flex';
    requestAnimationFrame(() => {
        panel.style.transform = 'scale(1)';
        panel.style.opacity = '1';
    });
}

// 6. Render Feed
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
    finalFeed.forEach((item, index) => {
        let targetUrl = '#'; 
        if (item.type === 'tournament') targetUrl = `/tournaments?id=${item.id}`;
        if (item.type === 'event') targetUrl = `/events?id=${item.id}`;
        if (item.type === 'career') targetUrl = `/careers?id=${item.id}`;
        if (item.type === 'talent') targetUrl = `/rising?id=${item.id}`;

        if (item.type === 'announcement') {
            html += `
                <div class="notif-item p-4 border-b border-white/5 hover:bg-white/5 transition-colors cursor-pointer group" data-notif-index="${index}">
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
                </div>
            `;
        } else {
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
        }
    });

    list.innerHTML = html;

    // Attach click handlers for announcement modals
    list.querySelectorAll('[data-notif-index]').forEach(el => {
        const idx = parseInt(el.dataset.notifIndex);
        el.addEventListener('click', () => showAnnouncementModal(finalFeed[idx]));
    });

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