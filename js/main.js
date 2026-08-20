import { auth } from './firebase-config.js';
import { signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-auth.js";
import { initLiveScores } from './live-scores.js';
import './community-chat.js';

document.addEventListener('DOMContentLoaded', () => {

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

    // --- 2. GLOBAL LOGOUT LOGIC ---
    // This allows any "Log Out" button on any page to work
    const logoutBtns = document.querySelectorAll('#logout-btn, .logout-link');
    logoutBtns.forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.preventDefault();
            try {
                await signOut(auth);
                window.location.href = "/login";
            } catch (error) {
                console.error("Logout Error:", error);
            }
        });
    });

    // --- 3. DYNAMIC NAV BAR (Show/Hide Login/Profile) ---
    onAuthStateChanged(auth, async (user) => {
        const authControls = document.getElementById('auth-controls');
        // NEW: Select the wrapper (Ensure you added id="auth-controls-wrapper" in your HTML)
        const authWrapper = document.getElementById('auth-controls-wrapper');

        // Mobile Auth Controls (inside the menu)
        const mobileAuth = document.querySelector('#mobile-menu .border-t');

        if (user && authControls) {
            // Check user role & supporter status from Firestore
            let isAdmin = false;
            let isSupporter = false;
            let supporterTier = 'bronze';
            let userAvatar = null;
            let displayName = user.displayName || "Champion";
            try {
                const { doc, getDoc } = await import("https://www.gstatic.com/firebasejs/11.1.0/firebase-firestore.js");
                const { db } = await import('./firebase-config.js');
                const userDoc = await getDoc(doc(db, "users", user.uid));
                if (userDoc.exists()) {
                    const userData = userDoc.data();
                    isAdmin = userData.role === "admin";
                    isSupporter = Boolean(userData.isSupporter || userData.supporterTier || userData.supporterBadge);
                    supporterTier = String(userData.supporterTier || 'bronze').toLowerCase();
                    userAvatar = userData.avatar || null;
                    displayName = userData.ign || userData.displayName || user.displayName || "Champion";
                }
            } catch (error) {
                console.error("Error checking admin/supporter status:", error);
            }

            // Global Profile Header Sync Safeguard
            const profileHeaderName = document.getElementById('display-name-header');
            if (profileHeaderName) profileHeaderName.textContent = displayName;
            const profileHeaderEmail = document.getElementById('email-display');
            if (profileHeaderEmail && user.email) profileHeaderEmail.textContent = user.email;
            const profileAccEmail = document.getElementById('account-email-display');
            if (profileAccEmail && user.email) profileAccEmail.textContent = user.email;
            const profileAvatarEl = document.getElementById('profile-avatar');
            if (profileAvatarEl) {
                profileAvatarEl.src = userAvatar || ('https://ui-avatars.com/api/?name=' + encodeURIComponent(displayName) + '&background=111116&color=FFD700');
            }

            const supporterIcon = isSupporter
                ? (supporterTier === 'gold'
                    ? '<span class="px-1.5 py-0.2 rounded text-[8px] font-bold uppercase bg-[#FFD700]/20 text-[#FFD700] border border-[#FFD700]/30 font-mono" title="Gold Patron">PATRON</span>'
                    : (supporterTier === 'silver'
                        ? '<span class="px-1.5 py-0.2 rounded text-[8px] font-bold uppercase bg-slate-400/20 text-slate-200 border border-slate-300/30 font-mono" title="Silver Elite">ELITE</span>'
                        : '<span class="px-1.5 py-0.2 rounded text-[8px] font-bold uppercase bg-amber-700/20 text-amber-400 border border-amber-600/30 font-mono" title="Bronze Scout">SCOUT</span>'))
                : '';

            // User is Logged In -> Show Profile Icon with Dropdown (Desktop Only)
            authControls.innerHTML = `
                <div class="relative profile-dropdown-container hidden md:block">
                    <button id="profile-dropdown-btn" class="flex items-center gap-2 hover:opacity-80 transition-opacity">
                        <div class="text-right">
                            <div class="text-xs text-gray-400">Welcome,</div>
                            <div class="text-sm font-bold text-[var(--gold)] flex items-center justify-end gap-1">
                                <span>${displayName}</span>
                                ${supporterIcon}
                            </div>
                        </div>
                        <img src="${userAvatar || 'https://ui-avatars.com/api/?name=' + (user.email || 'U') + '&background=1A1A1F&color=FFD700'}" class="w-8 h-8 rounded-full ${isSupporter ? (supporterTier === 'gold' ? 'border-2 border-[#FFD700] shadow-[0_0_8px_rgba(255,215,0,0.4)]' : 'border-2 border-slate-300') : 'border border-[var(--gold)]'} object-cover">
                        <svg class="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path>
                        </svg>
                    </button>
                    <div id="profile-dropdown-menu" class="hidden absolute right-0 mt-2 w-48 bg-[var(--dark-card)] border border-white/20 rounded-lg shadow-xl py-2 z-50">
                        <a href="/profile" class="block px-4 py-2 text-sm text-gray-300 hover:bg-white/10 hover:text-[var(--gold)] transition-colors">
                            <svg class="w-4 h-4 inline-block mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"></path>
                            </svg>
                            View Profile
                        </a>
                        <a href="/support" class="block px-4 py-2 text-sm text-gray-300 hover:bg-white/10 hover:text-[var(--gold)] transition-colors">
                            <svg class="w-4 h-4 inline-block mr-2 text-[#FFD700]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path>
                            </svg>
                            Supporter Club
                        </a>
                        ${isAdmin ? `<a href="/admin" class="block px-4 py-2 text-sm text-gray-300 hover:bg-white/10 hover:text-[var(--gold)] transition-colors">
                            <svg class="w-4 h-4 inline-block mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"></path>
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path>
                            </svg>
                            Admin
                        </a>` : ''}
                        <div class="border-t border-white/10 my-1"></div>
                        <button id="dropdown-logout-btn" class="w-full text-left block px-4 py-2 text-sm text-red-400 hover:bg-red-900/20 transition-colors">
                            <svg class="w-4 h-4 inline-block mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"></path>
                            </svg>
                            Log Out
                        </button>
                    </div>
                </div>
            `;

            // Add dropdown toggle functionality
            const dropdownBtn = document.getElementById('profile-dropdown-btn');
            const dropdownMenu = document.getElementById('profile-dropdown-menu');

            if (dropdownBtn && dropdownMenu) {
                dropdownBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    dropdownMenu.classList.toggle('hidden');
                });

                // Close dropdown when clicking outside
                document.addEventListener('click', (e) => {
                    if (!dropdownBtn.contains(e.target) && !dropdownMenu.contains(e.target)) {
                        dropdownMenu.classList.add('hidden');
                    }
                });

                // Logout from dropdown
                const dropdownLogout = document.getElementById('dropdown-logout-btn');
                if (dropdownLogout) {
                    dropdownLogout.addEventListener('click', async (e) => {
                        e.preventDefault();
                        try {
                            await signOut(auth);
                            window.location.href = "/login";
                        } catch (error) {
                            console.error("Logout Error:", error);
                        }
                    });
                }
            }

            // Update Mobile Menu to show Gamer HUD instead of simple text links
            if (mobileAuth) {
                const avatarSrc = userAvatar || ('https://ui-avatars.com/api/?name=' + encodeURIComponent(displayName) + '&background=111116&color=FFD700');
                mobileAuth.innerHTML = `
                    <div class="space-y-4 w-full">
                        <div class="flex items-center gap-3 p-3 rounded-xl bg-white/5 border border-white/10">
                            <img src="${avatarSrc}" alt="${displayName}" class="w-10 h-10 rounded-xl border border-[var(--gold)]/60 object-cover shrink-0">
                            <div class="min-w-0 flex-1">
                                <div class="flex items-center gap-1.5">
                                    <span class="text-xs font-bold text-white font-heading truncate uppercase">${displayName}</span>
                                    <span class="text-[9px] font-mono-tag px-1.5 py-0.2 rounded bg-[var(--gold)]/10 text-[var(--gold)] border border-[var(--gold)]/30 uppercase font-bold">${isAdmin ? 'Admin' : 'Player'}</span>
                                </div>
                                <div class="text-[11px] text-neutral-400 font-mono-tag truncate">${user.email || ''}</div>
                            </div>
                        </div>

                        <div class="grid grid-cols-1 gap-2">
                            <a href="/profile" class="w-full text-center py-3 rounded-lg text-black bg-[var(--gold)] hover:bg-[var(--gold-light)] font-heading font-bold text-xs uppercase tracking-wider transition-all shadow-md flex items-center justify-center gap-2">
                                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"></path></svg>
                                <span>Player Profile &amp; Dashboard</span>
                            </a>
                            ${isAdmin ? `
                            <a href="/admin" class="w-full text-center py-3 rounded-lg text-white bg-white/5 hover:bg-white/10 border border-white/10 font-heading font-bold text-xs uppercase tracking-wider transition-all flex items-center justify-center gap-2">
                                <svg class="w-4 h-4 text-[var(--gold)]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>
                                <span>Admin Control Center</span>
                            </a>` : ''}
                            <button id="mobile-logout" class="w-full text-center py-2.5 rounded-lg text-red-400 hover:text-red-300 hover:bg-red-950/30 border border-red-900/30 font-mono-tag text-xs uppercase tracking-wider transition-all flex items-center justify-center gap-2">
                                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"></path></svg>
                                <span>Sign Out</span>
                            </button>
                        </div>
                    </div>
                `;
                // Re-attach logout listener for the new mobile button
                document.getElementById('mobile-logout')?.addEventListener('click', async () => {
                    await signOut(auth);
                    window.location.href = "/login";
                });
            }

        } else if (authControls) {
            // User is Logged Out -> Show Login/Signup
            authControls.innerHTML = `
                <a href="/login" class="text-xs font-semibold px-3 py-1.5 text-neutral-300 hover:text-white transition-colors">Log In</a>
                <a href="/signup" class="hidden sm:inline-block bg-[var(--gold)] hover:bg-[var(--gold-light)] text-black px-4 py-2 rounded-lg text-xs font-heading font-bold uppercase tracking-wider transition-all">Sign Up</a>
            `;
            if (mobileAuth) {
                mobileAuth.innerHTML = `
                    <div class="space-y-2.5 w-full">
                        <a href="/login" class="block w-full text-center py-3 rounded-lg text-white bg-white/5 border border-white/10 font-semibold text-xs uppercase tracking-wider hover:bg-white/10 transition-all">Log In</a>
                        <a href="/signup" class="block w-full text-center py-3 rounded-lg text-black bg-[var(--gold)] hover:bg-[var(--gold-light)] font-heading font-bold text-xs uppercase tracking-wider transition-all shadow-md">Sign Up</a>
                    </div>
                `;
            }
        }

        if (authWrapper) {
            // A small timeout ensures the browser has rendered the initial state before fading in
            setTimeout(() => {
                authWrapper.classList.remove('opacity-0');
                authWrapper.classList.remove('pointer-events-none');
            }, 50);
        }

        // --- THE CRITICAL FIX ---
        // Once all decisions (Profile vs Login) are made, make the wrapper visible
        if (authWrapper) {
            authWrapper.style.visibility = 'visible';
        }
    });
    initLiveScores();
    initCustomCursor();
});

/**
 * Initializes the ChampZero Bespoke Gaming Cursor & Tactical Click Effects
 */
function initCustomCursor() {
    // Only inject for pointer/mouse devices (desktop/laptop)
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;

    // Inject stylesheet if not already present
    if (!document.getElementById('cz-custom-cursor-css')) {
        const link = document.createElement('link');
        link.id = 'cz-custom-cursor-css';
        link.rel = 'stylesheet';
        link.href = '/css/custom-cursor.css';
        document.head.appendChild(link);
    }

    // Tactical click pulse effect
    document.addEventListener('click', (e) => {
        const pulse = document.createElement('div');
        pulse.className = 'cz-click-pulse';
        pulse.style.left = `${e.clientX}px`;
        pulse.style.top = `${e.clientY}px`;
        document.body.appendChild(pulse);
        setTimeout(() => pulse.remove(), 400);
    });
}