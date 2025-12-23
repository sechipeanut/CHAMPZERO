import { auth } from './firebase-config.js';
import { signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-auth.js";

document.addEventListener('DOMContentLoaded', () => {
    
    // --- 1. MOBILE MENU LOGIC ---
    const menuBtn = document.getElementById('mobile-menu-button');
    const mobileMenu = document.getElementById('mobile-menu');

    if (menuBtn && mobileMenu) {
        // Toggle Menu
        menuBtn.addEventListener('click', () => {
            mobileMenu.classList.toggle('hidden');
        });

        // Close Menu when clicking ANY link inside it
        const mobileLinks = mobileMenu.querySelectorAll('a');
        mobileLinks.forEach(link => {
            link.addEventListener('click', () => {
                mobileMenu.classList.add('hidden');
            });
        });

        // Close Menu when clicking outside (Optional Polish)
        mobileMenu.addEventListener('click', (e) => {
            if (e.target === mobileMenu) {
                mobileMenu.classList.add('hidden');
            }
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
            // Check user role from Firestore
            let isAdmin = false;
            let userAvatar = null;
            let displayName = user.displayName || "Champion";
            try {
                const { doc, getDoc } = await import("https://www.gstatic.com/firebasejs/11.1.0/firebase-firestore.js");
                const { db } = await import('./firebase-config.js');
                const userDoc = await getDoc(doc(db, "users", user.uid));
                if (userDoc.exists()) {
                    const userData = userDoc.data();
                    isAdmin = userData.role === "admin";
                    userAvatar = userData.avatar || null;
                    displayName = userData.ign || userData.displayName || user.displayName || "Champion";
                }
            } catch (error) {
                console.error("Error checking admin status:", error);
            }

            // User is Logged In -> Show Profile Icon with Dropdown (Desktop Only)
            authControls.innerHTML = `
                <div class="relative profile-dropdown-container hidden md:block">
                    <button id="profile-dropdown-btn" class="flex items-center gap-2 hover:opacity-80 transition-opacity">
                        <div class="text-right">
                            <div class="text-xs text-gray-400">Welcome,</div>
                            <div class="text-sm font-bold text-[var(--gold)]">${displayName}</div>
                        </div>
                        <img src="${userAvatar || 'https://ui-avatars.com/api/?name=' + (user.email || 'U') + '&background=1A1A1F&color=FFD700'}" class="w-8 h-8 rounded-full border border-[var(--gold)] object-cover">
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
            
            // Update Mobile Menu to show "Profile" instead of Login
            if (mobileAuth) {
                mobileAuth.innerHTML = `
                    <div class="flex flex-col gap-4 w-full">
                        <a href="/profile" class="text-center text-[var(--gold)] font-bold">My Profile</a>
                        ${isAdmin ? `<a href="/admin" class="text-center text-blue-400 font-bold">Admin Panel</a>` : ''}
                        <button id="mobile-logout" class="text-center text-red-400 text-sm">Log Out</button>
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
                <a href="/login" class="text-sm px-3 py-1.5 rounded-md hover:bg-white/10 text-gray-300">Log In</a>
                <a href="/signup" class="hidden sm:inline-block bg-gradient-to-r from-[var(--gold-darker)] to-[var(--gold)] text-black px-4 py-2 rounded-md text-sm font-bold">Sign Up</a>
            `;
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
});