// js/community-chat.js - ChampZero Real-Time Global Chat, Online Presence & Social Hub
import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-auth.js";
import { 
    collection, 
    addDoc, 
    getDocs, 
    getDoc, 
    setDoc, 
    updateDoc, 
    doc, 
    query, 
    orderBy, 
    limit, 
    onSnapshot, 
    serverTimestamp,
    where 
} from "https://www.gstatic.com/firebasejs/11.1.0/firebase-firestore.js";

let currentUser = null;
let currentProfile = {};
let isChatOpen = false;
let activeTab = 'chat';
let isSoundEnabled = true;
let unreadCount = 0;
let onlineUsersList = [];
let allRegisteredUsers = [];
let myFriendsList = [];
let pendingRequestsList = [];
let unsubscribeChat = null;
let unsubscribeOnline = null;
let unsubscribeRequests = null;

// Helper: Escape HTML
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

// Helper: Synthesize Gentle Esports Audio Chime (Web Audio API - 0 asset dependencies)
function playChatChime() {
    if (!isSoundEnabled) return;
    try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return;
        const ctx = new AudioContext();
        
        const now = ctx.currentTime;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        
        osc.type = 'sine';
        osc.frequency.setValueAtTime(587.33, now); // D5
        osc.frequency.exponentialRampToValueAtTime(880.00, now + 0.08); // A5
        
        gain.gain.setValueAtTime(0.08, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
        
        osc.connect(gain);
        gain.connect(ctx.destination);
        
        osc.start(now);
        osc.stop(now + 0.26);
    } catch (e) {
        // AudioContext may be blocked before first user gesture
    }
}

