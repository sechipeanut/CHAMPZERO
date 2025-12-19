import { db } from './firebase-config.js';
import { collection, getDocs, orderBy, query } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-auth.js";

// Helper Functions
function qs(sel) { return document.querySelector(sel); }
function escapeHtml(str) { if (!str) return ''; return String(str).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }

// --- Init ---
document.addEventListener('DOMContentLoaded', () => {
    // The alert() is gone. We just run the functions now.
    renderJobs();
    checkAdminStatus();
});

// --- 1. Fetch & Render Jobs ---
async function renderJobs() {
    const container = document.getElementById('jobs-container');
    if (!container) return;

    try {
        const q = query(collection(db, "careers")); 
        const querySnapshot = await getDocs(q);
        
        container.innerHTML = ''; // Clear loading text

        if (querySnapshot.empty) {
            container.innerHTML = `
                <div class="text-center py-12">
                    <div class="inline-block p-4 rounded-full bg-white/5 mb-4">
                        <svg class="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"></path></svg>
                    </div>
                    <p class="text-gray-400 font-medium">No active listings at the moment.</p>
                    <p class="text-sm text-gray-500 mt-2">Check back soon!</p>
                </div>
            `;
            return;
        }

        querySnapshot.forEach(doc => {
            const job = doc.data();
            const div = document.createElement('div');
            // Clean Card Design
            div.className = "bg-[var(--dark-card)] border border-white/10 rounded-xl p-6 flex flex-col sm:flex-row items-start sm:items-center gap-6 transition-all duration-300 hover:border-[var(--gold)]/40 hover:shadow-lg hover:translate-y-[-2px]";
            
            div.innerHTML = `
                <div class="flex-1">
                    <h3 class="font-bold text-xl text-white mb-2">${escapeHtml(job.title)}</h3>
                    <div class="flex flex-wrap items-center gap-3 text-sm text-gray-400">
                        <span class="flex items-center gap-1"><svg class="w-4 h-4 text-[var(--gold)]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"></path></svg> ${escapeHtml(job.location)}</span>
                        <span class="hidden sm:inline text-gray-600">•</span>
                        <span class="flex items-center gap-1"><svg class="w-4 h-4 text-[var(--gold)]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"></path></svg> ${escapeHtml(job.type)}</span>
                    </div>
                </div>
                <a href="contact.html?subject=Application for ${encodeURIComponent(job.title)}" class="w-full sm:w-auto px-6 py-2.5 text-center text-black bg-[var(--gold)] font-bold rounded-lg hover:bg-yellow-400 transition-colors shadow-md">
                    Apply Now
                </a>
            `;
            container.appendChild(div);
        });

    } catch (error) {
        console.error("Error loading jobs:", error);
        container.innerHTML = `<div class="text-center text-red-400 py-8"><p>Unable to load openings.</p></div>`;
    }
}

// --- 2. Admin Check Logic ---
function checkAdminStatus() {
    const auth = getAuth();
    const adminArea = qs('#admin-action-area');
    
    if(!adminArea) return;

    onAuthStateChanged(auth, (user) => {
        if (user) {
            // Check your admin email here
            const adminEmails = ["admin@champzero.com", "casalmeseanlloyd@gmail.com"]; 
            
            if (adminEmails.includes(user.email)) {
                adminArea.innerHTML = `
                    <a href="admin.html" class="inline-flex items-center gap-2 bg-red-600/90 hover:bg-red-600 text-white px-6 py-2 rounded-full font-bold shadow-lg transition-transform hover:scale-105 backdrop-blur-md border border-red-500/50">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path></svg>
                        Manage Jobs
                    </a>
                `;
            }
        }
    });
}