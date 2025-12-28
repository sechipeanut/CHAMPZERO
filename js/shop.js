import { db, auth } from './firebase-config.js';
import { collection, getDocs, addDoc, query, where, orderBy, serverTimestamp, doc, updateDoc, increment } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-firestore.js";

function qs(sel) { return document.querySelector(sel); }
function escapeHtml(str) { if (!str) return ''; return String(str).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }

let cart = [];
let allProducts = [];
let currentCategory = 'all';

// ======================
// 🛒 CART LOGIC
// ======================

window.toggleCartModal = function() {
    const modal = qs('#cart-modal');
    modal.classList.toggle('hidden');
    renderCart();
}

window.addToCart = function(itemString) {
    if(!auth.currentUser) {
        window.showErrorToast("Login Required", "Please login to shop.");
        return;
    }
    
    const item = JSON.parse(decodeURIComponent(itemString));
    
    if(item.stock !== undefined && item.stock <= 0) {
        window.showErrorToast("Out of Stock", "Sorry, this item is sold out.");
        return;
    }

    cart.push(item);
    updateCartCount();
    window.showSuccessToast("Added", `${item.name} added to cart!`, 1500);
    closeProductDetails();
}

window.removeFromCart = function(index) {
    cart.splice(index, 1);
    renderCart();
    updateCartCount();
}

function updateCartCount() {
    const badge = qs('#cart-count');
    badge.textContent = cart.length;
    if(cart.length > 0) badge.classList.remove('hidden');
    else badge.classList.add('hidden');
}

function renderCart() {
    const list = qs('#cart-items');
    const totalEl = qs('#cart-total');
    
    if(cart.length === 0) {
        list.innerHTML = '<p class="text-gray-500 text-center py-8">Your cart is empty.</p>';
        totalEl.textContent = '₱0';
        return;
    }

    let total = 0;
    list.innerHTML = cart.map((item, index) => {
        total += Number(item.price);
        return `
            <div class="flex justify-between items-center bg-white/5 p-3 rounded-lg border border-white/10">
                <div class="flex items-center gap-3">
                    <div class="w-10 h-10 bg-black/30 rounded flex items-center justify-center text-lg overflow-hidden">
                        ${item.image && item.image.startsWith('http') ? `<img src="${item.image}" class="w-full h-full object-cover">` : (item.icon || '📦')}
                    </div>
                    <div>
                        <div class="text-white font-bold text-sm">${escapeHtml(item.name)} <span class="text-xs text-gray-400 font-normal">${item.selectedVariant ? `(${item.selectedVariant})` : ''}</span></div>
                        <div class="text-[var(--gold)] text-xs">₱${item.price.toLocaleString()}</div>
                    </div>
                </div>
                <button onclick="removeFromCart(${index})" class="text-red-400 hover:text-red-300 p-2">&times;</button>
            </div>
        `;
    }).join('');

    totalEl.textContent = '₱' + total.toLocaleString();
}

// ======================
// 💳 CHECKOUT LOGIC
// ======================

window.initiateCheckout = function() {
    if(cart.length === 0) return;
    if(!auth.currentUser) {
        window.showErrorToast("Login Required", "Please login to continue.");
        return;
    }
    // Always show shipping modal to capture payment details
    qs('#cart-modal').classList.add('hidden');
    qs('#shipping-modal').classList.remove('hidden');
}

window.closeShippingModal = function() {
    qs('#shipping-modal').classList.add('hidden');
    qs('#cart-modal').classList.remove('hidden');
}

// Payment Method Selection Logic
document.querySelectorAll('input[name="payment_method"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
        const note = qs('#payment-note');
        if(e.target.value === 'GCash') note.textContent = "Send via 09123456789. Attach screenshot later.";
        else if(e.target.value === 'Bank Transfer') note.textContent = "BDO: 001234567890. Send proof later.";
        else note.textContent = "Pay securely upon delivery.";
    });
});

