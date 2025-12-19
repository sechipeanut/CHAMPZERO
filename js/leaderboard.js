import { db } from './firebase-config.js';
import { collection, getDocs, query, orderBy, limit } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-firestore.js";

document.addEventListener('DOMContentLoaded', async () => {
    const tbody = document.getElementById('leaderboard-body');
    
    try {
        // Fetch users sorted by prizes/points (simulated)
        const q = query(collection(db, "users"), orderBy("prizesEarned", "desc"), limit(20));
        const snapshot = await getDocs(q);
        
        tbody.innerHTML = '';
        let rank = 1;

        snapshot.forEach(doc => {
            const data = doc.data();
            const rankClass = rank === 1 ? 'rank-1' : (rank === 2 ? 'rank-2' : (rank === 3 ? 'rank-3' : 'text-white'));
            
            tbody.innerHTML += `
                <tr class="hover:bg-white/5 transition-colors">
                    <td class="p-6 text-xl ${rankClass}">#${rank}</td>
                    <td class="p-6">
                        <div class="flex items-center gap-4">
                            <img src="${data.avatar || 'https://ui-avatars.com/api/?background=random'}" class="w-10 h-10 rounded-full border border-white/10">
                            <div>
                                <div class="font-bold text-white">${data.ign || data.username || 'Unknown'}</div>
                                <div class="text-xs text-gray-500">${data.rank || 'Unranked'}</div>
                            </div>
                        </div>
                    </td>
                    <td class="p-6 hidden sm:table-cell text-gray-300 font-mono">${data.wins || 0}</td>
                    <td class="p-6 text-right font-bold text-[var(--gold)] text-lg">${data.prizesEarned ? '₱' + data.prizesEarned.toLocaleString() : '0'}</td>
                </tr>
            `;
            rank++;
        });

        if (snapshot.empty) {
            tbody.innerHTML = '<tr><td colspan="4" class="p-8 text-center text-gray-500">No ranked players yet.</td></tr>';
        }

    } catch (err) {
        console.error(err);
        tbody.innerHTML = '<tr><td colspan="4" class="p-8 text-center text-red-400">Error loading leaderboard.</td></tr>';
    }
});