import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-auth.js";
import { doc, getDoc, updateDoc, addDoc, collection, getDocs, query, orderBy, limit, where, onSnapshot, deleteDoc, setDoc, serverTimestamp, increment, arrayUnion } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-firestore.js";

let activeUserUid = null;
let activeUserData = {};
let isCurrentProfilePublic = false;
let isCurrentProfileOrganizer = false;
let cachedTournamentsSnap = null;
let cachedAllTournaments = null;
let isOrganizerStatsLoaded = false;
let isRewardsDataLoaded = false;

window.hideProfileLoadingScreen = function () {
    const loader = qs('#profile-loading-screen');
    if (loader && !loader.classList.contains('opacity-0')) {
        loader.classList.add('opacity-0', 'pointer-events-none');
        setTimeout(() => {
            if (loader) loader.style.display = 'none';
        }, 350);
    }
};

// Emergency fallback: ensure loading screen is dismissed even if network stalls
setTimeout(() => {
    if (typeof window.hideProfileLoadingScreen === 'function') {
        window.hideProfileLoadingScreen();
    }
}, 3500);

function qs(sel) { return document.querySelector(sel); }

function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/[&<>"']/g, m => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    })[m]);
}

// Format date helper
function formatDate(dateString) {
    if (!dateString) return '--';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

// Immediate optimistic player render from auth state & cached profile data
function renderOptimisticHeader(user) {
    if (!user) return;
    const immediateName = user.displayName || user.ign || (user.email ? user.email.split('@')[0] : 'Champion');
    if (qs('#display-name-header')) qs('#display-name-header').textContent = immediateName;
    if (qs('#email-display')) qs('#email-display').textContent = user.email || '';
    if (qs('#account-email-display')) qs('#account-email-display').textContent = user.email || '--';
    if (qs('#ign-display')) qs('#ign-display').textContent = immediateName;
    
    const avatarUrl = user.avatar || user.photoURL || ('https://ui-avatars.com/api/?name=' + encodeURIComponent(immediateName) + '&background=111116&color=FFD700');
    if (qs('#profile-avatar')) qs('#profile-avatar').src = avatarUrl;

    // Load any saved profile cache for instant 0ms HUD rendering
    try {
        const rawCache = localStorage.getItem('cz_profile_cache');
        if (rawCache) {
            const cache = JSON.parse(rawCache);
            if (cache && (cache.uid === user.uid || !cache.uid)) {
                if (qs('#tournaments-count') && cache.playedCount !== undefined) qs('#tournaments-count').textContent = cache.playedCount;
                if (qs('#prizes-earned') && cache.prizesEarned) qs('#prizes-earned').textContent = cache.prizesEarned;
                if (qs('#podium-count') && cache.podiumCount !== undefined) qs('#podium-count').textContent = cache.podiumCount;
                if (qs('#win-rate') && cache.winRate !== undefined) qs('#win-rate').textContent = cache.winRate;
                if (qs('#friends-count') && cache.friendCount !== undefined) qs('#friends-count').textContent = cache.friendCount;
                if (qs('#friends-tab-count') && cache.friendCount !== undefined) qs('#friends-tab-count').textContent = cache.friendCount;
                if (qs('#rank-display') && cache.rank) qs('#rank-display').textContent = cache.rank;
                if (qs('#bio-display') && cache.bio) qs('#bio-display').textContent = cache.bio;
                if (qs('#val-id-display') && cache.valId) qs('#val-id-display').textContent = cache.valId;
                if (qs('#mlbb-id-display') && cache.mlbbId) qs('#mlbb-id-display').textContent = cache.mlbbId;
                if (qs('#hok-id-display') && cache.hokId) qs('#hok-id-display').textContent = cache.hokId;
                if (qs('#escrow-balance-display') && cache.escrowBalance) qs('#escrow-balance-display').textContent = cache.escrowBalance;
            }
        }
    } catch (e) {}
}

// 1. AUTH PROTECTION, PUBLIC PROFILE ROUTING & INITIAL LOAD
let isProfileInitialized = false;

window.copyCurrentProfileLink = function () {
    const target = activeUserUid || (auth.currentUser ? auth.currentUser.uid : '');
    if (!target) return;
    const url = `${window.location.origin}/profile.html?uid=${encodeURIComponent(target)}`;
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(() => {
            if (typeof window.showSuccessToast === 'function') {
                window.showSuccessToast("Profile Link Copied", "Share this link with teammates and organizers!");
            } else {
                alert("Profile link copied to clipboard!");
            }
        }).catch(() => {
            prompt("Copy profile link:", url);
        });
    } else {
        prompt("Copy profile link:", url);
    }
};

async function initProfileForUser(user) {
    const urlParams = new URLSearchParams(window.location.search);
    const requestedUid = urlParams.get('uid') || urlParams.get('id');

    // Case 1: Public profile requested by URL parameter
    if (requestedUid && (!user || user.uid !== requestedUid)) {
        if (isProfileInitialized && activeUserUid === requestedUid) {
            return;
        }
        isProfileInitialized = true;
        activeUserUid = requestedUid;
        isCurrentProfilePublic = true;
        isCurrentProfileOrganizer = false;

        // Automatically award scout quest if user is logged in and scouting a rival
        if (user && user.uid && user.uid !== requestedUid) {
            try {
                const todayStr = getPHTDate();
                const myRef = doc(db, "users", user.uid);
                const mySnap = await getDoc(myRef);
                if (mySnap.exists()) {
                    const myData = mySnap.data() || {};
                    if (myData.lastDailyScoutDate !== todayStr) {
                        await updateDoc(myRef, {
                            czPoints: increment(15),
                            lifetimePoints: increment(15),
                            lastDailyScoutDate: todayStr
                        });
                        if (typeof window.showSuccessToast === 'function') {
                            window.showSuccessToast("Daily Quest Completed! 🔍", "+15 CZ Points awarded for scouting rival champions!");
                        }
                    }
                }
            } catch (scoutErr) {
                console.warn("Could not process public scout quest:", scoutErr);
            }
        }

        await loadUserProfile(requestedUid, null, true);
        return;
    }

    // Case 2: Own profile view (Requires authentication)
    if (!user) {
        window.hideProfileLoadingScreen();
        if (typeof window.showWarningToast === 'function') {
            window.showWarningToast("Session Required", "Please log in to access your player dashboard.", 3000);
        }
        setTimeout(() => {
            window.location.href = "/login";
        }, 500);
        return;
    }

    if (isProfileInitialized && activeUserUid === user.uid) {
        window.hideProfileLoadingScreen();
        return;
    }
    isProfileInitialized = true;
    activeUserUid = user.uid;
    isCurrentProfilePublic = false;

    // Immediately paint optimistic user details
    renderOptimisticHeader(user);

    // Email verification check
    const isGoogleUser = user.providerData && user.providerData.some(p => p.providerId === 'google.com');
    if (!user.emailVerified && !isGoogleUser) {
        const verifyBanner = document.getElementById('email-verification-alert');
        if (verifyBanner) {
            verifyBanner.classList.remove('hidden');
        } else if (typeof window.showWarningToast === 'function') {
            window.showWarningToast("Verification Pending", "Please verify your email address to unlock full competitive tournament access.", 5000);
        }
    }
    
    // Load Profile Data from Firestore (Owner view)
    await loadUserProfile(user.uid, user.email, false);

    // Check for PayRex Cash-In Return Callbacks
    const cashinStatus = urlParams.get('cashin_status');
    const sessionId = urlParams.get('session_id');
    const amountVal = parseFloat(urlParams.get('amount')) || 0;

    if (cashinStatus === 'success' && sessionId) {
        window.switchProfileTab('organizer');
        
        try {
            // Check if this PayRex session has already been credited
            const existingSnap = await getDocs(query(collection(db, "cashins"), where("organizerId", "==", user.uid)));
            let isAlreadyCredited = false;
            let existingDocId = null;

            existingSnap.forEach(d => {
                const data = d.data();
                if (data.referenceNumber === sessionId) {
                    if (data.status === 'Approved') isAlreadyCredited = true;
                    else existingDocId = d.id;
                }
            });

            if (!isAlreadyCredited) {
                // Update organizer user document escrowBalance in Firestore
                const userRef = doc(db, "users", user.uid);
                await updateDoc(userRef, {
                    escrowBalance: increment(amountVal || 1000)
                });

                if (existingDocId) {
                    await updateDoc(doc(db, "cashins", existingDocId), {
                        status: 'Approved',
                        verifiedAt: new Date().toISOString()
                    });
                } else {
                    await addDoc(collection(db, "cashins"), {
                        organizerId: user.uid,
                        organizerEmail: user.email,
                        organizerName: user.displayName || 'Organizer',
                        amount: amountVal || 1000,
                        channel: 'PayRex Instant Gateway',
                        referenceNumber: sessionId,
                        notes: 'Automated instant payment via PayRex',
                        status: 'Approved',
                        createdAt: new Date().toISOString(),
                        verifiedAt: new Date().toISOString()
                    });
                }

                if (window.showSuccessToast) {
                    window.showSuccessToast('Prize Pool Funded', `Payment verified! ₱${amountVal ? amountVal.toLocaleString('en-US', { minimumFractionDigits: 2 }) : '1,000.00'} has been credited to your organizer balance via PayRex.`);
                }

                // Reload profile data with new balance
                await loadUserProfile(user.uid, user.email);
            }
        } catch (callErr) {
            console.error("Error processing PayRex return:", callErr);
        }

        // Clean query params
        window.history.replaceState({}, document.title, window.location.pathname);

    } else if (cashinStatus === 'cancelled') {
        window.switchProfileTab('organizer');
        if (window.showErrorToast) {
            window.showErrorToast('Cancelled', 'PayRex checkout session was cancelled.');
        }
        window.history.replaceState({}, document.title, window.location.pathname);
    }
}

// Attach Auth Listener
onAuthStateChanged(auth, (user) => {
    initProfileForUser(user);
});

// ==========================================
// 1. TAB NAVIGATION: PLAYER / FRIENDS / REWARDS / ORGANIZER
// ==========================================
const TAB_IDS = ['player', 'friends', 'rewards', 'organizer'];
const ACTIVE_BTN_CLASS = 'px-6 py-2.5 rounded-full bg-[#FFD700] hover:bg-[#FFE033] text-black font-heading font-extrabold text-xs uppercase tracking-wider transition-colors duration-150 cursor-pointer shadow-[0_0_20px_rgba(255,215,0,0.35)] flex items-center justify-center gap-2.5 select-none border border-[#FFD700] shrink-0';
const INACTIVE_BTN_CLASS = 'px-6 py-2.5 rounded-full bg-[#121116] hover:bg-[#1A1922] text-white border border-white/10 hover:border-white/20 font-heading font-extrabold text-xs uppercase tracking-wider transition-colors duration-150 cursor-pointer flex items-center justify-center gap-2.5 select-none shrink-0';

window.switchProfileTab = function (tab) {
    // If viewing another user's public profile, private tabs (rewards, organizer) are forbidden
    if (isCurrentProfilePublic && (tab === 'rewards' || tab === 'organizer')) {
        tab = 'player';
    }

    TAB_IDS.forEach(t => {
        const btn = qs(`#tab-btn-${t}`);
        const pane = qs(`#tab-pane-${t}`);

        // Check if tab is allowed for current profile view
        let isTabAllowed = true;
        if (t === 'rewards' && isCurrentProfilePublic) {
            isTabAllowed = false;
        } else if (t === 'organizer' && (!isCurrentProfileOrganizer || isCurrentProfilePublic)) {
            isTabAllowed = false;
        }

        if (!isTabAllowed) {
            if (btn) btn.classList.add('hidden');
            if (pane) pane.classList.add('hidden');
            return;
        }

        const isActive = (t === tab);

        if (btn) {
            btn.classList.remove('hidden');
            btn.className = isActive ? ACTIVE_BTN_CLASS : INACTIVE_BTN_CLASS;

            const icon = btn.querySelector('.tab-icon');
            if (icon) {
                icon.classList.remove('hidden');
                if (t === 'player') {
                    icon.setAttribute('class', `w-4 h-4 tab-icon shrink-0 ${isActive ? 'text-black' : 'text-neutral-300'}`);
                } else if (t === 'friends') {
                    icon.setAttribute('class', `w-4 h-4 tab-icon shrink-0 ${isActive ? 'text-black' : 'text-emerald-400'}`);
                } else if (t === 'rewards') {
                    icon.setAttribute('class', `w-4 h-4 tab-icon shrink-0 ${isActive ? 'text-black' : 'text-[#FFD700]'}`);
                } else if (t === 'organizer') {
                    icon.setAttribute('class', `w-4 h-4 tab-icon shrink-0 ${isActive ? 'text-black' : 'text-[#FFD700]'}`);
                }
            }

            if (t === 'friends') {
                const badge = qs('#friends-tab-count');
                if (badge) {
                    badge.classList.remove('hidden');
                    badge.className = isActive
                        ? 'text-[10px] bg-black/15 text-black px-1.5 py-0.5 rounded-full font-mono font-bold shrink-0'
                        : 'text-[10px] bg-neutral-800 text-neutral-300 px-1.5 py-0.5 rounded-full font-mono font-bold shrink-0';
                }
            }
        }

        if (pane) {
            if (isActive) pane.classList.remove('hidden');
            else pane.classList.add('hidden');
        }
    });

    // Lazy-load sub-data when tab is opened
    if (tab === 'friends' && activeUserUid) loadFriendsList(activeUserUid);
    if (tab === 'rewards' && !isCurrentProfilePublic && activeUserUid && !isRewardsDataLoaded) {
        loadRewardsData(activeUserData).then(() => { isRewardsDataLoaded = true; }).catch(console.warn);
    }
    if (tab === 'organizer' && isCurrentProfileOrganizer && !isOrganizerStatsLoaded) {
        calculateOrganizerStats(activeUserUid, auth.currentUser?.email, cachedAllTournaments || []).then(() => {
            isOrganizerStatsLoaded = true;
        }).catch(console.warn);
    }
};

