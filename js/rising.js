import { db } from './firebase-config.js';
import { collection, getDocs, addDoc, query } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-auth.js";

function qs(sel) { return document.querySelector(sel); }
function escapeHtml(str) { if (!str) return ''; return String(str).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }

let allTalents = [];

document.addEventListener('DOMContentLoaded', () => {
    fetchTalents();
    setupApplicationForm();
    checkAdminStatus();
});

// 1. FETCH TALENTS
async function fetchTalents() {
    const grid = qs('#talents-grid');
    if (!grid) return;

    try {
        const q = query(collection(db, "talents"));
        const snapshot = await getDocs(q);
        
        allTalents = [];
        snapshot.forEach(doc => {
            allTalents.push({ id: doc.id, ...doc.data() });
        });

        renderTalents(allTalents);

    } catch (err) {
        console.error(err);
        grid.innerHTML = '<p class="col-span-full text-center text-red-500">Unable to load talents.</p>';
    }
}

// 2. RENDER & FILTER
window.filterTalents = function(category) {
    // Visual update for buttons
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.classList.remove('bg-[var(--gold)]', 'text-black', 'border-[var(--gold)]');
        btn.classList.add('text-gray-300', 'border-white/20');
        // Remove 'active' class from all
        btn.classList.remove('active'); 
    });
    
    // Highlight active button
    const activeBtn = event.target;
    activeBtn.classList.remove('text-gray-300', 'border-white/20');
    activeBtn.classList.add('bg-[var(--gold)]', 'text-black', 'border-[var(--gold)]', 'active');

    // Filter logic
    if (category === 'all') {
        renderTalents(allTalents);
    } else {
        const filtered = allTalents.filter(t => t.role === category);
        renderTalents(filtered);
    }
}

function renderTalents(talents) {
    const grid = qs('#talents-grid');
    grid.innerHTML = '';

    if (talents.length === 0) {
        grid.innerHTML = '<p class="col-span-full text-center text-gray-500 py-12">No talents found in this category.</p>';
        return;
    }

    talents.forEach(t => {
        const image = t.image || 'pictures/cz_logo.png';
        grid.innerHTML += `
            <div class="talent-card bg-[var(--dark-card)] rounded-xl overflow-hidden border border-white/10 group relative">
                <div class="h-64 overflow-hidden relative">
                    <img src="${image}" class="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110" alt="${escapeHtml(t.name)}">
                    <div class="absolute inset-0 bg-gradient-to-t from-black via-transparent to-transparent opacity-80"></div>
                    <div class="absolute bottom-4 left-4">
                        <span class="bg-[var(--gold)] text-black text-xs font-bold px-2 py-1 rounded mb-2 inline-block">${escapeHtml(t.role)}</span>
                        <h3 class="text-white font-bold text-xl">${escapeHtml(t.name)}</h3>
                    </div>
                </div>
                <div class="p-6">
                    <p class="text-gray-400 text-sm line-clamp-3 mb-4">${escapeHtml(t.bio || 'No bio available.')}</p>
                    <div class="flex gap-3 mt-auto pt-4 border-t border-white/10">
                         ${t.socialLink ? `<a href="${t.socialLink}" target="_blank" class="text-[var(--gold)] text-sm font-semibold hover:underline">Visit Profile &rarr;</a>` : ''}
                    </div>
                </div>
            </div>
        `;
    });
}

// 3. APPLICATION FORM
function setupApplicationForm() {
    const form = qs('#talentForm');
    if(!form) return;

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = form.querySelector('button');
        const originalText = btn.textContent;
        btn.disabled = true;
        btn.textContent = 'Sending...';

        try {
            await addDoc(collection(db, "messages"), {
                type: "Talent Application",
                name: qs('#app-name').value,
                category: qs('#app-category').value,
                link: qs('#app-link').value,
                message: qs('#app-msg').value,
                sentAt: new Date().toISOString()
            });
            alert("Application Sent! We will review your portfolio.");
            form.reset();
        } catch (err) {
            console.error(err);
            alert("Error sending application.");
        } finally {
            btn.disabled = false;
            btn.textContent = originalText;
        }
    });
}

// 4. ADMIN BUTTON (Shows "Manage Talents" if logged in as admin)
function checkAdminStatus() {
    const auth = getAuth();
    const adminArea = qs('#admin-action-area');
    if(!adminArea) return;

    onAuthStateChanged(auth, (user) => {
        if (user) {
            const adminEmails = ["admin@champzero.com", "owner@champzero.com"];
            if (adminEmails.includes(user.email)) {
                adminArea.innerHTML = `<a href="/admin" class="bg-red-600 hover:bg-red-700 text-white px-6 py-2 rounded-full font-bold shadow-lg">Manage Talents</a>`;
            }
        }
    });
}