import { auth, db } from './js/firebase-config.js';
    import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-auth.js";
    import { collection, getCountFromServer } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-firestore.js";

    // --- MAIN: Navbar Logic ---
    const mobileMenuButton = document.getElementById('mobile-menu-button');
    const mobileMenu = document.getElementById('mobile-menu');
    if (mobileMenuButton && mobileMenu) {
        mobileMenuButton.addEventListener('click', () => {
            mobileMenu.classList.toggle('hidden');
        });
    }

    onAuthStateChanged(auth, (user) => {
        const authControls = document.getElementById('auth-controls');
        if (authControls) {
            if (user) {
                const username = user.displayName || user.email.split('@')[0];
                authControls.innerHTML = `
                    <a href="profile.html" class="flex items-center gap-2 text-sm px-3 py-1.5 rounded-md hover:bg-white/10 text-gray-300 transition-colors">
                        <span>${username}</span>
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"></path></svg>
                    </a>`;
            } else {
                authControls.innerHTML = `
                    <a href="login.html" class="text-sm px-3 py-1.5 rounded-md hover:bg-white/10 text-gray-300 transition-colors">Log In</a>
                    <a href="signup.html" class="hidden sm:inline-block bg-gradient-to-r from-[var(--gold-darker)] to-[var(--gold)] text-black px-4 py-2 rounded-md text-sm font-bold hover:opacity-90 transition-opacity">Sign Up</a>`;
            }
        }
    });

    // --- HOME: Stats Logic ---
    function animateCountUp(element, finalValue, isCurrency = false) {
        let start = 0;
        const duration = 2000;
        const startTime = performance.now();
        function updateCount(currentTime) {
            const elapsedTime = currentTime - startTime;
            if (elapsedTime >= duration) {
                element.textContent = (isCurrency ? '₱' : '') + finalValue.toLocaleString();
                return;
            }
            const progress = elapsedTime / duration;
            const easeOut = 1 - Math.pow(1 - progress, 3);
            const currentVal = Math.floor(easeOut * finalValue);
            element.textContent = (isCurrency ? '₱' : '') + currentVal.toLocaleString();
            requestAnimationFrame(updateCount);
        }
        requestAnimationFrame(updateCount);
    }

    async function loadStatsBanner() {
        const stats = {
            talents: document.getElementById('stat-talents'),
            followers: document.getElementById('stat-followers'),
            prizes: document.getElementById('stat-prizes'),
            tournaments: document.getElementById('stat-tournaments'),
            players: document.getElementById('stat-players'),
        };
        if (!stats.talents) return;

        try {
            // Attempt to get real counts from Firestore
            const tournamentsSnap = await getCountFromServer(collection(db, "tournaments"));
            const playersSnap = await getCountFromServer(collection(db, "users"));
            // const talentsSnap = await getCountFromServer(collection(db, "rising_champs"));

            const tournamentCount = tournamentsSnap.data().count;
            const playerCount = playersSnap.data().count;
            
            // If DB is empty, use FALLBACK NUMBERS so users see animation
            if (tournamentCount === 0 && playerCount === 0) {
                console.log("DB Empty - Using Demo Stats");
                animateCountUp(stats.talents, 12);
                animateCountUp(stats.followers, 8500);
                animateCountUp(stats.prizes, 250000, true);
                animateCountUp(stats.tournaments, 5);
                animateCountUp(stats.players, 150);
            } else {
                const totalPrizes = tournamentCount * 10000; 
                const followers = 8500 + (tournamentCount * 150);
                animateCountUp(stats.talents, 5);
                animateCountUp(stats.followers, followers);
                animateCountUp(stats.prizes, totalPrizes, true);
                animateCountUp(stats.tournaments, tournamentCount);
                animateCountUp(stats.players, playerCount);
            }

        } catch (err) {
            console.error("Stats error (Using Fallback):", err);
            animateCountUp(stats.talents, 12);
            animateCountUp(stats.followers, 8500);
            animateCountUp(stats.prizes, 250000, true);
            animateCountUp(stats.tournaments, 5);
            animateCountUp(stats.players, 150);
        }
    }

    // Trigger animation when scrolled into view
    const observer = new IntersectionObserver(entries => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                if (entry.target.id === 'stats-section') {
                    loadStatsBanner();
                    observer.unobserve(entry.target);
                }
            }
        });
    }, { threshold: 0.1 });

    document.querySelectorAll('.fade-in-section').forEach(section => observer.observe(section));