document.getElementById('shipping-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const paymentMethod = document.querySelector('input[name="payment_method"]:checked')?.value || 'COD';
    
    const shippingDetails = {
        name: qs('#ship-name').value,
        address: qs('#ship-address').value,
        phone: qs('#ship-phone').value,
        method: paymentMethod
    };
    submitOrder(shippingDetails);
});

async function submitOrder(shippingDetails) {
    qs('#shipping-modal').classList.add('hidden'); 
    window.showSuccessToast("Processing", "Placing your order...", 2000);

    try {
        const totalAmount = cart.reduce((sum, item) => sum + Number(item.price), 0);
        const itemsSummary = cart.map(i => `${i.name} ${i.selectedVariant ? `(${i.selectedVariant})` : ''}`).join(', ');

        await addDoc(collection(db, "orders"), {
            userId: auth.currentUser.uid,
            userEmail: auth.currentUser.email,
            items: cart,
            itemName: itemsSummary,
            amount: totalAmount,
            status: 'pending',
            paymentStatus: 'unpaid',
            shipping: shippingDetails,
            createdAt: serverTimestamp()
        });

        // Decrement stock for physical items
        for (const item of cart) {
            if (item.stockId && item.category === 'physical') {
                const prodRef = doc(db, "products", item.stockId);
                updateDoc(prodRef, { stock: increment(-1) }).catch(console.error);
            }
        }

        window.showSuccessToast("Order Placed!", "Thank you for your purchase!");
        cart = []; 
        updateCartCount();
        viewOrderHistory(); 

    } catch (error) {
        console.error("Checkout Error:", error);
        window.showErrorToast("Error", "Checkout failed. Try again.", 3000);
    }
}

// ======================
// 📦 ORDERS LOGIC
// ======================

window.toggleOrdersModal = function() {
    qs('#orders-modal').classList.toggle('hidden');
}

window.viewOrderHistory = async function() {
    const list = qs('#orders-list');
    qs('#cart-modal').classList.add('hidden');
    qs('#orders-modal').classList.remove('hidden');
    
    list.innerHTML = '<p class="text-gray-500 text-center py-8">Loading your orders...</p>';

    if(!auth.currentUser) {
        list.innerHTML = '<p class="text-center text-red-400 py-4">Please login to view orders.</p>';
        return;
    }

    try {
        const q = query(
            collection(db, "orders"), 
            where("userId", "==", auth.currentUser.uid),
            orderBy("createdAt", "desc")
        );
        const snapshot = await getDocs(q);

        if(snapshot.empty) {
            list.innerHTML = '<p class="text-gray-500 text-center py-8">No past orders found.</p>';
            return;
        }

        list.innerHTML = '';
        snapshot.forEach(doc => {
            const data = doc.data();
            const date = data.createdAt ? new Date(data.createdAt.toDate()).toLocaleDateString() : 'Just now';
            const statusColor = data.status === 'completed' ? 'badge-completed' : (data.status === 'cancelled' ? 'badge-cancelled' : 'badge-pending');
            const paymentMethod = data.shipping?.method || 'COD';
            const isDigital = data.items && data.items.some(i => i.category === 'digital');
            
            list.innerHTML += `
                <div class="bg-white/5 p-4 rounded-lg border border-white/10">
                    <div class="flex justify-between items-start mb-2">
                        <span class="text-[var(--gold)] font-mono text-xs">#${doc.id.slice(0,8)}</span>
                        <span class="text-xs text-gray-500">${date}</span>
                    </div>
                    <div class="font-bold text-white text-sm mb-1">${escapeHtml(data.itemName)}</div>
                    <div class="text-xs text-gray-400 mb-2">Via: ${escapeHtml(paymentMethod)}</div>
                    <div class="flex justify-between items-center mt-3">
                        <span class="text-white font-bold">₱${data.amount.toLocaleString()}</span>
                        <span class="px-2 py-1 rounded text-[10px] font-bold uppercase ${statusColor}">${data.status}</span>
                    </div>
                    ${(data.status === 'completed' && isDigital) ? `<div class="mt-3 pt-3 border-t border-white/10 text-center"><button class="text-xs text-[var(--gold)] hover:underline">Download / View Code</button></div>` : ''}
                </div>
            `;
        });

    } catch (error) {
        console.error("Order Fetch Error:", error);
        list.innerHTML = '<p class="text-red-400 text-center py-4">Failed to load orders.</p>';
    }
}