// ----------------------------------------------------
// 1. INJECT FLOATING LAUNCHER & SOCIAL HUB UI
// ----------------------------------------------------
function injectCommunityUI() {
    if (document.getElementById('cz-community-root')) return;

    const root = document.createElement('div');
    root.id = 'cz-community-root';
    root.className = 'fixed bottom-5 right-5 z-[9990] font-sans select-none';

    root.innerHTML = `
        <!-- FLOATING LAUNCHER PILL -->
        <div id="cz-chat-launcher-wrap" class="flex items-center gap-2">
            <button id="cz-chat-launcher" type="button"
                class="group flex items-center gap-2.5 px-4 py-2.5 rounded-full bg-[#0A0A0F]/95 hover:bg-[#14141E] text-white border border-[#FFD700]/40 hover:border-[#FFD700] shadow-[0_4px_20px_rgba(255,215,0,0.15)] backdrop-blur-xl transition-all duration-200 cursor-pointer">
                <div class="relative flex items-center justify-center">
                    <svg class="w-4 h-4 text-[#FFD700] group-hover:scale-110 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" 
                            d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"></path>
                    </svg>
                    <span id="cz-unread-badge" class="hidden absolute -top-2 -right-2 px-1.5 py-0.2 bg-rose-500 text-white text-[9px] font-black rounded-full shadow animate-pulse">0</span>
                </div>
                <span class="font-heading font-black text-xs uppercase tracking-wider text-white">Global Chat</span>
                <span class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[10px] font-bold">
                    <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping"></span>
                    <span id="cz-online-pill-count">1</span> Online
                </span>
            </button>
        </div>

        <!-- SOCIAL & CHAT DRAWER / WINDOW -->
        <div id="cz-chat-card" class="hidden absolute bottom-14 right-0 w-[360px] sm:w-[410px] max-w-[calc(100vw-32px)] h-[560px] max-h-[calc(100vh-100px)] rounded-2xl bg-[#0B0B10]/98 border border-white/15 shadow-[0_12px_40px_rgba(0,0,0,0.8)] backdrop-blur-2xl flex flex-col overflow-hidden transition-all duration-300">
            
            <!-- HEADER -->
            <div class="px-4 py-3 bg-black/60 border-b border-white/10 flex items-center justify-between">
                <div class="flex items-center gap-2">
                    <div class="w-7 h-7 flex items-center justify-center">
                        <img src="pictures/cz_logo.png" class="w-6 h-6 object-contain" alt="Logo">
                    </div>
                    <div>
                        <h3 class="font-heading font-black text-xs text-white uppercase tracking-wider">Community Hub</h3>
                        <div class="flex items-center gap-1.5 text-[10px] text-neutral-400 font-mono">
                            <span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                            <span id="cz-online-header-count">1 Online</span>
                        </div>
                    </div>
                </div>
                <div class="flex items-center gap-1">
                    <button id="cz-sound-toggle" type="button" title="Toggle Chime Sound"
                        class="p-1.5 rounded-lg text-neutral-400 hover:text-[#FFD700] hover:bg-white/5 transition-colors cursor-pointer">
                        <svg id="cz-sound-icon-on" class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"></path>
                        </svg>
                        <svg id="cz-sound-icon-off" class="w-4 h-4 hidden text-neutral-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15zM17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2"></path>
                        </svg>
                    </button>
                    <button id="cz-chat-close" type="button" title="Minimize Chat"
                        class="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-white/5 transition-colors cursor-pointer">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
                        </svg>
                    </button>
                </div>
            </div>

            <!-- NAVIGATION TABS -->
            <div class="px-2 py-1.5 bg-black/40 border-b border-white/10 flex items-center justify-between text-[11px] font-heading font-bold uppercase tracking-wider">
                <button type="button" data-tab="chat" class="cz-tab-btn flex-1 py-1.5 text-center rounded-lg bg-[#FFD700] text-black font-black transition-all cursor-pointer">
                    Chat
                </button>
                <button type="button" data-tab="online" class="cz-tab-btn flex-1 py-1.5 text-center rounded-lg text-neutral-400 hover:text-white transition-all cursor-pointer flex items-center justify-center gap-1">
                    <span>Online</span>
                    <span id="cz-tab-online-badge" class="px-1.5 py-0.2 rounded-full bg-emerald-500/20 text-emerald-400 text-[9px]">0</span>
                </button>
                <button type="button" data-tab="search" class="cz-tab-btn flex-1 py-1.5 text-center rounded-lg text-neutral-400 hover:text-white transition-all cursor-pointer">
                    Search
                </button>
                <button type="button" data-tab="friends" class="cz-tab-btn flex-1 py-1.5 text-center rounded-lg text-neutral-400 hover:text-white transition-all cursor-pointer relative">
                    <span>Friends</span>
                    <span id="cz-tab-requests-badge" class="hidden absolute top-1 right-2 w-2 h-2 rounded-full bg-[#FFD700]"></span>
                </button>
            </div>

            <!-- TAB 1: GLOBAL CHAT -->
            <div id="cz-pane-chat" class="flex-1 flex flex-col min-h-0">
                <!-- MESSAGES STREAM CONTAINER -->
                <div id="cz-messages-stream" class="flex-1 overflow-y-auto p-3 space-y-3 font-sans text-xs scroll-smooth">
                    <div class="text-center py-8 text-neutral-500 text-[11px] italic">Connecting to ChampZero Live Stream...</div>
                </div>

                <!-- QUICK REACTION BAR -->
                <div class="px-3 py-1.5 bg-black/50 border-t border-white/5 flex items-center gap-1.5 overflow-x-auto no-scrollbar text-[11px]">
                    <span class="text-[9px] text-neutral-500 uppercase font-mono mr-1">Quick:</span>
                    <button type="button" onclick="window.czSendQuick('GG!')" class="px-2 py-0.5 rounded bg-white/5 hover:bg-white/10 text-neutral-300 border border-white/10 hover:border-[#FFD700]/40 transition-colors">GG!</button>
                    <button type="button" onclick="window.czSendQuick('WP!')" class="px-2 py-0.5 rounded bg-white/5 hover:bg-white/10 text-neutral-300 border border-white/10 hover:border-[#FFD700]/40 transition-colors">WP!</button>
                    <button type="button" onclick="window.czSendQuick('NT!')" class="px-2 py-0.5 rounded bg-white/5 hover:bg-white/10 text-neutral-300 border border-white/10 hover:border-[#FFD700]/40 transition-colors">NT!</button>
                    <button type="button" onclick="window.czSendQuick('GLHF')" class="px-2 py-0.5 rounded bg-white/5 hover:bg-white/10 text-neutral-300 border border-white/10 hover:border-[#FFD700]/40 transition-colors">GLHF</button>
                    <button type="button" onclick="window.czSendQuick('LFG!')" class="px-2 py-0.5 rounded bg-white/5 hover:bg-white/10 text-neutral-300 border border-white/10 hover:border-[#FFD700]/40 transition-colors">LFG!</button>
                </div>

                <!-- INPUT BAR -->
                <div class="p-2.5 bg-black/80 border-t border-white/10">
                    <form id="cz-chat-form" class="flex items-center gap-2">
                        <input id="cz-chat-input" type="text" maxlength="280" placeholder="Type a message to Champions..." autocomplete="off"
                            class="flex-1 bg-white/5 border border-white/10 focus:border-[#FFD700] rounded-xl px-3 py-2 text-xs text-white placeholder-neutral-500 focus:outline-none transition-colors">
                        <button type="submit" id="cz-chat-send-btn"
                            class="px-3.5 py-2 rounded-xl bg-[#FFD700] hover:bg-[#FFF099] text-black font-heading font-black text-xs uppercase transition-all shadow cursor-pointer shrink-0">
                            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"></path>
                            </svg>
                        </button>
                    </form>
                </div>
            </div>

            <!-- TAB 2: ONLINE PLAYERS -->
            <div id="cz-pane-online" class="hidden flex-1 flex flex-col min-h-0 p-3 overflow-y-auto space-y-2">
                <div class="text-[10px] font-mono uppercase text-neutral-400 mb-1 flex items-center justify-between">
                    <span>Active Champions</span>
                    <span id="cz-online-count-detail" class="text-emerald-400 font-bold">0 Online</span>
                </div>
                <div id="cz-online-list" class="space-y-2">
                    <div class="text-center py-6 text-neutral-500 text-xs italic">Loading active champions...</div>
                </div>
            </div>

            <!-- TAB 3: SEARCH PLAYERS -->
            <div id="cz-pane-search" class="hidden flex-1 flex flex-col min-h-0 p-3 space-y-3">
                <div class="relative">
                    <input id="cz-search-input" type="text" placeholder="Search by IGN, Game ID, Rank..."
                        class="w-full bg-white/5 border border-white/10 focus:border-[#FFD700] rounded-xl pl-8 pr-3 py-2 text-xs text-white placeholder-neutral-500 focus:outline-none transition-colors">
                    <svg class="w-3.5 h-3.5 text-neutral-500 absolute left-2.5 top-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path>
                    </svg>
                </div>
                <div id="cz-search-results" class="flex-1 overflow-y-auto space-y-2">
                    <div class="text-center py-6 text-neutral-500 text-xs italic">Type to search registered players across ChampZero</div>
                </div>
            </div>

            <!-- TAB 4: FRIENDS & REQUESTS -->
            <div id="cz-pane-friends" class="hidden flex-1 flex flex-col min-h-0 p-3 overflow-y-auto space-y-3">
                <!-- INCOMING REQUESTS -->
                <div id="cz-incoming-requests-wrap" class="hidden">
                    <h4 class="text-[10px] font-mono uppercase text-[#FFD700] font-bold mb-2 flex items-center justify-between">
                        <span>Friend Requests</span>
                        <span id="cz-requests-count" class="px-1.5 py-0.2 rounded-full bg-[#FFD700]/20 text-[#FFD700] text-[9px]">0</span>
                    </h4>
                    <div id="cz-incoming-requests-list" class="space-y-2"></div>
                    <div class="border-b border-white/10 my-3"></div>
                </div>

                <!-- CONFIRMED FRIENDS -->
                <div>
                    <h4 class="text-[10px] font-mono uppercase text-neutral-400 font-bold mb-2 flex items-center justify-between">
                        <span>My Friends List</span>
                        <span id="cz-friends-count" class="text-neutral-300">0 Friends</span>
                    </h4>
                    <div id="cz-friends-list" class="space-y-2">
                        <div class="text-center py-6 text-neutral-500 text-xs italic">No friends added yet. Use the Search tab to connect with other players!</div>
                    </div>
                </div>
            </div>

        </div>

        <!-- QUICK PLAYER MINI PROFILE MODAL -->
        <div id="cz-player-modal" class="hidden fixed inset-0 z-[10000] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
            <div class="w-full max-w-sm rounded-2xl bg-[#0E0E14] border border-[#FFD700]/40 p-5 shadow-2xl relative animate-in fade-in zoom-in duration-200">
                <button type="button" onclick="window.czClosePlayerModal()"
                    class="absolute top-3 right-3 text-neutral-400 hover:text-white p-1 rounded-lg hover:bg-white/5 transition-colors">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                </button>
                <div id="cz-player-modal-content" class="text-center"></div>
            </div>
        </div>
    `;

    document.body.appendChild(root);
    setupEventListeners();
}

