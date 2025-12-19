// js/shop.js
import { db } from './firebase-config.js';
import { collection, getDocs } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-firestore.js";

function qs(sel) { return document.querySelector(sel); }
function escapeHtml(str) { if (!str) return ''; return String(str).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }

async function renderShop() {
    try {
        const querySnapshot = await getDocs(collection(db, "products"));
        
        // Buckets for categories
        const physical = [];
        const digital = [];
        const services = [];

        querySnapshot.forEach((doc) => {
            const item = doc.data();
            if (item.category === 'physical') physical.push(item);
            else if (item.category === 'digital') digital.push(item);
            else if (item.category === 'services') services.push(item);
        });

        renderSection('physical-grid', physical, 'No physical gear available yet.');
        renderSection('digital-grid', digital, 'No digital goods available yet.');
        renderServices('services-grid', services);

    } catch (error) {
        console.error("Error loading shop:", error);
    }
}

function renderSection(elementId, items, emptyMessage) {
    const grid = qs(`#${elementId}`);
    if (!grid) return;
    grid.innerHTML = '';

    if (items.length === 0) {
        grid.innerHTML = `<div class="col-span-full text-center text-gray-500 py-12 italic">${emptyMessage} Check back soon!</div>`;
        return;
    }

    items.forEach(item => {
        const card = document.createElement('div');
        card.className = "bg-[var(--dark-card)] rounded-xl border border-white/10 overflow-hidden group";
        card.innerHTML = `
            <div class="h-56 bg-gray-800 overflow-hidden relative">
                <img src="${item.image || 'https://via.placeholder.com/600x600'}" alt="${escapeHtml(item.name)}" class="w-full h-full object-cover transform group-hover:scale-105 transition-transform duration-300">
            </div>
            <div class="p-4">
                <h3 class="font-bold text-lg text-white leading-tight">${escapeHtml(item.name)}</h3>
                <p class="text-[var(--gold)] font-semibold mt-1">₱${(item.price || 0).toLocaleString()}</p>
                <button class="mt-4 block w-full text-center px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-sm font-bold hover:bg-white/10 transition-colors">View Product</button>
            </div>
        `;
        grid.appendChild(card);
    });
}

function renderServices(elementId, items) {
    const grid = qs(`#${elementId}`);
    if (!grid) return;
    grid.innerHTML = '';

    if (items.length === 0) {
        grid.innerHTML = `<div class="col-span-full text-center text-gray-500 py-12 italic">Professional services are currently unavailable.</div>`;
        return;
    }

    items.forEach(service => {
        const card = document.createElement('div');
        card.className = "bg-[var(--dark-card)] rounded-xl border border-white/10 p-8 flex flex-col text-center hover:border-[var(--gold)]/30 transition-colors";
        card.innerHTML = `
            <div class="text-5xl mb-4 text-[var(--gold)]">${service.icon || '🛠️'}</div>
            <h3 class="font-bold text-xl text-white">${escapeHtml(service.name)}</h3>
            <p class="text-gray-400 mt-2 flex-grow text-sm">${escapeHtml(service.description)}</p>
            <button class="mt-6 w-full text-center px-4 py-2 bg-white/10 border border-white/20 rounded-lg text-sm font-bold hover:bg-white/20 transition-colors">Inquire</button>
        `;
        grid.appendChild(card);
    });
}

document.addEventListener('DOMContentLoaded', renderShop);