// 2. FETCH & DISPLAY PROFILE DATA WITH TOURNAMENT TROPHIES & EARNINGS
async function loadUserProfile(uid, email, isPublicView = false) {
    try {
        const docRef = doc(db, "users", uid);
        const tourneyQuery = collection(db, "tournaments");

        // Concurrently start tournaments & friend count in background without blocking initial DOM paint
        const tourneyPromise = cachedTournamentsSnap
            ? Promise.resolve(cachedTournamentsSnap)
            : getDocs(tourneyQuery).catch(() => ({ forEach: () => {} }));
        const friendCountPromise = countFriends(uid).catch(() => 0);

        // Fetch user document (FAST single-doc lookup, ~100-150ms)
        const docSnap = await getDoc(docRef);

        let userData = {};
        if (docSnap.exists && docSnap.exists()) {
            userData = docSnap.data() || {};
        }

        const isMe = auth.currentUser && auth.currentUser.uid === uid;
        const actualIsPublic = isPublicView || !isMe;
        isCurrentProfilePublic = actualIsPublic;

        const userEmail = isMe ? (userData.email || email || (auth.currentUser ? auth.currentUser.email : '')) : '';
        const userIgn = userData.ign || userData.displayName || userData.username || (isMe && auth.currentUser ? (auth.currentUser.displayName || auth.currentUser.email?.split('@')[0]) : '') || 'Champion';
        
        // Display Name, Email & Avatar
        if (qs('#display-name-header')) qs('#display-name-header').textContent = userIgn;
        if (qs('#email-display')) {
            if (actualIsPublic) {
                qs('#email-display').textContent = userData.discord ? `Discord: @${userData.discord}` : `Competitive Gamer // ${userData.rank || 'Player'}`;
            } else {
                qs('#email-display').textContent = userEmail || '--';
            }
        }
        if (qs('#account-email-display')) {
            qs('#account-email-display').textContent = isMe ? (userEmail || '--') : 'Protected';
        }
        
        const avatarUrl = userData.avatar || (isMe && auth.currentUser ? auth.currentUser.photoURL : null) || ('https://ui-avatars.com/api/?name=' + encodeURIComponent(userIgn) + '&background=111116&color=FFD700');
        if (qs('#profile-avatar')) {
            qs('#profile-avatar').src = avatarUrl;
        }

        // Cache profile metadata immediately for instant 0ms HUD rendering on repeat visits
        if (!actualIsPublic) {
            try {
                const existingCache = JSON.parse(localStorage.getItem('cz_profile_cache') || '{}');
                localStorage.setItem('cz_profile_cache', JSON.stringify({
                    ...existingCache,
                    uid,
                    ign: userIgn,
                    email: userEmail,
                    avatar: avatarUrl,
                    rank: userData.rank || existingCache.rank || '',
                    bio: userData.bio || existingCache.bio || '',
                    valId: userData.valId || existingCache.valId || '',
                    mlbbId: userData.mlbbId || existingCache.mlbbId || '',
                    hokId: userData.hokId || existingCache.hokId || '',
                    role: userData.role || existingCache.role || '',
                    cachedAt: Date.now()
                }));
            } catch (e) {}
        }

        // Configure Public / Owner Action Buttons
        const editProfileBtn = qs('#btn-edit-profile');
        const publicActions = qs('#public-profile-actions');
        const shareProfileText = qs('#btn-share-profile-text');

        if (actualIsPublic) {
            if (editProfileBtn) editProfileBtn.classList.add('hidden');
            if (shareProfileText) shareProfileText.textContent = 'Copy Link';
            
            if (publicActions) {
                publicActions.classList.remove('hidden');
                if (auth.currentUser) {
                    const currentUid = auth.currentUser.uid;
                    const reqRef = collection(db, "friend_requests");
                    const [qA, qB] = await Promise.all([
                        getDocs(query(reqRef, where("fromUid", "==", currentUid), where("toUid", "==", uid))),
                        getDocs(query(reqRef, where("fromUid", "==", uid), where("toUid", "==", currentUid)))
                    ]);
                    
                    let friendStatus = 'none';
                    let friendDocId = null;
                    qA.forEach(d => {
                        const dat = d.data();
                        if (dat.status === 'accepted') friendStatus = 'friends';
                        else if (dat.status === 'pending') { friendStatus = 'outgoing_pending'; friendDocId = d.id; }
                    });
                    qB.forEach(d => {
                        const dat = d.data();
                        if (dat.status === 'accepted') friendStatus = 'friends';
                        else if (dat.status === 'pending') { friendStatus = 'incoming_pending'; friendDocId = d.id; }
                    });

                    if (friendStatus === 'friends') {
                        publicActions.innerHTML = `
                            <button type="button" onclick="if(window.czOpenDMWith){window.czOpenDMWith('${escapeHtml(uid)}', '${escapeHtml(userIgn)}', '${escapeHtml(avatarUrl)}');}else{if(window.showInfoToast)window.showInfoToast('Direct Messages', 'Open the chat drawer to message this player.');}"
                                class="inline-flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 text-white font-heading font-bold text-xs uppercase tracking-wider px-4 py-2.5 rounded-lg transition-all cursor-pointer shadow">
                                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"></path></svg>
                                <span>Message</span>
                            </button>
                        `;
                    } else if (friendStatus === 'incoming_pending') {
                        publicActions.innerHTML = `
                            <button type="button" onclick="if(window.czRespondFriendRequest){window.czRespondFriendRequest('${friendDocId}', 'accepted', '${escapeHtml(userIgn)}'); setTimeout(()=>location.reload(), 800);}"
                                class="inline-flex items-center gap-1.5 bg-[#FFD700] hover:bg-[#FFF099] text-black font-heading font-bold text-xs uppercase tracking-wider px-4 py-2.5 rounded-lg transition-all cursor-pointer shadow">
                                <span>Accept Friend</span>
                            </button>
                        `;
                    } else if (friendStatus === 'outgoing_pending') {
                        publicActions.innerHTML = `
                            <span class="px-3 py-2 rounded-lg bg-amber-500/15 text-amber-400 border border-amber-500/30 text-xs font-mono font-bold uppercase">
                                Request Sent
                            </span>
                        `;
                    } else {
                        publicActions.innerHTML = `
                            <button type="button" onclick="if(window.czSendFriendRequest){window.czSendFriendRequest('${escapeHtml(uid)}', '${escapeHtml(userIgn)}', '${escapeHtml(avatarUrl)}'); this.textContent='Request Sent'; this.disabled=true;}else{if(window.showInfoToast)window.showInfoToast('Friend Request', 'Initializing friend request engine...');}"
                                class="inline-flex items-center gap-1.5 bg-[#FFD700] hover:bg-[#FFF099] text-black font-heading font-bold text-xs uppercase tracking-wider px-4 py-2.5 rounded-lg transition-all cursor-pointer shadow">
                                <svg class="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20"><path d="M8 9a3 3 0 100-6 3 3 0 000 6zM8 11a6 6 0 016 6H2a6 6 0 016-6zM16 7a1 1 0 10-2 0v1h-1a1 1 0 100 2h1v1a1 1 0 102 0v-1h1a1 1 0 100-2h-1V7z"></path></svg>
                                <span>Add Friend</span>
                            </button>
                        `;
                    }
                } else {
                    publicActions.innerHTML = `
                        <a href="/login" class="inline-flex items-center gap-1.5 bg-[#FFD700] hover:bg-[#FFF099] text-black font-heading font-bold text-xs uppercase tracking-wider px-4 py-2.5 rounded-lg transition-all shadow">
                            <span>Log In to Connect</span>
                        </a>
                    `;
                }
            }

            // Public Dossier vs Account Owner Controls
            const publicBanner = qs('#public-profile-banner');
            const bannerUser = qs('#public-banner-username');
            const accountInfoSection = qs('#account-information-section');
            const publicCompetitorDossier = qs('#public-competitor-dossier');
            const withdrawalMethodsSection = qs('#withdrawal-methods-section');
            const supporterPerksSection = qs('#supporter-perks-section');
            const themeSwitcher = qs('#btn-theme-switcher');
            const rewardsTabBtn = qs('#tab-btn-rewards');
            const supporterHubCta = qs('#supporter-hub-cta');

            if (publicBanner) {
                publicBanner.classList.remove('hidden');
                if (bannerUser) bannerUser.textContent = userIgn;
            }
            if (accountInfoSection) accountInfoSection.classList.add('hidden');
            if (publicCompetitorDossier) {
                publicCompetitorDossier.classList.remove('hidden');
                if (qs('#public-ign-display')) qs('#public-ign-display').textContent = userIgn;
                if (qs('#public-discord-display')) qs('#public-discord-display').textContent = userData.discord ? `@${userData.discord}` : 'Not shared';
                if (qs('#public-joined-display')) qs('#public-joined-display').textContent = formatDate(userData.joinedAt || userData.createdAt) || 'Recent';
            }
            if (withdrawalMethodsSection) withdrawalMethodsSection.classList.add('hidden');
            if (supporterPerksSection) supporterPerksSection.classList.add('hidden');
            if (themeSwitcher) themeSwitcher.classList.add('hidden');
            if (rewardsTabBtn) rewardsTabBtn.classList.add('hidden');
            if (supporterHubCta) supporterHubCta.classList.add('hidden');
        } else {
            const publicBanner = qs('#public-profile-banner');
            const accountInfoSection = qs('#account-information-section');
            const publicCompetitorDossier = qs('#public-competitor-dossier');
            const withdrawalMethodsSection = qs('#withdrawal-methods-section');
            const supporterPerksSection = qs('#supporter-perks-section');

            if (publicBanner) publicBanner.classList.add('hidden');
            if (accountInfoSection) accountInfoSection.classList.remove('hidden');
            if (publicCompetitorDossier) publicCompetitorDossier.classList.add('hidden');
            if (withdrawalMethodsSection) withdrawalMethodsSection.classList.remove('hidden');
            if (supporterPerksSection) supporterPerksSection.classList.remove('hidden');
            if (editProfileBtn) editProfileBtn.classList.remove('hidden');
            if (publicActions) publicActions.classList.add('hidden');
            if (shareProfileText) shareProfileText.textContent = 'Share Profile';
            const rewardsTabBtn = qs('#tab-btn-rewards');
            if (rewardsTabBtn) rewardsTabBtn.classList.remove('hidden');
            const supporterHubCta = qs('#supporter-hub-cta');
            if (supporterHubCta) supporterHubCta.classList.remove('hidden');
        }

        // Role Badge
        const roleBadge = qs('#role-badge');
        const rawRole = String(userData.role || window.currentUserRole || '').toLowerCase();
        const isAdmin = (rawRole === 'admin' || rawRole === 'superadmin' || rawRole === 'administrator' || userEmail === 'admin@champzero.com' || (auth.currentUser && auth.currentUser.email === 'admin@champzero.com'));
        const isOrganizer = (rawRole === 'organizer' || rawRole === 'host');
        const isModerator = (rawRole === 'moderator' || rawRole === 'mod');
        const isSubscriber = (rawRole === 'subscriber' || rawRole === 'pro');

        if (roleBadge) {
            if (isAdmin) {
                roleBadge.textContent = 'ADMIN';
                roleBadge.className = 'inline-flex items-center px-2.5 py-0.5 rounded-full bg-red-500/15 text-red-400 text-[10px] font-mono-tag font-bold border border-red-500/30 uppercase';
            } else if (isOrganizer) {
                roleBadge.textContent = 'ORGANIZER';
                roleBadge.className = 'inline-flex items-center px-2.5 py-0.5 rounded-full bg-purple-500/15 text-purple-400 text-[10px] font-mono-tag font-bold border border-purple-500/30 uppercase';
            } else if (isModerator) {
                roleBadge.textContent = 'MODERATOR';
                roleBadge.className = 'inline-flex items-center px-2.5 py-0.5 rounded-full bg-cyan-500/15 text-cyan-400 text-[10px] font-mono-tag font-bold border border-cyan-500/30 uppercase';
            } else if (isSubscriber) {
                roleBadge.textContent = 'PRO';
                roleBadge.className = 'inline-flex items-center px-2.5 py-0.5 rounded-full bg-amber-500/15 text-amber-300 text-[10px] font-mono-tag font-bold border border-amber-500/30 uppercase';
            } else {
                roleBadge.textContent = 'MEMBER';
                roleBadge.className = 'inline-flex items-center px-2.5 py-0.5 rounded-full bg-[var(--gold)]/10 text-[var(--gold)] text-[10px] font-mono-tag font-bold border border-[var(--gold)]/20 uppercase';
            }
        }

        // Verified Player Badge Logic
        const isTargetGoogle = userData.providerData?.some?.(p => p.providerId === 'google.com') || (userData.provider === 'google.com');
        const isUserVerified = actualIsPublic ? Boolean(userData.emailVerified === true || isTargetGoogle) : Boolean(auth.currentUser?.emailVerified || isTargetGoogle || userData.emailVerified === true);
        const verifiedBadgeEl = qs('#verified-badge');
        const verifiedBadgeText = qs('#verified-badge-text');
        const verifiedInlineCheck = qs('#verified-inline-check');

        if (verifiedBadgeEl) {
            verifiedBadgeEl.classList.remove('hidden');
            if (isUserVerified) {
                if (verifiedBadgeText) verifiedBadgeText.textContent = 'VERIFIED';
                verifiedBadgeEl.className = 'inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 text-[10px] font-mono-tag font-bold border border-emerald-500/30 shadow-[0_0_10px_rgba(52,211,153,0.15)] uppercase';
                verifiedBadgeEl.title = 'Verified Email & Competitive Player';
                verifiedBadgeEl.onclick = null;
                if (verifiedInlineCheck) verifiedInlineCheck.classList.remove('hidden');
            } else {
                if (verifiedBadgeText) verifiedBadgeText.textContent = 'UNVERIFIED';
                verifiedBadgeEl.className = 'inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-amber-500/15 text-amber-400 text-[10px] font-mono-tag font-bold border border-amber-500/30 hover:bg-amber-500/25 cursor-pointer uppercase transition-colors';
                verifiedBadgeEl.title = 'Email not verified.';
                if (!actualIsPublic && verifiedBadgeEl) {
                    verifiedBadgeEl.onclick = async () => {
                        if (window.checkEmailVerification) {
                            await window.checkEmailVerification("verify your competitive account");
                        }
                    };
                }
                if (verifiedInlineCheck) verifiedInlineCheck.classList.add('hidden');
            }
        }

        // Supporter Status & Badge Logic (With 30-day Active Duration Verification)
        const now = Date.now();
        const hasSupporterFlag = Boolean(userData.isSupporter || userData.supporterTier || userData.supporterBadge);
        const isExpired = Boolean(hasSupporterFlag && userData.supporterExpiresAt && userData.supporterExpiresAt <= now);
        const isSupporter = Boolean(hasSupporterFlag && (!userData.supporterExpiresAt || userData.supporterExpiresAt > now));
        const supporterTier = String(userData.supporterTier || 'bronze').toLowerCase();
        
        let daysLeftStr = '';
        if (isSupporter && userData.supporterExpiresAt) {
            const days = Math.ceil((userData.supporterExpiresAt - now) / (1000 * 60 * 60 * 24));
            if (days > 0) {
                daysLeftStr = ` • ${days}d left`;
            }
        }

        const supporterBadgeEl = qs('#supporter-badge');
        const supporterBadgeIcon = qs('#supporter-badge-icon');
        const supporterBadgeText = qs('#supporter-badge-text');
        const avatarImg = qs('#profile-avatar');

        if (supporterBadgeEl) {
            if (isSupporter) {
                supporterBadgeEl.classList.remove('hidden');
                if (supporterTier === 'gold') {
                    if (supporterBadgeIcon) supporterBadgeIcon.textContent = '';
                    if (supporterBadgeText) supporterBadgeText.textContent = 'GOLD PATRON';
                    supporterBadgeEl.className = 'inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-gradient-to-r from-[#FFD700]/25 to-amber-500/25 text-[#FFD700] text-xs font-bold border border-[#FFD700]/50 shadow-[0_0_12px_rgba(255,215,0,0.25)]';
                    if (avatarImg) {
                        avatarImg.classList.add('border-2', 'border-[#FFD700]', 'shadow-[0_0_20px_rgba(255,215,0,0.3)]');
                    }
                } else if (supporterTier === 'silver') {
                    if (supporterBadgeIcon) supporterBadgeIcon.textContent = '';
                    if (supporterBadgeText) supporterBadgeText.textContent = 'SILVER ELITE';
                    supporterBadgeEl.className = 'inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-400/20 text-slate-200 text-xs font-bold border border-slate-300/40 shadow-[0_0_8px_rgba(255,255,255,0.15)]';
                    if (avatarImg) {
                        avatarImg.classList.add('border-2', 'border-slate-300', 'shadow-[0_0_15px_rgba(255,255,255,0.2)]');
                    }
                } else {
                    if (supporterBadgeIcon) supporterBadgeIcon.textContent = '';
                    if (supporterBadgeText) supporterBadgeText.textContent = 'BRONZE SCOUT';
                    supporterBadgeEl.className = 'inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-700/20 text-amber-400 text-xs font-bold border border-amber-600/40';
                }
            } else {
                supporterBadgeEl.classList.add('hidden');
                if (avatarImg) {
                    avatarImg.classList.remove('border-2', 'border-[#FFD700]', 'border-slate-300', 'shadow-[0_0_20px_rgba(255,215,0,0.3)]', 'shadow-[0_0_15px_rgba(255,255,255,0.2)]');
                }
            }
        }

        // Equipped Player Title Flair Badge
        const titleBadgeEl = qs('#player-title-badge');
        const titleTextEl = qs('#player-title-text');
        if (titleBadgeEl) {
            if (userData.playerTitle) {
                titleBadgeEl.classList.remove('hidden');
                if (titleTextEl) titleTextEl.textContent = userData.playerTitle;
            } else {
                titleBadgeEl.classList.add('hidden');
            }
        }

        // Profile HUD Theme (Cyberpunk vs Default)
        const themeSwitcherBtn = qs('#btn-theme-switcher');
        const themeLabel = qs('#current-theme-label');
        const hasCyberpunk = (userData.profileTheme === 'cyberpunk') || (Array.isArray(userData.unlockedThemes) && userData.unlockedThemes.includes('cyberpunk'));

        if (hasCyberpunk) {
            if (themeSwitcherBtn) themeSwitcherBtn.classList.remove('hidden');
            const isCyberActive = (userData.profileTheme === 'cyberpunk');
            document.body.classList.toggle('theme-cyberpunk', isCyberActive);
            if (themeLabel) themeLabel.textContent = isCyberActive ? 'Cyberpunk' : 'Default Dark';
        } else {
            document.body.classList.remove('theme-cyberpunk');
            if (themeSwitcherBtn) themeSwitcherBtn.classList.add('hidden');
        }

        // Supporter Card in Profile Tab
        const supporterCardTitle = qs('#supporter-card-tier-title');
        const supporterCardStatus = qs('#supporter-card-status-pill');
        const supporterCardDesc = qs('#supporter-card-desc');
        const supporterCtaText = qs('#supporter-hub-cta-text');

        if (isSupporter) {
            if (supporterTier === 'gold') {
                if (supporterCardTitle) supporterCardTitle.textContent = 'Grand Champion Gold Patron';
                if (supporterCardStatus) {
                    supporterCardStatus.textContent = `Active Patron (Max Tier)${daysLeftStr}`;
                    supporterCardStatus.className = 'font-mono-tag text-[9px] font-bold uppercase px-2 py-0.5 rounded bg-[#FFD700]/20 text-[#FFD700] border border-[#FFD700]/40';
                }
                if (supporterCardDesc) {
                    const dateStr = userData.supporterSince ? new Date(userData.supporterSince).toLocaleDateString([], { month: 'short', year: 'numeric' }) : '2026';
                    supporterCardDesc.textContent = `Highest Tier Patron since ${dateStr}. Thank you for powering our grassroots tournaments and livestream broadcast labs!`;
                }
                if (supporterCtaText) supporterCtaText.textContent = 'Renew / Extend ↗';
            } else if (supporterTier === 'silver') {
                if (supporterCardTitle) supporterCardTitle.textContent = 'Arena Elite Supporter';
                if (supporterCardStatus) {
                    supporterCardStatus.textContent = `Active Backer${daysLeftStr}`;
                    supporterCardStatus.className = 'font-mono-tag text-[9px] font-bold uppercase px-2 py-0.5 rounded bg-slate-400/20 text-slate-200 border border-slate-300/40';
                }
                if (supporterCardDesc) {
                    supporterCardDesc.textContent = 'Active Silver Elite supporter. Upgrade your badge to Gold Patron to unlock full gold radiance and top Wall of Fame VIP billing!';
                }
                if (supporterCtaText) supporterCtaText.textContent = 'Upgrade to Gold ↗';
            } else {
                if (supporterCardTitle) supporterCardTitle.textContent = 'Champion Bronze Scout';
                if (supporterCardStatus) {
                    supporterCardStatus.textContent = `Active Backer${daysLeftStr}`;
                    supporterCardStatus.className = 'font-mono-tag text-[9px] font-bold uppercase px-2 py-0.5 rounded bg-amber-700/20 text-amber-400 border border-amber-600/40';
                }
                if (supporterCardDesc) {
                    supporterCardDesc.textContent = 'Active Bronze Scout backer. Upgrade your badge to Silver Elite or Gold Patron to unlock glowing golden profile cards and animated VIP chat flairs!';
                }
                if (supporterCtaText) supporterCtaText.textContent = 'Upgrade Badge ↗';
            }
        } else if (isExpired) {
            if (supporterCardTitle) supporterCardTitle.textContent = 'Supporter Badge Expired';
            if (supporterCardStatus) {
                supporterCardStatus.textContent = 'Expired';
                supporterCardStatus.className = 'font-mono-tag text-[9px] font-bold uppercase px-2 py-0.5 rounded bg-red-500/20 text-red-400 border border-red-500/40';
            }
            if (supporterCardDesc) {
                supporterCardDesc.textContent = 'Your supporter membership duration has ended. Re-activate or upgrade your badge to restore your VIP chat flair, golden border, and live Wall of Fame listing.';
            }
            if (supporterCtaText) supporterCtaText.textContent = 'Renew Badge ↗';
        } else {
            if (supporterCardTitle) supporterCardTitle.textContent = 'Join the Supporter Club';
            if (supporterCardStatus) {
                supporterCardStatus.textContent = 'Free Member';
                supporterCardStatus.className = 'font-mono-tag text-[9px] font-bold uppercase px-2 py-0.5 rounded bg-white/5 text-neutral-400 border border-white/10';
            }
            if (supporterCardDesc) {
                supporterCardDesc.textContent = 'Support grassroots tournament prize pools, broadcast production, and unlock verified supporter badges, golden profile borders, and VIP chat flairs.';
            }
            if (supporterCtaText) supporterCtaText.textContent = 'Support Club ↗';
        }

        // Rank Display
        const overallRank = userData.rank || userData.userRank || userData.valRank || userData.mlbbRank || userData.hokRank || 'Unranked';
        if (qs('#rank-display')) qs('#rank-display').textContent = overallRank;

        // Bio
        if (qs('#bio-display')) qs('#bio-display').textContent = userData.bio || 'No bio provided yet. Click Edit Profile to add your bio.';

        // Game IDs & Contacts
        if (qs('#ign-display')) qs('#ign-display').textContent = userData.ign || userData.displayName || userIgn;
        if (qs('#discord-display')) qs('#discord-display').textContent = userData.discord || userData.discordTag || 'Not set';
        if (qs('#real-name-display')) qs('#real-name-display').textContent = userData.realName || userData.fullName || '--';
        
        // Valorant
        if (qs('#val-id-display')) qs('#val-id-display').textContent = userData.valId || userData.valorantId || 'Not set';
        if (qs('#val-rank-display')) qs('#val-rank-display').textContent = userData.valRank || userData.valorantRank || '--';
        if (qs('#val-role-display')) qs('#val-role-display').textContent = userData.valRole || userData.valorantRole || '--';
        
        // Mobile Legends
        if (qs('#mlbb-id-display')) qs('#mlbb-id-display').textContent = userData.mlbbId || userData.mobileLegendsId || 'Not set';
        if (qs('#mlbb-rank-display')) qs('#mlbb-rank-display').textContent = userData.mlbbRank || userData.mobileLegendsRank || '--';
        if (qs('#mlbb-role-display')) qs('#mlbb-role-display').textContent = userData.mlbbRole || userData.mobileLegendsRole || '--';
        
        // Honor of Kings
        if (qs('#hok-id-display')) qs('#hok-id-display').textContent = userData.hokId || userData.honorOfKingsId || 'Not set';
        if (qs('#hok-rank-display')) qs('#hok-rank-display').textContent = userData.hokRank || userData.honorOfKingsRank || '--';
        if (qs('#hok-role-display')) qs('#hok-role-display').textContent = userData.hokRole || userData.honorOfKingsRole || '--';

        // Dates
        if (qs('#joined-display')) qs('#joined-display').textContent = formatDate(userData.joinedAt || userData.createdAt);
        if (qs('#updated-display')) qs('#updated-display').textContent = formatDate(userData.updatedAt) || 'Never';

        activeUserUid = uid;
        activeUserData = userData;

        // 3. RENDER SAVED WITHDRAWAL / PAYOUT METHOD (Account Owner Only)
        if (!actualIsPublic) {
            try {
                if (typeof renderWithdrawalMethodDisplay === 'function') {
                    renderWithdrawalMethodDisplay(userData.payoutMethod);
                }
            } catch (e) {
                console.warn("Error rendering withdrawal preview:", e);
            }
        }

        // 4. TAB ROUTING & ORGANIZER TAB VISIBILITY
        const showOrganizerTab = isOrganizer && !actualIsPublic;
        isCurrentProfileOrganizer = showOrganizerTab;
        const tabOrganizerBtn = qs('#tab-btn-organizer');
        if (showOrganizerTab) {
            if (tabOrganizerBtn) {
                tabOrganizerBtn.classList.remove('hidden');
                const titleSpan = qs('#tab-organizer-title');
                if (titleSpan) titleSpan.textContent = 'Organizer Command';
            }
        } else {
            if (tabOrganizerBtn) tabOrganizerBtn.classList.add('hidden');
            const paneOrg = qs('#tab-pane-organizer');
            if (paneOrg) paneOrg.classList.add('hidden');
        }

        // 5. REWARDS TAB VISIBILITY
        const rewardsTabBtn = qs('#tab-btn-rewards');
        const rewardsTabPane = qs('#tab-pane-rewards');
        if (!actualIsPublic) {
            if (rewardsTabBtn) rewardsTabBtn.classList.remove('hidden');
        } else {
            if (rewardsTabBtn) rewardsTabBtn.classList.add('hidden');
            if (rewardsTabPane) rewardsTabPane.classList.add('hidden');
        }

        // 6. INITIAL TAB ACTIVATION (Instantaneous switch!)
        let initialTab = new URLSearchParams(window.location.search).get('tab') || 'player';
        if (actualIsPublic && (initialTab === 'rewards' || initialTab === 'organizer')) {
            initialTab = 'player';
        } else if (initialTab === 'organizer' && !showOrganizerTab) {
            initialTab = 'player';
        } else if (!TAB_IDS.includes(initialTab)) {
            initialTab = 'player';
        }
        window.switchProfileTab(initialTab);

        // 7. PROGRESSIVE HYDRATION IN BACKGROUND (Non-blocking: renders stats & honors as they arrive)
        Promise.all([tourneyPromise, friendCountPromise]).then(async ([tourneySnap, friendCount]) => {
            cachedTournamentsSnap = tourneySnap;
            const allTourneys = [];
            if (tourneySnap && typeof tourneySnap.forEach === 'function') {
                tourneySnap.forEach(d => allTourneys.push({ id: d.id, ...d.data() }));
            }
            cachedAllTournaments = allTourneys;
            await calculateTournamentStats(uid, userIgn, allTourneys, friendCount);

            // Lazy-load organizer stats if landing directly on organizer tab
            if (showOrganizerTab && initialTab === 'organizer' && !isOrganizerStatsLoaded) {
                await calculateOrganizerStats(uid, userEmail, allTourneys);
                isOrganizerStatsLoaded = true;
            }
        }).catch(err => {
            console.warn("Background tournament hydration error:", err);
        });

        // Lazy-load rewards data only if landing directly on rewards tab
        if (!actualIsPublic && initialTab === 'rewards' && !isRewardsDataLoaded) {
            loadRewardsData(userData).then(() => { isRewardsDataLoaded = true; }).catch(console.warn);
        }

    } catch (error) {
        console.error("Error fetching profile:", error);
        if (window.showErrorToast) {
            window.showErrorToast("Error", "Failed to load profile data", 3000);
        }
    } finally {
        window.hideProfileLoadingScreen();
    }
}