// ----------------------------------------------------
// 2. EVENT LISTENERS & TAB MANAGEMENT
// ----------------------------------------------------
function setupEventListeners() {
    const launcher = document.getElementById('cz-chat-launcher');
    const closeBtn = document.getElementById('cz-chat-close');
    const soundToggle = document.getElementById('cz-sound-toggle');
    const form = document.getElementById('cz-chat-form');
    const searchInput = document.getElementById('cz-search-input');
    const tabBtns = document.querySelectorAll('.cz-tab-btn');

    if (launcher) {
        launcher.onclick = () => {
            toggleChatWindow();
        };
    }
    if (closeBtn) {
        closeBtn.onclick = () => {
            toggleChatWindow(false);
        };
    }
    if (soundToggle) {
        soundToggle.onclick = () => {
            isSoundEnabled = !isSoundEnabled;
            document.getElementById('cz-sound-icon-on').classList.toggle('hidden', !isSoundEnabled);
            document.getElementById('cz-sound-icon-off').classList.toggle('hidden', isSoundEnabled);
        };
    }
    if (form) {
        form.onsubmit = async (e) => {
            e.preventDefault();
            const input = document.getElementById('cz-chat-input');
            if (!input) return;
            const text = input.value.trim();
            if (!text) return;
            input.value = '';
            await sendChatMessage(text);
        };
    }
    if (searchInput) {
        searchInput.oninput = (e) => {
            filterAndRenderSearch(e.target.value.trim());
        };
    }

    tabBtns.forEach(btn => {
        btn.onclick = () => {
            const targetTab = btn.getAttribute('data-tab');
            switchTab(targetTab);
        };
    });
}

function toggleChatWindow(forceState) {
    const card = document.getElementById('cz-chat-card');
    const badge = document.getElementById('cz-unread-badge');
    if (!card) return;

    isChatOpen = (typeof forceState === 'boolean') ? forceState : !isChatOpen;
    if (isChatOpen) {
        card.classList.remove('hidden');
        unreadCount = 0;
        if (badge) badge.classList.add('hidden');
        scrollChatToBottom();
        // Focus input
        setTimeout(() => document.getElementById('cz-chat-input')?.focus(), 150);
    } else {
        card.classList.add('hidden');
    }
}

function switchTab(tabName) {
    activeTab = tabName;
    const tabBtns = document.querySelectorAll('.cz-tab-btn');
    const panes = {
        chat: document.getElementById('cz-pane-chat'),
        online: document.getElementById('cz-pane-online'),
        search: document.getElementById('cz-pane-search'),
        friends: document.getElementById('cz-pane-friends')
    };

    tabBtns.forEach(btn => {
        const isSelected = btn.getAttribute('data-tab') === tabName;
        if (isSelected) {
            btn.className = 'cz-tab-btn flex-1 py-1.5 text-center rounded-lg bg-[#FFD700] text-black font-black transition-all cursor-pointer';
        } else {
            btn.className = 'cz-tab-btn flex-1 py-1.5 text-center rounded-lg text-neutral-400 hover:text-white transition-all cursor-pointer';
        }
    });

    Object.keys(panes).forEach(k => {
        if (panes[k]) panes[k].classList.toggle('hidden', k !== tabName);
    });

    if (tabName === 'chat') scrollChatToBottom();
    if (tabName === 'online') renderOnlineList();
    if (tabName === 'search') {
        const queryVal = document.getElementById('cz-search-input')?.value || '';
        filterAndRenderSearch(queryVal);
    }
    if (tabName === 'friends') renderFriendsPanel();
}

function scrollChatToBottom() {
    const stream = document.getElementById('cz-messages-stream');
    if (stream) {
        setTimeout(() => {
            stream.scrollTop = stream.scrollHeight;
        }, 50);
    }
}

// ----------------------------------------------------
// 3. GLOBAL REAL-TIME MESSAGING
// ----------------------------------------------------
async function sendChatMessage(text) {
    const activeUser = currentUser || auth.currentUser;
    if (!activeUser) {
        if (window.showErrorToast) window.showErrorToast("Sign In Required", "Please log in to join the ChampZero Global Chat!");
        else alert("Please log in to join the ChampZero Global Chat!");
        return;
    }

    const senderName = currentProfile.ign || currentProfile.displayName || activeUser.displayName || activeUser.email?.split('@')[0] || 'Champion';
    const senderAvatar = currentProfile.avatar || activeUser.photoURL || ('https://ui-avatars.com/api/?name=' + encodeURIComponent(senderName) + '&background=111116&color=FFD700');
    const senderRole = (currentProfile.role || 'member').toLowerCase();
    const senderRank = currentProfile.rank || currentProfile.valRank || currentProfile.mlbbRank || currentProfile.hokRank || 'Unranked';
    const isSupporter = Boolean(currentProfile.isSupporter || currentProfile.supporterTier || currentProfile.supporterBadge);
    const supporterTier = currentProfile.supporterTier || (isSupporter ? 'bronze' : null);

    const msgPayload = {
        type: "global_chat",
        senderId: activeUser.uid,
        senderName,
        senderEmail: activeUser.email || '',
        senderAvatar,
        senderRole,
        senderRank,
        isSupporter,
        supporterTier,
        text,
        timestamp: Date.now(),
        sentAt: new Date().toISOString(),
        createdAt: new Date().toISOString()
    };

    try {
        // Primary write into messages collection
        await addDoc(collection(db, "messages"), msgPayload);
    } catch (e) {
        console.warn("Primary messages collection write failed, trying global_chat:", e);
        try {
            await addDoc(collection(db, "global_chat"), msgPayload);
        } catch (e2) {
            console.error("Error sending chat message:", e2);
            if (window.showErrorToast) window.showErrorToast("Error", "Could not send message: " + (e2.message || 'Please check connection'));
            return;
        }
    }
}

