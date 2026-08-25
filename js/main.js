import { auth, db } from './firebase-config.js';
import { signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-auth.js";
import { doc, getDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-firestore.js";
import { initLiveScores } from './live-scores.js';
import './community-chat.js';
import './stinger.js';

function escapeHtml(str) { 
    if (!str) return ''; 
    return String(str).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); 
}

// --- 0. INSTANT AUTH CACHING (Zero-Flicker Header Hydration) ---
export function getCachedAuthUser() {
    try {
        const raw = localStorage.getItem('cz_auth_cache');
        return raw ? JSON.parse(raw) : null;
    } catch (e) {
        return null;
    }
}

export function setCachedAuthUser(data) {
    try {
        if (data) {
            localStorage.setItem('cz_auth_cache', JSON.stringify(data));
        } else {
            localStorage.removeItem('cz_auth_cache');
        }
    } catch (e) {}
}

// --- 1. GLOBAL MOBILE MENU LOGIC ---
window.openMobileMenu = function () {
    const mobileMenu = document.getElementById('mobile-menu');
    if (mobileMenu) {
        mobileMenu.classList.remove('hidden');
        mobileMenu.classList.add('flex');
        document.body.style.overflow = 'hidden';
    }
};

window.closeMobileMenu = function () {
    const mobileMenu = document.getElementById('mobile-menu');
    if (mobileMenu) {
        mobileMenu.classList.add('hidden');
        mobileMenu.classList.remove('flex');
        document.body.style.overflow = 'auto';
    }
};

window.toggleMobileMenu = function () {
    const mobileMenu = document.getElementById('mobile-menu');
    if (mobileMenu) {
        if (mobileMenu.classList.contains('hidden')) {
            window.openMobileMenu();
        } else {
            window.closeMobileMenu();
        }
    }
};

function updateActiveNavLink() {
    const rawPath = window.location.pathname.toLowerCase().replace(/\/index\.html$/, '/').replace(/\.html$/, '');
    const currentPath = (rawPath === '' || rawPath === '/index') ? '/' : rawPath;

    const navLinks = document.querySelectorAll('header nav a.nav-link, #mobile-menu nav a');
    navLinks.forEach(link => {
        const rawHref = (link.getAttribute('href') || '').toLowerCase().replace(/\/index\.html$/, '/').replace(/\.html$/, '');
        const href = (rawHref === '' || rawHref === '/index') ? '/' : rawHref;

        let isActive = false;
        if (href === '/') {
            isActive = (currentPath === '/' || currentPath === '');
        } else {
            isActive = (currentPath === href) || currentPath.startsWith(href + '/');
        }

        if (isActive) {
            link.classList.add('text-white', 'active');
            link.classList.remove('text-neutral-400');
            // Add gold dot indicator for mobile menu links
            if (link.closest('#mobile-menu') && !link.querySelector('.nav-active-dot')) {
                const dot = document.createElement('span');
                dot.className = 'nav-active-dot w-1.5 h-1.5 rounded-full bg-[#FFD700] ml-auto shrink-0';
                link.style.display = 'flex';
                link.style.justifyContent = 'space-between';
                link.style.alignItems = 'center';
                link.appendChild(dot);
            }
        } else {
            link.classList.remove('text-white', 'active');
            link.classList.add('text-neutral-400');
            // Remove any gold dot
            const dot = link.querySelector('.nav-active-dot');
            if (dot) dot.remove();
        }
    });
}

function setupStaticListeners() {
    const menuBtn = document.getElementById('mobile-menu-button');
    const closeBtn = document.getElementById('close-mobile-menu');
    const mobileMenu = document.getElementById('mobile-menu');

    if (menuBtn) {
        menuBtn.onclick = (e) => {
            e.stopPropagation();
            window.toggleMobileMenu();
        };
    }
    if (closeBtn) {
        closeBtn.onclick = (e) => {
            e.stopPropagation();
            window.closeMobileMenu();
        };
    }
    if (mobileMenu) {
        mobileMenu.onclick = (e) => {
            if (e.target === mobileMenu) window.closeMobileMenu();
        };
        mobileMenu.querySelectorAll('a').forEach(link => {
            link.addEventListener('click', () => window.closeMobileMenu());
        });
    }

    const logoutBtns = document.querySelectorAll('#logout-btn, .logout-link');
    logoutBtns.forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.preventDefault();
            try {
                setCachedAuthUser(null);
                await signOut(auth);
                window.location.href = "/login";
            } catch (error) {
                console.error("Logout Error:", error);
            }
        });
    });

    updateActiveNavLink();
    try { initLiveScores(); } catch(e) {}
    try { initCustomCursor(); } catch(e) {}

    // Instant Link Prefetching on Hover for Zero-Latency Navigation
    const prefetchedUrls = new Set();
    document.querySelectorAll('header nav a, #mobile-menu nav a, a.nav-link').forEach(link => {
        const href = link.getAttribute('href');
        if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('javascript:')) return;
        link.addEventListener('mouseenter', () => {
            if (prefetchedUrls.has(href)) return;
            prefetchedUrls.add(href);
            const prefetchTag = document.createElement('link');
            prefetchTag.rel = 'prefetch';
            prefetchTag.href = href;
            document.head.appendChild(prefetchTag);
        }, { once: true });
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupStaticListeners);
} else {
    setupStaticListeners();
}

