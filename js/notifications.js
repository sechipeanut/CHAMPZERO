import { db } from './firebase-config.js'; 
import { collection, query, orderBy, limit, getDocs } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-firestore.js";

document.addEventListener('DOMContentLoaded', async () => {
    injectNotificationStyles();
    injectNotificationUI();
    await loadNotifications();
});

// 1. Inject Custom CSS
function injectNotificationStyles() {
    const style = document.createElement('style');
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
        .bell-ring-hover:hover svg {
            animation: bell-ring 0.8s ease-in-out;
        }
        .notif-dropdown-active {
            opacity: 1;
            transform: translateY(0) scale(1);
            transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
        }
        #notif-list::-webkit-scrollbar { width: 6px; }
        #notif-list::-webkit-scrollbar-track { background: #1A1A1F; }
        #notif-list::-webkit-scrollbar-thumb { background: #333; border-radius: 3px; }
        #notif-list::-webkit-scrollbar-thumb:hover { background: #FFD700; }
    `;
    document.head.appendChild(style);
}

// 2. Inject UI (FIXED LOCATION)
function injectNotificationUI() {
    const authContainer = document.getElementById('auth-controls');
    
    // Safety check: if page doesn't have auth controls, stop
    if (!authContainer) return;

    // Create the Wrapper
    const wrapper = document.createElement('div');
    wrapper.className = "relative flex items-center mr-3"; // Added margin-right for spacing

    wrapper.innerHTML = `
        <button id="notif-btn" class="bell-ring-hover relative group p-2 rounded-full border border-[var(--gold)] text-[var(--gold)] bg-transparent hover:bg-[var(--gold)] hover:text-black transition-colors duration-300 outline-none">
            <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
            </svg>
            <span id="notif-badge" class="hidden absolute top-0 right-0 h-3 w-3">
                <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                <span class="relative inline-flex rounded-full h-3 w-3 bg-red-600 border-2 border-[var(--dark-bg)]"></span>
            </span>
        </button>

        <div id="notif-dropdown" class="hidden absolute top-full right-0 mt-3 w-80 sm:w-96 bg-[#1A1A1F] border border-white/10 rounded-xl shadow-2xl z-50 overflow-hidden transform origin-top-right">
            <div class="p-4 border-b border-white/10 flex justify-between items-center bg-[#111115]">
                <h3 class="font-bold text-white text-sm">Notifications</h3>
                <span class="text-xs text-gray-500">Recent Updates</span>
            </div>
            <div id="notif-list" class="max-h-[300px] overflow-y-auto">
                <div class="p-6 text-center text-gray-500 text-sm">Loading...</div>
            </div>
            <div class="p-2 border-t border-white/10 bg-[#111115] text-center">
                <a href="events.html" class="text-xs text-[var(--gold)] hover:underline">View All Events</a>
            </div>
        </div>
    `;

    // CRITICAL FIX: Insert BEFORE auth-controls (Sibling), not INSIDE it
    // This prevents auth.js from wiping the bell when it sets "Welcome User"
    authContainer.parentNode.insertBefore(wrapper, authContainer);

    setupInteractions();
}

// 3. Interactions
function setupInteractions() {
    const btn = document.getElementById('notif-btn');
    const dropdown = document.getElementById('notif-dropdown');
    
    if(!btn || !dropdown) return;

    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isHidden = dropdown.classList.contains('hidden');
        if (isHidden) {
            dropdown.classList.remove('hidden');
            setTimeout(() => dropdown.classList.add('notif-dropdown-active'), 10);
            document.getElementById('notif-badge').classList.add('hidden');
        } else {
            closeDropdown();
        }
    });

    document.addEventListener('click', (e) => {
        if (!dropdown.contains(e.target) && !btn.contains(e.target)) {
            closeDropdown();
        }
    });

    function closeDropdown() {
        dropdown.classList.remove('notif-dropdown-active');
        setTimeout(() => dropdown.classList.add('hidden'), 200);
    }
}

// 4. Load Data
async function loadNotifications() {
    const list = document.getElementById('notif-list');
    const badge = document.getElementById('notif-badge');
    
    try {
        const q = query(collection(db, "notifications"), orderBy("timestamp", "desc"), limit(5));
        const querySnapshot = await getDocs(q);

        if (querySnapshot.empty) {
            list.innerHTML = `<div class="p-6 text-center text-gray-500 text-sm">No new notifications.</div>`;
            return;
        }

        let html = '';
        querySnapshot.forEach((doc) => {
            const data = doc.data();
            const date = data.timestamp ? new Date(data.timestamp.seconds * 1000).toLocaleDateString() : 'Just now';
            
            // Fixed Icons (Emojis were corrupted in previous version)
            let icon = '📢'; 
            if(data.type === 'tournament') icon = '🏆';
            if(data.type === 'event') icon = '🎉';
            if(data.type === 'alert') icon = '⚠️';

            html += `
                <div class="p-4 border-b border-white/5 hover:bg-white/5 transition-colors cursor-pointer group">
                    <div class="flex gap-3">
                        <div class="text-xl bg-white/5 h-10 w-10 flex items-center justify-center rounded-lg border border-white/10 group-hover:border-[var(--gold)]/30 transition-colors">
                            ${icon}
                        </div>
                        <div>
                            <h4 class="text-sm font-semibold text-white group-hover:text-[var(--gold)] transition-colors">${data.title}</h4>
                            <p class="text-xs text-gray-400 mt-1 line-clamp-2">${data.message}</p>
                            <span class="text-[10px] text-gray-600 mt-2 block">${date}</span>
                        </div>
                    </div>
                </div>
            `;
        });

        list.innerHTML = html;
        badge.classList.remove('hidden');

    } catch (error) {
        console.log("Notif fetch error:", error);
        list.innerHTML = `<div class="p-6 text-center text-gray-500 text-sm">Notifications unavailable.</div>`;
    }
}