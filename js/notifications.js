import { db } from './firebase-config.js'; 
import { collection, query, orderBy, limit, onSnapshot, where, addDoc, serverTimestamp, doc, updateDoc, getDocs } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-auth.js";

const auth = getAuth();

// Global Cache & State
const feedData = {
    personal: [],
    announcements: [],
    tournaments: [],
    events: [],
    activeTab: 'all' // 'all' | 'personal' | 'announcements'
};

let personalUnsubscribes = [];
let lastReadTimestamp = localStorage.getItem('cz_notif_last_read') || 0;

function escapeHtml(str) { 
    if (!str) return ''; 
    return String(str).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); 
}

function timeAgo(date) {
    if (!date) return '';
    const now = new Date();
    const seconds = Math.floor((now - date) / 1000);
    if (seconds < 60) return 'Just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

document.addEventListener('DOMContentLoaded', () => {
    injectNotificationStyles(); 
    injectNotificationHTML(); 
    setupInteractions();        
});

// 1. Inject Custom Notification CSS
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
            display: none;
            opacity: 0;
            transform-origin: top right;
            transition: opacity 0.2s ease, transform 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275);
            pointer-events: none;
            z-index: 1005 !important;
            background: #0B0B10;
            border: 1px solid rgba(255, 255, 255, 0.12);
            border-radius: 1rem;
            overflow: hidden;
            box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.9), 0 0 0 1px rgba(255, 255, 255, 0.05);
            backdrop-filter: blur(24px);
        }

        #notif-dropdown.notif-dropdown-active {
            display: block !important;
            opacity: 1 !important;
            transform: scale(1) translateY(0) !important;
            pointer-events: auto !important;
        }

        @media (max-width: 639px) {
            #notif-dropdown {
                position: fixed; top: 70px; left: 50%; width: 92vw; max-width: 360px;
                transform: translateX(-50%) scale(0.95) translateY(-10px);
                transform-origin: top center;
            }
            #notif-dropdown.notif-dropdown-active {
                transform: translateX(-50%) scale(1) translateY(0) !important;
            }
        }

        @media (min-width: 640px) {
            #notif-dropdown {
                position: absolute; right: 0; top: calc(100% + 12px); width: 24rem;
                transform: scale(0.95) translateY(-8px);
            }
        }

        #notif-list::-webkit-scrollbar { width: 5px; }
        #notif-list::-webkit-scrollbar-track { background: #0B0B10; }
        #notif-list::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 3px; }
        #notif-list::-webkit-scrollbar-thumb:hover { background: #FFD700; }
        
        .notif-tab-btn.active {
            color: #FFD700;
            border-color: #FFD700;
            background: rgba(255, 215, 0, 0.08);
        }
    `;
    document.head.appendChild(style);
}

// 2. Inject HTML
function injectNotificationHTML() {
    if (document.getElementById('notif-btn')) return;

    const wrapper = document.getElementById('auth-controls-wrapper');
    if (!wrapper) return;

    wrapper.classList.add('flex', 'items-center', 'gap-4'); 

    let hasCachedUser = false;
    try {
        hasCachedUser = Boolean(localStorage.getItem('cz_auth_cache'));
    } catch(e) {}

    const notifContainer = document.createElement('div');
    notifContainer.id = 'user-notifications'; 
    notifContainer.className = hasCachedUser ? 'relative shrink-0 flex items-center z-[1002]' : 'relative shrink-0 flex items-center z-[1002] hidden'; 
    
    notifContainer.innerHTML = `
        <button id="notif-btn" class="p-2 relative" title="Notifications">
            <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
            </svg>
            <span id="notif-badge" class="hidden absolute top-1 right-1 min-w-[16px] h-4 px-1 bg-red-600 text-white font-mono-tag font-bold text-[9px] rounded-full border border-[var(--dark-bg)] flex items-center justify-center shadow-sm animate-pulse">0</span>
        </button>

        <div id="notif-dropdown" class="hidden">
            <!-- Header -->
            <div class="p-3.5 border-b border-white/10 flex justify-between items-center bg-[#111116]">
                <div class="flex items-center gap-2">
                    <span class="w-2 h-2 rounded-full bg-[#FFD700] shadow-[0_0_6px_#FFD700]"></span>
                    <h3 class="font-heading font-black text-white text-xs uppercase tracking-wider">Command Feed</h3>
                </div>
                <button id="mark-all-read-btn" class="text-[10px] font-mono-tag text-neutral-400 hover:text-[#FFD700] bg-white/5 hover:bg-white/10 px-2 py-1 rounded border border-white/5 transition-colors cursor-pointer uppercase">
                    Mark All Read
                </button>
            </div>

            <!-- Filter Tabs -->
            <div class="flex border-b border-white/5 bg-black/40 text-[10px] font-mono-tag font-bold">
                <button data-tab="all" class="notif-tab-btn active flex-1 py-2 text-center text-neutral-400 border-b-2 border-transparent hover:text-white transition-all cursor-pointer">
                    All (<span id="count-all">0</span>)
                </button>
                <button data-tab="personal" class="notif-tab-btn flex-1 py-2 text-center text-neutral-400 border-b-2 border-transparent hover:text-white transition-all cursor-pointer">
                    My Alerts (<span id="count-personal">0</span>)
                </button>
                <button data-tab="announcements" class="notif-tab-btn flex-1 py-2 text-center text-neutral-400 border-b-2 border-transparent hover:text-white transition-all cursor-pointer">
                    News (<span id="count-news">0</span>)
                </button>
            </div>

            <!-- Notification Items List -->
            <div id="notif-list" class="max-h-[340px] overflow-y-auto divide-y divide-white/5 custom-scrollbar">
                <div class="p-6 text-center text-neutral-500 font-mono-tag text-xs">Loading tactical updates...</div>
            </div>

            <!-- Footer -->
            <div class="p-2.5 border-t border-white/10 bg-[#111116] flex items-center justify-between text-xs">
                <a href="/tournaments" class="font-heading font-bold text-[10px] uppercase tracking-wider text-neutral-400 hover:text-[#FFD700] transition-colors flex items-center gap-1">
                    <span>Explore Tournaments</span> &rarr;
                </a>
                <a href="/events" class="font-heading font-bold text-[10px] uppercase tracking-wider text-[#FFD700] hover:text-white transition-colors">
                    Events Calendar
                </a>
            </div>
        </div>
    `;

    wrapper.insertBefore(notifContainer, wrapper.firstChild);

    // Inject announcement detail modal
    if (!document.getElementById('announcement-modal')) {
        const modal = document.createElement('div');
        modal.id = 'announcement-modal';
        modal.style.cssText = 'display:none; position:fixed; inset:0; z-index:99999; background:rgba(0,0,0,0.85); backdrop-filter:blur(8px); align-items:center; justify-content:center; padding:1rem;';
        modal.innerHTML = `
            <div id="announcement-modal-panel" style="background:#0D0D12; border:1px solid rgba(255,215,0,0.3); border-radius:1rem; overflow:hidden; max-width:480px; width:100%; box-shadow:0 25px 50px rgba(0,0,0,0.9), 0 0 30px rgba(255,215,0,0.15); transform:scale(0.95); opacity:0; transition:transform 0.2s cubic-bezier(0.175,0.885,0.32,1.275), opacity 0.2s ease;">
                <div style="padding:1.25rem 1.5rem; border-bottom:1px solid rgba(255,255,255,0.08); display:flex; align-items:center; justify-content:space-between; background:#15151a; border-radius:1rem 1rem 0 0;">
                    <div style="display:flex; align-items:center; gap:0.75rem;">
                        <span id="announcement-modal-icon" style="font-size:1.25rem;"></span>
                        <h3 id="announcement-modal-title" style="font-weight:800; color:#fff; font-size:0.95rem; text-transform:uppercase; margin:0; font-family:var(--font-heading, inherit);"></h3>
                    </div>
                    <button id="announcement-modal-close" style="background:transparent; border:none; color:#9CA3AF; cursor:pointer; font-size:1.25rem; line-height:1; padding:0.25rem;" aria-label="Close">&times;</button>
                </div>
                <div style="padding:1.5rem;">
                    <p id="announcement-modal-message" style="color:#D1D5DB; font-size:0.875rem; line-height:1.7; white-space:pre-wrap; margin:0;"></p>
                    <div style="margin-top:1.25rem; display:flex; justify-content:space-between; align-items:center;">
                        <span id="announcement-modal-date" style="font-size:0.7rem; color:#6B7280; font-family:monospace;"></span>
                        <button id="announcement-modal-action-btn" style="display:none; padding:0.4rem 0.8rem; background:#FFD700; color:#000; border-radius:0.5rem; font-weight:800; font-size:0.75rem; text-transform:uppercase; border:none; cursor:pointer;">View Hub</button>
                    </div>
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
            personalUnsubscribes.forEach(unsub => { try { unsub(); } catch(e){} });
            personalUnsubscribes = [];
            feedData.personal = [];
            feedData.announcements = [];
            renderUnifiedFeed();
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
        if (!dropdown.classList.contains('notif-dropdown-active')) {
            dropdown.style.display = 'block';
            btn.classList.add('bell-active');
            requestAnimationFrame(() => {
                dropdown.classList.add('notif-dropdown-active');
            });
        } else {
            closeDropdown();
        }
    });

    document.addEventListener('click', (e) => {
        if (!dropdown.contains(e.target) && !btn.contains(e.target)) closeDropdown();
    });

    function closeDropdown() {
        if (dropdown.classList.contains('notif-dropdown-active')) {
            dropdown.classList.remove('notif-dropdown-active');
            btn.classList.remove('bell-active');
            setTimeout(() => {
                if (!dropdown.classList.contains('notif-dropdown-active')) {
                    dropdown.style.display = 'none';
                }
            }, 200);
        }
    }

    // Mark all as read button
    const markReadBtn = document.getElementById('mark-all-read-btn');
    if (markReadBtn) {
        markReadBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            lastReadTimestamp = Date.now();
            localStorage.setItem('cz_notif_last_read', String(lastReadTimestamp));
            renderUnifiedFeed();
        });
    }

    // Tab buttons
    document.querySelectorAll('.notif-tab-btn').forEach(tabBtn => {
        tabBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            document.querySelectorAll('.notif-tab-btn').forEach(b => b.classList.remove('active'));
            tabBtn.classList.add('active');
            feedData.activeTab = tabBtn.dataset.tab;
            renderUnifiedFeed();
        });
    });
}

