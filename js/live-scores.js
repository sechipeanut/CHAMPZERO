import { escapeHtml } from './events.js'; 

export async function initLiveScores() {
    updateLiveMatches();
    setInterval(updateLiveMatches, 60000);
}

async function updateLiveMatches() {
    try {
        // 1. Fetch data (Falling back to mock if API isn't ready)
        let liveMatches = [];
        try {
            const response = await fetch('/.netlify/functions/get-live-matches');
            if (response.ok) liveMatches = await response.json();
        } catch (e) { /* ignore */ }

        if (liveMatches.length === 0) {
            liveMatches = await mockFetchLiveMatches();
        }

        const isLive = liveMatches.length > 0;

        // 2. Update the Nav Badges (Desktop & Mobile)
        // This runs on EVERY page
        const badges = document.querySelectorAll('#live-badge, #live-badge-mobile');
        badges.forEach(badge => {
            isLive ? badge.classList.remove('hidden') : badge.classList.add('hidden');
        });

        // 3. Update the Grid (Only runs on the EVENTS page)
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

// Updated to accept the container element
function renderLiveMatches(matches, container) {
    container.innerHTML = matches.map(match => {
        const config = GAME_CONFIG[match.game] || { icon: 'pictures/cz_logo.png', color: 'border-white/10' };
        
        return `
            <div class="bg-[var(--dark-card)] border-l-4 ${config.color} rounded-xl p-6 flex flex-col md:flex-row items-center justify-between gap-6 shadow-2xl relative overflow-hidden">
                <div class="absolute -right-10 -top-10 w-32 h-32 bg-white/5 blur-3xl rounded-full"></div>
                
                <div class="flex flex-col items-center gap-2 w-full md:w-1/3 text-center">
                    <img src="${match.teamA.logo}" class="w-16 h-16 object-contain drop-shadow-lg" alt="${match.teamA.name}">
                    <span class="font-bold text-white">${escapeHtml(match.teamA.name)}</span>
                </div>

                <div class="flex flex-col items-center justify-center w-full md:w-1/3">
                    <div class="text-xs uppercase tracking-widest text-gray-500 font-bold mb-2">${escapeHtml(match.game)}</div>
                    <div class="flex items-center gap-4">
                        <span class="text-4xl md:text-5xl font-black text-white">${match.teamA.score}</span>
                        <span class="text-xl font-bold text-gray-600">:</span>
                        <span class="text-4xl md:text-5xl font-black text-white">${match.teamB.score}</span>
                    </div>
                    <div class="mt-3 px-3 py-1 bg-red-500/10 text-red-500 text-[10px] font-bold rounded-full uppercase">
                        Live Match
                    </div>
                </div>

                <div class="flex flex-col items-center gap-2 w-full md:w-1/3 text-center">
                    <img src="${match.teamB.logo}" class="w-16 h-16 object-contain drop-shadow-lg" alt="${match.teamB.name}">
                    <span class="font-bold text-white">${escapeHtml(match.teamB.name)}</span>
                </div>
            </div>
        `;
    }).join('');
}

// Simulating API Data
async function mockFetchLiveMatches() {
    return [
        {
            id: 'val-001',
            game: 'Valorant',
            teamA: { name: 'Team Secret', score: 11, logo: 'https://placehold.co/100x100/111/fff?text=TS' },
            teamB: { name: 'PRX', score: 9, logo: 'https://placehold.co/100x100/111/fff?text=PRX' }
        }
    ];
}