// --- 3. DYNAMIC NAV BAR (Show/Hide Login/Profile with Zero Reload Flash) ---
let lastRenderedUserKey = null;

function renderAuthHeader(user, userData = {}) {
    const authControls = document.getElementById('auth-controls');
    const mobileAuth = document.querySelector('#mobile-menu .border-t');

    if (user && authControls) {
        const isAdmin = userData.role === "admin";
        const isSupporter = Boolean(userData.isSupporter || userData.supporterTier || userData.supporterBadge);
        const supporterTier = String(userData.supporterTier || 'bronze').toLowerCase();
        const displayName = userData.ign || userData.displayName || user.displayName || (user.email ? user.email.split('@')[0] : "Champion");
        const userAvatar = userData.avatar || ('https://ui-avatars.com/api/?name=' + encodeURIComponent(displayName) + '&background=111116&color=FFD700');

        const currentKey = `${user.uid}_${displayName}_${userData.role}_${supporterTier}_${isSupporter}_${userAvatar}`;
        if (lastRenderedUserKey === currentKey) {
            // Already rendered identically, avoid DOM thrashing
            return;
        }
        lastRenderedUserKey = currentKey;

        // Global Profile Header Sync Safeguard
        const profileHeaderName = document.getElementById('display-name-header');
        if (profileHeaderName) profileHeaderName.textContent = displayName;
        const profileHeaderEmail = document.getElementById('email-display');
        if (profileHeaderEmail && user.email) profileHeaderEmail.textContent = user.email;
        const profileAccEmail = document.getElementById('account-email-display');
        if (profileAccEmail && user.email) profileAccEmail.textContent = user.email;
        const profileAvatarEl = document.getElementById('profile-avatar');
        if (profileAvatarEl) profileAvatarEl.src = userAvatar;

        const supporterIcon = isSupporter
            ? (supporterTier === 'gold'
                ? '<span class="px-1.5 py-0.2 rounded text-[8px] font-bold uppercase bg-[#FFD700]/20 text-[#FFD700] border border-[#FFD700]/30 font-mono" title="Gold Patron">PATRON</span>'
                : (supporterTier === 'silver'
                    ? '<span class="px-1.5 py-0.2 rounded text-[8px] font-bold uppercase bg-slate-400/20 text-slate-200 border border-slate-300/30 font-mono" title="Silver Elite">ELITE</span>'
                    : '<span class="px-1.5 py-0.2 rounded text-[8px] font-bold uppercase bg-amber-700/20 text-amber-400 border border-amber-600/30 font-mono" title="Bronze Scout">SCOUT</span>'))
            : '';

        // User is Logged In -> Show Profile Dropdown
        authControls.innerHTML = `
            <div class="relative profile-dropdown-container flex items-center z-[1002]">
                <button id="profile-dropdown-btn" class="flex items-center gap-2 hover:opacity-80 transition-opacity cursor-pointer">
                    <div class="text-right hidden sm:block">
                        <div class="text-[10px] text-neutral-400 font-mono-tag">Welcome,</div>
                        <div class="text-xs font-bold text-[#FFD700] flex items-center justify-end gap-1 font-heading">
                            <span>${escapeHtml(displayName)}</span>
                            ${supporterIcon}
                        </div>
                    </div>
                    <img src="${userAvatar}" class="w-8 h-8 rounded-full ${isSupporter ? (supporterTier === 'gold' ? 'border-2 border-[#FFD700] shadow-[0_0_8px_rgba(255,215,0,0.4)]' : 'border-2 border-slate-300') : 'border border-[#FFD700]'} object-cover">
                    <svg class="w-4 h-4 text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path>
                    </svg>
                </button>
                <div id="profile-dropdown-menu" class="hidden absolute right-0 top-full mt-2 w-48 bg-[#111116] border border-white/20 rounded-lg shadow-xl py-2 z-[1005]">
                    <a href="/profile" class="block px-4 py-2 text-xs font-semibold text-neutral-300 hover:bg-white/10 hover:text-[#FFD700] transition-colors">
                        <svg class="w-4 h-4 inline-block mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"></path>
                        </svg>
                        View Profile
                    </a>
                    <a href="/support" class="block px-4 py-2 text-xs font-semibold text-neutral-300 hover:bg-white/10 hover:text-[#FFD700] transition-colors">
                        <svg class="w-4 h-4 inline-block mr-2 text-[#FFD700]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path>
                        </svg>
                        Supporter Club
                    </a>
                    ${isAdmin ? `<a href="/admin" class="block px-4 py-2 text-xs font-semibold text-neutral-300 hover:bg-white/10 hover:text-[#FFD700] transition-colors">
                        <svg class="w-4 h-4 inline-block mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"></path>
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path>
                        </svg>
                        Admin
                    </a>` : ''}
                    <div class="border-t border-white/10 my-1"></div>
                    <button id="dropdown-logout-btn" class="w-full text-left block px-4 py-2 text-xs font-semibold text-red-400 hover:bg-red-900/20 transition-colors cursor-pointer">
                        <svg class="w-4 h-4 inline-block mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"></path>
                        </svg>
                        Log Out
                    </button>
                </div>
            </div>
        `;

        const heroCtaLoggedIn = document.getElementById('hero-cta-btn');
        if (heroCtaLoggedIn) {
            heroCtaLoggedIn.href = "/tournaments";
            heroCtaLoggedIn.innerHTML = `<span>Explore Tournaments</span><span>&rarr;</span>`;
        }

        const dropdownBtn = document.getElementById('profile-dropdown-btn');
        const dropdownMenu = document.getElementById('profile-dropdown-menu');

        if (dropdownBtn && dropdownMenu) {
            dropdownBtn.onclick = (e) => {
                e.stopPropagation();
                dropdownMenu.classList.toggle('hidden');
            };
            document.addEventListener('click', (e) => {
                if (!dropdownBtn.contains(e.target) && !dropdownMenu.contains(e.target)) {
                    dropdownMenu.classList.add('hidden');
                }
            });
            document.getElementById('dropdown-logout-btn')?.addEventListener('click', async (e) => {
                e.preventDefault();
                try {
                    setCachedAuthUser(null);
                    await signOut(auth);
                    window.location.href = "/login";
                } catch (error) {
                    console.error("Logout Error:", error);
                }
            });
        }

        if (mobileAuth) {
            mobileAuth.innerHTML = `
                <div class="space-y-4 w-full">
                    <div class="flex items-center gap-3 p-3 rounded-xl bg-white/5 border border-white/10">
                        <img src="${userAvatar}" alt="${displayName}" class="w-10 h-10 rounded-xl border border-[#FFD700]/60 object-cover shrink-0">
                        <div class="min-w-0 flex-1">
                            <div class="flex items-center gap-1.5">
                                <span class="text-xs font-bold text-white font-heading truncate uppercase">${displayName}</span>
                                <span class="text-[9px] font-mono-tag px-1.5 py-0.2 rounded bg-[#FFD700]/10 text-[#FFD700] border border-[#FFD700]/30 uppercase font-bold">${isAdmin ? 'Admin' : 'Player'}</span>
                            </div>
                            <div class="text-[11px] text-neutral-400 font-mono-tag truncate">${user.email || ''}</div>
                        </div>
                    </div>
                    <div class="grid grid-cols-1 gap-2">
                        <a href="/profile" class="w-full text-center py-3 rounded-lg text-black bg-[#FFD700] hover:bg-[#FFF099] font-heading font-bold text-xs uppercase tracking-wider transition-all shadow-md flex items-center justify-center gap-2">
                            <span>Player Profile &amp; Dashboard</span>
                        </a>
                        ${isAdmin ? `
                        <a href="/admin" class="w-full text-center py-3 rounded-lg text-white bg-white/5 hover:bg-white/10 border border-white/10 font-heading font-bold text-xs uppercase tracking-wider transition-all flex items-center justify-center gap-2">
                            <span>Admin Control Center</span>
                        </a>` : ''}
                        <button id="mobile-logout" class="w-full text-center py-2.5 rounded-lg text-red-400 hover:text-red-300 hover:bg-red-950/30 border border-red-900/30 font-mono-tag text-xs uppercase tracking-wider transition-all flex items-center justify-center gap-2 cursor-pointer">
                            <span>Sign Out</span>
                        </button>
                    </div>
                </div>
            `;
            document.getElementById('mobile-logout')?.addEventListener('click', async () => {
                setCachedAuthUser(null);
                await signOut(auth);
                window.location.href = "/login";
            });
        }
    } else if (authControls) {
        lastRenderedUserKey = '__logged_out__';
        authControls.innerHTML = `
            <a href="/login" class="text-xs font-semibold px-3 py-1.5 text-neutral-300 hover:text-white transition-colors">Log In</a>
            <a href="/signup" class="inline-block bg-[#FFD700] hover:bg-[#FFF099] text-black px-4 py-2 rounded font-heading font-bold text-xs uppercase tracking-wider transition-all shadow-sm">Sign Up</a>
        `;
        if (mobileAuth) {
            mobileAuth.innerHTML = `
                <div class="space-y-2.5 w-full">
                    <a href="/login" class="block w-full text-center py-3 rounded-lg text-white bg-white/5 border border-white/10 font-semibold text-xs uppercase tracking-wider hover:bg-white/10 transition-all">Log In</a>
                    <a href="/signup" class="block w-full text-center py-3 rounded-lg text-black bg-[#FFD700] hover:bg-[#FFF099] font-heading font-bold text-xs uppercase tracking-wider transition-all shadow-md">Sign Up</a>
                </div>
            `;
        }
        const heroCtaLoggedOut = document.getElementById('hero-cta-btn');
        if (heroCtaLoggedOut) {
            heroCtaLoggedOut.href = "/signup";
            heroCtaLoggedOut.innerHTML = `<span>Get Started</span><span>&rarr;</span>`;
        }
    }

    const authWrapper = document.getElementById('auth-controls-wrapper');
    if (authWrapper) {
        authWrapper.classList.remove('opacity-0', 'pointer-events-none');
        authWrapper.style.visibility = 'visible';
        authWrapper.style.opacity = '1';
        authWrapper.style.pointerEvents = 'auto';
    }
}