async function calculateTournamentStats(uid, userIgn, allTourneys, friendCountVal = 0) {
    try {
        let playedCount = 0;
        let totalEarnings = 0;
        let champCount = 0;
        let secondCount = 0;
        let thirdCount = 0;
        let matchesWon = 0;
        let matchesTotal = 0;

        const historyItems = [];
        const normIgn = (userIgn || '').trim().toLowerCase();

        allTourneys.forEach(t => {
            const participants = t.participants || [];
            
            // Check if user participated
            const myTeam = participants.find(p => {
                if (p.registeredBy === uid) return true;
                const pName = (typeof p === 'object' ? (p.name || p.teamName) : p).toLowerCase();
                const pCaptain = (p.captain || '').toLowerCase();
                const pMembers = (p.members || []).map(m => (typeof m === 'object' ? (m.ign || m.name) : m).toLowerCase());
                if (normIgn && (pName === normIgn || pCaptain === normIgn || pMembers.includes(normIgn))) return true;
                return false;
            });

            if (!myTeam) return;

            playedCount++;
            const myTeamName = (typeof myTeam === 'object' ? (myTeam.name || myTeam.teamName) : myTeam) || 'My Squad';

            // Match win/loss calculation
            const matches = t.matches || [];
            matches.forEach(m => {
                const t1 = (m.team1 || '').toLowerCase();
                const t2 = (m.team2 || '').toLowerCase();
                const normMyTeam = myTeamName.toLowerCase();
                if (t1 === normMyTeam || t2 === normMyTeam) {
                    if (m.winner) {
                        matchesTotal++;
                        if (m.winner.toLowerCase() === normMyTeam) matchesWon++;
                    }
                }
            });

            // Placements and prize split calculations
            const isCompleted = t.status === 'Completed';
            const totalPrize = parseFloat(t.prize) || 0;
            const split = t.prizeSplit || { first: 100, second: 0, third: 0 };
            const p1 = (split.first !== undefined ? Number(split.first) : 100) / 100;
            const p2 = (split.second !== undefined ? Number(split.second) : 0) / 100;
            const p3 = (split.third !== undefined ? Number(split.third) : 0) / 100;

            let placement = 'Participant';
            let placementBadge = '<span class="px-2 py-0.5 rounded text-[9px] font-bold uppercase bg-white/5 text-neutral-400 border border-white/10">Participant</span>';
            let earnedInThis = 0;

            if (isCompleted) {
                const grandFinalMatch = matches.find(m => m.id === 'GF-1' || (!m.nextMatchId && !m.isBronzeMatch && m.id !== 'M-3RD'));
                const bronzeMatch = matches.find(m => m.id === 'M-3RD' || m.isBronzeMatch);

                const champName = t.winner || (grandFinalMatch ? grandFinalMatch.winner : null);
                const runnerUpName = grandFinalMatch ? (grandFinalMatch.winner === grandFinalMatch.team1 ? grandFinalMatch.team2 : grandFinalMatch.team1) : null;
                const thirdName = bronzeMatch ? bronzeMatch.winner : null;

                const normMy = myTeamName.toLowerCase();

                if (champName && champName.toLowerCase() === normMy) {
                    champCount++;
                    earnedInThis = totalPrize * p1;
                    placement = '1st Place Champion';
                    placementBadge = '<span class="px-2 py-0.5 rounded text-[9px] font-black uppercase bg-[#FFD700]/20 text-[#FFD700] border border-[#FFD700]/40">Rank 1 Champion</span>';
                } else if (runnerUpName && runnerUpName.toLowerCase() === normMy) {
                    secondCount++;
                    earnedInThis = totalPrize * p2;
                    placement = '2nd Place Runner-Up';
                    placementBadge = '<span class="px-2 py-0.5 rounded text-[9px] font-black uppercase bg-slate-300/20 text-slate-200 border border-slate-300/40">Rank 2 Runner-Up</span>';
                } else if (thirdName && thirdName.toLowerCase() === normMy) {
                    thirdCount++;
                    earnedInThis = totalPrize * p3;
                    placement = '3rd Place Bronze';
                    placementBadge = '<span class="px-2 py-0.5 rounded text-[9px] font-black uppercase bg-amber-600/20 text-amber-400 border border-amber-600/40">Rank 3 Bronze</span>';
                }

                totalEarnings += earnedInThis;
            }

            historyItems.push({
                tournamentName: t.name || 'Tournament',
                game: t.game || 'Esports',
                format: t.format || 'Single Elimination',
                myTeam: myTeamName,
                placement,
                placementBadge,
                earnedInThis,
                dateStr: t.date || 'TBD',
                status: t.status || (t.isStarted ? 'Ongoing' : 'Upcoming')
            });
        });

        const prizesEarnedStr = `₱${totalEarnings.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        const podiumCount = (champCount + secondCount + thirdCount);
        const winRate = matchesTotal > 0 ? Math.round((matchesWon / matchesTotal) * 100) : null;
        const winRateStr = winRate !== null ? `${winRate}%` : '--';

        // Update DOM Stats
        if (qs('#tournaments-count')) qs('#tournaments-count').textContent = playedCount;
        if (qs('#prizes-earned')) qs('#prizes-earned').textContent = prizesEarnedStr;
        if (qs('#podium-count')) qs('#podium-count').textContent = podiumCount;
        if (qs('#win-rate')) qs('#win-rate').textContent = winRateStr;

        // Update Trophy Cabinet Counters
        if (qs('#championships-count')) qs('#championships-count').textContent = champCount;
        if (qs('#second-place-count')) qs('#second-place-count').textContent = secondCount;
        if (qs('#third-place-count')) qs('#third-place-count').textContent = thirdCount;

        // Friend Count
        const finalFriendCount = typeof friendCountVal === 'number' ? friendCountVal : 0;
        if (qs('#friends-count')) qs('#friends-count').textContent = finalFriendCount;
        if (qs('#friends-tab-count')) qs('#friends-tab-count').textContent = finalFriendCount;

        // Cache the calculated stats for instant future visits
        try {
            const existingCache = JSON.parse(localStorage.getItem('cz_profile_cache') || '{}');
            const updatedCache = {
                ...existingCache,
                uid,
                playedCount,
                prizesEarned: prizesEarnedStr,
                podiumCount,
                winRate: winRateStr,
                friendCount: finalFriendCount,
                cachedAt: Date.now()
            };
            localStorage.setItem('cz_profile_cache', JSON.stringify(updatedCache));
        } catch (e) {}

        // Render Tournament History List
        const historyListEl = qs('#tournament-history-list');
        if (historyListEl) {
            if (historyItems.length === 0) {
                historyListEl.innerHTML = `<div class="text-center py-6 text-neutral-500 text-xs italic">No tournament participation history recorded yet. Join upcoming tournaments to build your career!</div>`;
            } else {
                historyListEl.innerHTML = historyItems.map(item => `
                    <div class="p-3.5 bg-black/40 border border-white/5 hover:border-white/20 rounded-xl flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 transition-colors">
                        <div>
                            <div class="flex items-center gap-2 flex-wrap mb-1">
                                <h4 class="font-heading font-black text-white text-xs uppercase">${escapeHtml(item.tournamentName)}</h4>
                                <span class="text-[9px] text-[var(--gold)] bg-[var(--gold)]/10 px-2 py-0.5 rounded font-mono">${escapeHtml(item.game)}</span>
                            </div>
                            <div class="text-[11px] text-neutral-400 flex items-center gap-3 flex-wrap">
                                <span>Squad: <strong class="text-white">${escapeHtml(item.myTeam)}</strong></span>
                                <span>•</span>
                                <span>Date: ${escapeHtml(item.dateStr)}</span>
                            </div>
                        </div>
                        <div class="flex items-center gap-3 shrink-0 self-end sm:self-center">
                            ${item.placementBadge}
                            ${item.earnedInThis > 0 ? `
                                <span class="text-xs font-bold font-heading text-[#FFD700]">+₱${item.earnedInThis.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                            ` : ''}
                        </div>
                    </div>
                `).join('');
            }
        }

    } catch (e) {
        console.warn("Error calculating tournament stats:", e);
    }
}

async function calculateOrganizerStats(uid, email, allTourneys) {
    const orgDashboard = qs('#organizer-dashboard-section');
    if (!orgDashboard) return;

    if ((!allTourneys || allTourneys.length === 0) && cachedAllTournaments) {
        allTourneys = cachedAllTournaments;
    } else if (!allTourneys || allTourneys.length === 0) {
        try {
            const snap = cachedTournamentsSnap || await getDocs(collection(db, "tournaments"));
            cachedTournamentsSnap = snap;
            allTourneys = [];
            snap.forEach(d => allTourneys.push({ id: d.id, ...d.data() }));
            cachedAllTournaments = allTourneys;
        } catch (e) {
            allTourneys = [];
        }
    }

    // Header labels strictly for Organizer Command
    const badgeLabel = qs('#org-badge-label');
    const titleLabel = qs('#org-title-label');
    const tableTitle = qs('#org-table-title');

    if (badgeLabel) badgeLabel.textContent = 'ORGANIZER COMMAND';
    if (titleLabel) titleLabel.textContent = 'Host Operations & Financials';
    if (tableTitle) tableTitle.textContent = 'Your Hosted Tournaments';

    let hostedCount = 0;
    let totalParticipants = 0;
    let grossCollected = 0;
    let totalPlatformFee = 0;
    let totalPrizePoolsCommitted = 0;
    const hostedItems = [];

    allTourneys.forEach(t => {
        // Organizers only see tournaments hosted/created by themselves
        const isHostedByMe = (t.createdBy === uid || t.creatorId === uid || t.organizerId === uid || (email && t.creatorEmail === email));
        if (!isHostedByMe) return;

        hostedCount++;
        const parts = t.participants || [];
        const partCount = parts.length;
        totalParticipants += partCount;

        const entryFee = parseFloat(t.entryFee) || 0;
        const tournamentPrize = parseFloat(t.prize) || 0;
        totalPrizePoolsCommitted += tournamentPrize;

        const pType = t.paymentType || (t.entryType === 'Paid' ? 'manual' : (t.entryType ? String(t.entryType).toLowerCase() : 'free'));
        const isAuto = pType === 'automatic';
        const isPaid = (pType === 'manual' || isAuto || t.entryType === 'Paid') && entryFee > 0;
        
        // Gross fees collected from registered participants (5% fee on automated, 0% on manual)
        const tournamentGross = isPaid ? (partCount * entryFee) : 0;
        const platformFee = isAuto ? (tournamentGross * 0.05) : 0;
        const netRegFunds = tournamentGross - platformFee;
        const netStandingTourney = netRegFunds - tournamentPrize;

        grossCollected += tournamentGross;
        totalPlatformFee += platformFee;

        hostedItems.push({
            id: t.id,
            name: t.name || 'Tournament',
            paymentType: pType,
            game: t.game || 'Esports',
            format: t.format || 'Single Elimination',
            date: t.date || 'TBD',
            partCount,
            maxTeams: t.maxTeams || 16,
            entryFee,
            tournamentPrize,
            tournamentGross,
            platformFee,
            netRegFunds,
            netStandingTourney,
            status: t.status || (t.isCancelled ? 'Cancelled' : (t.isStarted ? 'Ongoing' : 'Upcoming'))
        });
    });

    const totalNetRegFunds = grossCollected - totalPlatformFee;
    const rawNetStanding = totalNetRegFunds - totalPrizePoolsCommitted;

    // Update Organizer/Admin KPI DOM
    if (qs('#org-tournaments-count')) qs('#org-tournaments-count').textContent = hostedCount;
    if (qs('#org-participants-count')) qs('#org-participants-count').textContent = totalParticipants;
    if (qs('#org-gross-collected')) qs('#org-gross-collected').textContent = `₱${grossCollected.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    if (qs('#org-platform-fee')) qs('#org-platform-fee').textContent = `-₱${totalPlatformFee.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    if (qs('#org-prizepools-committed')) qs('#org-prizepools-committed').textContent = `₱${totalPrizePoolsCommitted.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    if (qs('#org-hosted-count-label')) qs('#org-hosted-count-label').textContent = `${hostedCount} Events`;

    // Render Hosted Tournaments List
    const hostedListEl = qs('#org-hosted-tournaments-list');
    if (hostedListEl) {
        if (hostedItems.length === 0) {
            hostedListEl.innerHTML = `<div class="text-center py-6 text-neutral-500 text-xs italic">No tournaments hosted yet. Browse the Tournaments page to create an event.</div>`;
        } else {
            hostedListEl.innerHTML = hostedItems.map(item => {
                let statusBadge = '<span class="px-2 py-0.5 rounded text-[9px] font-bold uppercase bg-amber-500/15 text-amber-400 border border-amber-500/30">Upcoming</span>';
                if (item.status === 'Ongoing') statusBadge = '<span class="px-2 py-0.5 rounded text-[9px] font-bold uppercase bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">Live</span>';
                if (item.status === 'Completed') statusBadge = '<span class="px-2 py-0.5 rounded text-[9px] font-bold uppercase bg-neutral-500/20 text-neutral-300 border border-neutral-500/30">Completed</span>';
                if (item.status === 'Cancelled') statusBadge = '<span class="px-2 py-0.5 rounded text-[9px] font-bold uppercase bg-rose-500/20 text-rose-400 border border-rose-500/30">Cancelled</span>';
                if (item.archived || item.isArchived || item.status === 'Archived') statusBadge = '<span class="px-2 py-0.5 rounded text-[9px] font-bold uppercase bg-neutral-800 text-neutral-400 border border-neutral-700">Archived</span>';

                const isSurplus = item.netStandingTourney >= 0;
                const standingPill = isSurplus
                    ? `<span class="text-emerald-400 font-bold">+₱${item.netStandingTourney.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>`
                    : `<span class="text-amber-400 font-bold">-₱${Math.abs(item.netStandingTourney).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>`;

                return `
                    <div class="p-4 bg-black/40 border border-white/10 hover:border-[#FFD700]/30 rounded-xl flex flex-col md:flex-row justify-between items-start md:items-center gap-3.5 transition-all">
                        <div class="min-w-0 flex-1">
                            <div class="flex items-center gap-2 flex-wrap mb-1">
                                <h4 class="font-heading font-black text-white text-sm uppercase truncate">${escapeHtml(item.name)}</h4>
                                <span class="text-[10px] text-[var(--gold)] bg-[var(--gold)]/10 px-2 py-0.5 rounded font-mono">${escapeHtml(item.game)}</span>
                                ${statusBadge}
                            </div>
                            <div class="text-[11px] text-neutral-400 flex items-center gap-3 flex-wrap">
                                <span>Date: ${escapeHtml(item.date)}</span>
                                <span>•</span>
                                <span>Prize Guarantee: <strong class="text-white">₱${item.tournamentPrize.toLocaleString()}</strong></span>
                                <span>•</span>
                                <span>Capacity: <strong class="text-white">${item.partCount} / ${item.maxTeams} Squads</strong></span>
                            </div>
                        </div>
                                  <!-- Financial Summary -->
                        <div class="flex items-center gap-3 sm:gap-4 shrink-0 bg-white/[0.02] border border-white/5 px-3 py-2 rounded-lg text-right font-mono">
                            <div>
                                <div class="text-[8px] text-neutral-500 uppercase">Gross Fees</div>
                                <div class="text-xs font-bold text-white">₱${item.tournamentGross.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                            </div>
                            <div class="border-l border-white/10 pl-3">
                                <div class="text-[8px] text-amber-400 uppercase">Fee (${item.paymentType === 'automatic' ? '5%' : '0%'})</div>
                                <div class="text-xs font-bold text-amber-400">₱${item.platformFee.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                            </div>
                            <div class="border-l border-white/10 pl-3">
                                <div class="text-[8px] text-neutral-400 uppercase">${isSurplus ? 'Net Profit' : 'Deficit'}</div>
                                <div class="text-xs font-black">${standingPill}</div>
                            </div>
                        </div>
                        <a href="/tournaments?id=${item.id}"
                            class="px-3.5 py-2 rounded-lg bg-[#FFD700] hover:bg-[#FFF099] text-black font-heading font-black text-[10px] uppercase transition-all shadow-sm shrink-0 self-end md:self-center">
                            Manage &rarr;
                        </a>
                    </div>
                `;
            }).join('');
        }
    }

    // ========================================================
    // PRIZE POOL CASH-INS & CASHOUT DISBURSEMENT PROCESSING
    // ========================================================
    try {
        // Scope queries based on role:
        // - Admins fetch all records (allowed by isAdmin() in Firestore rules)
        // - Organizers fetch only their own records (matched by organizerId == uid)
        const [cashinsSnap, withdrawalsSnap] = await Promise.all([
            isAdmin
                ? getDocs(collection(db, "cashins"))
                : getDocs(query(collection(db, "cashins"), where("organizerId", "==", uid))),
            isAdmin
                ? getDocs(collection(db, "withdrawals"))
                : getDocs(query(collection(db, "withdrawals"), where("organizerId", "==", uid)))
        ]);

        const allCashIns = [];
        cashinsSnap.forEach(d => allCashIns.push({ id: d.id, ...d.data() }));

        const allWithdrawals = [];
        withdrawalsSnap.forEach(d => allWithdrawals.push({ id: d.id, ...d.data() }));

        const adminCashinSec = qs('#admin-cashins-section');
        const adminWithdrawSec = qs('#admin-withdrawals-section');
        const adminBankSec = qs('#admin-organizers-bank-directory');
        const orgDeficitBanner = qs('#org-deficit-banner');
        const orgCashoutBanner = qs('#org-cashout-banner');
        const orgCashinsHistoryWrap = qs('#org-cashins-history-wrap');
        const orgWithdrawalsHistoryWrap = qs('#org-withdrawals-history-wrap');

        if (isAdmin) {
            // ADMIN VIEW
            if (adminCashinSec) adminCashinSec.classList.remove('hidden');
            if (adminWithdrawSec) adminWithdrawSec.classList.remove('hidden');
            if (adminBankSec) adminBankSec.classList.remove('hidden');
            if (orgDeficitBanner) orgDeficitBanner.classList.add('hidden');
            if (orgCashoutBanner) orgCashoutBanner.classList.add('hidden');
            if (orgCashinsHistoryWrap) orgCashinsHistoryWrap.classList.add('hidden');
            if (orgWithdrawalsHistoryWrap) orgWithdrawalsHistoryWrap.classList.add('hidden');

            // 1. Admin Cash-In Queue
            const pendingCashins = allCashIns.filter(c => c.status === 'Pending');
            if (qs('#admin-cashin-pending-badge')) qs('#admin-cashin-pending-badge').textContent = `${pendingCashins.length} Pending Verification`;

            const adminCashinListEl = qs('#admin-cashins-list');
            if (adminCashinListEl) {
                if (allCashIns.length === 0) {
                    adminCashinListEl.innerHTML = `<div class="text-neutral-500 text-xs italic py-3 text-center">No organizer prize pool cash-in deposits submitted yet.</div>`;
                } else {
                    const sortedCashins = [...allCashIns].sort((a, b) => {
                        if (a.status === 'Pending' && b.status !== 'Pending') return -1;
                        if (b.status === 'Pending' && a.status !== 'Pending') return 1;
                        return (new Date(b.createdAt || 0)) - (new Date(a.createdAt || 0));
                    });

                    adminCashinListEl.innerHTML = sortedCashins.map(c => {
                        let statusBadge = '<span class="px-2 py-0.5 rounded text-[9px] font-bold uppercase bg-amber-500/20 text-amber-400 border border-amber-500/40">Pending Verification</span>';
                        if (c.status === 'Approved') statusBadge = '<span class="px-2 py-0.5 rounded text-[9px] font-bold uppercase bg-emerald-500/20 text-emerald-400 border border-emerald-500/40">Approved &amp; Credited</span>';
                        if (c.status === 'Rejected') statusBadge = '<span class="px-2 py-0.5 rounded text-[9px] font-bold uppercase bg-rose-500/20 text-rose-400 border border-rose-500/40">Rejected</span>';

                        return `
                            <div class="p-3.5 bg-black/40 border border-white/10 rounded-xl flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
                                <div class="min-w-0 flex-1">
                                    <div class="flex items-center gap-2 flex-wrap mb-1">
                                        <span class="font-bold text-white text-xs">${escapeHtml(c.organizerName || c.organizerEmail || 'Organizer')}</span>
                                        <span class="text-[10px] text-neutral-400 font-mono">${escapeHtml(c.organizerEmail || '')}</span>
                                        ${statusBadge}
                                    </div>
                                    <div class="text-[11px] text-neutral-300 flex items-center gap-2 flex-wrap">
                                        <span>Channel: <strong class="text-white">${escapeHtml(c.channel || 'Direct')}</strong></span>
                                        <span>•</span>
                                        <span>Ref #: <strong class="text-emerald-400 font-mono">${escapeHtml(c.referenceNumber || '--')}</strong></span>
                                        ${c.notes ? `<span>•</span><span class="text-neutral-400">Note: ${escapeHtml(c.notes)}</span>` : ''}
                                    </div>
                                </div>

                                <div class="flex items-center gap-3 shrink-0 self-end md:self-center">
                                    <div class="text-right">
                                        <div class="text-[9px] text-neutral-400 uppercase">Deposit Amount</div>
                                        <div class="text-base font-black text-[#FFD700] font-heading">₱${Number(c.amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                                    </div>
                                    ${c.status === 'Pending' ? `
                                        <button type="button" onclick="window.openAdminApproveCashInModal('${c.id}', '${escapeHtml(c.organizerName || 'Organizer')}', ${c.amount}, '${escapeHtml(c.channel || '')}', '${escapeHtml(c.referenceNumber || '')}')"
                                            class="px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-black font-heading font-black text-[10px] uppercase rounded-lg transition-colors cursor-pointer shadow-sm">
                                            Verify Deposit
                                        </button>
                                        <button type="button" onclick="window.rejectCashInDeposit('${c.id}', '${escapeHtml(c.organizerName || 'Organizer')}')"
                                            class="px-2.5 py-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 text-[10px] font-bold uppercase rounded-lg transition-colors cursor-pointer">
                                            Reject
                                        </button>
                                    ` : ''}
                                </div>
                            </div>
                        `;
                    }).join('');
                }
            }

            // 2. Admin Cashout Queue
            const pendingWithdrawals = allWithdrawals.filter(w => w.status === 'Pending');
            if (qs('#admin-pending-badge')) qs('#admin-pending-badge').textContent = `${pendingWithdrawals.length} Pending Action`;

            const adminWithdrawListEl = qs('#admin-withdrawals-list');
            if (adminWithdrawListEl) {
                if (allWithdrawals.length === 0) {
                    adminWithdrawListEl.innerHTML = `<div class="text-neutral-500 text-xs italic py-3 text-center">No organizer cashout requests submitted yet.</div>`;
                } else {
                    const sortedWithdrawals = [...allWithdrawals].sort((a, b) => {
                        if (a.status === 'Pending' && b.status !== 'Pending') return -1;
                        if (b.status === 'Pending' && a.status !== 'Pending') return 1;
                        return (new Date(b.requestedAt || 0)) - (new Date(a.requestedAt || 0));
                    });

                    adminWithdrawListEl.innerHTML = sortedWithdrawals.map(w => {
                        const pm = w.payoutMethod || {};
                        const destStr = `${pm.channel || 'GCash'}${pm.bankName ? ` (${pm.bankName})` : ''} • ${pm.accountNumber || '--'} (${pm.accountName || '--'})`;
                        
                        let statusBadge = '<span class="px-2 py-0.5 rounded text-[9px] font-bold uppercase bg-amber-500/20 text-amber-400 border border-amber-500/40">Pending Review</span>';
                        if (w.status === 'Disbursed') statusBadge = '<span class="px-2 py-0.5 rounded text-[9px] font-bold uppercase bg-emerald-500/20 text-emerald-400 border border-emerald-500/40">Disbursed</span>';
                        if (w.status === 'Rejected') statusBadge = '<span class="px-2 py-0.5 rounded text-[9px] font-bold uppercase bg-rose-500/20 text-rose-400 border border-rose-500/40">Rejected</span>';

                        return `
                            <div class="p-3.5 bg-black/40 border border-white/10 rounded-xl flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
                                <div class="min-w-0 flex-1">
                                    <div class="flex items-center gap-2 flex-wrap mb-1">
                                        <span class="font-bold text-white text-xs">${escapeHtml(w.organizerName || w.organizerEmail || 'Organizer')}</span>
                                        <span class="text-[10px] text-neutral-400 font-mono">${escapeHtml(w.organizerEmail || '')}</span>
                                        ${statusBadge}
                                    </div>
                                    <div class="text-[11px] text-neutral-300 flex items-center gap-2 flex-wrap">
                                        <span>Destination: <strong class="text-[#FFD700]">${escapeHtml(destStr)}</strong></span>
                                        ${w.notes ? `<span>•</span><span class="text-neutral-400">Note: ${escapeHtml(w.notes)}</span>` : ''}
                                    </div>
                                    ${w.referenceNumber ? `<div class="text-[10px] text-emerald-400 mt-1">Ref #: ${escapeHtml(w.referenceNumber)} • Transferred by ${escapeHtml(w.disbursedBy || 'Admin')}</div>` : ''}
                                </div>

                                <div class="flex items-center gap-3 shrink-0 self-end md:self-center">
                                    <div class="text-right">
                                        <div class="text-[9px] text-neutral-400 uppercase">Amount</div>
                                        <div class="text-base font-black text-[#FFD700] font-heading">₱${Number(w.amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                                    </div>
                                    ${w.status === 'Pending' ? `
                                        <button type="button" onclick="window.openAdminDisburseModal('${w.id}', '${escapeHtml(w.organizerName || 'Organizer')}', ${w.amount}, '${escapeHtml(destStr)}')"
                                            class="px-3 py-1.5 bg-emerald-500 hover:bg-emerald-400 text-black font-heading font-black text-[10px] uppercase rounded-lg transition-colors cursor-pointer shadow-sm">
                                            Disburse Funds
                                        </button>
                                        <button type="button" onclick="window.rejectWithdrawalRequest('${w.id}', '${escapeHtml(w.organizerName || 'Organizer')}')"
                                            class="px-2.5 py-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 text-[10px] font-bold uppercase rounded-lg transition-colors cursor-pointer">
                                            Reject
                                        </button>
                                    ` : ''}
                                </div>
                            </div>
                        `;
                    }).join('');
                }
            }

            // 3. Admin Organizer Bank Directory
            const usersSnap = await getDocs(collection(db, "users"));
            const orgUsers = [];
            usersSnap.forEach(uDoc => {
                const u = uDoc.data();
                if (u.role === 'organizer' || u.role === 'admin' || u.payoutMethod) {
                    orgUsers.push({ id: uDoc.id, ...u });
                }
            });

            if (qs('#admin-org-count-label')) qs('#admin-org-count-label').textContent = `${orgUsers.length} Accounts Configured`;
            const adminOrgListEl = qs('#admin-organizers-bank-list');
            if (adminOrgListEl) {
                if (orgUsers.length === 0) {
                    adminOrgListEl.innerHTML = `<div class="text-neutral-500 text-xs italic py-2 text-center">No organizer accounts found.</div>`;
                } else {
                    adminOrgListEl.innerHTML = orgUsers.map(u => {
                        const pm = u.payoutMethod;
                        return `
                            <div class="p-3 bg-black/30 border border-white/5 rounded-lg flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 text-xs">
                                <div class="min-w-0">
                                    <div class="flex items-center gap-2">
                                        <strong class="text-white">${escapeHtml(u.ign || u.displayName || u.email || 'User')}</strong>
                                        <span class="px-1.5 py-0.2 rounded text-[8px] font-bold uppercase ${u.role === 'admin' ? 'bg-red-500/10 text-red-400' : 'bg-purple-500/10 text-purple-400'}">${escapeHtml(u.role || 'member')}</span>
                                        <span class="text-[10px] text-neutral-400">${escapeHtml(u.email || '')}</span>
                                    </div>
                                    <div class="text-[11px] text-neutral-300 mt-1 font-mono">
                                        ${pm && pm.accountNumber ? `
                                            <span class="text-[#FFD700] font-bold">${escapeHtml(pm.channel)}${pm.bankName ? ` (${escapeHtml(pm.bankName)})` : ''}:</span>
                                            <span>${escapeHtml(pm.accountNumber)}</span> (${escapeHtml(pm.accountName || '--')})
                                        ` : `<span class="text-neutral-500 italic">No withdrawal method set up</span>`}
                                    </div>
                                </div>
                            </div>
                        `;
                    }).join('');
                }
            }

        } else {
            // ORGANIZER VIEW
            if (adminCashinSec) adminCashinSec.classList.add('hidden');
            if (adminWithdrawSec) adminWithdrawSec.classList.add('hidden');
            if (adminBankSec) adminBankSec.classList.add('hidden');
            if (orgCashinsHistoryWrap) orgCashinsHistoryWrap.classList.remove('hidden');
            if (orgWithdrawalsHistoryWrap) orgWithdrawalsHistoryWrap.classList.remove('hidden');

            const myCashIns = allCashIns.filter(c => c.organizerId === uid);
            const myApprovedCashIns = myCashIns.filter(c => c.status === 'Approved').reduce((s, c) => s + (Number(c.amount) || 0), 0);
            const myPendingCashIns = myCashIns.filter(c => c.status === 'Pending').reduce((s, c) => s + (Number(c.amount) || 0), 0);

            // Effective Net Standing after approved Cash-Ins
            const effectiveNetStanding = rawNetStanding + myApprovedCashIns;

            if (effectiveNetStanding < 0) {
                // DEFICIT: Organizer must Cash-In / Top-Up to fund prize pool
                const deficitAmount = Math.abs(effectiveNetStanding);
                window._currentOrganizerDeficit = deficitAmount;
                window._currentOrganizerAvailableBalance = 0;

                if (orgDeficitBanner) orgDeficitBanner.classList.remove('hidden');
                if (orgCashoutBanner) orgCashoutBanner.classList.add('hidden');
                if (qs('#org-deficit-amount')) qs('#org-deficit-amount').textContent = `₱${deficitAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

                const netRevEl = qs('#org-net-revenue');
                if (netRevEl) {
                    netRevEl.textContent = `-₱${deficitAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
                    netRevEl.className = 'text-lg sm:text-xl font-black text-amber-400 font-heading';
                }
                if (qs('#org-standing-sublabel')) qs('#org-standing-sublabel').textContent = 'Prize Pool Deficit';

            } else {
                // SURPLUS: Organizer has positive balance and can withdraw
                const surplusAmount = effectiveNetStanding;
                const myWithdrawals = allWithdrawals.filter(w => w.organizerId === uid);
                const totalDisbursed = myWithdrawals.filter(w => w.status === 'Disbursed').reduce((s, w) => s + (Number(w.amount) || 0), 0);
                const totalPendingWithdrawals = myWithdrawals.filter(w => w.status === 'Pending').reduce((s, w) => s + (Number(w.amount) || 0), 0);
                const availableBalance = Math.max(0, surplusAmount - totalDisbursed - totalPendingWithdrawals);

                window._currentOrganizerDeficit = 0;
                window._currentOrganizerAvailableBalance = availableBalance;

                if (orgDeficitBanner) orgDeficitBanner.classList.add('hidden');
                if (orgCashoutBanner) orgCashoutBanner.classList.remove('hidden');
                if (qs('#org-available-cashout')) qs('#org-available-cashout').textContent = `₱${availableBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

                const pendingLabel = qs('#org-pending-cashout-label');
                if (pendingLabel) {
                    if (totalPendingWithdrawals > 0) {
                        pendingLabel.textContent = `(₱${totalPendingWithdrawals.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} in review)`;
                        pendingLabel.classList.remove('hidden');
                    } else {
                        pendingLabel.classList.add('hidden');
                    }
                }

                const netRevEl = qs('#org-net-revenue');
                if (netRevEl) {
                    netRevEl.textContent = `+₱${surplusAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
                    netRevEl.className = 'text-lg sm:text-xl font-black text-transparent bg-clip-text bg-gradient-to-r from-[#FFF5C0] via-[#FFD700] to-[#E6B800] font-heading';
                }
                if (qs('#org-standing-sublabel')) qs('#org-standing-sublabel').textContent = 'Net Organizer Surplus';
            }

            // Render Organizer Cash-In History
            if (qs('#org-cashins-count-badge')) qs('#org-cashins-count-badge').textContent = `${myCashIns.length} Deposits`;
            const cashinsListEl = qs('#org-cashins-history-list');
            if (cashinsListEl) {
                if (myCashIns.length === 0) {
                    cashinsListEl.innerHTML = `<div class="text-neutral-500 text-xs italic py-2">No prize pool top-up deposits recorded.</div>`;
                } else {
                    const sortedMyCashins = [...myCashIns].sort((a, b) => (new Date(b.createdAt || 0)) - (new Date(a.createdAt || 0)));
                    cashinsListEl.innerHTML = sortedMyCashins.map(c => {
                        let statusBadge = '<span class="px-2 py-0.5 rounded text-[9px] font-bold uppercase bg-amber-500/20 text-amber-400 border border-amber-500/40">Pending Verification</span>';
                        if (c.status === 'Approved') statusBadge = '<span class="px-2 py-0.5 rounded text-[9px] font-bold uppercase bg-emerald-500/20 text-emerald-400 border border-emerald-500/40">Approved &amp; Credited</span>';
                        if (c.status === 'Rejected') statusBadge = '<span class="px-2 py-0.5 rounded text-[9px] font-bold uppercase bg-rose-500/20 text-rose-400 border border-rose-500/40">Rejected</span>';

                        return `
                            <div class="p-3 bg-black/30 border border-white/5 rounded-lg flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 text-xs">
                                <div>
                                    <div class="flex items-center gap-2 flex-wrap">
                                        <span class="font-bold text-white">₱${Number(c.amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                        <span class="text-neutral-400 text-[10px]">via ${escapeHtml(c.channel || 'Direct')}</span>
                                        ${statusBadge}
                                    </div>
                                    <div class="text-[10px] text-neutral-500 mt-0.5 font-mono">
                                        Date: ${formatDate(c.createdAt)} • Ref #: <span class="text-emerald-400">${escapeHtml(c.referenceNumber || '--')}</span>
                                    </div>
                                </div>
                            </div>
                        `;
                    }).join('');
                }
            }

            // Render Organizer Cashout Requests History
            const myWithdrawals = allWithdrawals.filter(w => w.organizerId === uid);
            if (qs('#org-withdrawals-count-badge')) qs('#org-withdrawals-count-badge').textContent = `${myWithdrawals.length} Requests`;
            const historyListEl = qs('#org-withdrawals-history-list');
            if (historyListEl) {
                if (myWithdrawals.length === 0) {
                    historyListEl.innerHTML = `<div class="text-neutral-500 text-xs italic py-2">No cashout requests submitted yet.</div>`;
                } else {
                    const sortedMy = [...myWithdrawals].sort((a, b) => (new Date(b.requestedAt || 0)) - (new Date(a.requestedAt || 0)));
                    historyListEl.innerHTML = sortedMy.map(w => {
                        const pm = w.payoutMethod || {};
                        let statusBadge = '<span class="px-2 py-0.5 rounded text-[9px] font-bold uppercase bg-amber-500/20 text-amber-400 border border-amber-500/40">Pending Review</span>';
                        if (w.status === 'Disbursed') statusBadge = '<span class="px-2 py-0.5 rounded text-[9px] font-bold uppercase bg-emerald-500/20 text-emerald-400 border border-emerald-500/40">Disbursed</span>';
                        if (w.status === 'Rejected') statusBadge = '<span class="px-2 py-0.5 rounded text-[9px] font-bold uppercase bg-rose-500/20 text-rose-400 border border-rose-500/40">Rejected</span>';

                        return `
                            <div class="p-3 bg-black/30 border border-white/5 rounded-lg flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 text-xs">
                                <div>
                                    <div class="flex items-center gap-2 flex-wrap">
                                        <span class="font-bold text-white">₱${Number(w.amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                        <span class="text-neutral-400 text-[10px]">to ${escapeHtml(pm.channel || 'Account')} (${escapeHtml(pm.accountNumber || '--')})</span>
                                        ${statusBadge}
                                    </div>
                                    <div class="text-[10px] text-neutral-500 mt-0.5 font-mono">
                                        Requested: ${formatDate(w.requestedAt)} ${w.referenceNumber ? `• Ref #: <span class="text-emerald-400">${escapeHtml(w.referenceNumber)}</span>` : ''}
                                    </div>
                                </div>
                            </div>
                        `;
                    }).join('');
                }
            }
        }
    } catch (orgErr) {
        console.warn("Error processing withdrawals/cashins:", orgErr);
    }
}

// ==========================================
// 6. WITHDRAWAL & BANKING METHODS MANAGEMENT
// ==========================================
window.openWithdrawalModal = function () {
    const modal = document.getElementById('withdrawalMethodModal');
    if (!modal) return;

    const pm = activeUserData.payoutMethod || {};
    const channelSelect = document.getElementById('w-channel');
    const bankSelect = document.getElementById('w-bank-select');
    const bankCustom = document.getElementById('w-bank-custom');
    const nameInput = document.getElementById('w-account-name');
    const numInput = document.getElementById('w-account-number');
    const notesInput = document.getElementById('w-notes');

    if (channelSelect) channelSelect.value = pm.channel || 'GCash';
    if (nameInput) nameInput.value = pm.accountName || activeUserData.realName || activeUserData.displayName || '';
    if (numInput) numInput.value = pm.accountNumber || '';
    if (notesInput) notesInput.value = pm.notes || '';

    if (bankSelect && bankCustom) {
        if (pm.bankName) {
            const hasOption = [...bankSelect.options].some(o => o.value === pm.bankName);
            if (hasOption) {
                bankSelect.value = pm.bankName;
                bankCustom.classList.add('hidden');
                bankCustom.value = '';
            } else {
                bankSelect.value = 'custom';
                bankCustom.classList.remove('hidden');
                bankCustom.value = pm.bankName;
            }
        } else {
            bankSelect.value = 'BDO Unibank';
            bankCustom.classList.add('hidden');
            bankCustom.value = '';
        }
    }

    window.handleWithdrawalChannelChange();
    modal.classList.remove('hidden');
    modal.classList.add('flex');
};

window.closeWithdrawalModal = function () {
    const modal = document.getElementById('withdrawalMethodModal');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }
};

window.handleWithdrawalChannelChange = function () {
    const channel = document.getElementById('w-channel')?.value;
    const bankGroup = document.getElementById('w-bank-name-group');
    if (!bankGroup) return;

    if (channel === 'Bank Transfer' || channel === 'Other') {
        bankGroup.classList.remove('hidden');
    } else {
        bankGroup.classList.add('hidden');
    }
};

window.saveWithdrawalMethod = async function (e) {
    if (e) e.preventDefault();
    if (!activeUserUid) return;

    const channel = document.getElementById('w-channel')?.value;
    const bankSelect = document.getElementById('w-bank-select')?.value;
    const bankCustom = document.getElementById('w-bank-custom')?.value;
    const accountName = document.getElementById('w-account-name')?.value.trim();
    const accountNumber = document.getElementById('w-account-number')?.value.trim();
    const notes = document.getElementById('w-notes')?.value.trim();

    if (!channel || !accountName || !accountNumber) {
        if (window.showErrorToast) window.showErrorToast('Missing Info', 'Please fill in all required payout details.');
        return;
    }

    let finalBankName = '';
    if (channel === 'Bank Transfer' || channel === 'Other') {
        finalBankName = bankSelect === 'custom' ? (bankCustom || 'Other Institution') : bankSelect;
    }

    const saveBtn = document.getElementById('w-save-btn');
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving...'; }

    try {
        const payoutMethodData = {
            channel,
            bankName: finalBankName,
            accountName,
            accountNumber,
            notes,
            updatedAt: new Date().toISOString()
        };

        const userDocRef = doc(db, "users", activeUserUid);
        await updateDoc(userDocRef, {
            payoutMethod: payoutMethodData
        });

        activeUserData.payoutMethod = payoutMethodData;
        renderWithdrawalMethodDisplay(payoutMethodData);
        window.closeWithdrawalModal();

        if (window.showSuccessToast) {
            window.showSuccessToast('Withdrawal Method Saved', 'Your payout details have been securely updated.');
        }
    } catch (err) {
        console.error("Error saving withdrawal method:", err);
        if (window.showErrorToast) {
            window.showErrorToast('Save Error', 'Failed to save payout method: ' + err.message);
        }
    } finally {
        if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save Method'; }
    }
};

// ==========================================
// 7. CASH-IN / TOP-UP FOR PRIZE POOL DEFICIT (PAYREX & MANUAL)
// ==========================================
window.switchCashInTab = function (tab) {
    const tabPayrex = qs('#cashin-tab-payrex');
    const tabManual = qs('#cashin-tab-manual');
    const panePayrex = qs('#cashin-pane-payrex');
    const paneManual = qs('#cashin-pane-manual');

    if (tab === 'manual') {
        if (tabPayrex) {
            tabPayrex.className = 'py-2.5 px-3 rounded-lg text-neutral-400 hover:text-white text-center transition-all cursor-pointer';
        }
        if (tabManual) {
            tabManual.className = 'py-2.5 px-3 rounded-lg bg-[#FFD700] text-black font-black text-center transition-all cursor-pointer shadow-sm';
        }
        if (panePayrex) panePayrex.classList.add('hidden');
        if (paneManual) paneManual.classList.remove('hidden');
    } else {
        if (tabPayrex) {
            tabPayrex.className = 'py-2.5 px-3 rounded-lg bg-[#FFD700] text-black font-black text-center transition-all cursor-pointer shadow-sm';
        }
        if (tabManual) {
            tabManual.className = 'py-2.5 px-3 rounded-lg text-neutral-400 hover:text-white text-center transition-all cursor-pointer';
        }
        if (panePayrex) panePayrex.classList.remove('hidden');
        if (paneManual) paneManual.classList.add('hidden');
    }
};

window.setPayRexAmount = function (amount) {
    const amountInput = qs('#payrex-amount');
    if (amountInput) amountInput.value = amount;
};

window.setCashInShortfallAmount = function () {
    const deficit = window._currentOrganizerDeficit || 0;
    const amountInput = qs('#payrex-amount');
    if (amountInput) amountInput.value = deficit > 0 ? deficit : '';
    const manualInput = qs('#cashin-amount');
    if (manualInput) manualInput.value = deficit > 0 ? deficit : '';
};

window.openCashInModal = function () {
    const modal = document.getElementById('cashInModal');
    if (!modal) {
        console.error("cashInModal element not found in DOM");
        return;
    }

    const deficit = window._currentOrganizerDeficit || 0;
    if (qs('#cashin-deficit-amount')) qs('#cashin-deficit-amount').textContent = `₱${deficit.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    
    const payrexAmountInput = qs('#payrex-amount');
    if (payrexAmountInput) payrexAmountInput.value = deficit > 0 ? deficit : '';

    const manualAmountInput = qs('#cashin-amount');
    if (manualAmountInput) manualAmountInput.value = deficit > 0 ? deficit : '';

    window.switchCashInTab('payrex');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
};

window.closeCashInModal = function () {
    const modal = document.getElementById('cashInModal');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }
};

// 7.1 START PAYREX AUTOMATED INSTANT CHECKOUT
window.startPayRexCashIn = async function (e) {
    if (e) e.preventDefault();
    if (!activeUserUid) return;

    const amountVal = parseFloat(document.getElementById('payrex-amount')?.value) || 0;
    const notesVal = document.getElementById('payrex-notes')?.value.trim() || '';

    if (amountVal <= 0) {
        if (window.showErrorToast) window.showErrorToast('Invalid Amount', 'Please enter a cash-in amount greater than ₱0.');
        return;
    }

    const submitBtn = document.getElementById('payrex-submit-btn');
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = `<span>Connecting to PayRex...</span>`;
    }

    try {
        const payload = {
            amount: amountVal,
            organizerId: activeUserUid,
            organizerEmail: auth.currentUser?.email || '',
            organizerName: activeUserData.ign || activeUserData.displayName || 'Organizer',
            notes: notesVal,
            type: 'organizer_cashin'
        };

        // Call the Netlify serverless function for PayRex checkout
        const res = await fetch('/.netlify/functions/payrex-checkout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const responseData = await res.json();

        if (!res.ok) {
            throw new Error(responseData?.error || `PayRex checkout request failed (HTTP ${res.status}).`);
        }

        if (responseData && responseData.url) {
            // Record initial pending PayRex cashin in Firestore
            await addDoc(collection(db, "cashins"), {
                organizerId: activeUserUid,
                organizerEmail: auth.currentUser?.email || '',
                organizerName: activeUserData.ign || activeUserData.displayName || 'Organizer',
                amount: amountVal,
                channel: 'PayRex Instant Gateway',
                referenceNumber: responseData.sessionId || ('PRX_' + Date.now()),
                notes: notesVal || 'PayRex Online Payment',
                status: responseData.mode === 'test_sandbox' ? 'Approved' : 'Pending',
                createdAt: new Date().toISOString()
            });

            if (window.showSuccessToast) {
                window.showSuccessToast('Redirecting to PayRex', 'Opening secure checkout for GCash, Maya, Cards, and QRPH...');
            }

            // Redirect to PayRex hosted checkout
            window.location.href = responseData.url;
        } else {
            throw new Error(responseData?.error || 'Unable to generate PayRex checkout session.');
        }

    } catch (err) {
        console.error("Error creating PayRex checkout:", err);
        if (window.showErrorToast) window.showErrorToast('Checkout Error', err.message);
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = `<span>Pay with PayRex</span><span>&rarr;</span>`;
        }
    }
};

// 7.2 SUBMIT MANUAL ESCROW PROOF
window.submitCashInDeposit = async function (e) {
    if (e) e.preventDefault();
    if (!activeUserUid) return;

    const amountVal = parseFloat(document.getElementById('cashin-amount')?.value) || 0;
    const channelVal = document.getElementById('cashin-channel')?.value || 'GCash';
    const refVal = document.getElementById('cashin-ref')?.value.trim();
    const notesVal = document.getElementById('cashin-notes')?.value.trim() || '';

    if (amountVal <= 0 || !refVal) {
        if (window.showErrorToast) window.showErrorToast('Missing Info', 'Please enter deposit amount and transaction reference number.');
        return;
    }

    const submitBtn = document.getElementById('cashin-submit-btn');
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Submitting...'; }

    try {
        await addDoc(collection(db, "cashins"), {
            organizerId: activeUserUid,
            organizerEmail: auth.currentUser?.email || '',
            organizerName: activeUserData.ign || activeUserData.displayName || 'Organizer',
            amount: amountVal,
            channel: channelVal,
            referenceNumber: refVal,
            notes: notesVal,
            status: 'Pending',
            createdAt: new Date().toISOString()
        });

        window.closeCashInModal();
        if (window.showSuccessToast) {
            window.showSuccessToast('Deposit Proof Submitted', `Deposit of ₱${amountVal.toLocaleString()} submitted for Admin verification.`);
        }

        // Reload data
        await loadUserProfile(activeUserUid, auth.currentUser?.email);

    } catch (err) {
        console.error("Error submitting cash-in:", err);
        if (window.showErrorToast) window.showErrorToast('Submit Error', err.message);
    } finally {
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Submit Proof'; }
    }
};

window.openAdminApproveCashInModal = function (reqId, orgName, amount, channel, refNum) {
    const modal = document.getElementById('adminApproveCashInModal');
    if (!modal) return;

    if (qs('#admin-cashin-req-id')) qs('#admin-cashin-req-id').value = reqId;
    if (qs('#admin-cashin-org-name')) qs('#admin-cashin-org-name').textContent = orgName;
    if (qs('#admin-cashin-amount')) qs('#admin-cashin-amount').textContent = `₱${Number(amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    if (qs('#admin-cashin-channel')) qs('#admin-cashin-channel').textContent = channel;
    if (qs('#admin-cashin-ref-display')) qs('#admin-cashin-ref-display').textContent = refNum;
    if (qs('#admin-cashin-notes')) qs('#admin-cashin-notes').value = '';

    modal.classList.remove('hidden');
    modal.classList.add('flex');
};

window.closeAdminApproveCashInModal = function () {
    const modal = document.getElementById('adminApproveCashInModal');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }
};

window.confirmAdminCashInApproval = async function (e) {
    if (e) e.preventDefault();
    const reqId = document.getElementById('admin-cashin-req-id')?.value;
    const adminNotes = document.getElementById('admin-cashin-notes')?.value.trim();

    if (!reqId) return;

    const approveBtn = document.getElementById('admin-cashin-btn');
    if (approveBtn) { approveBtn.disabled = true; approveBtn.textContent = 'Processing...'; }

    try {
        const cRef = doc(db, "cashins", reqId);
        await updateDoc(cRef, {
            status: 'Approved',
            adminNotes: adminNotes || '',
            approvedBy: auth.currentUser?.email || 'admin@champzero.com',
            verifiedAt: new Date().toISOString()
        });

        window.closeAdminApproveCashInModal();
        if (window.showSuccessToast) {
            window.showSuccessToast('Deposit Approved', 'Prize pool deposit has been approved and credited to organizer balance.');
        }

        await loadUserProfile(activeUserUid, auth.currentUser?.email);

    } catch (err) {
        console.error("Error approving cash in:", err);
        if (window.showErrorToast) window.showErrorToast('Approval Failed', err.message);
    } finally {
        if (approveBtn) { approveBtn.disabled = false; approveBtn.textContent = 'Confirm Approval'; }
    }
};

window.rejectCashInDeposit = async function (reqId, orgName) {
    if (!confirm(`Are you sure you want to reject the deposit proof for ${orgName}?`)) return;

    try {
        const cRef = doc(db, "cashins", reqId);
        await updateDoc(cRef, {
            status: 'Rejected',
            rejectedBy: auth.currentUser?.email || 'admin@champzero.com',
            verifiedAt: new Date().toISOString()
        });

        if (window.showSuccessToast) window.showSuccessToast('Deposit Rejected', 'The deposit proof has been marked as rejected.');
        await loadUserProfile(activeUserUid, auth.currentUser?.email);

    } catch (err) {
        console.error("Error rejecting deposit:", err);
        if (window.showErrorToast) window.showErrorToast('Reject Error', err.message);
    }
};

// ==========================================
// 8. ORGANIZER CASHOUT & ADMIN DISBURSEMENTS
// ==========================================
window.openRequestWithdrawalModal = function () {
    const pm = activeUserData.payoutMethod;
    if (!pm || !pm.accountNumber) {
        if (window.showErrorToast) {
            window.showErrorToast('No Payout Method', 'Please configure your bank or e-wallet account first.');
        }
        window.openWithdrawalModal();
        return;
    }

    const modal = document.getElementById('requestWithdrawalModal');
    if (!modal) return;

    const avail = window._currentOrganizerAvailableBalance || 0;
    if (qs('#req-available-balance')) qs('#req-available-balance').textContent = `₱${avail.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    const pmPreview = qs('#req-payout-method-preview');
    if (pmPreview) {
        pmPreview.innerHTML = `
            <div class="font-bold text-white">${escapeHtml(pm.channel)}${pm.bankName ? ` (${escapeHtml(pm.bankName)})` : ''}</div>
            <div class="text-xs text-neutral-300 font-mono mt-0.5">Account #: ${escapeHtml(pm.accountNumber)} • Name: ${escapeHtml(pm.accountName)}</div>
        `;
    }

    const amountInput = qs('#req-amount');
    if (amountInput) {
        amountInput.value = avail > 0 ? avail : '';
        amountInput.max = avail;
    }

    modal.classList.remove('hidden');
    modal.classList.add('flex');
};

window.closeRequestWithdrawalModal = function () {
    const modal = document.getElementById('requestWithdrawalModal');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }
};

window.setWithdrawalMaxAmount = function () {
    const avail = window._currentOrganizerAvailableBalance || 0;
    const amountInput = qs('#req-amount');
    if (amountInput) amountInput.value = avail;
};

window.submitOrganizerWithdrawalRequest = async function (e) {
    if (e) e.preventDefault();
    if (!activeUserUid) return;

    const avail = window._currentOrganizerAvailableBalance || 0;
    const amountVal = parseFloat(document.getElementById('req-amount')?.value) || 0;
    const notesVal = document.getElementById('req-notes')?.value.trim() || '';

    if (amountVal <= 0) {
        if (window.showErrorToast) window.showErrorToast('Invalid Amount', 'Please enter a cashout amount greater than ₱0.');
        return;
    }

    if (amountVal > avail) {
        if (window.showErrorToast) window.showErrorToast('Insufficient Balance', `Requested amount exceeds available balance of ₱${avail.toLocaleString('en-US', { minimumFractionDigits: 2 })}.`);
        return;
    }

    const submitBtn = document.getElementById('req-submit-btn');
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Submitting...'; }

    try {
        await addDoc(collection(db, "withdrawals"), {
            organizerId: activeUserUid,
            organizerEmail: auth.currentUser?.email || '',
            organizerName: activeUserData.ign || activeUserData.displayName || 'Organizer',
            amount: amountVal,
            payoutMethod: activeUserData.payoutMethod || {},
            notes: notesVal,
            status: 'Pending',
            requestedAt: new Date().toISOString(),
            processedAt: null,
            referenceNumber: ''
        });

        window.closeRequestWithdrawalModal();
        if (window.showSuccessToast) {
            window.showSuccessToast('Cashout Requested', `Request for ₱${amountVal.toLocaleString()} submitted for Admin review.`);
        }

        // Reload data
        await loadUserProfile(activeUserUid, auth.currentUser?.email);

    } catch (err) {
        console.error("Error submitting withdrawal request:", err);
        if (window.showErrorToast) window.showErrorToast('Request Failed', err.message);
    } finally {
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Submit Request'; }
    }
};

window.openAdminDisburseModal = function (reqId, orgName, amount, accountDetailsStr) {
    const modal = document.getElementById('adminDisburseModal');
    if (!modal) return;

    if (qs('#admin-disburse-req-id')) qs('#admin-disburse-req-id').value = reqId;
    if (qs('#admin-disburse-org-name')) qs('#admin-disburse-org-name').textContent = orgName;
    if (qs('#admin-disburse-amount')) qs('#admin-disburse-amount').textContent = `₱${Number(amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    if (qs('#admin-disburse-account-box')) qs('#admin-disburse-account-box').textContent = accountDetailsStr;
    if (qs('#admin-disburse-ref')) qs('#admin-disburse-ref').value = '';
    if (qs('#admin-disburse-notes')) qs('#admin-disburse-notes').value = '';

    modal.classList.remove('hidden');
    modal.classList.add('flex');
};

window.closeAdminDisburseModal = function () {
    const modal = document.getElementById('adminDisburseModal');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }
};

window.confirmAdminDisbursement = async function (e) {
    if (e) e.preventDefault();
    const reqId = document.getElementById('admin-disburse-req-id')?.value;
    const refNum = document.getElementById('admin-disburse-ref')?.value.trim();
    const adminNotes = document.getElementById('admin-disburse-notes')?.value.trim();

    if (!reqId || !refNum) {
        if (window.showErrorToast) window.showErrorToast('Missing Ref', 'Please enter a transaction / transfer reference number.');
        return;
    }

    const disburseBtn = document.getElementById('admin-disburse-btn');
    if (disburseBtn) { disburseBtn.disabled = true; disburseBtn.textContent = 'Processing...'; }

    try {
        const wRef = doc(db, "withdrawals", reqId);
        await updateDoc(wRef, {
            status: 'Disbursed',
            referenceNumber: refNum,
            adminNotes: adminNotes || '',
            disbursedBy: auth.currentUser?.email || 'admin@champzero.com',
            processedAt: new Date().toISOString()
        });

        window.closeAdminDisburseModal();
        if (window.showSuccessToast) {
            window.showSuccessToast('Funds Disbursed', `Payment marked as sent with Ref #${refNum}.`);
        }

        // Reload data
        await loadUserProfile(activeUserUid, auth.currentUser?.email);

    } catch (err) {
        console.error("Error confirming disbursement:", err);
        if (window.showErrorToast) window.showErrorToast('Disburse Failed', err.message);
    } finally {
        if (disburseBtn) { disburseBtn.disabled = false; disburseBtn.textContent = 'Confirm Payout'; }
    }
};

window.rejectWithdrawalRequest = async function (reqId, orgName) {
    if (!confirm(`Are you sure you want to reject the cashout request for ${orgName}?`)) return;

    try {
        const wRef = doc(db, "withdrawals", reqId);
        await updateDoc(wRef, {
            status: 'Rejected',
            rejectedBy: auth.currentUser?.email || 'admin@champzero.com',
            processedAt: new Date().toISOString()
        });

        if (window.showSuccessToast) window.showSuccessToast('Request Rejected', 'The cashout request has been marked as rejected.');
        await loadUserProfile(activeUserUid, auth.currentUser?.email);

    } catch (err) {
        console.error("Error rejecting request:", err);
        if (window.showErrorToast) window.showErrorToast('Reject Error', err.message);
    }
};

// ============================================================
// FRIENDS MODULE — Count, List, Remove
// ============================================================

async function getAcceptedFriendDocs(uid) {
    const friendsRef = collection(db, "friend_requests");
    const results = [];

    // Query 1: where user sent the request
    const q1 = query(friendsRef, where("fromUid", "==", uid), where("status", "==", "accepted"));
    const snap1 = await getDocs(q1);
    snap1.forEach(d => results.push({ id: d.id, ...d.data(), friendUid: d.data().toUid }));

    // Query 2: where user received the request
    const q2 = query(friendsRef, where("toUid", "==", uid), where("status", "==", "accepted"));
    const snap2 = await getDocs(q2);
    snap2.forEach(d => results.push({ id: d.id, ...d.data(), friendUid: d.data().fromUid }));

    // Deduplicate by friendUid
    const seen = new Set();
    return results.filter(r => {
        if (seen.has(r.friendUid)) return false;
        seen.add(r.friendUid);
        return true;
    });
}

async function countFriends(uid) {
    const friends = await getAcceptedFriendDocs(uid);
    return friends.length;
}

async function loadFriendsList(uid) {
    const listEl = qs('#friends-list');
    if (!listEl) return;

    listEl.innerHTML = '<div class="text-center py-6 text-neutral-500 text-xs"><svg class="animate-spin h-5 w-5 mx-auto mb-2 text-[#FFD700]" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path></svg>Loading...</div>';

    try {
        const friends = await getAcceptedFriendDocs(uid);

        if (qs('#friends-list-count')) qs('#friends-list-count').textContent = `(${friends.length})`;
        if (qs('#friends-count')) qs('#friends-count').textContent = friends.length;
        if (qs('#friends-tab-count')) qs('#friends-tab-count').textContent = friends.length;

        if (friends.length === 0) {
            listEl.innerHTML = '<div class="text-center py-10 text-neutral-500 text-xs italic">No friends yet. Send friend requests from team pages or player profiles!</div>';
            return;
        }

        // Fetch friend profile data
        const friendCards = await Promise.all(friends.map(async (f) => {
            let friendData = {};
            try {
                const fDoc = await getDoc(doc(db, "users", f.friendUid));
                if (fDoc.exists()) friendData = fDoc.data();
            } catch (e) {}

            const name = friendData.ign || friendData.displayName || friendData.username || 'Unknown Player';
            const avatar = friendData.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=111116&color=FFD700`;
            const isSelf = auth.currentUser && auth.currentUser.uid === f.friendUid;
            const subtitle = isCurrentProfilePublic
                ? (friendData.rank ? `Rank: ${escapeHtml(friendData.rank)}` : 'Competitive Gamer')
                : (friendData.email ? escapeHtml(friendData.email) : (friendData.rank ? `Rank: ${escapeHtml(friendData.rank)}` : 'Player'));

            let actionsHtml = '';
            if (isCurrentProfilePublic) {
                // On someone else's public profile, NEVER show the Remove button!
                if (!isSelf) {
                    actionsHtml = `
                        <button type="button" onclick="window.startDMWith('${escapeHtml(f.friendUid)}', '${escapeHtml(name)}')" class="px-3 py-1.5 bg-blue-500/20 hover:bg-blue-500/30 text-blue-400 text-[10px] font-heading font-bold uppercase rounded-lg border border-blue-500/30 transition-all cursor-pointer">
                            Message
                        </button>
                        <a href="/profile.html?uid=${encodeURIComponent(f.friendUid)}" class="px-3 py-1.5 bg-white/5 hover:bg-white/10 text-neutral-300 hover:text-white text-[10px] font-heading font-bold uppercase rounded-lg border border-white/10 transition-all">
                            Profile
                        </a>
                    `;
                } else {
                    actionsHtml = `
                        <span class="px-2.5 py-1 bg-[#FFD700]/10 text-[#FFD700] text-[10px] font-mono font-bold uppercase rounded-md border border-[#FFD700]/20">You</span>
                    `;
                }
            } else {
                // On owner's own profile: show Message and Remove button
                actionsHtml = `
                    <button type="button" onclick="window.startDMWith('${escapeHtml(f.friendUid)}', '${escapeHtml(name)}')" class="px-3 py-1.5 bg-blue-500/20 hover:bg-blue-500/30 text-blue-400 text-[10px] font-heading font-bold uppercase rounded-lg border border-blue-500/30 transition-all cursor-pointer">
                        Message
                    </button>
                    <button type="button" onclick="window.removeFriend('${f.id}', '${escapeHtml(name)}')" class="px-3 py-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 text-[10px] font-heading font-bold uppercase rounded-lg border border-red-500/20 transition-all cursor-pointer">
                        Remove
                    </button>
                `;
            }

            return `
                <div class="flex items-center gap-4 p-4 bg-white/5 hover:bg-white/8 border border-white/10 rounded-xl transition-all group">
                    <a href="/profile.html?uid=${encodeURIComponent(f.friendUid)}" class="shrink-0">
                        <img src="${escapeHtml(avatar)}" class="w-10 h-10 rounded-full border border-white/20 object-cover bg-black hover:scale-105 transition-transform" alt="${escapeHtml(name)}">
                    </a>
                    <div class="flex-1 min-w-0">
                        <a href="/profile.html?uid=${encodeURIComponent(f.friendUid)}" class="font-heading font-bold text-sm text-white hover:text-[#FFD700] uppercase tracking-tight truncate block transition-colors">${escapeHtml(name)}</a>
                        <p class="text-[10px] text-neutral-500 font-mono">${subtitle}</p>
                    </div>
                    <div class="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        ${actionsHtml}
                    </div>
                </div>
            `;
        }));

        listEl.innerHTML = friendCards.join('');

    } catch (err) {
        console.error("Error loading friends:", err);
        listEl.innerHTML = '<div class="text-center py-10 text-red-400 text-xs">Failed to load friends list.</div>';
    }
}

window.removeFriend = async function (requestId, friendName) {
    if (isCurrentProfilePublic || !auth.currentUser) {
        if (window.showErrorToast) window.showErrorToast('Action Restricted', 'You can only remove friends from your own profile dashboard.');
        return;
    }

    if (!confirm(`Remove ${friendName} from your friends?`)) return;
    try {
        await deleteDoc(doc(db, "friend_requests", requestId));
        if (window.showSuccessToast) window.showSuccessToast('Friend Removed', `${friendName} has been removed from your friends.`);
        const targetUid = auth.currentUser ? auth.currentUser.uid : activeUserUid;
        if (targetUid) {
            loadFriendsList(targetUid);
            // Update count
            const count = await countFriends(targetUid);
            if (qs('#friends-count')) qs('#friends-count').textContent = count;
            if (qs('#friends-tab-count')) qs('#friends-tab-count').textContent = count;
        }
    } catch (err) {
        console.error("Error removing friend:", err);
        if (window.showErrorToast) window.showErrorToast('Error', 'Could not remove friend.');
    }
};

// ============================================================
// DIRECT MESSAGES MODULE
// ============================================================

let activeDmId = null;
let dmUnsubscribe = null;

// Get or create a DM conversation between two users
async function getOrCreateDM(uid1, uid2) {
    const dmRef = collection(db, "direct_messages");

    // Check if conversation already exists
    const q1 = query(dmRef, where("participants", "array-contains", uid1));
    const snap = await getDocs(q1);

    let existingDmId = null;
    snap.forEach(d => {
        const data = d.data();
        if (data.participants && data.participants.includes(uid2)) {
            existingDmId = d.id;
        }
    });

    if (existingDmId) return existingDmId;

    // Create new conversation
    const newDm = await addDoc(dmRef, {
        participants: [uid1, uid2],
        createdAt: new Date().toISOString(),
        lastMessage: '',
        lastMessageAt: new Date().toISOString()
    });

    return newDm.id;
}

// Start a DM from the friends list -> opens floating Community Chat DM drawer
window.startDMWith = async function (friendUid, friendName) {
    const myUid = auth.currentUser ? auth.currentUser.uid : activeUserUid;
    if (!myUid) return;
    if (friendUid === myUid) {
        if (window.showWarningToast) window.showWarningToast('Notice', 'You cannot message yourself.');
        return;
    }

    if (typeof window.czOpenDMWith === 'function') {
        window.czOpenDMWith(friendUid, friendName);
    } else {
        if (window.showWarningToast) window.showWarningToast('Chat', 'Open the Community Hub at the bottom right to message.');
    }
};

// Load all DM conversations
async function loadDMConversations(uid) {
    const listEl = qs('#dm-conversations-list');
    if (!listEl) return;

    try {
        const dmRef = collection(db, "direct_messages");
        const q = query(dmRef, where("participants", "array-contains", uid));
        const snap = await getDocs(q);

        if (snap.empty) {
            listEl.innerHTML = '<div class="text-center py-10 text-neutral-500 text-xs italic">No conversations yet. Message a friend to start!</div>';
            return;
        }

        const convos = [];
        snap.forEach(d => {
            const data = d.data();
            const friendUid = data.participants.find(p => p !== uid);
            convos.push({ id: d.id, friendUid, ...data });
        });

        // Sort by last message time
        convos.sort((a, b) => (b.lastMessageAt || '').localeCompare(a.lastMessageAt || ''));

        // Fetch friend names
        const cards = await Promise.all(convos.map(async (c) => {
            let friendData = {};
            try {
                const fDoc = await getDoc(doc(db, "users", c.friendUid));
                if (fDoc.exists()) friendData = fDoc.data();
            } catch (e) {}

            const name = friendData.ign || friendData.displayName || 'Unknown';
            const avatar = friendData.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=111116&color=FFD700&size=32`;
            const preview = c.lastMessage ? (c.lastMessage.length > 40 ? c.lastMessage.substring(0, 40) + '...' : c.lastMessage) : 'No messages yet';
            const isActive = c.id === activeDmId;

            return `
                <button onclick="window.openDMChatById('${c.id}', '${escapeHtml(name)}', '${c.friendUid}')"
                    class="w-full flex items-center gap-3 p-3 rounded-xl text-left transition-all cursor-pointer ${isActive ? 'bg-[#FFD700]/10 border border-[#FFD700]/30' : 'hover:bg-white/5 border border-transparent'}">
                    <img src="${escapeHtml(avatar)}" class="w-8 h-8 rounded-full border border-white/20 object-cover bg-black shrink-0" alt="">
                    <div class="min-w-0 flex-1">
                        <p class="font-heading font-bold text-xs text-white uppercase truncate">${escapeHtml(name)}</p>
                        <p class="text-[10px] text-neutral-500 truncate">${escapeHtml(preview)}</p>
                    </div>
                </button>
            `;
        }));

        listEl.innerHTML = cards.join('');

    } catch (err) {
        console.error("Error loading conversations:", err);
        listEl.innerHTML = '<div class="text-center py-10 text-red-400 text-xs">Failed to load conversations.</div>';
    }
}

window.openDMChatById = function (dmId, friendName, friendUid) {
    openDMChat(dmId, friendName, friendUid);
};

function openDMChat(dmId, friendName, friendUid) {
    activeDmId = dmId;

    // Update header
    if (qs('#dm-chat-name')) qs('#dm-chat-name').textContent = friendName;
    if (qs('#dm-input-area')) qs('#dm-input-area').classList.remove('hidden');

    // Highlight active conversation in list
    if (activeUserUid) loadDMConversations(activeUserUid);

    // Unsubscribe from previous listener
    if (dmUnsubscribe) dmUnsubscribe();

    // Listen for messages in real-time
    const msgsRef = collection(db, "direct_messages", dmId, "messages");
    const msgsQuery = query(msgsRef, orderBy("createdAt", "asc"));

    dmUnsubscribe = onSnapshot(msgsQuery, (snapshot) => {
        const container = qs('#dm-messages-container');
        if (!container) return;

        if (snapshot.empty) {
            container.innerHTML = '<div class="flex items-center justify-center h-full text-neutral-500 text-xs italic">No messages yet. Say hello!</div>';
            return;
        }

        const messages = [];
        snapshot.forEach(d => messages.push({ id: d.id, ...d.data() }));

        container.innerHTML = messages.map(msg => {
            const isMine = msg.senderUid === activeUserUid;
            const time = msg.createdAt ? new Date(msg.createdAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '';

            return `
                <div class="flex ${isMine ? 'justify-end' : 'justify-start'}">
                    <div class="max-w-[70%] ${isMine ? 'bg-[#FFD700]/15 border-[#FFD700]/30' : 'bg-white/5 border-white/10'} border rounded-2xl px-4 py-2.5 ${isMine ? 'rounded-br-sm' : 'rounded-bl-sm'}">
                        <p class="text-sm text-white break-words">${escapeHtml(msg.text || '')}</p>
                        <p class="text-[9px] ${isMine ? 'text-[#FFD700]/60' : 'text-neutral-500'} mt-1 text-right">${time}</p>
                    </div>
                </div>
            `;
        }).join('');

        // Auto-scroll to bottom
        container.scrollTop = container.scrollHeight;
    });
}

window.sendDM = async function (e) {
    e.preventDefault();
    if (!activeDmId || !activeUserUid) return;

    const input = qs('#dm-input');
    const text = input?.value?.trim();
    if (!text) return;

    input.value = '';

    try {
        // Add message
        const msgsRef = collection(db, "direct_messages", activeDmId, "messages");
        await addDoc(msgsRef, {
            senderUid: activeUserUid,
            text: text,
            createdAt: new Date().toISOString()
        });

        // Update conversation's lastMessage
        const dmDocRef = doc(db, "direct_messages", activeDmId);
        await updateDoc(dmDocRef, {
            lastMessage: text,
            lastMessageAt: new Date().toISOString()
        });
    } catch (err) {
        console.error("Error sending DM:", err);
        if (window.showErrorToast) window.showErrorToast('Send Failed', 'Could not send message.');
    }
};

// Centralized Profile Realtime Listener Teardown
function cleanupProfileListeners() {
    if (typeof dmUnsubscribe === 'function') {
        dmUnsubscribe();
        dmUnsubscribe = null;
    }
}

window.addEventListener('beforeunload', cleanupProfileListeners);
window.addEventListener('pagehide', cleanupProfileListeners);

// ==========================================
// 8. REWARDS, STREAKS, REFERRALS & VAULT REDEEM
// ==========================================

// --- PHILIPPINE TIME (PHT / UTC+8) DATE HELPERS ---
function getPHTDate(date = new Date()) {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Manila',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(date);
}

function getPHTYesterday() {
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    return getPHTDate(yesterday);
}

let phtResetInterval = null;

function startPHTResetTimer() {
    const timerEl = qs('#streak-reset-timer');
    if (!timerEl) return;

    if (phtResetInterval) clearInterval(phtResetInterval);

    function update() {
        const now = new Date();
        const phtFormatter = new Intl.DateTimeFormat('en-US', {
            timeZone: 'Asia/Manila',
            year: 'numeric',
            month: 'numeric',
            day: 'numeric',
            hour: 'numeric',
            minute: 'numeric',
            second: 'numeric',
            hour12: false
        });
        const parts = phtFormatter.formatToParts(now);
        const map = {};
        parts.forEach(p => map[p.type] = p.value);
        
        const hour = parseInt(map.hour, 10) % 24;
        const min = parseInt(map.minute, 10);
        const sec = parseInt(map.second, 10);

        const currentSecs = hour * 3600 + min * 60 + sec;
        const totalDaySecs = 86400; // 24 * 3600
        const remSecs = totalDaySecs - currentSecs;

        const remH = Math.floor(remSecs / 3600);
        const remM = Math.floor((remSecs % 3600) / 60);
        const remS = remSecs % 60;

        const pad = (n) => String(n).padStart(2, '0');
        timerEl.textContent = `${pad(remH)}h ${pad(remM)}m ${pad(remS)}s`;
    }

    update();
    phtResetInterval = setInterval(update, 1000);
}

async function loadRewardsData(userData) {
    if (!userData) userData = activeUserData || {};
    const czPoints = typeof userData.czPoints === 'number' ? userData.czPoints : 0;
    const lifetimePoints = typeof userData.lifetimePoints === 'number' ? userData.lifetimePoints : czPoints;
    const dailyStreak = typeof userData.dailyStreak === 'number' ? userData.dailyStreak : 1;
    const lastCheckIn = userData.lastCheckInDate || '';
    const referralCount = typeof userData.referralCount === 'number' ? userData.referralCount : 0;
    const referralCode = userData.referralCode || ('CZ-' + (activeUserUid ? activeUserUid.substring(0, 6).toUpperCase() : 'MEMBER'));

    // Start live PHT reset countdown
    startPHTResetTimer();

    // 1. Vault Balance & Lifetime Points
    if (qs('#reward-points-balance')) qs('#reward-points-balance').textContent = czPoints.toLocaleString();
    if (qs('#reward-lifetime-points')) qs('#reward-lifetime-points').textContent = `${lifetimePoints.toLocaleString()} CZ`;

    // Tier badge
    const tierBadge = qs('#reward-tier-badge');
    if (tierBadge) {
        if (lifetimePoints >= 1000) {
            tierBadge.textContent = 'Master Tier';
            tierBadge.className = 'font-mono-tag text-[9px] uppercase font-bold px-2 py-0.5 rounded bg-purple-500/20 text-purple-300 border border-purple-500/40 shadow-sm';
        } else if (lifetimePoints >= 500) {
            tierBadge.textContent = 'Elite Tier';
            tierBadge.className = 'font-mono-tag text-[9px] uppercase font-bold px-2 py-0.5 rounded bg-[#FFD700]/20 text-[#FFD700] border border-[#FFD700]/40 shadow-sm';
        } else {
            tierBadge.textContent = 'Scout Tier';
            tierBadge.className = 'font-mono-tag text-[9px] uppercase font-bold px-2 py-0.5 rounded bg-white/10 text-white border border-white/15';
        }
    }

    // 2. Streak Counter & 7-Day Pills
    const streakPill = qs('#streak-counter-pill');
    if (streakPill) {
        streakPill.textContent = `🔥 Day ${dailyStreak} of 7`;
    }

    const todayStr = getPHTDate();
    let isCheckedInToday = (lastCheckIn === todayStr);
    if (isCheckedInToday && (!userData.czPoints || userData.czPoints === 0) && (!userData.lifetimePoints || userData.lifetimePoints === 0)) {
        isCheckedInToday = false;
    }

    const checkinBtn = qs('#daily-checkin-btn');
    if (checkinBtn) {
        if (isCheckedInToday) {
            checkinBtn.disabled = true;
            checkinBtn.innerHTML = '<span>Checked In Today ✓</span>';
            checkinBtn.className = 'px-5 py-2.5 rounded-xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 font-heading font-bold text-xs uppercase tracking-wider shrink-0 cursor-not-allowed';
        } else {
            checkinBtn.disabled = false;
            const pts = dailyStreak === 7 ? 50 : 15;
            checkinBtn.innerHTML = `<span>Claim Check-In (+${pts} CZ)</span>`;
            checkinBtn.className = 'px-5 py-2.5 rounded-xl bg-[#FFD700] hover:bg-[#FFF099] text-black font-heading font-bold text-xs uppercase tracking-wider transition-all shadow-md shrink-0 cursor-pointer';
        }
    }

    const questLoginStatus = qs('#quest-login-status');
    if (questLoginStatus) {
        if (isCheckedInToday) {
            questLoginStatus.innerHTML = '<span class="text-emerald-400 font-bold">Completed Today ✓</span>';
        } else {
            questLoginStatus.innerHTML = '<span class="text-amber-400 font-bold">Pending Check-In</span>';
        }
    }

    // Quest 2: Scrim Battle
    const questScrimStatus = qs('#quest-scrim-status');
    const isScrimDone = (userData.lastDailyScrimDate === todayStr);
    if (questScrimStatus) {
        if (isScrimDone) {
            questScrimStatus.innerHTML = '<span class="text-emerald-400 font-bold">Completed Today ✓ (+30 CZ)</span>';
        } else {
            questScrimStatus.innerHTML = '<span class="text-amber-400 font-semibold">Available Daily</span>';
        }
    }

    // Quest 3: Global Chat
    const questChatStatus = qs('#quest-chat-status');
    const isChatDone = (userData.lastDailyChatDate === todayStr);
    if (questChatStatus) {
        if (isChatDone) {
            questChatStatus.innerHTML = '<span class="text-emerald-400 font-bold">Completed Today ✓ (+15 CZ)</span>';
        } else {
            questChatStatus.innerHTML = '<span class="text-amber-400 font-semibold">Available Daily</span>';
        }
    }

    // Quest 4: Scout Rivals
    const questScoutStatus = qs('#quest-scout-status');
    const isScoutDone = (userData.lastDailyScoutDate === todayStr);
    if (questScoutStatus) {
        if (isScoutDone) {
            questScoutStatus.innerHTML = '<span class="text-emerald-400 font-bold">Completed Today ✓ (+15 CZ)</span>';
        } else {
            questScoutStatus.innerHTML = '<span class="text-amber-400 font-semibold">Available Daily</span>';
        }
    }

    // Live Quest Countdown to 12:00 AM PHT
    startQuestCountdown();

    const streakContainer = qs('#streak-days-container');
    if (streakContainer) {
        let pillsHtml = '';
        for (let day = 1; day <= 7; day++) {
            const isMystery = (day === 7);
            const pts = isMystery ? '+50' : '+15';
            const isCompleted = (day < dailyStreak) || (day === dailyStreak && isCheckedInToday);
            const isCurrent = (day === dailyStreak && !isCheckedInToday);

            let bgBorder = 'bg-white/5 border-white/10 text-neutral-500';
            let iconOrBonus = `<span class="text-[9px] font-mono font-bold">${pts}</span>`;

            if (isCompleted) {
                bgBorder = 'bg-emerald-500/10 border-emerald-500/40 text-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.1)]';
                iconOrBonus = '<span class="text-xs font-bold text-emerald-400">✓</span>';
            } else if (isCurrent) {
                bgBorder = 'bg-[#FFD700]/15 border-[#FFD700] text-[#FFD700] ring-2 ring-[#FFD700]/30 animate-pulse';
                iconOrBonus = `<span class="text-[9px] font-mono font-black text-[#FFD700]">${pts}</span>`;
            } else if (isMystery) {
                bgBorder = 'bg-gradient-to-br from-amber-500/10 to-purple-500/10 border-[#FFD700]/30 text-[#FFD700]';
                iconOrBonus = '<span class="text-xs">🎁</span>';
            }

            pillsHtml += `
                <div class="flex flex-col items-center justify-between p-2 sm:p-2.5 rounded-xl border ${bgBorder} text-center transition-all">
                    <span class="text-[9px] font-mono-tag uppercase font-bold">D${day}</span>
                    <div class="my-1">${iconOrBonus}</div>
                    <span class="text-[8px] font-mono-tag ${isCompleted ? 'text-emerald-400 font-bold' : (isCurrent ? 'text-[#FFD700] font-bold' : 'text-neutral-500')}">${isCompleted ? 'DONE' : (isCurrent ? 'ACTIVE' : 'LOCK')}</span>
                </div>
            `;
        }
        streakContainer.innerHTML = pillsHtml;
    }

    // 3. Referral Engine
    const referralLinkInput = qs('#user-referral-link-input');
    const referralCodeDisplay = qs('#user-referral-code-display');
    const referralsCountDisplay = qs('#referrals-count-display');
    const referralsPointsDisplay = qs('#referrals-points-display');

    const origin = window.location.origin || (window.location.protocol + '//' + window.location.host);
    const fullInviteLink = `${origin}/signup?ref=${encodeURIComponent(referralCode)}`;

    if (referralLinkInput) referralLinkInput.value = fullInviteLink;
    if (referralCodeDisplay) referralCodeDisplay.textContent = referralCode;
    if (referralsCountDisplay) referralsCountDisplay.textContent = referralCount;
    if (referralsPointsDisplay) referralsPointsDisplay.textContent = `+${referralCount * 100}`;

    // 4. Dynamic Rewards Catalog Pricing & 5. Redemption Receipts History in parallel
    await Promise.all([
        loadRewardsCatalog(),
        loadRedemptionHistory()
    ]);
}

async function loadRewardsCatalog() {
    const container = qs('#rewards-catalog-cards');
    if (!container) return;

    try {
        const docRef = doc(db, "site_config", "rewards_catalog");
        const docSnap = await getDoc(docRef);

        if (docSnap.exists() && Array.isArray(docSnap.data().items) && docSnap.data().items.length > 0) {
            const items = docSnap.data().items.filter(it => it.active !== false);
            if (items.length === 0) return;

            container.innerHTML = '';
            window.rewardsCatalogCache = window.rewardsCatalogCache || {};
            items.forEach(item => {
                window.rewardsCatalogCache[item.id] = item;
                const cost = Number(item.cost) || 100;
                const isUnavailable = Boolean(item.isUnavailable);
                const badgeClass = item.badgeClass || (isUnavailable ? 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30' : 'bg-[#FFD700]/15 text-[#FFD700] border-[#FFD700]/30');
                const gameType = item.gameType || 'platform';
                const safeTitle = escapeHtml(item.title);
                const safeBadge = escapeHtml(item.badgeText || (isUnavailable ? 'Limited Merch' : (gameType === 'platform' ? 'Instant Unlock' : gameType.toUpperCase())));
                const safeDesc = escapeHtml(item.description);

                const isSpecial = Boolean(item.isSpecialDrop);
                const stockLimit = Number(item.stockLimit) || 0;
                const claimedCount = Number(item.claimedCount) || 0;
                const isLimited = stockLimit > 0;
                const remaining = isLimited ? Math.max(0, stockLimit - claimedCount) : null;
                const isSoldOut = isLimited && remaining <= 0;

                let borderBgClass = 'bg-[#111116] border border-white/10 hover:border-[#FFD700]/40';
                if (isSpecial) {
                    borderBgClass = 'bg-gradient-to-b from-[#FFD700]/15 via-[#13131A] to-[#0A0A0E] border-2 border-[#FFD700] ring-1 ring-[#FFD700]/50 shadow-[0_0_30px_rgba(255,215,0,0.22)]';
                } else if (isUnavailable) {
                    borderBgClass = 'bg-gradient-to-b from-amber-500/5 via-[#111116] to-[#0d0d12] border border-amber-500/25 hover:border-amber-500/40 relative';
                }

                let stockBadge = '';
                if (isUnavailable) {
                    stockBadge = '<span class="px-2 py-0.5 rounded text-[8px] font-mono-tag font-bold uppercase bg-amber-500/15 text-amber-400 border border-amber-500/30 flex items-center gap-1">🔒 Locked Drop</span>';
                } else if (isLimited) {
                    if (isSoldOut) {
                        stockBadge = '<span class="px-2 py-0.5 rounded text-[8px] font-mono-tag font-bold uppercase bg-red-500/20 text-red-400 border border-red-500/30">🚫 Sold Out</span>';
                    } else if (remaining <= 3) {
                        stockBadge = `<span class="px-2 py-0.5 rounded text-[8px] font-mono-tag font-bold uppercase bg-red-500/15 text-red-400 border border-red-500/30 animate-pulse">🔥 Only ${remaining} Left!</span>`;
                    } else {
                        stockBadge = `<span class="px-2 py-0.5 rounded text-[8px] font-mono-tag font-bold uppercase bg-white/10 text-neutral-300 border border-white/15">📦 ${remaining} Left</span>`;
                    }
                }

                const specialRibbon = isSpecial
                    ? `<div class="absolute top-0 right-0 bg-gradient-to-l from-[#FFD700] to-amber-400 text-black font-heading font-black text-[9px] uppercase tracking-wider px-3 py-1 rounded-bl-xl shadow-md flex items-center gap-1">
                        <span>✨ SPECIAL DROP</span>
                       </div>`
                    : '';

                const unavailableRibbon = isUnavailable
                    ? `<div class="absolute top-0 right-0 bg-gradient-to-l from-amber-500/30 to-amber-500/10 text-amber-300 font-heading font-black text-[9px] uppercase tracking-wider px-3 py-1 rounded-bl-xl border-l border-b border-amber-500/30 flex items-center gap-1">
                        <span>🔒 COMING SOON</span>
                       </div>`
                    : '';

                let buttonAction = '';
                if (isUnavailable) {
                    buttonAction = `
                        <button type="button" disabled class="w-full py-2.5 rounded-xl bg-white/5 text-neutral-400 font-heading font-bold text-xs uppercase tracking-wider border border-white/10 cursor-not-allowed flex items-center justify-center gap-1.5 opacity-80 select-none">
                            <svg class="w-3.5 h-3.5 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/></svg>
                            <span>Currently Unavailable</span>
                        </button>
                    `;
                } else if (isSoldOut) {
                    buttonAction = `
                        <button type="button" disabled class="w-full py-2.5 rounded-xl bg-white/5 text-neutral-500 font-heading font-bold text-xs uppercase tracking-wider border border-white/10 cursor-not-allowed">
                            Sold Out (${stockLimit} Claimed)
                        </button>
                    `;
                } else {
                    buttonAction = `
                        <button type="button" onclick="window.openRedeemModalById('${escapeHtml(item.id)}')"
                            class="w-full py-2.5 rounded-xl ${isSpecial ? 'bg-[#FFD700] hover:bg-[#FFF099] text-black shadow-[0_0_15px_rgba(255,215,0,0.35)]' : 'bg-white/5 hover:bg-[#FFD700] text-neutral-200 hover:text-black border border-white/10 hover:border-[#FFD700]'} font-heading font-bold text-xs uppercase tracking-wider transition-all cursor-pointer">
                            ${gameType === 'platform' ? `Redeem (${cost.toLocaleString()} CZ)` : `Claim (${cost.toLocaleString()} CZ)`}
                        </button>
                    `;
                }

                const card = document.createElement('div');
                card.className = `${borderBgClass} rounded-2xl p-5 sm:p-6 flex flex-col justify-between gap-4 transition-all relative overflow-hidden`;
                card.innerHTML = `
                    ${specialRibbon || unavailableRibbon}
                    <div>
                        <div class="flex items-center justify-between mb-3 ${isSpecial || isUnavailable ? 'pt-2' : ''}">
                            <div class="flex items-center gap-1.5 flex-wrap">
                                <span class="px-2 py-0.5 rounded text-[9px] font-mono-tag font-bold uppercase ${badgeClass} border">${safeBadge}</span>
                                ${stockBadge}
                            </div>
                            <div class="font-heading font-extrabold text-base text-[#FFD700]">${cost.toLocaleString()} CZ</div>
                        </div>
                        <h3 class="font-heading font-bold text-base text-white uppercase tracking-tight">${safeTitle}</h3>
                        <p class="text-xs text-neutral-400 mt-1 leading-relaxed">
                            ${safeDesc}
                        </p>
                    </div>
                    ${buttonAction}
                `;
                container.appendChild(card);
            });
        }
    } catch (err) {
        console.warn("Could not load rewards catalog config, using defaults:", err);
    }
}

async function loadRedemptionHistory() {
    const container = qs('#redemption-history-container');
    if (!container || !activeUserUid) return;

    try {
        const q = query(
            collection(db, "rewards_redemptions"),
            where("userId", "==", activeUserUid),
            limit(15)
        );
        const snap = await getDocs(q);

        if (snap.empty) {
            container.innerHTML = `
                <div class="text-center py-8 text-neutral-500 font-mono-tag text-xs">
                    No reward redemptions yet. Complete daily quests, invite friends, and claim perks above!
                </div>
            `;
            return;
        }

        const items = [];
        snap.forEach(d => items.push({ id: d.id, ...d.data() }));
        items.sort((a, b) => {
            const timeA = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : new Date(a.createdAt || 0).getTime();
            const timeB = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : new Date(b.createdAt || 0).getTime();
            return timeB - timeA;
        });

        container.innerHTML = items.map(item => {
            const dateStr = item.createdAt?.toDate 
                ? item.createdAt.toDate().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })
                : formatDate(item.createdAt);
            const isCompleted = (item.status === 'completed');
            const statusBadge = isCompleted
                ? '<span class="px-2 py-0.5 rounded text-[9px] font-mono-tag font-bold uppercase bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">Active / Fulfilled</span>'
                : '<span class="px-2 py-0.5 rounded text-[9px] font-mono-tag font-bold uppercase bg-amber-500/15 text-amber-400 border border-amber-500/30 animate-pulse">Processing Delivery</span>';

            return `
                <div class="p-3.5 rounded-xl bg-white/5 border border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-3 font-mono-tag text-xs">
                    <div class="flex items-center gap-3">
                        <div class="w-8 h-8 rounded-lg bg-[#FFD700]/10 border border-[#FFD700]/30 flex items-center justify-center text-[#FFD700] font-bold shrink-0">
                            🪙
                        </div>
                        <div>
                            <div class="font-heading font-bold text-white uppercase text-sm">${escapeHtml(item.rewardTitle || 'Reward')}</div>
                            <div class="text-[10px] text-neutral-400 mt-0.5 flex items-center gap-2 flex-wrap">
                                <span>${dateStr}</span>
                                ${item.lootDrop ? `<span class="text-purple-300 font-bold">• Drop: ${escapeHtml(item.lootDrop)}</span>` : ''}
                                ${item.voucherCode ? `<span class="text-neutral-300">• Code: <strong class="text-[#FFD700]">${escapeHtml(item.voucherCode)}</strong></span>` : ''}
                                ${item.gameDetails?.gameId ? `<span>• ID: <strong class="text-neutral-200">${escapeHtml(item.gameDetails.gameId)}</strong></span>` : ''}
                            </div>
                        </div>
                    </div>
                    <div class="flex items-center justify-between sm:justify-end gap-3 shrink-0">
                        <span class="text-[#FFD700] font-bold text-sm">-${item.costPoints || 0} CZ</span>
                        ${statusBadge}
                    </div>
                </div>
            `;
        }).join('');

    } catch (err) {
        console.warn("Could not load redemption receipts:", err);
    }
}

window.claimDailyCheckin = async function () {
    if (isCurrentProfilePublic || !auth.currentUser) {
        if (window.showWarningToast) window.showWarningToast("Action Restricted", "Daily check-in can only be claimed on your personal dashboard.");
        return;
    }

    const todayStr = getPHTDate();
    const lastCheckIn = activeUserData.lastCheckInDate || '';

    let isAlreadyClaimed = (lastCheckIn === todayStr);
    if (isAlreadyClaimed && (!activeUserData.czPoints || activeUserData.czPoints === 0) && (!activeUserData.lifetimePoints || activeUserData.lifetimePoints === 0)) {
        isAlreadyClaimed = false;
    }

    if (isAlreadyClaimed) {
        if (window.showWarningToast) window.showWarningToast("Already Claimed", "You have already claimed your daily check-in today! Next reset is at 12:00 AM PHT (midnight).");
        return;
    }

    const yesterdayStr = getPHTYesterday();

    const currentStreak = typeof activeUserData.dailyStreak === 'number' ? activeUserData.dailyStreak : 1;
    let newStreak = 1;

    if (lastCheckIn === yesterdayStr) {
        newStreak = (currentStreak % 7) + 1;
    } else if (!lastCheckIn) {
        newStreak = 1;
    } else {
        newStreak = 1; // Streak reset to day 1 after a missed day
    }

    const pointsToAward = (newStreak === 7) ? 50 : 15;
    const btn = qs('#daily-checkin-btn');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<span>Claiming...</span>';
    }

    try {
        const userRef = doc(db, "users", auth.currentUser.uid);
        await updateDoc(userRef, {
            czPoints: increment(pointsToAward),
            lifetimePoints: increment(pointsToAward),
            dailyStreak: newStreak,
            lastCheckInDate: todayStr
        });

        activeUserData.czPoints = (activeUserData.czPoints || 0) + pointsToAward;
        activeUserData.lifetimePoints = (activeUserData.lifetimePoints || 0) + pointsToAward;
        activeUserData.dailyStreak = newStreak;
        activeUserData.lastCheckInDate = todayStr;

        await loadRewardsData(activeUserData);

        if (window.showSuccessToast) {
            window.showSuccessToast(
                `Check-In Claimed! +${pointsToAward} CZ`,
                newStreak === 7 ? "Day 7 Mystery Drop unlocked! +50 CZ added to your vault." : `Day ${newStreak} of 7 streak active! Next reset at 12:00 AM PHT.`
            );
        }

    } catch (err) {
        console.error("Error claiming checkin:", err);
        if (window.showErrorToast) window.showErrorToast("Claim Failed", err.message || "Failed to claim check-in.");
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<span>Claim Check-In</span>';
        }
    }
};

window.copyReferralLink = function () {
    const input = qs('#user-referral-link-input');
    if (!input || !input.value) return;

    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(input.value).then(() => {
            if (window.showSuccessToast) {
                window.showSuccessToast("Invite Link Copied!", "Share with friends: You get +100 CZ per registered player, and they get +50 CZ.");
            }
        }).catch(() => {
            input.select();
            document.execCommand('copy');
            if (window.showSuccessToast) window.showSuccessToast("Invite Link Copied!", "Copied to clipboard.");
        });
    } else {
        input.select();
        document.execCommand('copy');
        if (window.showSuccessToast) window.showSuccessToast("Invite Link Copied!", "Copied to clipboard.");
    }
};

window.copyReferralCodeOnly = function () {
    const codeEl = qs('#user-referral-code-display');
    const code = codeEl ? codeEl.textContent.trim() : '';
    if (!code) return;

    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(code).then(() => {
            if (window.showSuccessToast) window.showSuccessToast("Referral Code Copied!", `Code "${code}" copied.`);
        });
    } else {
        if (window.showSuccessToast) window.showSuccessToast("Referral Code", `Code: ${code}`);
    }
};

const DEFAULT_REWARDS_META = {
    'pro_badge': { id: 'pro_badge', title: '1-Month Golden PRO Badge', cost: 300, gameType: 'platform' },
    'cz_mystery_crate': { id: 'cz_mystery_crate', title: 'CZ Mystery Esports Crate 🎁', cost: 250, gameType: 'platform' },
    'animated_title_apex': { id: 'animated_title_apex', title: 'Player Title: Apex Striker', cost: 450, gameType: 'flair' },
    'cyber_theme_hud': { id: 'cyber_theme_hud', title: 'Neon Cyberpunk Profile HUD', cost: 500, gameType: 'hud' },
    'val_points_475': { id: 'val_points_475', title: '475 Valorant Points (VP)', cost: 1000, gameType: 'valorant' },
    'mlbb_diamonds_100': { id: 'mlbb_diamonds_100', title: '100 MLBB Diamonds', cost: 800, gameType: 'mlbb' },
    'hok_tokens_100': { id: 'hok_tokens_100', title: '100 HOK Tokens', cost: 800, gameType: 'hok' }
};

window.openRedeemModalById = function (itemId) {
    const item = window.rewardsCatalogCache?.[itemId] || DEFAULT_REWARDS_META[itemId];
    if (item) {
        window.openRedeemModal(item.id, item.title, Number(item.cost) || 100, item.gameType || 'platform');
    } else {
        window.openRedeemModal(itemId, 'Reward', 100, 'platform');
    }
};

window.openRedeemModal = function (rewardId, title, cost, gameType) {
    if (isCurrentProfilePublic || !auth.currentUser) {
        if (window.showWarningToast) window.showWarningToast("Action Restricted", "Rewards can only be redeemed on your personal dashboard.");
        return;
    }

    if (rewardId === 'cz_pro_jersey' || rewardId === 'logitech_gpro_drop') {
        if (window.showWarningToast) window.showWarningToast("Currently Unavailable", "This reward is locked and coming soon in an upcoming rewards wave.");
        return;
    }

    const currentPoints = typeof activeUserData.czPoints === 'number' ? activeUserData.czPoints : 0;
    if (currentPoints < cost) {
        if (window.showWarningToast) {
            window.showWarningToast(
                "Insufficient CZ Points",
                `You need ${cost} CZ Points for this item. Your balance is ${currentPoints} CZ.`
            );
        }
        return;
    }

    if (qs('#modal-redeem-id')) qs('#modal-redeem-id').value = rewardId;
    if (qs('#modal-redeem-title')) qs('#modal-redeem-title').textContent = title;
    if (qs('#modal-redeem-cost')) qs('#modal-redeem-cost').textContent = `${cost} CZ Points`;
    if (qs('#modal-redeem-cost-val')) qs('#modal-redeem-cost-val').value = cost;
    if (qs('#modal-redeem-game-type')) qs('#modal-redeem-game-type').value = gameType || '';
    if (qs('#modal-redeem-balance-after')) qs('#modal-redeem-balance-after').textContent = `${(currentPoints - cost).toLocaleString()} CZ`;

    const gameInputsDiv = qs('#modal-game-info-inputs');
    const zoneWrapper = qs('#modal-zone-id-wrapper');
    const idLabel = qs('#modal-game-id-label');
    const idInput = qs('#modal-game-id-input');
    const zoneInput = qs('#modal-zone-id-input');

    if (idInput) idInput.value = '';
    if (zoneInput) zoneInput.value = '';

    if (gameType === 'mlbb') {
        if (gameInputsDiv) gameInputsDiv.classList.remove('hidden');
        if (zoneWrapper) zoneWrapper.classList.remove('hidden');
        if (idLabel) idLabel.textContent = 'MLBB User ID';
        if (idInput) {
            idInput.placeholder = 'e.g. 123456789';
            if (activeUserData.mlbbId) idInput.value = activeUserData.mlbbId;
        }
    } else if (gameType === 'valorant') {
        if (gameInputsDiv) gameInputsDiv.classList.remove('hidden');
        if (zoneWrapper) zoneWrapper.classList.add('hidden');
        if (idLabel) idLabel.textContent = 'Riot ID (e.g. Player#PH1)';
        if (idInput) {
            idInput.placeholder = 'e.g. JettMain#PH1';
            if (activeUserData.valId) idInput.value = activeUserData.valId;
        }
    } else if (gameType === 'hok') {
        if (gameInputsDiv) gameInputsDiv.classList.remove('hidden');
        if (zoneWrapper) zoneWrapper.classList.add('hidden');
        if (idLabel) idLabel.textContent = 'Honor of Kings UID';
        if (idInput) {
            idInput.placeholder = 'e.g. 987654321';
            if (activeUserData.hokId) idInput.value = activeUserData.hokId;
        }
    } else {
        if (gameInputsDiv) gameInputsDiv.classList.add('hidden');
    }

    const modal = qs('#rewardRedeemModal');
    if (modal) modal.classList.remove('hidden');
};

window.closeRedeemModal = function () {
    const modal = qs('#rewardRedeemModal');
    if (modal) modal.classList.add('hidden');
};

window.submitRewardRedeem = async function (e) {
    if (e && e.preventDefault) e.preventDefault();
    if (isCurrentProfilePublic || !auth.currentUser) return;
    const currentUid = auth.currentUser.uid;

    const rewardId = qs('#modal-redeem-id')?.value;
    const title = qs('#modal-redeem-title')?.textContent || 'Reward';
    const cost = parseInt(qs('#modal-redeem-cost-val')?.value, 10) || 0;
    const gameType = qs('#modal-redeem-game-type')?.value;
    const gameId = qs('#modal-game-id-input')?.value?.trim();
    const zoneId = qs('#modal-zone-id-input')?.value?.trim();

    // Only game-currency reward types require an in-game player ID
    const requiresGameId = gameType === 'mlbb' || gameType === 'valorant' || gameType === 'hok' || gameType === 'other';
    if (requiresGameId && !gameId) {
        if (window.showWarningToast) window.showWarningToast("Player ID Required", "Please provide your in-game player ID/IGN to receive your currency.");
        return;
    }

    const currentPoints = typeof activeUserData.czPoints === 'number' ? activeUserData.czPoints : 0;
    if (currentPoints < cost) {
        if (window.showWarningToast) window.showWarningToast("Insufficient Points", "You do not have enough CZ Points.");
        return;
    }

    const submitBtn = qs('#modal-redeem-submit-btn');
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Processing...';
    }

    try {
        // Verify stock limit from site_config/rewards_catalog if applicable
        try {
            const configRef = doc(db, "site_config", "rewards_catalog");
            const configSnap = await getDoc(configRef);
            if (configSnap.exists()) {
                const catalogItems = configSnap.data().items || [];
                const itemIndex = catalogItems.findIndex(it => it.id === rewardId);
                if (itemIndex !== -1) {
                    const it = catalogItems[itemIndex];
                    if (it.stockLimit > 0 && (it.claimedCount || 0) >= it.stockLimit) {
                        if (window.showWarningToast) window.showWarningToast("Reward Sold Out", "All available claims for this reward have been redeemed.");
                        if (submitBtn) {
                            submitBtn.disabled = false;
                            submitBtn.textContent = 'Confirm Claim';
                        }
                        await loadRewardsCatalog();
                        return;
                    }
                    it.claimedCount = (it.claimedCount || 0) + 1;
                    await setDoc(configRef, { items: catalogItems, updatedAt: serverTimestamp() }, { merge: true });
                }
            }
        } catch (stockErr) {
            console.warn("Could not check/update stock limit:", stockErr);
        }

        const userRef = doc(db, "users", currentUid);
        const updates = {
            czPoints: increment(-cost)
        };

        const isInstantPro = (rewardId === 'pro_badge');
        const isMysteryCrate = (rewardId === 'cz_mystery_crate');
        const isApexTitle = (rewardId === 'animated_title_apex');
        const isCyberTheme = (rewardId === 'cyber_theme_hud');
        let mysteryLoot = null;

        if (isInstantPro) {
            const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
            updates.isSupporter = true;
            updates.supporterTier = 'gold';
            updates.supporterBadge = 'PRO';
            updates.supporterSince = new Date().toISOString();
            updates.supporterExpiresAt = Date.now() + thirtyDaysMs;
        } else if (isMysteryCrate) {
            mysteryLoot = rollMysteryCrate();
            if (mysteryLoot.type === 'points') {
                updates.czPoints = increment(-cost + mysteryLoot.points);
                updates.lifetimePoints = increment(mysteryLoot.points);
            } else if (mysteryLoot.type === 'title') {
                updates.playerTitle = mysteryLoot.titleName;
                updates.unlockedTitles = arrayUnion(mysteryLoot.titleName);
            } else if (mysteryLoot.type === 'supporter') {
                const extraDays = (mysteryLoot.days || 14) * 24 * 60 * 60 * 1000;
                const currentExpire = (activeUserData.supporterExpiresAt && activeUserData.supporterExpiresAt > Date.now()) ? activeUserData.supporterExpiresAt : Date.now();
                updates.isSupporter = true;
                updates.supporterTier = 'gold';
                updates.supporterBadge = 'PRO';
                updates.supporterExpiresAt = currentExpire + extraDays;
            } else if (mysteryLoot.type === 'theme') {
                updates.profileTheme = 'cyberpunk';
                updates.unlockedThemes = arrayUnion('cyberpunk');
            }
        } else if (isApexTitle) {
            updates.playerTitle = 'Apex Striker';
            updates.unlockedTitles = arrayUnion('Apex Striker');
        } else if (isCyberTheme) {
            updates.profileTheme = 'cyberpunk';
            updates.unlockedThemes = arrayUnion('cyberpunk');
        }

        await updateDoc(userRef, updates);

        const isInstantCompleted = isInstantPro || isMysteryCrate || isApexTitle || isCyberTheme || rewardId === 'spotlight_48h' || rewardId === 'tournament_pass';
        const voucherCode = !isInstantCompleted ? `CZ-${(gameType || 'RW').toUpperCase()}-${Math.floor(10000 + Math.random() * 90000)}` : null;

        await addDoc(collection(db, "rewards_redemptions"), {
            userId: currentUid,
            userEmail: auth.currentUser?.email || '',
            userName: activeUserData.displayName || activeUserData.ign || 'Champion',
            rewardId: rewardId,
            rewardTitle: title,
            costPoints: cost,
            lootDrop: mysteryLoot ? mysteryLoot.title : null,
            voucherCode: voucherCode,
            gameType: gameType || null,
            gameDetails: {
                gameId: gameId || null,
                zoneId: zoneId || null
            },
            status: isInstantCompleted ? 'completed' : 'pending_delivery',
            createdAt: serverTimestamp()
        });

        // Optimistic local state update
        if (isMysteryCrate && mysteryLoot && mysteryLoot.type === 'points') {
            activeUserData.czPoints = currentPoints - cost + mysteryLoot.points;
            activeUserData.lifetimePoints = (activeUserData.lifetimePoints || 0) + mysteryLoot.points;
        } else {
            activeUserData.czPoints = currentPoints - cost;
        }

        if (isInstantPro) {
            activeUserData.isSupporter = true;
            activeUserData.supporterTier = 'gold';
            activeUserData.supporterBadge = 'PRO';
            activeUserData.supporterExpiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
        } else if (isMysteryCrate && mysteryLoot) {
            if (mysteryLoot.type === 'title') {
                activeUserData.playerTitle = mysteryLoot.titleName;
                if (!activeUserData.unlockedTitles) activeUserData.unlockedTitles = [];
                if (!activeUserData.unlockedTitles.includes(mysteryLoot.titleName)) activeUserData.unlockedTitles.push(mysteryLoot.titleName);
            } else if (mysteryLoot.type === 'supporter') {
                activeUserData.isSupporter = true;
                activeUserData.supporterTier = 'gold';
                activeUserData.supporterBadge = 'PRO';
                activeUserData.supporterExpiresAt = Date.now() + 14 * 24 * 60 * 60 * 1000;
            } else if (mysteryLoot.type === 'theme') {
                activeUserData.profileTheme = 'cyberpunk';
                if (!activeUserData.unlockedThemes) activeUserData.unlockedThemes = [];
                if (!activeUserData.unlockedThemes.includes('cyberpunk')) activeUserData.unlockedThemes.push('cyberpunk');
            }
        } else if (isApexTitle) {
            activeUserData.playerTitle = 'Apex Striker';
            if (!activeUserData.unlockedTitles) activeUserData.unlockedTitles = [];
            if (!activeUserData.unlockedTitles.includes('Apex Striker')) activeUserData.unlockedTitles.push('Apex Striker');
        } else if (isCyberTheme) {
            activeUserData.profileTheme = 'cyberpunk';
            if (!activeUserData.unlockedThemes) activeUserData.unlockedThemes = [];
            if (!activeUserData.unlockedThemes.includes('cyberpunk')) activeUserData.unlockedThemes.push('cyberpunk');
        }

        window.closeRedeemModal();

        if (isMysteryCrate && mysteryLoot) {
            window.showMysteryCrateOpening(mysteryLoot);
        } else if (isApexTitle) {
            if (window.showSuccessToast) window.showSuccessToast("Title Flair Equipped! ⚡", "Holographic 'Apex Striker' title is now live on your profile & chat!");
        } else if (isCyberTheme) {
            if (window.showSuccessToast) window.showSuccessToast("Cyberpunk HUD Activated! 🌐", "Futuristic neon theme equipped across your player dossier!");
        } else if (isInstantPro) {
            if (window.showSuccessToast) window.showSuccessToast("PRO Status Activated! 👑", "Golden PRO Supporter status active for 30 days on your profile!");
        } else {
            if (window.showSuccessToast) window.showSuccessToast("Reward Claimed! 🪙", `Receipt generated for ${title}. Voucher: ${voucherCode}`);
        }

        await loadUserProfile(activeUserUid, auth.currentUser?.email);
        await loadRewardsData(activeUserData);

    } catch (err) {
        console.error("Error submitting redemption:", err);
        if (window.showErrorToast) window.showErrorToast("Redemption Error", err.message || "Failed to redeem reward.");
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Confirm Claim';
        }
    }
};

// ----------------------------------------------------
// 6. REWARDS HELPER ENGINES (MYSTERY CRATE, TITLE, THEME, QUEST COUNTDOWN)
// ----------------------------------------------------

function rollMysteryCrate() {
    const roll = Math.floor(Math.random() * 100) + 1; // 1 to 100
    if (roll <= 10) {
        // 10%: JACKPOT
        return {
            type: 'points',
            points: 500,
            tier: 'LEGENDARY JACKPOT 🌟',
            title: '+500 CZ Mega Jackpot!',
            icon: '💎',
            desc: 'Incredible luck! You hit the maximum jackpot drop of 500 CZ points added directly to your vault.'
        };
    } else if (roll <= 35) {
        // 25%: BONUS POINTS
        const bonusPts = roll <= 20 ? 300 : 200;
        return {
            type: 'points',
            points: bonusPts,
            tier: 'BONUS VAULT DROP 🪙',
            title: `+${bonusPts} CZ Points Cache`,
            icon: '🪙',
            desc: `Lucky roll! A reward cache of ${bonusPts} CZ points has been deposited to your balance.`
        };
    } else if (roll <= 65) {
        // 30%: EXCLUSIVE PLAYER TITLE
        const titles = [
            { name: "Shadow Assassin", desc: "Equipped the stealthy 'Shadow Assassin' holographic title badge." },
            { name: "Phantom Carry", desc: "Equipped the prestigious 'Phantom Carry' holographic title badge." },
            { name: "Cyber Samurai", desc: "Equipped the neon 'Cyber Samurai' holographic title badge." },
            { name: "Void Walker", desc: "Equipped the cosmic 'Void Walker' holographic title badge." },
            { name: "Relentless", desc: "Equipped the fearsome 'Relentless' holographic title badge." }
        ];
        const selected = titles[Math.floor(Math.random() * titles.length)];
        return {
            type: 'title',
            titleName: selected.name,
            tier: 'EXCLUSIVE TITLE FLAIR ⚡',
            title: `Title: '${selected.name}'`,
            icon: '⚡',
            desc: selected.desc
        };
    } else if (roll <= 85) {
        // 20%: 14-DAY PRO SUPPORTER PASS
        return {
            type: 'supporter',
            days: 14,
            tier: 'VIP SUPPORTER PASS 👑',
            title: '14-Day Golden PRO Status',
            icon: '👑',
            desc: 'Activated 14 days of Golden PRO supporter status across tournament brackets, profile HUD, and chat!'
        };
    } else {
        // 15%: CYBERPUNK HUD THEME
        return {
            type: 'theme',
            themeName: 'cyberpunk',
            tier: 'COSMETIC HUD UNLOCK 🌐',
            title: 'Neon Cyberpunk Profile HUD',
            icon: '🌐',
            desc: 'Unlocked futuristic neon cyan & magenta visual aesthetics across your player dossier!'
        };
    }
}

function playVictoryChime() {
    try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return;
        const ctx = new AudioContext();
        const now = ctx.currentTime;
        const notes = [440, 554.37, 659.25, 880];
        notes.forEach((freq, idx) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(freq, now + idx * 0.12);
            gain.gain.setValueAtTime(0.001, now + idx * 0.12);
            gain.gain.exponentialRampToValueAtTime(0.22, now + idx * 0.12 + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.0001, now + idx * 0.12 + 0.4);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(now + idx * 0.12);
            osc.stop(now + idx * 0.12 + 0.45);
        });
    } catch (e) {}
}

window.showMysteryCrateOpening = function (loot) {
    const modal = qs('#mysteryCrateModal');
    const openingPhase = qs('#crate-opening-phase');
    const revealPhase = qs('#crate-reveal-phase');
    if (!modal) return;

    if (openingPhase) openingPhase.classList.remove('hidden');
    if (revealPhase) revealPhase.classList.add('hidden');
    modal.classList.remove('hidden');

    setTimeout(() => {
        playVictoryChime();
        if (openingPhase) openingPhase.classList.add('hidden');
        if (revealPhase) revealPhase.classList.remove('hidden');

        const tierEl = qs('#crate-reward-tier');
        const titleEl = qs('#crate-reward-title');
        const descEl = qs('#crate-reward-desc');
        const iconEl = qs('#crate-reward-icon');

        if (tierEl) tierEl.textContent = loot.tier || 'RARE DROP';
        if (titleEl) titleEl.textContent = loot.title;
        if (descEl) descEl.textContent = loot.desc;
        if (iconEl) iconEl.textContent = loot.icon || '🎁';
    }, 1400);
};

window.closeMysteryCrateModal = function () {
    const modal = qs('#mysteryCrateModal');
    if (modal) modal.classList.add('hidden');
};

window.toggleCyberpunkTheme = async function () {
    if (isCurrentProfilePublic || !auth.currentUser) return;
    const targetUid = auth.currentUser.uid;
    const currentTheme = activeUserData.profileTheme || 'default';
    const newTheme = (currentTheme === 'cyberpunk') ? 'default' : 'cyberpunk';
    
    activeUserData.profileTheme = newTheme;
    document.body.classList.toggle('theme-cyberpunk', newTheme === 'cyberpunk');
    const label = qs('#current-theme-label');
    if (label) label.textContent = newTheme === 'cyberpunk' ? 'Cyberpunk' : 'Default Dark';

    try {
        await updateDoc(doc(db, "users", targetUid), { profileTheme: newTheme });
        if (window.showSuccessToast) {
            window.showSuccessToast("HUD Theme Updated", `Profile style switched to ${newTheme === 'cyberpunk' ? 'Neon Cyberpunk HUD' : 'Default Dark'}.`);
        }
    } catch (e) {
        console.warn("Could not save theme preference:", e);
    }
};

window.openTitleSelectModal = function () {
    const modal = qs('#titleSelectorModal');
    const container = qs('#unlocked-titles-list');
    if (!modal || !container) return;

    const titles = Array.isArray(activeUserData.unlockedTitles) ? [...activeUserData.unlockedTitles] : [];
    if (activeUserData.playerTitle && !titles.includes(activeUserData.playerTitle)) {
        titles.unshift(activeUserData.playerTitle);
    }

    if (titles.length === 0) {
        container.innerHTML = `
            <div class="text-center py-6 text-neutral-400 text-xs font-mono-tag">
                No custom titles unlocked yet.<br>
                <span class="text-neutral-500 text-[11px]">Redeem the Apex Striker title or unbox Mystery Crates in the Rewards Vault!</span>
            </div>
        `;
    } else {
        container.innerHTML = titles.map(t => {
            const isEquipped = (activeUserData.playerTitle === t);
            return `
                <div class="flex items-center justify-between p-3 rounded-xl bg-white/5 border ${isEquipped ? 'border-indigo-500/60 bg-indigo-500/10' : 'border-white/10'} transition-all">
                    <div class="flex items-center gap-2">
                        <span class="text-indigo-400 text-sm">⚡</span>
                        <span class="font-mono-tag font-bold text-xs text-white">${escapeHtml(t)}</span>
                        ${isEquipped ? '<span class="text-[9px] font-mono-tag font-bold uppercase bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 px-1.5 py-0.2 rounded">Equipped</span>' : ''}
                    </div>
                    <button type="button" onclick="window.equipTitle('${escapeHtml(t).replace(/'/g, "\\'")}')"
                        class="px-3 py-1 rounded-lg text-xs font-heading font-bold uppercase transition-all ${isEquipped ? 'bg-white/10 text-neutral-400 cursor-default' : 'bg-indigo-600 hover:bg-indigo-500 text-white cursor-pointer'}">
                        ${isEquipped ? 'Active' : 'Equip'}
                    </button>
                </div>
            `;
        }).join('');
    }

    modal.classList.remove('hidden');
};

window.closeTitleSelectModal = function () {
    const modal = qs('#titleSelectorModal');
    if (modal) modal.classList.add('hidden');
};

window.equipTitle = async function (title) {
    if (isCurrentProfilePublic || !auth.currentUser) return;
    const targetUid = auth.currentUser.uid;
    activeUserData.playerTitle = title || null;
    
    const titleBadgeEl = qs('#player-title-badge');
    const titleTextEl = qs('#player-title-text');
    if (titleBadgeEl) {
        if (title) {
            titleBadgeEl.classList.remove('hidden');
            if (titleTextEl) titleTextEl.textContent = title;
        } else {
            titleBadgeEl.classList.add('hidden');
        }
    }

    window.closeTitleSelectModal();

    try {
        await updateDoc(doc(db, "users", targetUid), { playerTitle: title || null });
        if (window.showSuccessToast) {
            window.showSuccessToast("Title Updated", title ? `Equipped '${title}' title flair!` : "Player title unequipped.");
        }
    } catch (e) {
        console.warn("Could not equip title:", e);
    }
};

window.quickScoutRival = async function () {
    if (!activeUserUid) {
        if (window.showWarningToast) window.showWarningToast("Sign In Required", "Log in to complete the Scout Rivals quest.");
        window.location.href = '/teams';
        return;
    }

    const todayStr = getPHTDate();
    let wasAlreadyDone = (activeUserData.lastDailyScoutDate === todayStr);

    if (!wasAlreadyDone) {
        try {
            const userRef = doc(db, "users", activeUserUid);
            await updateDoc(userRef, {
                czPoints: increment(15),
                lifetimePoints: increment(15),
                lastDailyScoutDate: todayStr
            });

            activeUserData.czPoints = (activeUserData.czPoints || 0) + 15;
            activeUserData.lifetimePoints = (activeUserData.lifetimePoints || 0) + 15;
            activeUserData.lastDailyScoutDate = todayStr;

            await loadRewardsData(activeUserData);

            if (window.showSuccessToast) {
                window.showSuccessToast("Daily Quest Completed! 🔍", "+15 CZ Points awarded for scouting contender squads! Opening Teams Hub...");
            }
        } catch (e) {
            console.warn("Could not award scout quest:", e);
        }
    }

    setTimeout(() => {
        window.location.href = '/teams';
    }, 600);
};

let questCountdownInterval = null;
function startQuestCountdown() {
    if (questCountdownInterval) clearInterval(questCountdownInterval);

    function update() {
        const el = qs('#quest-countdown');
        if (!el) return;

        // Current time in PHT (UTC+8)
        const now = new Date();
        const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
        const phtNow = new Date(utc + (3600000 * 8));

        // Next midnight in PHT
        const nextMidnight = new Date(phtNow);
        nextMidnight.setHours(24, 0, 0, 0);

        const diff = nextMidnight.getTime() - phtNow.getTime();
        if (diff <= 0) {
            el.textContent = 'Resetting...';
            return;
        }

        const hours = Math.floor(diff / (1000 * 60 * 60));
        const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        const secs = Math.floor((diff % (1000 * 60)) / 1000);

        el.textContent = `${hours}h ${mins}m ${secs}s`;
    }

    update();
    questCountdownInterval = setInterval(update, 1000);
}


