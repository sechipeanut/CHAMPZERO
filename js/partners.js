// js/partners.js
import { db } from './firebase-config.js';
import { collection, getDocs } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-firestore.js";

function qs(sel) { return document.querySelector(sel); }
function escapeHtml(str) { if (!str) return ''; return String(str).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }

async function renderPartners() {
    const container = qs('#partners-container');
    if (!container) return;
    
    container.innerHTML = '<p class="text-center text-gray-500">Loading partners...</p>';

    try {
        const querySnapshot = await getDocs(collection(db, "partners"));
        container.innerHTML = '';

        if (querySnapshot.empty) {
            container.innerHTML = `
                <div class="text-center py-16">
                    <h3 class="text-xl font-semibold text-white">No partners listed at the moment</h3>
                    <p class="text-gray-400 mt-2">Check back soon for our official alliances.</p>
                </div>
            `;
            return;
        }

        const partners = [];
        querySnapshot.forEach(doc => partners.push(doc.data()));

        // Group partners by category
        const grouped = partners.reduce((acc, partner) => {
            const cat = partner.category || 'Official Partners';
            if (!acc[cat]) acc[cat] = [];
            acc[cat].push(partner);
            return acc;
        }, {});

        Object.keys(grouped).forEach(category => {
            const section = document.createElement('section');
            const gridClass = category === 'Major Partners' ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-2 md:grid-cols-4';
            
            let partnersHtml = grouped[category].map(p => `
                <div class="bg-[var(--dark-card)] rounded-xl border border-white/10 p-6 flex items-center justify-center h-32 transform hover:-translate-y-1 transition-all duration-300 hover:border-[var(--gold)]/30 hover:bg-white/5">
                    <img src="${p.logo}" alt="${escapeHtml(p.name)}" class="max-h-16 w-auto object-contain">
                </div>
            `).join('');

            section.innerHTML = `
                <h2 class="text-3xl font-bold text-center mb-10 text-white">${escapeHtml(category)}</h2>
                <div class="grid ${gridClass} gap-8">
                    ${partnersHtml}
                </div>
            `;
            container.appendChild(section);
        });

    } catch (error) {
        console.error("Error:", error);
        container.innerHTML = '<p class="text-center text-red-500">Failed to load partners.</p>';
    }
}

document.addEventListener('DOMContentLoaded', renderPartners);