window.czSendQuick = async function(text) {
    await sendChatMessage(text);
};

let isInitialChatSnapshot = true;

function listenToGlobalChat() {
    if (unsubscribeChat) unsubscribeChat();
    isInitialChatSnapshot = true;

    // Listen to messages collection
    try {
        const messagesQuery = query(collection(db, "messages"));
        let previousMsgCount = -1;

        unsubscribeChat = onSnapshot(messagesQuery, (snapshot) => {
            const messages = [];
            snapshot.forEach(docSnap => {
                const data = docSnap.data();
                if (data.type === 'global_chat' || (!data.type && data.text && data.senderName)) {
                    messages.push({ id: docSnap.id, ...data });
                }
            });

            // Sort ascending by timestamp
            messages.sort((a, b) => (a.timestamp || (new Date(a.createdAt || a.sentAt || 0)).getTime()) - (b.timestamp || (new Date(b.createdAt || b.sentAt || 0)).getTime()));

            const recentMessages = messages.slice(-60);
            renderChatMessages(recentMessages);

            // On initial load: do NOT sound alarm or increase unread count for existing history
            if (isInitialChatSnapshot) {
                isInitialChatSnapshot = false;
                previousMsgCount = messages.length;
                return;
            }

            // Only trigger unread notification if NEW messages were actually added after initial load
            if (messages.length > previousMsgCount) {
                const newAddedCount = messages.length - Math.max(0, previousMsgCount);
                previousMsgCount = messages.length;

                if (!isChatOpen && newAddedCount > 0) {
                    unreadCount += newAddedCount;
                    const badge = document.getElementById('cz-unread-badge');
                    if (badge) {
                        badge.textContent = unreadCount > 9 ? '9+' : unreadCount;
                        badge.classList.remove('hidden');
                    }
                    playChatChime();
                }
            }
        }, (err) => {
            console.warn("Messages collection listener error, trying global_chat fallback:", err);
            try {
                const fallbackQuery = query(collection(db, "global_chat"));
                unsubscribeChat = onSnapshot(fallbackQuery, (snap) => {
                    const fallbackMsgs = [];
                    snap.forEach(d => fallbackMsgs.push({ id: d.id, ...d.data() }));
                    fallbackMsgs.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
                    renderChatMessages(fallbackMsgs.slice(-60));
                });
            } catch (fallbackErr) {
                console.error("Chat fallback listener error:", fallbackErr);
            }
        });
    } catch (e) {
        console.error("Error setting up chat listener:", e);
    }
}

function renderChatMessages(messages) {
    const stream = document.getElementById('cz-messages-stream');
    if (!stream) return;

    if (messages.length === 0) {
        stream.innerHTML = `
            <div class="text-center py-8 text-neutral-500 text-xs">
                <div class="w-8 h-8 rounded-full bg-white/5 border border-white/10 flex items-center justify-center mx-auto mb-2 text-[#FFD700]">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/></svg>
                </div>
                <p class="font-bold text-neutral-400">Welcome to ChampZero Global Chat!</p>
                <p class="text-[10px] text-neutral-500 mt-1">Be the first to say hello to the community.</p>
            </div>
        `;
        return;
    }

    const myUid = currentUser ? currentUser.uid : null;

    stream.innerHTML = messages.map(m => {
        const isMe = myUid && m.senderId === myUid;
        const role = String(m.senderRole || 'member').toLowerCase();
        
        let roleBadge = '';
        if (role === 'admin') {
            roleBadge = '<span class="px-1.5 py-0.2 rounded text-[8px] font-bold uppercase bg-red-500/20 text-red-400 border border-red-500/30">ADMIN</span>';
        } else if (role === 'organizer') {
            roleBadge = '<span class="px-1.5 py-0.2 rounded text-[8px] font-bold uppercase bg-purple-500/20 text-purple-400 border border-purple-500/30">HOST</span>';
        }

        const rankTag = m.senderRank && m.senderRank !== 'Unranked' 
            ? `<span class="px-1.5 py-0.2 rounded text-[8px] font-mono text-blue-400 bg-blue-500/10 border border-blue-500/20">${escapeHtml(m.senderRank)}</span>` 
            : '';

        let supporterBadgeTag = '';
        let nameColorClass = 'text-white hover:text-[#FFD700]';

        if (m.isSupporter || m.supporterTier) {
            const tier = String(m.supporterTier || 'bronze').toLowerCase();
            if (tier === 'gold') {
                supporterBadgeTag = '<span class="px-1.5 py-0.2 rounded text-[8px] font-bold uppercase bg-gradient-to-r from-[#FFD700]/30 to-amber-500/30 text-[#FFD700] border border-[#FFD700]/50 shadow-[0_0_8px_rgba(255,215,0,0.3)]">PATRON</span>';
                nameColorClass = 'text-[#FFD700] hover:text-white drop-shadow-[0_0_8px_rgba(255,215,0,0.35)]';
            } else if (tier === 'silver') {
                supporterBadgeTag = '<span class="px-1.5 py-0.2 rounded text-[8px] font-bold uppercase bg-slate-400/20 text-slate-200 border border-slate-300/30">ELITE</span>';
                nameColorClass = 'text-slate-200 hover:text-[#FFD700]';
            } else {
                supporterBadgeTag = '<span class="px-1.5 py-0.2 rounded text-[8px] font-bold uppercase bg-amber-700/20 text-amber-400 border border-amber-600/30">SCOUT</span>';
            }
        }

        const timeStr = m.timestamp ? new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

        return `
            <div class="flex items-start gap-2.5 ${isMe ? 'flex-row-reverse' : ''} group">
                <button type="button" onclick="window.czOpenPlayerModal('${escapeHtml(m.senderId)}')"
                    class="shrink-0 rounded-xl overflow-hidden hover:ring-2 hover:ring-[#FFD700] transition-all cursor-pointer">
                    <img src="${escapeHtml(m.senderAvatar || 'pictures/cz_logo.png')}" class="w-8 h-8 rounded-xl object-cover bg-black/40 border border-white/10" alt="Avatar">
                </button>
                <div class="max-w-[78%]">
                    <div class="flex items-center gap-1.5 mb-1 ${isMe ? 'justify-end' : ''} flex-wrap">
                        <button type="button" onclick="window.czOpenPlayerModal('${escapeHtml(m.senderId)}')"
                            class="font-heading font-black ${nameColorClass} text-xs transition-colors cursor-pointer">
                            ${escapeHtml(m.senderName)}
                        </button>
                        ${roleBadge}
                        ${supporterBadgeTag}
                        ${rankTag}
                        <span class="text-[9px] text-neutral-500 font-mono">${timeStr}</span>
                    </div>
                    <div class="p-2.5 rounded-2xl text-xs break-words shadow-sm ${
                        isMe 
                        ? 'bg-gradient-to-r from-[#FFD700] to-amber-500 text-black font-semibold rounded-tr-none' 
                        : 'bg-white/10 text-neutral-200 border border-white/10 rounded-tl-none'
                    }">
                        ${escapeHtml(m.text)}
                    </div>
                </div>
            </div>
        `;
    }).join('');

    scrollChatToBottom();
}

