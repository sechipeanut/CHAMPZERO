// js/shop.js
import { db } from './firebase-config.js';
import { collection, getDocs } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-firestore.js";

function qs(sel) { return document.querySelector(sel); }
function escapeHtml(str) { if (!str) return ''; return String(str).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }

window.closeServiceModal = function() {
    const modal = qs('#service-modal');
    if(modal) modal.classList.add('hidden');
    document.body.style.overflow = ''; 
}

async function renderShop() {
    const physical = [];
    const digital = [];
    
    // Services Data (Using numbers for price to fix currency bug)
    const services = [
        {
            name: "Tournament Organizer",
            price: 1.99, 
            icon: "🏆",
            description: "Expert management for your esports brackets, scheduling, and dispute resolution.",
            category: "services"
        },
        {
            name: "Team Manager",
            price: 0.99,
            icon: "👔",
            description: "Dedicated coordination for scrims, roster management, and player welfare.",
            category: "services"
        },
        {
            name: "Org Partner",
            price: 9.99,
            icon: "🤝",
            description: "Full organizational partnership including branding consultation and verified partner status.",
            category: "services"
        }
    ];

    try {
        const querySnapshot = await getDocs(collection(db, "products"));
        
        querySnapshot.forEach((doc) => {
            const item = doc.data();
            if (item.category === 'physical') physical.push(item);
            else if (item.category === 'digital') digital.push(item);
            else if (item.category === 'services') services.push(item);
        });

    } catch (error) {
        console.warn("Database connection issue - Loading hardcoded items.", error);
    }

    renderSection('physical-grid', physical, 'No physical gear available yet.');
    renderSection('digital-grid', digital, 'No digital goods available yet.');
    renderServices('services-grid', services);
}

// Handles Physical & Digital Items (Buy Now)
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
        card.className = "bg-[var(--dark-card)] rounded-xl border border-white/10 overflow-hidden group hover:border-[var(--gold)]/50 transition-colors cursor-pointer";
        
        const priceDisplay = item.price < 50 ? `$${item.price}` : `₱${(item.price || 0).toLocaleString()}`;

        card.innerHTML = `
            <div class="h-56 bg-gray-800 overflow-hidden relative">
                <img src="${item.image || 'https://via.placeholder.com/600x600'}" alt="${escapeHtml(item.name)}" class="w-full h-full object-cover transform group-hover:scale-105 transition-transform duration-300">
            </div>
            <div class="p-4">
                <h3 class="font-bold text-lg text-white leading-tight">${escapeHtml(item.name)}</h3>
                <p class="text-[var(--gold)] font-semibold mt-1">${priceDisplay}</p>
                <button class="buy-now-btn mt-4 block w-full text-center px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-sm font-bold hover:bg-[var(--gold)] hover:text-black hover:border-[var(--gold)] transition-colors z-20 relative">Buy Now</button>
            </div>
        `;
        grid.appendChild(card);
    });
}

// Handles Professional Services (Subscribe)
function renderServices(elementId, items) {
    const grid = qs(`#${elementId}`);
    if (!grid) return;
    grid.innerHTML = '';

    items.forEach(service => {
        const card = document.createElement('div');
        card.className = "bg-[var(--dark-card)] rounded-xl border border-white/10 p-8 flex flex-col text-center hover:border-[var(--gold)] transition-all cursor-pointer transform hover:-translate-y-1 relative group";
        
        const currencySymbol = service.price < 50 ? '$' : '₱';
        const priceVal = service.price.toLocaleString();
        const priceDisplay = `${currencySymbol}${priceVal}/month`;

        card.innerHTML = `
            <div class="text-5xl mb-4 text-[var(--gold)] transform group-hover:scale-110 transition-transform duration-300">${service.icon || '🛠️'}</div>
            <h3 class="font-bold text-xl text-white">${escapeHtml(service.name)}</h3>
            <p class="text-[var(--gold)] font-bold text-lg my-2">${priceDisplay}</p>
            <p class="text-gray-400 mt-2 flex-grow text-sm line-clamp-3">${escapeHtml(service.description)}</p>
            
            <button class="buy-now-btn mt-6 w-full text-center px-4 py-2 bg-white/10 border border-white/20 rounded-lg text-sm font-bold hover:bg-[var(--gold)] hover:text-black transition-colors z-10">
                Subscribe
            </button>
        `;

        card.addEventListener('click', () => openServiceModal(service));

        const buyBtn = card.querySelector('.buy-now-btn');
        buyBtn.addEventListener('click', (e) => {
            e.stopPropagation(); 
            handleBuy(service);
        });

        grid.appendChild(card);
    });
}

function openServiceModal(service) {
    const modal = qs('#service-modal');
    const content = qs('#modal-content');
    
    const currencySymbol = service.price < 50 ? '$' : '₱';
    const priceDisplay = `${currencySymbol}${service.price.toLocaleString()}/month`;

    content.innerHTML = `
        <div class="text-6xl mb-6">${service.icon || '🛠️'}</div>
        <h2 class="text-3xl font-bold text-white mb-2">${escapeHtml(service.name)}</h2>
        <p class="text-2xl text-[var(--gold)] font-bold mb-6">${priceDisplay}</p>
        
        <div class="bg-white/5 rounded-lg p-6 mb-8 text-left border border-white/10">
            <h4 class="text-gray-300 text-sm font-semibold uppercase tracking-wider mb-2">Service Details</h4>
            <p class="text-gray-200 leading-relaxed">${escapeHtml(service.description)}</p>
        </div>

        <button id="modal-buy-btn" class="w-full py-4 bg-gradient-to-r from-[var(--gold-darker)] to-[var(--gold)] text-black font-extrabold text-lg rounded-xl hover:opacity-90 transition-opacity shadow-[0_0_20px_rgba(255,215,0,0.3)]">
            SUBSCRIBE
        </button>
    `;

    qs('#modal-buy-btn').onclick = () => handleBuy(service);
    modal.classList.remove('hidden');
    document.body.style.overflow = 'hidden'; 
}

function handleBuy(item) {
    alert(`Initiating transaction for: ${item.name}`);
}

document.addEventListener('DOMContentLoaded', renderShop);