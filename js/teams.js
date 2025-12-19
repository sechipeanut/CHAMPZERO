// js/teams.js
import { db } from './firebase-config.js';
import { collection, getDocs } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-firestore.js";

function qs(sel) { return document.querySelector(sel); }
function escapeHtml(str) { if (!str) return ''; return String(str).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }

async function renderTeams() {
    const board = qs('#recruitment-board');
    if (!board) return;
    
    board.innerHTML = '<p class="text-gray-500 text-center">Loading listings...</p>';

    try {
        const querySnapshot = await getDocs(collection(db, "recruitment")); 
        board.innerHTML = '';

        if (querySnapshot.empty) {
            board.innerHTML = '<p class="text-center text-gray-500 py-8">No active listings found.</p>';
            return;
        }

        querySnapshot.forEach((doc) => {
            const post = doc.data();
            const postEl = document.createElement('div');
            postEl.className = 'bg-[var(--dark-card)] border border-white/10 rounded-xl p-6 flex flex-col md:flex-row items-center gap-6 mb-4';
            postEl.innerHTML = `
                <div class="flex-shrink-0 w-full md:w-1/4">
                    <div class="font-bold text-white text-lg">${escapeHtml(post.name)}</div>
                    <div class="text-xs text-[var(--gold)] uppercase font-bold mt-1">${escapeHtml(post.type)}</div>
                </div>
                <div class="flex-1 border-l border-white/10 pl-0 md:pl-6 border-l-0 md:border-l">
                    <p class="text-sm text-gray-300">"${escapeHtml(post.message)}"</p>
                    <div class="mt-3 flex gap-4 text-xs text-gray-400">
                        <span>Game: <span class="text-white">${escapeHtml(post.game)}</span></span>
                        <span>Rank: <span class="text-white">${escapeHtml(post.rank)}</span></span>
                    </div>
                </div>
                <button class="px-6 py-2 bg-indigo-600 text-white rounded-lg text-sm font-bold hover:bg-indigo-500">Contact</button>
            `;
            board.appendChild(postEl);
        });

    } catch (error) {
        console.error("Error:", error);
        board.innerHTML = '<p class="text-red-500 text-center">Failed to load listings.</p>';
    }
}

document.addEventListener('DOMContentLoaded', renderTeams);