// ----------------------------------------------------
// 4. REAL-TIME ONLINE PRESENCE & PLAYER DIRECTORY
// ----------------------------------------------------
async function updateMyPresence(isOnline) {
    if (!currentUser) return;
    try {
        const userRef = doc(db, "users", currentUser.uid);
        await updateDoc(userRef, {
            isOnline,
            lastSeen: new Date().toISOString()
        });
    } catch (e) {
        // User doc may not yet have update permissions or offline
    }
}

function listenToUsersPresence() {
    if (unsubscribeOnline) unsubscribeOnline();

    const usersQuery = query(collection(db, "users"));
    unsubscribeOnline = onSnapshot(usersQuery, (snapshot) => {
        const list = [];
        allRegisteredUsers = [];
        const threshold = Date.now() - (5 * 60 * 1000); // Online if active within last 5 minutes

        snapshot.forEach(d => {
            const data = { id: d.id, ...d.data() };
            allRegisteredUsers.push(data);

            const lastSeenTime = data.lastSeen ? new Date(data.lastSeen).getTime() : 0;
            const isReallyOnline = data.isOnline === true || lastSeenTime > threshold;

            if (isReallyOnline) {
                list.push(data);
            }
        });

        onlineUsersList = list;
        const onlineCount = list.length || 1;

        const pillCount = document.getElementById('cz-online-pill-count');
        const headerCount = document.getElementById('cz-online-header-count');
        const tabBadge = document.getElementById('cz-tab-online-badge');
        const detailCount = document.getElementById('cz-online-count-detail');

        if (pillCount) pillCount.textContent = onlineCount;
        if (headerCount) headerCount.textContent = `${onlineCount} Online`;
        if (tabBadge) tabBadge.textContent = onlineCount;
        if (detailCount) detailCount.textContent = `${onlineCount} Online`;

        if (activeTab === 'online') renderOnlineList();
    }, (err) => {
        console.warn("Online presence listener warning:", err);
    });
}

function renderOnlineList() {
    const container = document.getElementById('cz-online-list');
    if (!container) return;

    if (onlineUsersList.length === 0) {
        container.innerHTML = `<div class="text-center py-6 text-neutral-500 text-xs italic">No players online right now.</div>`;
        return;
    }

    const myUid = currentUser ? currentUser.uid : null;

    container.innerHTML = onlineUsersList.map(u => {
        const name = u.ign || u.displayName || u.username || 'Champion';
        const avatar = u.avatar || ('https://ui-avatars.com/api/?name=' + encodeURIComponent(name) + '&background=111116&color=FFD700');
        const role = (u.role || 'member').toLowerCase();
        const rank = u.rank || u.valRank || u.mlbbRank || u.hokRank || 'Unranked';
        const isMe = myUid && u.id === myUid;

        return `
            <div class="p-2.5 rounded-xl bg-black/40 border border-white/5 hover:border-white/15 flex items-center justify-between gap-2.5 transition-colors">
                <div class="flex items-center gap-2.5 min-w-0">
                    <div class="relative shrink-0">
                        <img src="${escapeHtml(avatar)}" class="w-8 h-8 rounded-xl object-cover bg-black border border-white/10" alt="Avatar">
                        <span class="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-400 border-2 border-black"></span>
                    </div>
                    <div class="min-w-0">
                        <div class="flex items-center gap-1.5 flex-wrap">
                            <span class="font-heading font-bold text-white text-xs truncate">${escapeHtml(name)}</span>
                            ${isMe ? '<span class="text-[9px] text-[var(--gold)] font-mono font-bold">(You)</span>' : ''}
                        </div>
                        <div class="text-[10px] text-neutral-400 flex items-center gap-1.5 font-mono">
                            <span>${escapeHtml(rank)}</span>
                            <span>•</span>
                            <span class="capitalize ${role === 'admin' ? 'text-red-400 font-bold' : (role === 'organizer' ? 'text-purple-400 font-bold' : 'text-neutral-400')}">${role}</span>
                        </div>
                    </div>
                </div>
                <div class="flex items-center gap-1 shrink-0">
                    <button type="button" onclick="window.czOpenPlayerModal('${escapeHtml(u.id)}')"
                        class="px-2 py-1 rounded bg-white/5 hover:bg-white/10 text-neutral-300 text-[10px] font-bold border border-white/10 hover:border-white/20 transition-colors cursor-pointer">
                        Profile
                    </button>
                    ${!isMe ? `
                        <button type="button" onclick="window.czSendFriendRequest('${escapeHtml(u.id)}', '${escapeHtml(name)}', '${escapeHtml(avatar)}')"
                            class="px-2 py-1 rounded bg-[#FFD700]/10 hover:bg-[#FFD700] text-[#FFD700] hover:text-black text-[10px] font-black border border-[#FFD700]/30 transition-all cursor-pointer">
                            + Friend
                        </button>
                    ` : ''}
                </div>
            </div>
        `;
    }).join('');
}