// ======================
// 🛍️ SHOP RENDERING
// ======================

window.closeProductDetails = function() {
    qs('#product-details-modal').classList.add('hidden');
}

window.openProductDetails = function(itemStr) {
    const item = JSON.parse(decodeURIComponent(itemStr));
    const modal = qs('#product-details-modal');
    
    // Toggle Image vs Icon display
    const imgEl = qs('#modal-img');
    const iconEl = qs('#modal-icon');
    
    if(item.category === 'services') {
        imgEl.classList.add('hidden');
        iconEl.classList.remove('hidden');
        iconEl.textContent = item.icon || '🛠️';
    } else {
        imgEl.classList.remove('hidden');
        iconEl.classList.add('hidden');
        imgEl.src = item.image || 'https://via.placeholder.com/600x600?text=No+Image';
    }

    qs('#modal-cat').textContent = item.category;
    qs('#modal-title').textContent = item.name;
    qs('#modal-price').textContent = `₱${item.price.toLocaleString()}`;
    qs('#modal-desc').textContent = item.description;
    
    const variantContainer = qs('#modal-variants-container');
    const variantSelect = qs('#modal-variant-select');
    
    if(item.variants && item.variants.length > 0) {
        variantContainer.classList.remove('hidden');
        variantSelect.innerHTML = item.variants.map(v => `<option value="${v}">${v}</option>`).join('');
    } else {
        variantContainer.classList.add('hidden');
    }
    
    const btn = qs('#modal-add-btn');
    if(item.stock !== undefined && item.stock <= 0) {
        btn.disabled = true;
        btn.textContent = "Out of Stock";
        btn.classList.add('opacity-50', 'cursor-not-allowed');
    } else {
        btn.disabled = false;
        btn.textContent = "Add to Cart";
        btn.classList.remove('opacity-50', 'cursor-not-allowed');
        
        btn.onclick = () => {
            if(!item.variants || item.variants.length === 0) {
                window.addToCart(encodeURIComponent(JSON.stringify(item)));
            } else {
                const selected = variantSelect.value;
                const itemWithVar = { ...item, selectedVariant: selected };
                window.addToCart(encodeURIComponent(JSON.stringify(itemWithVar)));
            }
        };
    }
    
    modal.classList.remove('hidden');
}

async function renderShop() {
    allProducts = []; // Reset to empty, fetch real data only

    try {
        const querySnapshot = await getDocs(collection(db, "products"));
        querySnapshot.forEach((doc) => {
            const data = doc.data();
            allProducts.push({ stockId: doc.id, ...data }); 
        });
    } catch (error) {
        console.warn("Database connection issue.", error);
    }

    applyFilters();
}

window.filterShop = function(category) {
    currentCategory = category;
    document.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'));
    event.target.classList.add('active'); 
    applyFilters();
}

window.applyFilters = function() {
    const search = qs('#shop-search')?.value.toLowerCase() || '';
    const sortVal = qs('#shop-sort')?.value || 'newest';
    
    let filtered = allProducts.filter(item => {
        const matchesCat = currentCategory === 'all' || item.category === currentCategory;
        const matchesSearch = item.name.toLowerCase().includes(search) || item.description.toLowerCase().includes(search);
        return matchesCat && matchesSearch;
    });

    // Sort Logic
    if (sortVal === 'price-low') {
        filtered.sort((a, b) => a.price - b.price);
    } else if (sortVal === 'price-high') {
        filtered.sort((a, b) => b.price - a.price);
    } else if (sortVal === 'name-az') {
        filtered.sort((a, b) => a.name.localeCompare(b.name));
    }

    distributeProducts(filtered);
}

