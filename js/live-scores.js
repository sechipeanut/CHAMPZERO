import { escapeHtml } from './events.js'; 
import { db } from './firebase-config.js';
import { collection, getDocs, query, where } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-firestore.js";

export async function initLiveScores() {
    updateLiveMatches();
    setInterval(updateLiveMatches, 60000);
}

async function updateLiveMatches() {
    try {
        // Fetch live events from Firebase
        let liveMatches = await fetchLiveEvents();

        const isLive = liveMatches.length > 0;

        // Update the Nav Badges (Desktop & Mobile)
        const badges = document.querySelectorAll('#live-badge, #live-badge-mobile');
        badges.forEach(badge => {
            isLive ? badge.classList.remove('hidden') : badge.classList.add('hidden');
        });

        // Update the Grid (Only runs on the EVENTS page)
        const LIVE_SECTION = document.querySelector('#liveMatchesSection');
        const LIVE_GRID = document.querySelector('#liveMatchGrid');

        if (LIVE_SECTION && LIVE_GRID) {
            if (isLive) {
                LIVE_SECTION.classList.remove('hidden');
                renderLiveMatches(liveMatches, LIVE_GRID);
            } else {
                LIVE_SECTION.classList.add('hidden');
            }
        }
    } catch (err) {
        console.warn("Live check skipped:", err);
    }
}

async function fetchLiveEvents() {
    try {
        // Query events that have livestream data
        const q = query(collection(db, "events"));
        const snapshot = await getDocs(q);
        
        const liveEvents = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            // Check if event has livestream and it's active
            if (data.livestream && data.livestream.playbackId) {
                liveEvents.push({
                    id: doc.id,
                    name: data.name,
                    playbackId: data.livestream.playbackId,
                    status: data.livestream.status,
                    banner: data.banner,
                    description: data.description
                });
            }
        });
        
        return liveEvents;
    } catch (error) {
        console.error('Error fetching live events:', error);
        return [];
    }
}

function renderLiveMatches(liveEvents, container) {
    container.innerHTML = liveEvents.map(event => {
        return `
            <div class="bg-[var(--dark-card)] border border-white/10 rounded-xl overflow-hidden shadow-2xl hover:border-red-500/50 transition-all group">
                <div class="relative">
                    <!-- Mux Player -->
                    <mux-player
                        playback-id="${event.playbackId}"
                        metadata-video-title="${escapeHtml(event.name)}"
                        accent-color="#FFD700"
                        class="w-full aspect-video"
                        stream-type="live"
                        autoplay
                        muted
                    ></mux-player>
                    
                    <!-- Live Badge Overlay -->
                    <div class="absolute top-3 left-3 bg-red-500 text-white px-3 py-1 rounded-full text-xs font-bold uppercase flex items-center gap-2 animate-pulse">
                        <span class="relative flex h-2 w-2">
                            <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
                            <span class="relative inline-flex rounded-full h-2 w-2 bg-white"></span>
                        </span>
                        LIVE
                    </div>
                </div>
                
                <div class="p-5">
                    <h3 class="text-xl font-bold text-white mb-2 group-hover:text-[var(--gold)] transition-colors">
                        ${escapeHtml(event.name)}
                    </h3>
                    <p class="text-gray-400 text-sm mb-4 line-clamp-2">
                        ${escapeHtml(event.description || 'Watch live now!')}
                    </p>
                    <a href="/livestream.html?event=${event.id}" 
                       class="block w-full py-2 bg-gradient-to-r from-red-600 to-red-500 hover:from-red-500 hover:to-red-400 text-white text-center rounded-lg font-semibold transition-all">
                        Watch Full Stream
                    </a>
                </div>
            </div>
        `;
    }).join('');
}