// ----------------------------------------------------
// 5. PLAYER SEARCH
// ----------------------------------------------------
function filterAndRenderSearch(queryText) {
    const container = document.getElementById('cz-search-results');
    if (!container) return;

    if (!queryText) {
        container.innerHTML = `<div class="text-center py-6 text-neutral-500 text-xs italic">Type to search registered players across ChampZero</div>`;
        return;
    }

    const q = queryText.toLowerCase();
    const matches = allRegisteredUsers.filter(u => {
        const name = (u.ign || u.displayName || u.username || '').toLowerCase();
        const email = (u.email || '').toLowerCase();
        const valId = (u.valId || '').toLowerCase();
        const mlbbId = (u.mlbbId || '').toLowerCase();
        const hokId = (u.hokId || '').toLowerCase();
        const rank = (u.rank || u.valRank || '').toLowerCase();
        return name.includes(q) || email.includes(q) || valId.includes(q) || mlbbId.includes(q) || hokId.includes(q) || rank.includes(q);
    });

    if (matches.length === 0) {
        container.innerHTML = `<div class="text-center py-6 text-neutral-500 text-xs italic">No players found matching "${escapeHtml(queryText)}"</div>`;
        return;
    }

    const myUid = currentUser ? currentUser.uid : null;

    container.innerHTML = matches.slice(0, 20).map(u => {
        const name = u.ign || u.displayName || u.username || 'Champion';
        const avatar = u.avatar || ('https://ui-avatars.com/api/?name=' + encodeURIComponent(name) + '&background=111116&color=FFD700');
        const role = (u.role || 'member').toLowerCase();
        const rank = u.rank || u.valRank || u.mlbbRank || u.hokRank || 'Unranked';
        const isMe = myUid && u.id === myUid;

        return `
            <div class="p-2.5 rounded-xl bg-black/40 border border-white/5 hover:border-white/15 flex items-center justify-between gap-2.5 transition-colors">
                <div class="flex items-center gap-2.5 min-w-0">
                    <img src="${escapeHtml(avatar)}" class="w-8 h-8 rounded-xl object-cover bg-black border border-white/10 shrink-0" alt="Avatar">
                    <div class="min-w-0">
                        <div class="font-heading font-bold text-white text-xs truncate">${escapeHtml(name)} ${isMe ? '<span class="text-[var(--gold)] font-mono">(You)</span>' : ''}</div>
                        <div class="text-[10px] text-neutral-400 flex items-center gap-1.5 font-mono">
                            <span>${escapeHtml(rank)}</span>
                            <span>•</span>
                            <span class="capitalize ${role === 'admin' ? 'text-red-400' : 'text-neutral-400'}">${role}</span>
                        </div>
                    </div>
                </div>
                <div class="flex items-center gap-1 shrink-0">
                    <button type="button" onclick="window.czOpenPlayerModal('${escapeHtml(u.id)}')"
                        class="px-2 py-1 rounded bg-white/5 hover:bg-white/10 text-neutral-300 text-[10px] font-bold border border-white/10 transition-colors cursor-pointer">
                        Profile
                    </button>
                    ${!isMe ? `
                        <button type="button" onclick="window.czSendFriendRequest('${escapeHtml(u.id)}', '${escapeHtml(name)}', '${escapeHtml(avatar)}')"
                            class="px-2 py-1 rounded bg-[#FFD700]/10 hover:bg-[#FFD700] text-[#FFD700] hover:text-black text-[10px] font-black border border-[#FFD700]/30 transition-all cursor-pointer">
                            + Friend
                        </button>
                    ` : ''}
                </div>
            </div>
        `;
    }).join('');
}

// ----------------------------------------------------
// 6. FRIEND REQUESTS & FRIENDS LIST
// ----------------------------------------------------
window.czSendFriendRequest = async function(targetUid, targetName, targetAvatar) {
    const activeUser = currentUser || auth.currentUser;
    if (!activeUser) {
        if (window.showErrorToast) window.showErrorToast("Sign In Required", "Please log in to add friends!");
        return;
    }
    if (targetUid === activeUser.uid) {
        if (window.showErrorToast) window.showErrorToast("Notice", "You cannot add yourself as a friend.");
        return;
    }

    const myName = currentProfile.ign || currentProfile.displayName || activeUser.displayName || 'Champion';
    const myAvatar = currentProfile.avatar || activeUser.photoURL || ('https://ui-avatars.com/api/?name=' + encodeURIComponent(myName) + '&background=111116&color=FFD700');

    const reqPayload = {
        type: "friend_request",
        fromUid: activeUser.uid,
        fromName: myName,
        fromAvatar: myAvatar,
        toUid: targetUid,
        toName: targetName,
        toAvatar: targetAvatar,
        status: 'pending',
        createdAt: new Date().toISOString()
    };

    try {
        await addDoc(collection(db, "messages"), reqPayload);
        if (window.showSuccessToast) {
            window.showSuccessToast("Friend Request Sent!", `Invitation dispatched to ${targetName}.`);
        }
    } catch (e) {
        try {
            await addDoc(collection(db, "friend_requests"), reqPayload);
            if (window.showSuccessToast) {
                window.showSuccessToast("Friend Request Sent!", `Invitation dispatched to ${targetName}.`);
            }
        } catch (e2) {
            console.error("Error sending friend request:", e2);
            if (window.showErrorToast) window.showErrorToast("Error", "Could not send friend request.");
        }
    }
};