function distributeProducts(products) {
    const physical = products.filter(p => p.category === 'physical');
    const digital = products.filter(p => p.category === 'digital');
    const services = products.filter(p => p.category === 'services');

    // Update Counts
    if(qs('#physical-section .count-badge')) qs('#physical-section .count-badge').textContent = `${physical.length} items`;
    if(qs('#digital-section .count-badge')) qs('#digital-section .count-badge').textContent = `${digital.length} items`;
    if(qs('#services-section .count-badge')) qs('#services-section .count-badge').textContent = `${services.length} items`;

    renderSection('physical-grid', physical, 'No physical gear found.');
    renderSection('digital-grid', digital, 'No digital goods found.');
    renderServices('services-grid', services); 
}

function renderSection(elementId, items, emptyMessage) {
    const grid = qs(`#${elementId}`);
    if (!grid) return;
    grid.innerHTML = '';

    if (items.length === 0) {
        grid.innerHTML = `<div class="col-span-full text-center text-gray-500 py-12 italic">${emptyMessage}</div>`;
        return;
    }

    items.forEach(item => {
        const card = document.createElement('div');
        card.className = "bg-[var(--dark-card)] rounded-xl border border-white/10 overflow-hidden group hover:border-[var(--gold)]/50 transition-colors cursor-pointer relative flex flex-col h-full";
        const itemStr = encodeURIComponent(JSON.stringify(item));
        const isOutOfStock = item.stock !== undefined && item.stock <= 0;

        card.innerHTML = `
            <div onclick="openProductDetails('${itemStr}')">
                <div class="h-56 bg-gray-800 overflow-hidden relative">
                    <img src="${item.image || 'https://via.placeholder.com/600x600?text=No+Image'}" class="w-full h-full object-cover transform group-hover:scale-105 transition-transform duration-300 ${isOutOfStock ? 'opacity-50 grayscale' : ''}">
                    ${isOutOfStock ? '<span class="absolute inset-0 flex items-center justify-center bg-black/60 font-bold text-white tracking-widest">SOLD OUT</span>' : ''}
                </div>
                <div class="p-4 flex flex-col flex-1">
                    <h3 class="font-bold text-lg text-white leading-tight mb-1">${escapeHtml(item.name)}</h3>
                    <p class="text-[var(--gold)] font-semibold mb-2">₱${Number(item.price).toLocaleString()}</p>
                    <p class="text-xs text-gray-400 line-clamp-2 mb-4 flex-grow">${escapeHtml(item.description)}</p>
                    <button class="mt-auto w-full text-center px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-sm font-bold hover:bg-[var(--gold)] hover:text-black hover:border-[var(--gold)] transition-colors">
                        View Details
                    </button>
                </div>
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
        grid.innerHTML = `<div class="col-span-full text-center text-gray-500 py-12 italic">No services available.</div>`;
        return;
    }

    items.forEach(service => {
        const card = document.createElement('div');
        card.className = "bg-[var(--dark-card)] rounded-xl border border-white/10 p-8 flex flex-col text-center hover:border-[var(--gold)] transition-all cursor-pointer transform hover:-translate-y-1 relative group";
        const itemStr = encodeURIComponent(JSON.stringify(service));

        card.innerHTML = `
            <div onclick="openProductDetails('${itemStr}')">
                <div class="text-5xl mb-4 text-[var(--gold)] transform group-hover:scale-110 transition-transform duration-300">${service.icon || '🛠️'}</div>
                <h3 class="font-bold text-xl text-white">${escapeHtml(service.name)}</h3>
                <p class="text-[var(--gold)] font-bold text-lg my-2">₱${Number(service.price).toLocaleString()}</p>
                <p class="text-gray-400 mt-2 flex-grow text-sm line-clamp-3">${escapeHtml(service.description)}</p>
                <button class="mt-6 w-full text-center px-4 py-2 bg-white/10 border border-white/20 rounded-lg text-sm font-bold hover:bg-[var(--gold)] hover:text-black transition-colors z-10 relative">
                    Subscribe
                </button>
            </div>
        `;
        grid.appendChild(card);
    });
}

document.addEventListener('DOMContentLoaded', renderShop);