import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-auth.js";
import { doc, getDoc, updateDoc, addDoc, collection, getDocs, query, orderBy, limit } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-firestore.js";

let activeUserUid = null;
let activeUserData = {};

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

// Immediate optimistic player render from auth state
function renderOptimisticHeader(user) {
    if (!user) return;
    const immediateName = user.displayName || (user.email ? user.email.split('@')[0] : 'Champion');
    if (qs('#display-name-header')) qs('#display-name-header').textContent = immediateName;
    if (qs('#email-display')) qs('#email-display').textContent = user.email || '';
    if (qs('#account-email-display')) qs('#account-email-display').textContent = user.email || '--';
    if (qs('#ign-display')) qs('#ign-display').textContent = immediateName;
    if (user.photoURL && qs('#profile-avatar')) {
        qs('#profile-avatar').src = user.photoURL;
    } else if (qs('#profile-avatar')) {
        qs('#profile-avatar').src = 'https://ui-avatars.com/api/?name=' + encodeURIComponent(immediateName) + '&background=111116&color=FFD700';
    }
}

// 1. AUTH PROTECTION & INITIAL LOAD
async function initProfileForUser(user) {
    if (!user) {
        window.location.href = "/login";
        return;
    }

    // Immediately paint optimistic user details
    renderOptimisticHeader(user);
    
    // Load Profile Data from Firestore
    await loadUserProfile(user.uid, user.email);

    // Check for PayRex Cash-In Return Callbacks
    const urlParams = new URLSearchParams(window.location.search);
    const cashinStatus = urlParams.get('cashin_status');
    const sessionId = urlParams.get('session_id');
    const amountVal = parseFloat(urlParams.get('amount')) || 0;

    if (cashinStatus === 'success' && sessionId) {
        window.switchProfileTab('organizer');
        
        try {
            // Check if this PayRex session has already been credited
            const existingSnap = await getDocs(collection(db, "cashins"));
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
                    window.showSuccessToast('Prize Pool Funded', `Payment verified! ₱${amountVal ? amountVal.toLocaleString() : ''} has been credited to your organizer balance via PayRex.`);
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

// Immediate check if currentUser already loaded
if (auth.currentUser) {
    initProfileForUser(auth.currentUser);
}

// ==========================================
// 1. TAB NAVIGATION: PLAYER VS ORGANIZER
// ==========================================
window.switchProfileTab = function (tab) {
    const playerTabBtn = qs('#tab-btn-player');
    const organizerTabBtn = qs('#tab-btn-organizer');
    const playerPane = qs('#tab-pane-player');
    const organizerPane = qs('#tab-pane-organizer');
    if (tab === 'organizer') {
        if (playerTabBtn) {
            playerTabBtn.className = 'px-5 py-2.5 rounded-lg bg-white/5 hover:bg-white/10 text-neutral-300 border border-white/10 transition-all cursor-pointer flex items-center gap-2';
        }
        if (organizerTabBtn) {
            organizerTabBtn.className = 'px-5 py-2.5 rounded-lg bg-[#FFD700] text-black font-black transition-all cursor-pointer shadow-md flex items-center gap-2';
        }
        if (playerPane) playerPane.classList.add('hidden');
        if (organizerPane) organizerPane.classList.remove('hidden');
    } else {
        if (playerTabBtn) {
            playerTabBtn.className = 'px-5 py-2.5 rounded-lg bg-[#FFD700] text-black font-black transition-all cursor-pointer shadow-md flex items-center gap-2';
        }
        if (organizerTabBtn) {
            organizerTabBtn.className = 'px-5 py-2.5 rounded-lg bg-white/5 hover:bg-white/10 text-neutral-300 border border-white/10 transition-all cursor-pointer flex items-center gap-2';
        }
        if (playerPane) playerPane.classList.remove('hidden');
    }
};

// 2. FETCH & DISPLAY PROFILE DATA WITH TOURNAMENT TROPHIES & EARNINGS
async function loadUserProfile(uid, email) {
    try {
        const docRef = doc(db, "users", uid);
        const docSnap = await getDoc(docRef);

        let userData = {};
        if (docSnap.exists()) {
            userData = docSnap.data() || {};
        }

        const userEmail = userData.email || email || (auth.currentUser ? auth.currentUser.email : '');
        const userIgn = userData.ign || userData.displayName || userData.username || (auth.currentUser ? (auth.currentUser.displayName || auth.currentUser.email?.split('@')[0]) : '') || 'Champion';
        
        // Display Name, Email & Avatar
        if (qs('#display-name-header')) qs('#display-name-header').textContent = userIgn;
        if (qs('#email-display')) qs('#email-display').textContent = userEmail;
        if (qs('#account-email-display')) qs('#account-email-display').textContent = userEmail || '--';
        
        const avatarUrl = userData.avatar || (auth.currentUser ? auth.currentUser.photoURL : null) || ('https://ui-avatars.com/api/?name=' + encodeURIComponent(userIgn) + '&background=111116&color=FFD700');
        if (qs('#profile-avatar')) {
            qs('#profile-avatar').src = avatarUrl;
        }

        // Role Badge
        const roleBadge = qs('#role-badge');
        const rawRole = String(userData.role || window.currentUserRole || '').toLowerCase();
        const isAdmin = (rawRole === 'admin' || rawRole === 'superadmin' || rawRole === 'administrator' || userEmail === 'admin@champzero.com' || (auth.currentUser && auth.currentUser.email === 'admin@champzero.com'));
        const isOrganizer = (rawRole === 'organizer' || rawRole === 'host');

        if (roleBadge) {
            if (isAdmin) {
                roleBadge.textContent = 'ADMIN';
                roleBadge.className = 'inline-flex items-center px-3 py-1 rounded-full bg-red-500/10 text-red-400 text-xs font-bold border border-red-500/20';
            } else if (isOrganizer) {
                roleBadge.textContent = 'ORGANIZER';
                roleBadge.className = 'inline-flex items-center px-3 py-1 rounded-full bg-purple-500/10 text-purple-400 text-xs font-bold border border-purple-500/20';
            } else {
                roleBadge.textContent = 'MEMBER';
                roleBadge.className = 'inline-flex items-center px-3 py-1 rounded-full bg-[var(--gold)]/10 text-[var(--gold)] text-xs font-bold border border-[var(--gold)]/20';
            }
        }

        // Supporter Status & Badge Logic
        const isSupporter = Boolean(userData.isSupporter || userData.supporterTier || userData.supporterBadge);
        const supporterTier = String(userData.supporterTier || 'bronze').toLowerCase();
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
            }
        }

        // Supporter Card in Profile Tab
        const supporterCardTitle = qs('#supporter-card-tier-title');
        const supporterCardStatus = qs('#supporter-card-status-pill');
        const supporterCardDesc = qs('#supporter-card-desc');
        const supporterCtaText = qs('#supporter-hub-cta-text');

        if (isSupporter) {
            if (supporterCardTitle) {
                supporterCardTitle.textContent = supporterTier === 'gold' 
                    ? 'Grand Champion Gold Patron' 
                    : (supporterTier === 'silver' ? 'Arena Elite Supporter' : 'Champion Bronze Scout');
            }
            if (supporterCardStatus) {
                supporterCardStatus.textContent = 'Active Backer';
                supporterCardStatus.className = 'font-mono-tag text-[9px] font-bold uppercase px-2 py-0.5 rounded bg-[#FFD700]/20 text-[#FFD700] border border-[#FFD700]/40';
            }
            if (supporterCardDesc) {
                const dateStr = userData.supporterSince ? new Date(userData.supporterSince).toLocaleDateString([], { month: 'short', year: 'numeric' }) : '2026';
                supporterCardDesc.textContent = `Active backer of ChampZero since ${dateStr}. Thank you for powering our grassroots tournaments and livestream broadcast labs!`;
            }
            if (supporterCtaText) supporterCtaText.textContent = 'Supporter Active';
        } else {
            if (supporterCardTitle) supporterCardTitle.textContent = 'Join the Supporter Club';
            if (supporterCardStatus) {
                supporterCardStatus.textContent = 'Free Member';
                supporterCardStatus.className = 'font-mono-tag text-[9px] font-bold uppercase px-2 py-0.5 rounded bg-white/5 text-neutral-400 border border-white/10';
            }
            if (supporterCardDesc) {
                supporterCardDesc.textContent = 'Support grassroots tournament prize pools, broadcast production, and unlock verified supporter badges, golden profile borders, and VIP chat flairs.';
            }
            if (supporterCtaText) supporterCtaText.textContent = 'Support ChampZero';
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

        // 3. RENDER SAVED WITHDRAWAL / PAYOUT METHOD
        try {
            renderWithdrawalMethodDisplay(userData.payoutMethod);
        } catch (e) {
            console.warn("Error rendering withdrawal preview:", e);
        }

        // 4. QUERY TOURNAMENTS
        let allTourneys = [];
        try {
            const tourneysSnap = await getDocs(collection(db, "tournaments"));
            tourneysSnap.forEach(docSnap => allTourneys.push({ id: docSnap.id, ...docSnap.data() }));
        } catch (tourneyErr) {
            console.warn("Could not query tournaments collection:", tourneyErr);
        }

        try {
            await calculateTournamentStats(uid, userIgn, allTourneys);
        } catch (statsErr) {
            console.warn("Error calculating tournament stats:", statsErr);
        }

        // 5. IF ORGANIZER OR ADMIN: ENABLE ORGANIZER TAB & CALCULATE FINANCIALS
        const isOrganizerOrAdmin = (isOrganizer || isAdmin);

        const tabOrganizerBtn = qs('#tab-btn-organizer');
        const tabOrganizerTitle = qs('#tab-organizer-title');

        if (isOrganizerOrAdmin) {
            if (tabOrganizerBtn) tabOrganizerBtn.classList.remove('hidden');
            if (tabOrganizerTitle) tabOrganizerTitle.textContent = isAdmin ? 'Admin Command' : 'Organizer Command';
            try {
                await calculateOrganizerStats(uid, email, allTourneys, isAdmin);
            } catch (orgErr) {
                console.warn("Error calculating organizer stats:", orgErr);
            }
        } else {
            if (tabOrganizerBtn) tabOrganizerBtn.classList.add('hidden');
            window.switchProfileTab('player');
        }

    } catch (error) {
        console.error("Error fetching profile:", error);
        if (window.showErrorToast) {
            window.showErrorToast("Error", "Failed to load profile data", 3000);
        }
    }
}

async function calculateTournamentStats(uid, userIgn, allTourneys) {
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

        // Update DOM Stats
        if (qs('#tournaments-count')) qs('#tournaments-count').textContent = playedCount;
        if (qs('#prizes-earned')) qs('#prizes-earned').textContent = `₱${totalEarnings.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        if (qs('#podium-count')) qs('#podium-count').textContent = (champCount + secondCount + thirdCount);
        
        const winRate = matchesTotal > 0 ? Math.round((matchesWon / matchesTotal) * 100) : null;
        if (qs('#win-rate')) qs('#win-rate').textContent = winRate !== null ? `${winRate}%` : '--';

        // Update Trophy Cabinet Counters
        if (qs('#championships-count')) qs('#championships-count').textContent = champCount;
        if (qs('#second-place-count')) qs('#second-place-count').textContent = secondCount;
        if (qs('#third-place-count')) qs('#third-place-count').textContent = thirdCount;

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

async function calculateOrganizerStats(uid, email, allTourneys, isAdmin = false) {
    const orgDashboard = qs('#organizer-dashboard-section');
    if (!orgDashboard) return;

    // Update dynamic header labels based on whether user is Admin or Organizer
    const badgeLabel = qs('#org-badge-label');
    const titleLabel = qs('#org-title-label');
    const tableTitle = qs('#org-table-title');

    if (isAdmin) {
        if (badgeLabel) badgeLabel.textContent = 'ADMIN PLATFORM COMMAND';
        if (titleLabel) titleLabel.textContent = 'Platform Tournaments & Financial Audits';
        if (tableTitle) tableTitle.textContent = 'All Platform Tournaments';
    } else {
        if (badgeLabel) badgeLabel.textContent = 'ORGANIZER COMMAND';
        if (titleLabel) titleLabel.textContent = 'Host Operations & Financials';
        if (tableTitle) tableTitle.textContent = 'Your Hosted Tournaments';
    }

    let hostedCount = 0;
    let totalParticipants = 0;
    let grossCollected = 0;
    let totalPrizePoolsCommitted = 0;
    const hostedItems = [];

    allTourneys.forEach(t => {
        // Admins see all platform tournaments; Organizers see their own
        const isHostedByMe = isAdmin || t.createdBy === uid || (email === 'admin@champzero.com' && t.createdBy === uid);
        if (!isHostedByMe) return;

        hostedCount++;
        const parts = t.participants || [];
        const partCount = parts.length;
        totalParticipants += partCount;

        const entryFee = parseFloat(t.entryFee) || 0;
        const tournamentPrize = parseFloat(t.prize) || 0;
        totalPrizePoolsCommitted += tournamentPrize;

        const isPaid = (t.paymentType === 'manual' || t.paymentType === 'automatic' || t.entryType === 'Paid') && entryFee > 0;
        
        // Gross fees collected from registered participants (0% platform fee)
        const tournamentGross = isPaid ? (partCount * entryFee) : 0;
        const platformFee = 0;
        const netRegFunds = tournamentGross - platformFee;
        const netStandingTourney = netRegFunds - tournamentPrize;

        grossCollected += tournamentGross;

        hostedItems.push({
            id: t.id,
            name: t.name || 'Tournament',
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

    const totalPlatformFee = 0;
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
            hostedListEl.innerHTML = `<div class="text-center py-6 text-neutral-500 text-xs italic">${isAdmin ? 'No tournaments created on the platform yet.' : 'No tournaments hosted yet. Browse the Tournaments page to create an event.'}</div>`;
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
                                <div class="text-[8px] text-emerald-400 uppercase">Fee (0%)</div>
                                <div class="text-xs font-bold text-emerald-400">₱0.00</div>
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
        const [cashinsSnap, withdrawalsSnap] = await Promise.all([
            getDocs(collection(db, "cashins")),
            getDocs(collection(db, "withdrawals"))
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

        let responseData = null;

        // Try Netlify function first
        try {
            const res = await fetch('/.netlify/functions/payrex-checkout', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (res.ok) {
                responseData = await res.json();
            }
        } catch (netErr) {
            console.warn('Netlify function unavailable, trying Express API route:', netErr);
        }

        // Fallback to Express backend if Netlify function not available
        if (!responseData || !responseData.url) {
            const apiRes = await fetch('/api/payrex/create-checkout-session', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (apiRes.ok) {
                responseData = await apiRes.json();
            }
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