function listenToFriendRequests() {
    const activeUser = currentUser || auth.currentUser;
    if (!activeUser) return;
    if (unsubscribeRequests) unsubscribeRequests();

    try {
        const reqQuery = query(collection(db, "messages"));
        unsubscribeRequests = onSnapshot(reqQuery, (snapshot) => {
            const incoming = [];
            const friends = [];

            snapshot.forEach(docSnap => {
                const data = { id: docSnap.id, ...docSnap.data() };
                if (data.type === 'friend_request') {
                    if (data.toUid === activeUser.uid && data.status === 'pending') {
                        incoming.push(data);
                    }
                    if (data.status === 'accepted') {
                        if (data.fromUid === activeUser.uid) {
                            friends.push({ uid: data.toUid, name: data.toName, avatar: data.toAvatar, docId: data.id });
                        } else if (data.toUid === activeUser.uid) {
                            friends.push({ uid: data.fromUid, name: data.fromName, avatar: data.fromAvatar, docId: data.id });
                        }
                    }
                }
            });

            pendingRequestsList = incoming;
            myFriendsList = friends;

            const reqBadge = document.getElementById('cz-tab-requests-badge');
            const reqCount = document.getElementById('cz-requests-count');
            const friendsCount = document.getElementById('cz-friends-count');

            if (reqBadge) reqBadge.classList.toggle('hidden', incoming.length === 0);
            if (reqCount) reqCount.textContent = incoming.length;
            if (friendsCount) friendsCount.textContent = `${friends.length} Friends`;

            if (activeTab === 'friends') renderFriendsPanel();
        });
    } catch (e) {
        console.error("Error setting up friend requests listener:", e);
    }
}

function renderFriendsPanel() {
    const incWrap = document.getElementById('cz-incoming-requests-wrap');
    const incList = document.getElementById('cz-incoming-requests-list');
    const friendsList = document.getElementById('cz-friends-list');

    if (incWrap && incList) {
        if (pendingRequestsList.length > 0) {
            incWrap.classList.remove('hidden');
            incList.innerHTML = pendingRequestsList.map(r => `
                <div class="p-2.5 rounded-xl bg-[#FFD700]/5 border border-[#FFD700]/20 flex items-center justify-between gap-2">
                    <div class="flex items-center gap-2 min-w-0">
                        <img src="${escapeHtml(r.fromAvatar)}" class="w-7 h-7 rounded-lg object-cover bg-black border border-white/10 shrink-0" alt="Avatar">
                        <span class="font-heading font-bold text-white text-xs truncate">${escapeHtml(r.fromName)}</span>
                    </div>
                    <div class="flex items-center gap-1 shrink-0">
                        <button type="button" onclick="window.czRespondFriendRequest('${r.id}', 'accepted', '${escapeHtml(r.fromName)}')"
                            class="px-2 py-1 bg-[#FFD700] hover:bg-[#FFF099] text-black text-[10px] font-black uppercase rounded transition-colors cursor-pointer">
                            Accept
                        </button>
                        <button type="button" onclick="window.czRespondFriendRequest('${r.id}', 'declined', '${escapeHtml(r.fromName)}')"
                            class="px-2 py-1 bg-white/5 hover:bg-white/10 text-neutral-400 hover:text-white text-[10px] font-bold rounded transition-colors cursor-pointer">
                            Decline
                        </button>
                    </div>
                </div>
            `).join('');
        } else {
            incWrap.classList.add('hidden');
        }
    }

    if (friendsList) {
        if (myFriendsList.length === 0) {
            friendsList.innerHTML = `<div class="text-center py-6 text-neutral-500 text-xs italic">No friends added yet. Connect with Champions from the Search tab!</div>`;
            return;
        }

        friendsList.innerHTML = myFriendsList.map(f => {
            const isOnline = onlineUsersList.some(u => u.id === f.uid);
            return `
                <div class="p-2.5 rounded-xl bg-black/40 border border-white/5 hover:border-white/15 flex items-center justify-between gap-2 transition-colors">
                    <div class="flex items-center gap-2.5 min-w-0">
                        <div class="relative shrink-0">
                            <img src="${escapeHtml(f.avatar)}" class="w-8 h-8 rounded-xl object-cover bg-black border border-white/10" alt="Avatar">
                            <span class="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full ${isOnline ? 'bg-emerald-400 border border-black' : 'bg-neutral-600'}"></span>
                        </div>
                        <div class="min-w-0">
                            <div class="font-heading font-bold text-white text-xs truncate">${escapeHtml(f.name)}</div>
                            <div class="text-[9px] ${isOnline ? 'text-emerald-400' : 'text-neutral-500'} font-mono flex items-center">
                                ${isOnline ? '<span class="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block mr-1"></span>Online' : 'Offline'}
                            </div>
                        </div>
                    </div>
                    <button type="button" onclick="window.czOpenPlayerModal('${escapeHtml(f.uid)}')"
                        class="px-2 py-1 rounded bg-white/5 hover:bg-white/10 text-neutral-300 text-[10px] font-bold border border-white/10 transition-colors cursor-pointer shrink-0">
                        Profile
                    </button>
                </div>
            `;
        }).join('');
    }
}

window.czRespondFriendRequest = async function(reqId, newStatus, senderName) {
    try {
        await updateDoc(doc(db, "friend_requests", reqId), {
            status: newStatus,
            updatedAt: new Date().toISOString()
        });

        if (window.showSuccessToast) {
            if (newStatus === 'accepted') window.showSuccessToast("Friend Connected!", `You and ${senderName} are now friends!`);
            else window.showSuccessToast("Request Declined", "Friend request declined.");
        }
    } catch (e) {
        console.error("Error updating friend request:", e);
    }
};