// 4. Real-Time Player & Global Listeners
function initRealTimeListeners(user) {
    // Clear any previous listeners
    personalUnsubscribes.forEach(unsub => { try { unsub(); } catch(e){} });
    personalUnsubscribes = [];

    const getDate = (d) => {
        const val = d.createdAt || d.timestamp || d.date;
        if (!val) return new Date();
        if (typeof val.toDate === 'function') return val.toDate();
        if (typeof val.toMillis === 'function') return new Date(val.toMillis());
        const parsed = new Date(val);
        return isNaN(parsed.getTime()) ? new Date() : parsed;
    };

    const ICONS = {
        checkIn: `<svg class="w-4 h-4 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>`,
        matchReady: `<svg class="w-4 h-4 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>`,
        tournament: `<svg class="w-4 h-4 text-[#FFD700]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16.5 18.75h-9m9 0a3 3 0 0 1 3-3h1.5a1.5 1.5 0 0 0 1.5-1.5v-2.25a1.5 1.5 0 0 0-1.5-1.5h-1.5a3 3 0 0 1-3-3V6a3 3 0 0 0-3-3h-3a3 3 0 0 0-3 3v1.5a3 3 0 0 1-3 3H3a1.5 1.5 0 0 0-1.5 1.5v2.25A1.5 1.5 0 0 0 3 15.75h1.5a3 3 0 0 1 3 3m9 0v3m-9-3v3m0 0h9"/></svg>`,
        team: `<svg class="w-4 h-4 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"/></svg>`,
        announcement: `<svg class="w-4 h-4 text-sky-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" /></svg>`,
        event: `<svg class="w-4 h-4 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>`
    };

    // A. Direct User Notifications Subcollection: users/{uid}/notifications
    const userNotifQuery = query(
        collection(db, "users", user.uid, "notifications"),
        limit(25)
    );
    const unsubUserNotifs = onSnapshot(userNotifQuery, (snap) => {
        feedData.personal = snap.docs.map(doc => {
            const d = doc.data();
            return {
                id: doc.id,
                category: 'personal',
                type: d.type || 'player_alert',
                tag: d.tag || 'ALERT',
                icon: d.type === 'team' ? ICONS.team : d.type === 'checkIn' ? ICONS.checkIn : d.type === 'match' ? ICONS.matchReady : ICONS.tournament,
                title: d.title || "Match Alert",
                message: d.message || "",
                link: d.link || (d.tournamentId ? `/tournaments?id=${d.tournamentId}` : (d.teamId ? `/teams?id=${d.teamId}` : '#')),
                dateObj: getDate(d),
                dateStr: timeAgo(getDate(d)),
                isRead: d.read === true
            };
        });
        feedData.personal.sort((a, b) => b.dateObj - a.dateObj);
        renderUnifiedFeed();
    }, (err) => {
        console.warn("User personal notifications listener warning:", err);
    });
    personalUnsubscribes.push(unsubUserNotifs);

    // B. Player Tournament Monitoring (Check-in & Match Ready prompts)
    const activeTournamentsQuery = query(
        collection(db, "tournaments"),
        limit(30)
    );
    const unsubTournamentsMonitor = onSnapshot(activeTournamentsQuery, (snap) => {
        const generatedPersonalAlerts = [];
        const userEmailLower = (user.email || '').toLowerCase();
        const userNameLower = (user.displayName || '').toLowerCase();

        snap.docs.forEach(docSnap => {
            const t = docSnap.data();
            const participants = t.participants || [];
            const soloQueue = t.soloQueue || [];
            
            // Check if current user is registered (solo queue or roster member)
            const isSoloQueued = soloQueue.some(s => 
                s.userId === user.uid || (s.contact && s.contact.toLowerCase() === userEmailLower)
            );

            const myParticipation = participants.find(p => {
                if (!p) return false;
                if (typeof p === 'string') {
                    const pLower = p.toLowerCase();
                    return (userNameLower && pLower === userNameLower) || (userEmailLower && pLower === userEmailLower);
                }
                if (p.registeredBy === user.uid || p.userId === user.uid) return true;
                if (userNameLower && p.captain && p.captain.toLowerCase() === userNameLower) return true;
                if (userEmailLower && p.contact && p.contact.toLowerCase() === userEmailLower) return true;
                if (Array.isArray(p.members)) {
                    return p.members.some(m => {
                        if (!m) return false;
                        const name = typeof m === 'object' ? (m.name || m.ign) : m;
                        const mLower = String(name || '').toLowerCase();
                        return (userNameLower && mLower === userNameLower) || (userEmailLower && mLower === userEmailLower);
                    });
                }
                return false;
            });

            if (myParticipation || isSoloQueued) {
                // Check-in Alert
                if (t.checkInOpen && myParticipation && !myParticipation.checkedIn && !t.isStarted && t.status !== 'Cancelled') {
                    generatedPersonalAlerts.push({
                        id: `checkin_${docSnap.id}`,
                        category: 'personal',
                        type: 'checkIn',
                        tag: 'CHECK-IN OPEN',
                        icon: ICONS.checkIn,
                        title: `Ready Up: ${t.name}`,
                        message: `Check-in is now OPEN. Confirm your squad to secure your bracket seed.`,
                        link: `/tournaments?id=${docSnap.id}`,
                        dateObj: getDate(t),
                        dateStr: 'Action Required',
                        isActionable: true
                    });
                }

                // Match Ready Alert
                if (t.isStarted && t.matches && t.matches.length > 0 && t.status !== 'Cancelled' && t.status !== 'Completed') {
                    const myTeamName = myParticipation ? ((typeof myParticipation === 'object') ? myParticipation.name : myParticipation) : '';
                    if (myTeamName) {
                        const myLiveMatch = t.matches.find(m => 
                            !m.winner && (m.team1 === myTeamName || m.team2 === myTeamName) && m.team1 && m.team2 && m.team1 !== 'TBD' && m.team2 !== 'TBD'
                        );

                        if (myLiveMatch) {
                            const opponent = myLiveMatch.team1 === myTeamName ? myLiveMatch.team2 : myLiveMatch.team1;
                            generatedPersonalAlerts.push({
                                id: `match_${docSnap.id}_${myLiveMatch.id}`,
                                category: 'personal',
                                type: 'match',
                                tag: 'MATCH READY',
                                icon: ICONS.matchReady,
                                title: `Match Scheduled vs ${opponent}`,
                                message: `Your bracket match in ${t.name} is ready for score reporting.`,
                                link: `/tournaments?id=${docSnap.id}`,
                                dateObj: getDate(t),
                                dateStr: 'Live Now',
                                isActionable: true
                            });
                        }
                    }
                }
            }
        });

        // Merge generated alerts with Firestore personal notifications
        const existingIds = new Set(feedData.personal.map(p => p.id));
        const newAlerts = generatedPersonalAlerts.filter(a => !existingIds.has(a.id));
        feedData.personal = [...newAlerts, ...feedData.personal];
        feedData.personal.sort((a, b) => b.dateObj - a.dateObj);
        renderUnifiedFeed();
    }, (err) => {});
    personalUnsubscribes.push(unsubTournamentsMonitor);

    // C. Announcements & Community News
    const publicTournamentsQuery = query(collection(db, "tournaments"), orderBy("createdAt", "desc"), limit(4));
    const unsubPublicTourneys = onSnapshot(publicTournamentsQuery, (snap) => {
        feedData.tournaments = snap.docs.map(docSnap => {
            const d = docSnap.data();
            return {
                id: docSnap.id,
                category: 'announcements',
                type: 'tournament',
                tag: d.game ? d.game.toUpperCase() : 'TOURNAMENT',
                icon: ICONS.tournament,
                title: d.name || "New Tournament",
                message: `₱${Number(d.prize || 0).toLocaleString()} Prize Pool • ${d.venueType || 'Online'}`,
                link: `/tournaments?id=${docSnap.id}`,
                dateObj: getDate(d),
                dateStr: timeAgo(getDate(d))
            };
        });
        renderUnifiedFeed();
    }, (err) => {});
    personalUnsubscribes.push(unsubPublicTourneys);

    const eventsQuery = query(collection(db, "events"), orderBy("createdAt", "desc"), limit(3));
    const unsubEvents = onSnapshot(eventsQuery, (snap) => {
        feedData.events = snap.docs.map(docSnap => {
            const d = docSnap.data();
            return {
                id: docSnap.id,
                category: 'announcements',
                type: 'event',
                tag: 'COMMUNITY EVENT',
                icon: ICONS.event,
                title: d.title || d.name || "Community Event",
                message: d.description || "Official ChampZero esports gathering & broadcast.",
                link: `/events`,
                dateObj: getDate(d),
                dateStr: timeAgo(getDate(d))
            };
        });
        renderUnifiedFeed();
    }, (err) => {});
    personalUnsubscribes.push(unsubEvents);
}

