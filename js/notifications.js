import { db } from './firebase-config.js'; 
import { collection, query, orderBy, limit, getDocs } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-firestore.js";

document.addEventListener('DOMContentLoaded', async () => {
    injectNotificationStyles(); // Keeps the animations/css
    setupInteractions(); // Attaches logic to the HTML elements
    await loadNotifications(); // Fetches data
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

// 2. Interactions (Updated to find existing HTML elements)
function setupInteractions() {
    const btn = document.getElementById('notif-btn');
    const dropdown = document.getElementById('notif-dropdown');
    
    if(!btn || !dropdown) {
        console.warn("Notification elements not found in HTML");
        return;
    }

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

// 3. Load Data
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
            
            // Fixed Icons
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