// ----------------------------------------------------
// 7. QUICK MINI PLAYER MODAL
// ----------------------------------------------------
window.czOpenPlayerModal = async function(uid) {
    const modal = document.getElementById('cz-player-modal');
    const content = document.getElementById('cz-player-modal-content');
    if (!modal || !content) return;

    content.innerHTML = `<div class="py-8 text-neutral-400 text-xs italic">Loading Player Details...</div>`;
    modal.classList.remove('hidden');

    try {
        let player = allRegisteredUsers.find(u => u.id === uid);
        if (!player) {
            const snap = await getDoc(doc(db, "users", uid));
            if (snap.exists()) player = { id: snap.id, ...snap.data() };
        }

        if (!player) {
            content.innerHTML = `<div class="py-6 text-neutral-400 text-xs">Player record not found.</div>`;
            return;
        }

        const name = player.ign || player.displayName || player.username || 'Champion';
        const avatar = player.avatar || ('https://ui-avatars.com/api/?name=' + encodeURIComponent(name) + '&background=111116&color=FFD700');
        const role = (player.role || 'member').toLowerCase();
        const rank = player.rank || player.valRank || player.mlbbRank || player.hokRank || 'Unranked';
        const isMe = currentUser && currentUser.uid === player.id;
        const isFriend = myFriendsList.some(f => f.uid === player.id);
        const isSupporter = Boolean(player.isSupporter || player.supporterTier || player.supporterBadge);
        const supporterTier = String(player.supporterTier || 'bronze').toLowerCase();

        let supporterPill = '';
        if (isSupporter) {
            if (supporterTier === 'gold') {
                supporterPill = '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#FFD700]/20 text-[#FFD700] text-[9px] font-mono font-bold border border-[#FFD700]/40 mt-1">GOLD PATRON</span>';
            } else if (supporterTier === 'silver') {
                supporterPill = '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-400/20 text-slate-200 text-[9px] font-mono font-bold border border-slate-300/40 mt-1">SILVER ELITE</span>';
            } else {
                supporterPill = '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-700/20 text-amber-400 text-[9px] font-mono font-bold border border-amber-600/40 mt-1">BRONZE SCOUT</span>';
            }
        }

        content.innerHTML = `
            <div class="flex flex-col items-center">
                <div class="relative mb-3">
                    <img src="${escapeHtml(avatar)}" class="w-16 h-16 rounded-2xl object-cover bg-black border-2 border-[#FFD700]/60 shadow-lg" alt="Avatar">
                    <span class="absolute -bottom-1 -right-1 px-1.5 py-0.2 rounded bg-black/80 border border-white/20 text-[8px] font-mono font-bold text-[#FFD700] uppercase">${role}</span>
                </div>

                <h3 class="font-heading font-black text-base text-white uppercase tracking-tight">${escapeHtml(name)}</h3>
                <div class="flex items-center gap-1.5 flex-wrap justify-center">
                    <p class="text-xs text-blue-400 font-mono mt-0.5">${escapeHtml(rank)}</p>
                    ${supporterPill}
                </div>
                ${player.bio ? `<p class="text-xs text-neutral-400 italic mt-2 max-w-xs leading-snug">"${escapeHtml(player.bio)}"</p>` : ''}

                <!-- GAME IDS PREVIEW -->
                <div class="w-full grid grid-cols-3 gap-2 mt-4 text-[10px] font-mono text-left">
                    <div class="bg-black/50 p-2 rounded-lg border border-white/5">
                        <span class="text-neutral-500 block uppercase text-[8px]">Valorant</span>
                        <span class="text-white font-bold truncate block">${escapeHtml(player.valId || '--')}</span>
                    </div>
                    <div class="bg-black/50 p-2 rounded-lg border border-white/5">
                        <span class="text-neutral-500 block uppercase text-[8px]">MLBB</span>
                        <span class="text-white font-bold truncate block">${escapeHtml(player.mlbbId || '--')}</span>
                    </div>
                    <div class="bg-black/50 p-2 rounded-lg border border-white/5">
                        <span class="text-neutral-500 block uppercase text-[8px]">HoK</span>
                        <span class="text-white font-bold truncate block">${escapeHtml(player.hokId || '--')}</span>
                    </div>
                </div>

                <!-- ACTIONS -->
                <div class="w-full flex items-center gap-2 mt-5">
                    <a href="/profile" class="flex-1 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-white font-heading font-black text-[11px] uppercase transition-colors">
                        View Profile
                    </a>
                    ${!isMe ? (
                        isFriend 
                        ? `<span class="px-3 py-2 rounded-xl bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 text-[11px] font-bold uppercase">Friends</span>`
                        : `<button type="button" onclick="window.czSendFriendRequest('${escapeHtml(player.id)}', '${escapeHtml(name)}', '${escapeHtml(avatar)}'); window.czClosePlayerModal();"
                            class="flex-1 py-2 rounded-xl bg-[#FFD700] hover:bg-[#FFF099] text-black font-heading font-black text-[11px] uppercase transition-all shadow cursor-pointer">
                            + Add Friend
                        </button>`
                    ) : ''}
                </div>
            </div>
        `;
    } catch (e) {
        content.innerHTML = `<div class="py-6 text-rose-400 text-xs">Error loading player profile: ${escapeHtml(e.message)}</div>`;
    }
};

window.czClosePlayerModal = function() {
    const modal = document.getElementById('cz-player-modal');
    if (modal) modal.classList.add('hidden');
};

// ----------------------------------------------------
// 8. INITIALIZE COMMUNITY CHAT ENGINE
// ----------------------------------------------------
export function initCommunityChat() {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => injectAndStart());
    } else {
        injectAndStart();
    }
}

function injectAndStart() {
    if (window.__czCommunityChatStarted) return;
    window.__czCommunityChatStarted = true;

    injectCommunityUI();
    listenToGlobalChat();
    listenToUsersPresence();

    // Heartbeat presence listener
    setInterval(() => {
        if (currentUser && document.visibilityState === 'visible') {
            updateMyPresence(true);
        }
    }, 60000);

    window.addEventListener('beforeunload', () => {
        if (currentUser) updateMyPresence(false);
    });

    onAuthStateChanged(auth, async (user) => {
        currentUser = user;
        if (user) {
            try {
                const userDoc = await getDoc(doc(db, "users", user.uid));
                if (userDoc.exists()) currentProfile = userDoc.data() || {};
            } catch (e) {}

            await updateMyPresence(true);
            listenToFriendRequests();
        } else {
            currentProfile = {};
            if (unsubscribeRequests) unsubscribeRequests();
        }
    });
}

// Auto-run if imported as a script module
initCommunityChat();