// Immediate Synchronous Hydration on Script Load
const _initialCachedUser = getCachedAuthUser();
if (_initialCachedUser && _initialCachedUser.uid) {
    renderAuthHeader(_initialCachedUser, _initialCachedUser);
}

// Background Reconciliation with Firebase Auth
onAuthStateChanged(auth, async (user) => {
    if (user) {
        const cached = getCachedAuthUser();
        if (!cached || cached.uid !== user.uid) {
            renderAuthHeader(user, {});
        }
        try {
            const userDoc = await getDoc(doc(db, "users", user.uid));
            if (userDoc.exists()) {
                const profileData = userDoc.data();
                const fullUserData = {
                    uid: user.uid,
                    email: user.email,
                    displayName: profileData.ign || profileData.displayName || user.displayName || (user.email ? user.email.split('@')[0] : "Champion"),
                    ign: profileData.ign || '',
                    avatar: profileData.avatar || '',
                    role: profileData.role || 'user',
                    isSupporter: Boolean(profileData.isSupporter || profileData.supporterTier || profileData.supporterBadge),
                    supporterTier: profileData.supporterTier || 'bronze',
                    ...profileData
                };
                setCachedAuthUser(fullUserData);
                renderAuthHeader(user, fullUserData);
            } else {
                const basicData = {
                    uid: user.uid,
                    email: user.email,
                    displayName: user.displayName || (user.email ? user.email.split('@')[0] : "Champion"),
                    role: 'user'
                };
                setCachedAuthUser(basicData);
                renderAuthHeader(user, basicData);
            }
        } catch (error) {
            console.warn("Could not fetch user profile details:", error);
        }
    } else {
        setCachedAuthUser(null);
        renderAuthHeader(null);
    }
});

