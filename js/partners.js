// js/partners.js
import { db } from './firebase-config.js';
import { doc, getDoc, collection, getDocs } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-firestore.js";

function qs(sel) { return document.querySelector(sel); }
function escapeHtml(str) { if (!str) return ''; return String(str).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }

async function renderPartners() {
    const container = qs('#partners-container');
    if (!container) return;
    
    container.innerHTML = '<p class="text-center text-neutral-500 font-mono-tag text-xs">LOADING PARTNERS DATA...</p>';

    try {
        let partners = [];

        // 1. Try reading from site_config/partners_data
        try {
            const configSnap = await getDoc(doc(db, "site_config", "partners_data"));
            if (configSnap.exists() && Array.isArray(configSnap.data().partners) && configSnap.data().partners.length > 0) {
                partners = configSnap.data().partners;
            }
        } catch (err) {
            console.warn("Could not read site_config/partners_data", err);
        }

        // 2. Fallback to collection("partners") if site_config was empty
        if (partners.length === 0) {
            try {
                const querySnapshot = await getDocs(collection(db, "partners"));
                querySnapshot.forEach(d => partners.push({ id: d.id, ...d.data() }));
            } catch (err) {
                console.warn("Could not read collection partners", err);
            }
        }

        container.innerHTML = '';

        if (partners.length === 0) {
            container.innerHTML = `
                <div class="text-center py-16 bg-[#0D0D12] rounded-2xl border border-white/5 p-8 max-w-xl mx-auto">
                    <span class="text-[10px] font-mono-tag uppercase tracking-widest text-[#FFD700]">// ALLIANCES</span>
                    <h3 class="text-xl font-heading font-bold text-white uppercase mt-1">Partners &amp; Sponsors</h3>
                    <p class="text-neutral-400 text-xs mt-2 leading-relaxed">Official strategic alliances and sponsor announcements will be listed here soon.</p>
                </div>
            `;
            return;
        }

        // Sort by order or name
        partners.sort((a, b) => (Number(a.order) || 99) - (Number(b.order) || 99));

        // Group partners by category
        const categoryOrder = ['Major Partners', 'Official Partners', 'Hardware Partners', 'Media Partners', 'Community Partners'];
        const grouped = partners.reduce((acc, partner) => {
            const cat = partner.category || 'Official Partners';
            if (!acc[cat]) acc[cat] = [];
            acc[cat].push(partner);
            return acc;
        }, {});

        const sortedCategories = Object.keys(grouped).sort((a, b) => {
            const idxA = categoryOrder.indexOf(a);
            const idxB = categoryOrder.indexOf(b);
            if (idxA !== -1 && idxB !== -1) return idxA - idxB;
            if (idxA !== -1) return -1;
            if (idxB !== -1) return 1;
            return a.localeCompare(b);
        });

        sortedCategories.forEach(category => {
            const section = document.createElement('section');
            const isMajor = category === 'Major Partners';
            const gridClass = isMajor 
                ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3' 
                : 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4';
            
            const partnersHtml = grouped[category].map(p => {
                const logoUrl = p.logo || 'pictures/cz_logo.png';
                const hasLink = p.website && p.website.trim().length > 0;
                let cleanLink = p.website ? p.website.trim() : '';
                if (cleanLink && !cleanLink.startsWith('http://') && !cleanLink.startsWith('https://')) {
                    cleanLink = 'https://' + cleanLink;
                }
                const linkAttr = hasLink ? `href="${escapeHtml(cleanLink)}" target="_blank" rel="noopener noreferrer"` : '';
                const tag = hasLink ? 'a' : 'div';
                
                return `
                    <${tag} ${linkAttr} class="group bg-[#0D0D12] rounded-2xl border border-white/5 hover:border-[#FFD700]/50 p-6 flex flex-col items-center justify-center ${isMajor ? 'h-40' : 'h-32'} transform hover:-translate-y-1.5 transition-all duration-300 shadow-lg hover:shadow-[0_0_25px_rgba(255,215,0,0.12)] relative overflow-hidden cursor-pointer">
                        <div class="absolute inset-0 bg-gradient-to-b from-white/[0.02] to-transparent pointer-events-none"></div>
                        <img src="${escapeHtml(logoUrl)}" alt="${escapeHtml(p.name)}" class="${isMajor ? 'max-h-20' : 'max-h-14'} w-auto object-contain transition-transform duration-300 group-hover:scale-105 filter drop-shadow">
                        ${p.name ? `<span class="mt-2 text-[10px] font-heading uppercase tracking-wider text-neutral-400 group-hover:text-white transition-colors truncate max-w-full">${escapeHtml(p.name)}</span>` : ''}
                    </${tag}>
                `;
            }).join('');

            section.innerHTML = `
                <div class="mb-6 flex items-center justify-between border-b border-white/5 pb-3">
                    <div>
                        <span class="text-[9px] font-mono-tag uppercase tracking-widest text-[#FFD700]">// SPONSOR TIER</span>
                        <h2 class="text-xl sm:text-2xl font-heading font-bold text-white uppercase mt-0.5">${escapeHtml(category)}</h2>
                    </div>
                    <span class="text-[10px] font-mono-tag text-neutral-500 font-bold">${grouped[category].length} ${grouped[category].length === 1 ? 'Partner' : 'Partners'}</span>
                </div>
                <div class="grid ${gridClass} gap-5 mb-14">
                    ${partnersHtml}
                </div>
            `;
            container.appendChild(section);
        });

    } catch (error) {
        console.error("Partners Render Error:", error);
        container.innerHTML = '<p class="text-center text-red-400 font-mono-tag text-xs">Failed to load partners data.</p>';
    }
}

document.addEventListener('DOMContentLoaded', renderPartners);