// 5. Global API: Send Notification to Player
window.sendPlayerNotification = async function(targetUserId, notifData) {
    if (!targetUserId || !notifData) return;
    // Don't send notifications to oneself
    if (auth.currentUser && targetUserId === auth.currentUser.uid) return;

    try {
        await addDoc(collection(db, "users", targetUserId, "notifications"), {
            title: notifData.title || "Tournament Update",
            message: notifData.message || "",
            type: notifData.type || "player_alert",
            tag: notifData.tag || "ALERT",
            link: notifData.link || "#",
            read: false,
            createdAt: serverTimestamp(),
            timestamp: Date.now()
        });
    } catch(e) {
        console.warn("Could not dispatch notification:", e);
    }
};

// 6. Announcement Detail Modal
function showAnnouncementModal(item) {
    const modal = document.getElementById('announcement-modal');
    const panel = document.getElementById('announcement-modal-panel');
    if (!modal || !panel) return;

    document.getElementById('announcement-modal-icon').innerHTML = item.icon;
    document.getElementById('announcement-modal-title').textContent = item.title;
    document.getElementById('announcement-modal-message').textContent = item.message;
    document.getElementById('announcement-modal-date').textContent = item.dateStr;

    const actionBtn = document.getElementById('announcement-modal-action-btn');
    if (actionBtn) {
        if (item.link && item.link !== '#') {
            actionBtn.style.display = 'inline-block';
            actionBtn.onclick = () => { window.location.href = item.link; };
        } else {
            actionBtn.style.display = 'none';
        }
    }

    modal.style.display = 'flex';
    requestAnimationFrame(() => {
        panel.style.transform = 'scale(1)';
        panel.style.opacity = '1';
    });
}