/**
 * Initializes the ChampZero Bespoke Gaming Cursor & Tactical Click Effects
 */
function initCustomCursor() {
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;

    if (!document.getElementById('cz-custom-cursor-css')) {
        const link = document.createElement('link');
        link.id = 'cz-custom-cursor-css';
        link.rel = 'stylesheet';
        link.href = '/css/custom-cursor.css';
        document.head.appendChild(link);
    }

    // Single click pulse listener
    if (!window._czCursorClickInit) {
        window._czCursorClickInit = true;
        document.addEventListener('click', (e) => {
            const pulse = document.createElement('div');
            pulse.className = 'cz-click-pulse';
            pulse.style.left = `${e.clientX}px`;
            pulse.style.top = `${e.clientY}px`;
            document.body.appendChild(pulse);
            setTimeout(() => pulse.remove(), 400);
        });
    }
}

// --- LIVE SYSTEM ANNOUNCEMENT BANNER ---
function initSystemAnnouncementBanner() {
    try {
        onSnapshot(doc(db, "system_settings", "banner"), (docSnap) => {
            let bannerEl = document.getElementById('cz-system-banner');
            if (!docSnap.exists() || !docSnap.data().active || !docSnap.data().text) {
                if (bannerEl) bannerEl.remove();
                return;
            }
            const data = docSnap.data();
            const type = data.type || 'gold';
            
            let colorClasses = 'bg-[#FFD700]/15 border-b border-[#FFD700]/30 text-[#FFD700]';
            if (type === 'amber') colorClasses = 'bg-amber-500/15 border-b border-amber-500/30 text-amber-300';
            if (type === 'red') colorClasses = 'bg-red-500/20 border-b border-red-500/40 text-red-300';
            if (type === 'emerald') colorClasses = 'bg-emerald-500/15 border-b border-emerald-500/30 text-emerald-300';

            if (!bannerEl) {
                bannerEl = document.createElement('div');
                bannerEl.id = 'cz-system-banner';
                document.body.insertBefore(bannerEl, document.body.firstChild);
            }

            bannerEl.className = `w-full py-2 px-4 text-center font-mono-tag text-xs font-bold tracking-wider z-[9999] flex items-center justify-center gap-2 ${colorClasses}`;
            bannerEl.innerHTML = `
                <span class="w-2 h-2 rounded-full bg-current animate-pulse"></span>
                <span>${escapeHtml(data.text)}</span>
            `;
        }, (err) => {
            // Gracefully handle without unhandled console error
        });
    } catch(e) {
        console.warn("System banner warning:", e);
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSystemAnnouncementBanner);
} else {
    initSystemAnnouncementBanner();
}