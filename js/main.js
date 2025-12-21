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
    onAuthStateChanged(auth, (user) => {
        const authControls = document.getElementById('auth-controls');
        // Mobile Auth Controls (inside the menu)
        const mobileAuth = document.querySelector('#mobile-menu .border-t'); 

        if (user && authControls) {
            // User is Logged In -> Show Profile Icon
            authControls.innerHTML = `
                <a href="/profile" class="flex items-center gap-2 hover:opacity-80 transition-opacity">
                    <div class="text-right hidden sm:block">
                        <div class="text-xs text-gray-400">Welcome,</div>
                        <div class="text-sm font-bold text-[var(--gold)]">${user.displayName || "Champion"}</div>
                    </div>
                    <img src="${user.photoURL || 'https://ui-avatars.com/api/?name=' + (user.email || 'U') + '&background=1A1A1F&color=FFD700'}" class="w-8 h-8 rounded-full border border-[var(--gold)]">
                </a>
            `;
            
            // Update Mobile Menu to show "Profile" instead of Login
            if (mobileAuth) {
                mobileAuth.innerHTML = `
                    <div class="flex flex-col gap-4 w-full">
                        <a href="/profile" class="text-center text-[var(--gold)] font-bold">My Profile</a>
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
    });
});