// 7. Render Unified Feed
function renderUnifiedFeed() {
    const list = document.getElementById('notif-list');
    const badge = document.getElementById('notif-badge');
    if (!list) return;

    const personalList = [...feedData.personal];
    const announcementsList = [...feedData.announcements, ...feedData.tournaments, ...feedData.events];

    // Update Tab Counts
    const countAllEl = document.getElementById('count-all');
    const countPersonalEl = document.getElementById('count-personal');
    const countNewsEl = document.getElementById('count-news');

    const allCombined = [...personalList, ...announcementsList];
    allCombined.sort((a, b) => b.dateObj - a.dateObj);

    if (countAllEl) countAllEl.textContent = allCombined.length;
    if (countPersonalEl) countPersonalEl.textContent = personalList.length;
    if (countNewsEl) countNewsEl.textContent = announcementsList.length;

    // Filter by Active Tab
    let activeFeed = [];
    if (feedData.activeTab === 'personal') {
        activeFeed = personalList;
    } else if (feedData.activeTab === 'announcements') {
        activeFeed = announcementsList;
    } else {
        activeFeed = allCombined;
    }

    // Sort by Date
    activeFeed.sort((a, b) => b.dateObj - a.dateObj);

    if (activeFeed.length === 0) {
        list.innerHTML = `
            <div class="p-8 text-center text-neutral-500 font-mono-tag text-xs space-y-1">
                <div class="text-neutral-600 text-lg">✦</div>
                <div>No alerts in this category</div>
                <div class="text-[10px] text-neutral-600">You're all caught up!</div>
            </div>
        `;
        return;
    }

    const lastReadNum = Number(lastReadTimestamp) || 0;
    let unreadCount = 0;

    let html = '';
    activeFeed.slice(0, 15).forEach((item, index) => {
        const itemTime = item.dateObj ? item.dateObj.getTime() : 0;
        const isUnread = (!item.isRead && itemTime > lastReadNum) || item.isActionable;
        if (isUnread) unreadCount++;

        const isAction = item.isActionable;
        const borderClass = isAction 
            ? 'border-l-2 border-emerald-400 bg-emerald-500/5' 
            : (isUnread ? 'border-l-2 border-[#FFD700] bg-[#FFD700]/5' : '');

        const tagColor = item.type === 'checkIn' 
            ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' 
            : item.type === 'match' 
                ? 'bg-amber-500/20 text-amber-300 border-amber-500/40' 
                : item.type === 'team'
                    ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40'
                    : 'bg-white/10 text-neutral-300 border-white/10';

        html += `
            <a href="${escapeHtml(item.link || '#')}" class="notif-item block p-3.5 hover:bg-white/5 transition-all group ${borderClass}" data-notif-idx="${index}">
                <div class="flex gap-3 items-start">
                    <div class="w-8 h-8 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center shrink-0 group-hover:border-[#FFD700]/40 group-hover:bg-[#FFD700]/10 transition-colors">
                        ${item.icon}
                    </div>
                    <div class="flex-1 min-w-0">
                        <div class="flex items-center justify-between gap-1.5 mb-1">
                            <span class="px-1.5 py-0.2 rounded text-[8px] font-mono-tag font-bold uppercase border ${tagColor}">
                                ${escapeHtml(item.tag || 'UPDATE')}
                            </span>
                            <span class="text-[9px] font-mono-tag text-neutral-500 shrink-0">${escapeHtml(item.dateStr)}</span>
                        </div>
                        <h4 class="text-xs font-bold text-white group-hover:text-[#FFD700] transition-colors truncate font-heading uppercase">
                            ${escapeHtml(item.title)}
                        </h4>
                        <p class="text-[11px] text-neutral-400 mt-0.5 line-clamp-2 leading-relaxed font-sans">
                            ${escapeHtml(item.message)}
                        </p>
                    </div>
                </div>
            </a>
        `;
    });

    list.innerHTML = html;

    // Update Bell Badge Counter
    if (badge) {
        if (unreadCount > 0) {
            badge.textContent = unreadCount > 9 ? '9+' : String(unreadCount);
            badge.classList.remove('hidden');
        } else {
            badge.classList.add('hidden');
        }
    }
}

// Teardown notifications listeners on page unload
function cleanupNotificationsListeners() {
    personalUnsubscribes.forEach(unsub => {
        try { if (typeof unsub === 'function') unsub(); } catch(e) {}
    });
    personalUnsubscribes = [];
}

window.addEventListener('beforeunload', cleanupNotificationsListeners);
window.addEventListener('pagehide', cleanupNotificationsListeners);