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
    deleteDoc,
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
let isGlobalChatOpen = false;
let isDmOpen = false;
let activeGlobalTab = 'chat';
let activeDmTab = 'convos';
let isSoundEnabled = true;
let globalUnreadCount = 0;
let dmUnreadCount = 0;
let onlineUsersList = [];
let allRegisteredUsers = [];
let myFriendsList = [];
let pendingRequestsList = [];
let outgoingRequestsList = [];
let unsubscribeChat = null;
let unsubscribeOnline = null;
let unsubscribeRequests = null;
let activeWidgetDmId = null;
let activeWidgetFriendUid = null;
let activeWidgetFriendName = null;
let unsubscribeDmThread = null;

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
// 1. INJECT FLOATING LAUNCHERS & SEPARATE WINDOWS UI
// ----------------------------------------------------
function injectCommunityUI() {
    if (document.getElementById('cz-community-root')) return;

    const root = document.createElement('div');
    root.id = 'cz-community-root';
    root.className = 'fixed bottom-5 right-5 z-[9990] font-sans select-none';

    root.innerHTML = `
        <!-- FLOATING LAUNCHER BAR (SEPARATE DMs & GLOBAL CHAT BUTTONS) -->
        <div id="cz-chat-launcher-wrap" class="flex items-center gap-2">
            <!-- 1. DIRECT MESSAGES LAUNCHER -->
            <button id="cz-dm-launcher" type="button" title="Open Direct Messages & Friends"
                class="group flex items-center gap-2 px-3.5 py-2.5 rounded-full bg-[#0A0A0F]/95 hover:bg-[#14141E] text-white border border-blue-500/40 hover:border-blue-400 shadow-[0_4px_20px_rgba(59,130,246,0.2)] backdrop-blur-xl transition-all duration-200 cursor-pointer">
                <div class="relative flex items-center justify-center">
                    <svg class="w-4 h-4 text-blue-400 group-hover:scale-110 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" 
                            d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"></path>
                    </svg>
                    <span id="cz-dm-unread-badge" class="hidden absolute -top-2 -right-2 px-1.5 py-0.2 bg-blue-500 text-white text-[9px] font-black rounded-full shadow animate-pulse">0</span>
                </div>
                <span class="font-heading font-black text-xs uppercase tracking-wider text-white">Direct Messages</span>
            </button>

            <!-- 2. GLOBAL CHAT LAUNCHER -->
            <button id="cz-chat-launcher" type="button" title="Open Global Live Chat"
                class="group flex items-center gap-2.5 px-4 py-2.5 rounded-full bg-[#0A0A0F]/95 hover:bg-[#14141E] text-white border border-[#FFD700]/40 hover:border-[#FFD700] shadow-[0_4px_20px_rgba(255,215,0,0.15)] backdrop-blur-xl transition-all duration-200 cursor-pointer">
                <div class="relative flex items-center justify-center">
                    <svg class="w-4 h-4 text-[#FFD700] group-hover:scale-110 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" 
                            d="M17 8h2a2 2 0 012 2v6a2 2 0 01-2 2h-2v4l-4-4H9a1.994 1.994 0 01-1.414-.586m0 0L11 14h4a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2v4l.586-.586z"></path>
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

        <!-- ============================================================ -->
        <!-- WINDOW 1: GLOBAL CHAT CARD -->
        <!-- ============================================================ -->
        <div id="cz-chat-card" class="hidden absolute bottom-14 right-0 w-[360px] sm:w-[410px] max-w-[calc(100vw-32px)] h-[560px] max-h-[calc(100vh-100px)] rounded-2xl bg-[#0B0B10]/98 border border-[#FFD700]/30 shadow-[0_12px_40px_rgba(0,0,0,0.85)] backdrop-blur-2xl flex flex-col overflow-hidden transition-all duration-300">
            <!-- HEADER -->
            <div class="px-4 py-3 bg-black/60 border-b border-white/10 flex items-center justify-between">
                <div class="flex items-center gap-2">
                    <div class="w-7 h-7 flex items-center justify-center">
                        <img src="pictures/cz_logo.png" class="w-6 h-6 object-contain" alt="Logo">
                    </div>
                    <div>
                        <h3 class="font-heading font-black text-xs text-white uppercase tracking-wider">Global Chat</h3>
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
                    <button id="cz-chat-close" type="button" title="Minimize Global Chat"
                        class="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-white/5 transition-colors cursor-pointer">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
                        </svg>
                    </button>
                </div>
            </div>

            <!-- GLOBAL SUB-TABS -->
            <div class="px-2 py-1.5 bg-black/40 border-b border-white/10 flex items-center justify-between text-[11px] font-heading font-bold uppercase tracking-wider">
                <button type="button" data-global-tab="chat" class="cz-global-tab-btn flex-1 py-1.5 text-center rounded-lg bg-[#FFD700] text-black font-black transition-all cursor-pointer">
                    Live Feed
                </button>
                <button type="button" data-global-tab="online" class="cz-global-tab-btn flex-1 py-1.5 text-center rounded-lg text-neutral-400 hover:text-white transition-all cursor-pointer flex items-center justify-center gap-1">
                    <span>Active Champions</span>
                    <span id="cz-tab-online-badge" class="px-1.5 py-0.2 rounded-full bg-emerald-500/20 text-emerald-400 text-[9px]">0</span>
                </button>
            </div>

            <!-- GLOBAL TAB 1: LIVE CHAT STREAM -->
            <div id="cz-pane-chat" class="flex-1 flex flex-col min-h-0">
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

            <!-- GLOBAL TAB 2: ONLINE PLAYERS -->
            <div id="cz-pane-online" class="hidden flex-1 flex flex-col min-h-0 p-3 overflow-y-auto space-y-2">
                <div class="text-[10px] font-mono uppercase text-neutral-400 mb-1 flex items-center justify-between">
                    <span>Active Champions</span>
                    <span id="cz-online-count-detail" class="text-emerald-400 font-bold">0 Online</span>
                </div>
                <div id="cz-online-list" class="space-y-2">
                    <div class="text-center py-6 text-neutral-500 text-xs italic">Loading active champions...</div>
                </div>
            </div>
        </div>

        <!-- ============================================================ -->
        <!-- WINDOW 2: DIRECT MESSAGES & FRIENDS HUB CARD -->
        <!-- ============================================================ -->
        <div id="cz-dm-card" class="hidden absolute bottom-14 right-0 w-[360px] sm:w-[410px] max-w-[calc(100vw-32px)] h-[560px] max-h-[calc(100vh-100px)] rounded-2xl bg-[#0B0B10]/98 border border-blue-500/40 shadow-[0_12px_40px_rgba(0,0,0,0.85)] backdrop-blur-2xl flex flex-col overflow-hidden transition-all duration-300">
            <!-- HEADER -->
            <div class="px-4 py-3 bg-black/60 border-b border-white/10 flex items-center justify-between">
                <div class="flex items-center gap-2.5">
                    <div class="w-7 h-7 rounded-lg bg-blue-500/10 border border-blue-500/30 flex items-center justify-center text-blue-400">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" 
                                d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"></path>
                        </svg>
                    </div>
                    <div>
                        <h3 class="font-heading font-black text-xs text-white uppercase tracking-wider">Direct Messages</h3>
                        <p class="text-[10px] text-neutral-400 font-mono">Private 1-on-1 Social Hub</p>
                    </div>
                </div>
                <div class="flex items-center gap-1">
                    <button id="cz-dm-close" type="button" title="Minimize Direct Messages"
                        class="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-white/5 transition-colors cursor-pointer">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
                        </svg>
                    </button>
                </div>
            </div>

            <!-- DM HUB SUB-TABS -->
            <div class="px-2 py-1.5 bg-black/40 border-b border-white/10 flex items-center justify-between text-[11px] font-heading font-bold uppercase tracking-wider">
                <button type="button" data-dm-tab="convos" class="cz-dm-tab-btn flex-1 py-1.5 text-center rounded-lg bg-blue-500 text-white font-black transition-all cursor-pointer">
                    Chats
                </button>
                <button type="button" data-dm-tab="friends" class="cz-dm-tab-btn flex-1 py-1.5 text-center rounded-lg text-neutral-400 hover:text-white transition-all cursor-pointer relative">
                    <span>Friends</span>
                    <span id="cz-dm-tab-requests-badge" class="hidden absolute top-1 right-2 w-2 h-2 rounded-full bg-[#FFD700]"></span>
                </button>
                <button type="button" data-dm-tab="search" class="cz-dm-tab-btn flex-1 py-1.5 text-center rounded-lg text-neutral-400 hover:text-white transition-all cursor-pointer">
                    Search
                </button>
            </div>

            <!-- DM PANE 1: CHATS (CONVERSATIONS OR THREAD) -->
            <div id="cz-pane-dm-convos" class="flex-1 flex flex-col min-h-0">
                <!-- SUB-VIEW A: CONVERSATION LIST -->
                <div id="cz-dm-convos-view" class="flex-1 flex flex-col min-h-0 p-3">
                    <div class="flex items-center justify-between mb-2">
                        <span class="text-[10px] font-mono uppercase text-blue-400 font-bold">Recent Messages</span>
                        <button type="button" onclick="window.czSwitchDMTab('friends')" class="text-[10px] text-neutral-400 hover:text-blue-400 flex items-center gap-1 transition-colors cursor-pointer">
                            <span>+ Start Chat</span>
                        </button>
                    </div>
                    <div id="cz-dm-convos-list" class="flex-1 overflow-y-auto space-y-2">
                        <div class="text-center py-8 text-neutral-500 text-xs italic">Loading conversations...</div>
                    </div>
                </div>

                <!-- SUB-VIEW B: ACTIVE 1-ON-1 THREAD -->
                <div id="cz-dm-thread-view" class="hidden flex-1 flex flex-col min-h-0">
                    <!-- THREAD HEADER -->
                    <div class="px-3 py-2 bg-black/60 border-b border-white/10 flex items-center justify-between shrink-0">
                        <div class="flex items-center gap-2 min-w-0">
                            <button type="button" onclick="window.czBackToDMList()" title="Back to Chats"
                                class="p-1 rounded-lg text-neutral-400 hover:text-white hover:bg-white/5 transition-colors cursor-pointer shrink-0">
                                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"></path>
                                </svg>
                            </button>
                            <div class="relative shrink-0">
                                <img id="cz-dm-thread-avatar" src="pictures/cz_logo.png" class="w-7 h-7 rounded-xl object-cover bg-black border border-white/10" alt="">
                                <span id="cz-dm-thread-status-dot" class="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-400 border border-black"></span>
                            </div>
                            <div class="min-w-0">
                                <h4 id="cz-dm-thread-name" class="font-heading font-black text-xs text-white uppercase truncate">Friend</h4>
                                <p id="cz-dm-thread-status-text" class="text-[9px] text-emerald-400 font-mono">Online</p>
                            </div>
                        </div>
                        <div class="flex items-center gap-1 shrink-0">
                            <button type="button" id="cz-dm-thread-profile-btn" onclick="" title="View Profile"
                                class="p-1.5 rounded-lg text-neutral-400 hover:text-[#FFD700] hover:bg-white/5 transition-colors cursor-pointer">
                                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"></path>
                                </svg>
                            </button>
                        </div>
                    </div>

                    <!-- THREAD MESSAGES STREAM -->
                    <div id="cz-dm-thread-stream" class="flex-1 overflow-y-auto p-3 space-y-2.5 font-sans text-xs scroll-smooth">
                        <div class="text-center py-8 text-neutral-500 text-xs italic">Loading direct messages...</div>
                    </div>

                    <!-- THREAD INPUT FORM -->
                    <div class="p-2.5 bg-black/80 border-t border-white/10 shrink-0">
                        <form id="cz-dm-thread-form" onsubmit="window.czSendDMThreadMessage(event)" class="flex items-center gap-2">
                            <input id="cz-dm-thread-input" type="text" maxlength="500" placeholder="Type a direct message..." autocomplete="off"
                                class="flex-1 bg-white/5 border border-white/10 focus:border-blue-400 rounded-xl px-3 py-2 text-xs text-white placeholder-neutral-500 focus:outline-none transition-colors">
                            <button type="submit" id="cz-dm-thread-send-btn"
                                class="px-3.5 py-2 rounded-xl bg-blue-500 hover:bg-blue-400 text-white font-heading font-black text-xs uppercase transition-all shadow cursor-pointer shrink-0">
                                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"></path>
                                </svg>
                            </button>
                        </form>
                    </div>
                </div>
            </div>

            <!-- DM PANE 2: FRIENDS & REQUESTS -->
            <div id="cz-pane-dm-friends" class="hidden flex-1 flex flex-col min-h-0 p-3 overflow-y-auto space-y-3">
                <!-- INCOMING REQUESTS -->
                <div id="cz-incoming-requests-wrap" class="hidden">
                    <h4 class="text-[10px] font-mono uppercase text-[#FFD700] font-bold mb-2 flex items-center justify-between">
                        <span>Friend Requests</span>
                        <span id="cz-requests-count" class="px-1.5 py-0.2 rounded-full bg-[#FFD700]/20 text-[#FFD700] text-[9px]">0</span>
                    </h4>
                    <div id="cz-incoming-requests-list" class="space-y-2"></div>
                    <div class="border-b border-white/10 my-3"></div>
                </div>

                <!-- OUTGOING/SENT REQUESTS -->
                <div id="cz-outgoing-requests-wrap" class="hidden">
                    <h4 class="text-[10px] font-mono uppercase text-neutral-400 font-bold mb-2 flex items-center justify-between">
                        <span>Sent Requests (Pending)</span>
                        <span id="cz-outgoing-count" class="px-1.5 py-0.2 rounded-full bg-white/10 text-neutral-300 text-[9px]">0</span>
                    </h4>
                    <div id="cz-outgoing-requests-list" class="space-y-2"></div>
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

            <!-- DM PANE 3: SEARCH PLAYERS -->
            <div id="cz-pane-dm-search" class="hidden flex-1 flex flex-col min-h-0 p-3 space-y-3">
                <div class="relative">
                    <input id="cz-search-input" type="text" placeholder="Search by IGN, Game ID, Rank..."
                        class="w-full bg-white/5 border border-white/10 focus:border-blue-400 rounded-xl pl-8 pr-3 py-2 text-xs text-white placeholder-neutral-500 focus:outline-none transition-colors">
                    <svg class="w-3.5 h-3.5 text-neutral-500 absolute left-2.5 top-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path>
                    </svg>
                </div>
                <div id="cz-search-results" class="flex-1 overflow-y-auto space-y-2">
                    <div class="text-center py-6 text-neutral-500 text-xs italic">Type to search registered players across ChampZero</div>
                </div>
            </div>
        </div>

        <!-- QUICK PLAYER MINI PROFILE MODAL -->
        <div id="cz-player-modal" class="hidden fixed inset-0 z-[10000] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
            <div class="w-full max-w-sm rounded-2xl bg-[#0E0E14] border border-[#FFD700]/40 p-5 shadow-2xl relative animate-in fade-in zoom-in duration-200">
                <button type="button" onclick="window.czClosePlayerModal()"
                    class="absolute top-3 right-3 text-neutral-400 hover:text-white p-1 rounded-lg hover:bg-white/5 transition-colors cursor-pointer">
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
// 2. EVENT LISTENERS & WINDOW/TAB MANAGEMENT
// ----------------------------------------------------
function setupEventListeners() {
    // Global Chat Launcher & Controls
    const chatLauncher = document.getElementById('cz-chat-launcher');
    const chatCloseBtn = document.getElementById('cz-chat-close');
    const soundToggle = document.getElementById('cz-sound-toggle');
    const chatForm = document.getElementById('cz-chat-form');
    const globalTabBtns = document.querySelectorAll('.cz-global-tab-btn');

    // DM Launcher & Controls
    const dmLauncher = document.getElementById('cz-dm-launcher');
    const dmCloseBtn = document.getElementById('cz-dm-close');
    const dmTabBtns = document.querySelectorAll('.cz-dm-tab-btn');
    const searchInput = document.getElementById('cz-search-input');

    if (chatLauncher) {
        chatLauncher.onclick = () => toggleGlobalChat();
    }
    if (chatCloseBtn) {
        chatCloseBtn.onclick = () => toggleGlobalChat(false);
    }
    if (dmLauncher) {
        dmLauncher.onclick = () => toggleDMChat();
    }
    if (dmCloseBtn) {
        dmCloseBtn.onclick = () => toggleDMChat(false);
    }

    if (soundToggle) {
        soundToggle.onclick = () => {
            isSoundEnabled = !isSoundEnabled;
            document.getElementById('cz-sound-icon-on').classList.toggle('hidden', !isSoundEnabled);
            document.getElementById('cz-sound-icon-off').classList.toggle('hidden', isSoundEnabled);
        };
    }

    if (chatForm) {
        chatForm.onsubmit = async (e) => {
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

    globalTabBtns.forEach(btn => {
        btn.onclick = () => {
            const targetTab = btn.getAttribute('data-global-tab');
            switchGlobalTab(targetTab);
        };
    });

    dmTabBtns.forEach(btn => {
        btn.onclick = () => {
            const targetTab = btn.getAttribute('data-dm-tab');
            switchDMTab(targetTab);
        };
    });
}

function toggleGlobalChat(forceState) {
    const card = document.getElementById('cz-chat-card');
    const badge = document.getElementById('cz-unread-badge');
    if (!card) return;

    isGlobalChatOpen = (typeof forceState === 'boolean') ? forceState : !isGlobalChatOpen;
    if (isGlobalChatOpen) {
        // If DM is open, close it
        if (isDmOpen) toggleDMChat(false);

        card.classList.remove('hidden');
        globalUnreadCount = 0;
        if (badge) badge.classList.add('hidden');
        scrollChatToBottom();
        setTimeout(() => document.getElementById('cz-chat-input')?.focus(), 150);
    } else {
        card.classList.add('hidden');
    }
}

function toggleDMChat(forceState) {
    const card = document.getElementById('cz-dm-card');
    const badge = document.getElementById('cz-dm-unread-badge');
    if (!card) return;

    isDmOpen = (typeof forceState === 'boolean') ? forceState : !isDmOpen;
    if (isDmOpen) {
        // If Global Chat is open, close it
        if (isGlobalChatOpen) toggleGlobalChat(false);

        card.classList.remove('hidden');
        dmUnreadCount = 0;
        if (badge) badge.classList.add('hidden');
        
        if (!activeWidgetDmId) {
            loadWidgetDMConversations();
        } else {
            scrollDMThreadToBottom();
            setTimeout(() => document.getElementById('cz-dm-thread-input')?.focus(), 150);
        }
    } else {
        card.classList.add('hidden');
    }
}

function switchGlobalTab(tabName) {
    activeGlobalTab = tabName;
    const tabBtns = document.querySelectorAll('.cz-global-tab-btn');
    const paneChat = document.getElementById('cz-pane-chat');
    const paneOnline = document.getElementById('cz-pane-online');

    tabBtns.forEach(btn => {
        const isSelected = btn.getAttribute('data-global-tab') === tabName;
        if (isSelected) {
            btn.className = 'cz-global-tab-btn flex-1 py-1.5 text-center rounded-lg bg-[#FFD700] text-black font-black transition-all cursor-pointer';
        } else {
            btn.className = 'cz-global-tab-btn flex-1 py-1.5 text-center rounded-lg text-neutral-400 hover:text-white transition-all cursor-pointer';
        }
    });

    if (paneChat) paneChat.classList.toggle('hidden', tabName !== 'chat');
    if (paneOnline) paneOnline.classList.toggle('hidden', tabName !== 'online');

    if (tabName === 'chat') scrollChatToBottom();
    if (tabName === 'online') renderOnlineList();
}

window.czSwitchDMTab = function(tabName) {
    switchDMTab(tabName);
};

function switchDMTab(tabName) {
    activeDmTab = tabName;
    const tabBtns = document.querySelectorAll('.cz-dm-tab-btn');
    const panes = {
        convos: document.getElementById('cz-pane-dm-convos'),
        friends: document.getElementById('cz-pane-dm-friends'),
        search: document.getElementById('cz-pane-dm-search')
    };

    tabBtns.forEach(btn => {
        const isSelected = btn.getAttribute('data-dm-tab') === tabName;
        if (isSelected) {
            btn.className = 'cz-dm-tab-btn flex-1 py-1.5 text-center rounded-lg bg-blue-500 text-white font-black transition-all cursor-pointer';
        } else {
            btn.className = 'cz-dm-tab-btn flex-1 py-1.5 text-center rounded-lg text-neutral-400 hover:text-white transition-all cursor-pointer';
        }
    });

    Object.keys(panes).forEach(k => {
        if (panes[k]) panes[k].classList.toggle('hidden', k !== tabName);
    });

    if (tabName === 'convos') {
        if (!activeWidgetDmId) loadWidgetDMConversations();
        else scrollDMThreadToBottom();
    }
    if (tabName === 'friends') renderFriendsPanel();
    if (tabName === 'search') {
        const queryVal = document.getElementById('cz-search-input')?.value || '';
        filterAndRenderSearch(queryVal);
    }
}

function scrollChatToBottom() {
    const stream = document.getElementById('cz-messages-stream');
    if (stream) {
        setTimeout(() => {
            stream.scrollTop = stream.scrollHeight;
        }, 50);
    }
}

function scrollDMThreadToBottom() {
    const stream = document.getElementById('cz-dm-thread-stream');
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
    const now = Date.now();
    const senderRole = (currentProfile.role || 'member').toLowerCase();
    const senderRank = currentProfile.rank || currentProfile.valRank || currentProfile.mlbbRank || currentProfile.hokRank || 'Unranked';
    const isSupporter = Boolean((currentProfile.isSupporter || currentProfile.supporterTier || currentProfile.supporterBadge) && (!currentProfile.supporterExpiresAt || currentProfile.supporterExpiresAt > now));
    const supporterTier = isSupporter ? (currentProfile.supporterTier || 'bronze') : null;

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
        await addDoc(collection(db, "global_chat_messages"), msgPayload);
    } catch (e) {
        console.warn("Primary global_chat_messages write failed, trying fallback:", e);
        try {
            const resp = await fetch('/api/chat/send', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(msgPayload)
            });
            if (!resp.ok) throw new Error("API fallback failed");
        } catch (apiErr) {
            console.error("Error sending chat message:", apiErr);
            if (window.showErrorToast) window.showErrorToast("Error", "Could not send message: " + (e.message || 'Please check connection'));
            return;
        }
    }
}

window.czSendQuick = async function (text) {
    await sendChatMessage(text);
};

let isInitialChatSnapshot = true;

function listenToGlobalChat() {
    if (unsubscribeChat) unsubscribeChat();
    isInitialChatSnapshot = true;

    try {
        const messagesQuery = query(collection(db, "global_chat_messages"));
        let previousMsgCount = -1;

        unsubscribeChat = onSnapshot(messagesQuery, (snapshot) => {
            const messages = [];
            snapshot.forEach(docSnap => {
                const data = docSnap.data();
                if (data.type === 'global_chat' || (!data.type && data.text && data.senderName)) {
                    messages.push({ id: docSnap.id, ...data });
                }
            });

            messages.sort((a, b) => (a.timestamp || (new Date(a.createdAt || a.sentAt || 0)).getTime()) - (b.timestamp || (new Date(b.createdAt || b.sentAt || 0)).getTime()));

            const recentMessages = messages.slice(-60);
            renderChatMessages(recentMessages);

            if (isInitialChatSnapshot) {
                isInitialChatSnapshot = false;
                previousMsgCount = messages.length;
                return;
            }

            if (messages.length > previousMsgCount) {
                const newAddedCount = messages.length - Math.max(0, previousMsgCount);
                previousMsgCount = messages.length;

                if (!isGlobalChatOpen && newAddedCount > 0) {
                    globalUnreadCount += newAddedCount;
                    const badge = document.getElementById('cz-unread-badge');
                    if (badge) {
                        badge.textContent = globalUnreadCount > 9 ? '9+' : globalUnreadCount;
                        badge.classList.remove('hidden');
                    }
                    playChatChime();
                }
            }
        }, (err) => {
            console.warn("Messages collection listener error:", err);
        });
    } catch (e) {
        console.error("Global chat listener failed:", e);
    }
}

function renderChatMessages(messages) {
    const stream = document.getElementById('cz-messages-stream');
    if (!stream) return;

    if (messages.length === 0) {
        stream.innerHTML = `<div class="text-center py-12 text-neutral-500 text-xs italic">No messages yet. Say hello to start the conversation!</div>`;
        return;
    }

    const activeUser = currentUser || auth.currentUser;
    const currentUid = activeUser ? activeUser.uid : null;

    stream.innerHTML = messages.map(msg => {
        const isMine = msg.senderId === currentUid;
        const name = msg.senderName || 'Champion';
        const avatar = msg.senderAvatar || ('https://ui-avatars.com/api/?name=' + encodeURIComponent(name) + '&background=111116&color=FFD700');
        const role = (msg.senderRole || 'member').toLowerCase();
        const isAdmin = role === 'admin' || role === 'superadmin';
        const isOrganizer = role === 'organizer' || role === 'host';
        const isSupporter = Boolean(msg.isSupporter || msg.supporterTier);
        const supporterTier = String(msg.supporterTier || 'bronze').toLowerCase();
        const text = escapeHtml(msg.text || '');

        let timeStr = '';
        if (msg.timestamp || msg.createdAt || msg.sentAt) {
            try {
                const d = new Date(msg.timestamp || msg.createdAt || msg.sentAt);
                timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            } catch (e) {}
        }

        let roleBadge = '';
        if (isAdmin) {
            roleBadge = '<span class="px-1.5 py-0.2 rounded bg-red-500/20 text-red-400 text-[8px] font-mono font-bold uppercase border border-red-500/30">ADMIN</span>';
        } else if (isOrganizer) {
            roleBadge = '<span class="px-1.5 py-0.2 rounded bg-purple-500/20 text-purple-400 text-[8px] font-mono font-bold uppercase border border-purple-500/30">HOST</span>';
        }

        let supporterBadge = '';
        if (isSupporter) {
            if (supporterTier === 'gold') {
                supporterBadge = '<span class="px-1.5 py-0.2 rounded bg-[#FFD700]/20 text-[#FFD700] text-[8px] font-mono font-bold border border-[#FFD700]/40">GOLD</span>';
            } else if (supporterTier === 'silver') {
                supporterBadge = '<span class="px-1.5 py-0.2 rounded bg-slate-400/20 text-slate-200 text-[8px] font-mono font-bold border border-slate-300/40">SILVER</span>';
            } else {
                supporterBadge = '<span class="px-1.5 py-0.2 rounded bg-amber-700/20 text-amber-400 text-[8px] font-mono font-bold border border-amber-600/40">BRONZE</span>';
            }
        }

        return `
            <div class="flex items-start gap-2.5 ${isMine ? 'flex-row-reverse' : ''} group animate-in fade-in duration-150">
                <button type="button" onclick="window.czOpenPlayerModal('${escapeHtml(msg.senderId)}')"
                    class="shrink-0 rounded-xl overflow-hidden focus:outline-none focus:ring-2 focus:ring-[#FFD700] transition-transform hover:scale-105 cursor-pointer">
                    <img src="${escapeHtml(avatar)}" class="w-8 h-8 rounded-xl object-cover bg-black border border-white/10" alt="${escapeHtml(name)}">
                </button>
                <div class="flex flex-col ${isMine ? 'items-end' : 'items-start'} max-w-[78%]">
                    <div class="flex items-center gap-1.5 mb-1 flex-wrap ${isMine ? 'justify-end' : ''}">
                        <button type="button" onclick="window.czOpenPlayerModal('${escapeHtml(msg.senderId)}')"
                            class="font-heading font-bold text-white hover:text-[#FFD700] text-xs transition-colors cursor-pointer truncate max-w-[120px]">
                            ${escapeHtml(name)}
                        </button>
                        ${roleBadge}
                        ${supporterBadge}
                        <span class="text-[9px] text-neutral-500 font-mono">${timeStr}</span>
                    </div>
                    <div class="${isMine ? 'bg-[#FFD700]/15 border border-[#FFD700]/30 text-white rounded-2xl rounded-tr-sm' : 'bg-white/5 border border-white/10 text-neutral-200 rounded-2xl rounded-tl-sm'} px-3 py-2 text-xs break-words leading-relaxed shadow-sm">
                        ${text}
                    </div>
                </div>
            </div>
        `;
    }).join('');

    scrollChatToBottom();
}

// ----------------------------------------------------
// 4. ONLINE PRESENCE ENGINE
// ----------------------------------------------------
async function updateMyPresence(isOnline) {
    const activeUser = currentUser || auth.currentUser;
    if (!activeUser) return;

    try {
        const userRef = doc(db, "users", activeUser.uid);
        await updateDoc(userRef, {
            isOnline: Boolean(isOnline),
            lastActive: new Date().toISOString(),
            lastHeartbeat: Date.now()
        });
    } catch (e) {
        // Safe silence
    }
}

function listenToUsersPresence() {
    if (unsubscribeOnline) unsubscribeOnline();

    try {
        const usersQuery = query(collection(db, "users"));
        unsubscribeOnline = onSnapshot(usersQuery, (snapshot) => {
            const users = [];
            snapshot.forEach(docSnap => {
                users.push({ id: docSnap.id, ...docSnap.data() });
            });

            allRegisteredUsers = users;
            const now = Date.now();

            onlineUsersList = users.filter(u => {
                if (u.isOnline === true) {
                    if (u.lastHeartbeat && (now - u.lastHeartbeat) < 120000) return true;
                    if (u.lastActive && (now - new Date(u.lastActive).getTime()) < 180000) return true;
                }
                return false;
            });

            const count = Math.max(1, onlineUsersList.length);
            const onlinePill = document.getElementById('cz-online-pill-count');
            const onlineHeader = document.getElementById('cz-online-header-count');
            const onlineBadge = document.getElementById('cz-tab-online-badge');
            const onlineDetail = document.getElementById('cz-online-count-detail');

            if (onlinePill) onlinePill.textContent = count;
            if (onlineHeader) onlineHeader.textContent = `${count} Online`;
            if (onlineBadge) onlineBadge.textContent = count;
            if (onlineDetail) onlineDetail.textContent = `${count} Online`;

            if (activeGlobalTab === 'online') renderOnlineList();
            if (activeDmTab === 'friends') renderFriendsPanel();
        });
    } catch (e) {
        console.error("Presence listener failed:", e);
    }
}

function renderOnlineList() {
    const container = document.getElementById('cz-online-list');
    if (!container) return;

    if (onlineUsersList.length === 0) {
        container.innerHTML = `<div class="text-center py-8 text-neutral-500 text-xs italic">No active players detected.</div>`;
        return;
    }

    container.innerHTML = onlineUsersList.map(u => {
        const name = u.ign || u.displayName || u.username || 'Champion';
        const avatar = u.avatar || ('https://ui-avatars.com/api/?name=' + encodeURIComponent(name) + '&background=111116&color=FFD700');
        const role = (u.role || 'member').toLowerCase();
        const isMe = currentUser && currentUser.uid === u.id;
        const rank = u.rank || u.valRank || u.mlbbRank || u.hokRank || 'Unranked';

        return `
            <div class="p-2.5 rounded-xl bg-black/40 border border-white/5 hover:border-white/15 flex items-center justify-between gap-2.5 transition-colors">
                <div class="flex items-center gap-2.5 min-w-0">
                    <div class="relative shrink-0">
                        <img src="${escapeHtml(avatar)}" class="w-8 h-8 rounded-xl object-cover bg-black border border-white/10" alt="Avatar">
                        <span class="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-400 border border-black animate-pulse"></span>
                    </div>
                    <div class="min-w-0">
                        <div class="flex items-center gap-1.5">
                            <span class="font-heading font-bold text-white text-xs truncate">${escapeHtml(name)}</span>
                            ${isMe ? '<span class="text-[8px] text-[#FFD700] font-mono font-bold">(YOU)</span>' : ''}
                        </div>
                        <p class="text-[10px] text-neutral-400 font-mono truncate">${escapeHtml(rank)}</p>
                    </div>
                </div>
                <div class="flex items-center gap-1.5 shrink-0">
                    ${!isMe ? `
                        <button type="button" onclick="window.czOpenDMWith('${escapeHtml(u.id)}', '${escapeHtml(name)}', '${escapeHtml(avatar)}')" title="Direct Message"
                            class="px-2 py-1 rounded bg-blue-500/10 hover:bg-blue-500 text-blue-400 hover:text-white text-[10px] font-bold transition-colors cursor-pointer">
                            Message
                        </button>
                    ` : ''}
                    <button type="button" onclick="window.czOpenPlayerModal('${escapeHtml(u.id)}')"
                        class="px-2 py-1 rounded bg-white/5 hover:bg-white/10 text-neutral-300 text-[10px] font-bold border border-white/10 transition-colors cursor-pointer">
                        Profile
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

// ----------------------------------------------------
// 5. PLAYER SEARCH DIRECTORY
// ----------------------------------------------------
function filterAndRenderSearch(searchQuery) {
    const resultsContainer = document.getElementById('cz-search-results');
    if (!resultsContainer) return;

    if (!searchQuery) {
        resultsContainer.innerHTML = `<div class="text-center py-6 text-neutral-500 text-xs italic">Type to search registered players across ChampZero</div>`;
        return;
    }

    const q = searchQuery.toLowerCase();
    const matches = allRegisteredUsers.filter(u => {
        const name = (u.ign || u.displayName || u.username || '').toLowerCase();
        const valId = (u.valId || '').toLowerCase();
        const mlbbId = (u.mlbbId || '').toLowerCase();
        const hokId = (u.hokId || '').toLowerCase();
        const role = (u.role || '').toLowerCase();
        return name.includes(q) || valId.includes(q) || mlbbId.includes(q) || hokId.includes(q) || role.includes(q);
    });

    if (matches.length === 0) {
        resultsContainer.innerHTML = `<div class="text-center py-6 text-neutral-500 text-xs">No champions matching "${escapeHtml(searchQuery)}"</div>`;
        return;
    }

    resultsContainer.innerHTML = matches.slice(0, 15).map(u => {
        const name = u.ign || u.displayName || u.username || 'Champion';
        const avatar = u.avatar || ('https://ui-avatars.com/api/?name=' + encodeURIComponent(name) + '&background=111116&color=FFD700');
        const isMe = currentUser && currentUser.uid === u.id;
        const friendship = getFriendshipStatus(u.id);
        const status = typeof friendship === 'object' ? friendship.status : friendship;

        return `
            <div class="p-2.5 rounded-xl bg-black/40 border border-white/5 hover:border-white/15 flex items-center justify-between gap-2 transition-colors">
                <div class="flex items-center gap-2.5 min-w-0">
                    <img src="${escapeHtml(avatar)}" class="w-8 h-8 rounded-xl object-cover bg-black border border-white/10 shrink-0" alt="Avatar">
                    <div class="min-w-0">
                        <span class="font-heading font-bold text-white text-xs truncate block">${escapeHtml(name)}</span>
                        <span class="text-[9px] text-neutral-400 font-mono block truncate">${escapeHtml(u.valId || u.mlbbId || u.hokId || 'No game ID')}</span>
                    </div>
                </div>
                <div class="flex items-center gap-1.5 shrink-0">
                    ${(() => {
                        if (isMe) return '<span class="text-[9px] text-neutral-500 font-mono">You</span>';
                        if (status === 'friends') {
                            return `
                                <button type="button" onclick="window.czOpenDMWith('${escapeHtml(u.id)}', '${escapeHtml(name)}', '${escapeHtml(avatar)}')"
                                    class="px-2 py-1 rounded bg-blue-500 text-white text-[10px] font-bold transition-colors cursor-pointer">
                                    Message
                                </button>
                            `;
                        }
                        if (status === 'incoming_pending') {
                            return `
                                <button type="button" onclick="window.czRespondFriendRequest('${friendship.reqId}', 'accepted', '${escapeHtml(name)}')"
                                    class="px-2 py-1 rounded bg-[#FFD700] text-black text-[10px] font-black transition-colors cursor-pointer">
                                    Accept
                                </button>
                            `;
                        }
                        if (status === 'outgoing_pending') {
                            return `<span class="px-2 py-0.5 rounded text-[9px] font-mono text-amber-400 bg-amber-500/10 border border-amber-500/20">Pending</span>`;
                        }
                        return `
                            <button type="button" onclick="window.czSendFriendRequest('${escapeHtml(u.id)}', '${escapeHtml(name)}', '${escapeHtml(avatar)}')"
                                class="px-2 py-1 rounded bg-[#FFD700]/10 hover:bg-[#FFD700] text-[#FFD700] hover:text-black text-[10px] font-bold transition-colors cursor-pointer">
                                + Add
                            </button>
                        `;
                    })()}
                    <button type="button" onclick="window.czOpenPlayerModal('${escapeHtml(u.id)}')"
                        class="px-2 py-1 rounded bg-white/5 hover:bg-white/10 text-neutral-300 text-[10px] font-bold border border-white/10 transition-colors cursor-pointer">
                        Profile
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

function getFriendshipStatus(targetUid) {
    if (!currentUser) return 'none';
    if (myFriendsList.some(f => f.uid === targetUid)) return 'friends';
    const outgoing = outgoingRequestsList.find(r => r.toUid === targetUid);
    if (outgoing) return { status: 'outgoing_pending', reqId: outgoing.id };
    const incoming = pendingRequestsList.find(r => r.fromUid === targetUid);
    if (incoming) return { status: 'incoming_pending', reqId: incoming.id };
    return 'none';
}

// ----------------------------------------------------
// 6. DIRECT 1-ON-1 MESSAGES (DMs) ENGINE
// ----------------------------------------------------
async function getOrCreateDMWidget(uid1, uid2) {
    const dmRef = collection(db, "direct_messages");
    try {
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
    } catch (e) {
        console.warn("Could not query direct_messages:", e);
    }

    const newDm = await addDoc(dmRef, {
        participants: [uid1, uid2],
        createdAt: new Date().toISOString(),
        lastMessage: '',
        lastMessageAt: new Date().toISOString()
    });
    return newDm.id;
}

async function loadWidgetDMConversations() {
    const listEl = document.getElementById('cz-dm-convos-list');
    if (!listEl) return;

    const activeUser = currentUser || auth.currentUser;
    if (!activeUser) {
        listEl.innerHTML = `
            <div class="text-center py-10 px-4">
                <div class="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center mx-auto mb-2 text-neutral-400">
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"></path></svg>
                </div>
                <p class="text-xs text-white font-heading font-bold uppercase">Sign in to Message</p>
                <p class="text-[10px] text-neutral-400 mt-1">Direct messaging is available for logged in Champions.</p>
            </div>
        `;
        return;
    }

    listEl.innerHTML = `<div class="text-center py-8 text-neutral-500 text-xs italic">Loading conversations...</div>`;

    try {
        const dmRef = collection(db, "direct_messages");
        const q = query(dmRef, where("participants", "array-contains", activeUser.uid));
        const snap = await getDocs(q);

        if (snap.empty) {
            listEl.innerHTML = `
                <div class="text-center py-8 px-4 space-y-3">
                    <div class="w-10 h-10 rounded-full bg-blue-500/10 border border-blue-500/20 flex items-center justify-center mx-auto text-blue-400">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"></path></svg>
                    </div>
                    <div>
                        <p class="text-xs text-white font-heading font-bold uppercase">No Direct Messages Yet</p>
                        <p class="text-[10px] text-neutral-400 mt-0.5">Start a private chat with any friend!</p>
                    </div>
                    <button type="button" onclick="window.czSwitchDMTab('friends')"
                        class="px-3 py-1.5 rounded-xl bg-blue-500 hover:bg-blue-400 text-white font-heading font-black text-[10px] uppercase transition-all shadow cursor-pointer">
                        View Friends List
                    </button>
                </div>
            `;
            return;
        }

        const convos = [];
        snap.forEach(d => {
            const data = d.data();
            const friendUid = (data.participants || []).find(p => p !== activeUser.uid);
            if (friendUid) {
                convos.push({ id: d.id, friendUid, ...data });
            }
        });

        convos.sort((a, b) => (b.lastMessageAt || '').localeCompare(a.lastMessageAt || ''));

        const cards = await Promise.all(convos.map(async (c) => {
            let friendData = allRegisteredUsers.find(u => u.id === c.friendUid) || {};
            if (!friendData.ign && !friendData.displayName) {
                try {
                    const fDoc = await getDoc(doc(db, "users", c.friendUid));
                    if (fDoc.exists()) friendData = { id: fDoc.id, ...fDoc.data() };
                } catch (e) {}
            }

            const name = friendData.ign || friendData.displayName || friendData.username || 'Champion';
            const avatar = friendData.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=111116&color=FFD700&size=36`;
            const isOnline = onlineUsersList.some(u => u.id === c.friendUid);
            const preview = c.lastMessage ? (c.lastMessage.length > 35 ? c.lastMessage.substring(0, 35) + '...' : c.lastMessage) : 'Start chatting...';

            let timeStr = '';
            if (c.lastMessageAt) {
                try {
                    const d = new Date(c.lastMessageAt);
                    timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                } catch (e) {}
            }

            return `
                <button type="button" onclick="window.czOpenDMWith('${escapeHtml(c.friendUid)}', '${escapeHtml(name)}', '${escapeHtml(avatar)}', '${c.id}')"
                    class="w-full p-2.5 rounded-xl bg-black/40 hover:bg-white/5 border border-white/5 hover:border-blue-500/30 flex items-center justify-between gap-2.5 transition-all text-left cursor-pointer group">
                    <div class="flex items-center gap-2.5 min-w-0 flex-1">
                        <div class="relative shrink-0">
                            <img src="${escapeHtml(avatar)}" class="w-9 h-9 rounded-xl object-cover bg-black border border-white/10" alt="">
                            <span class="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full ${isOnline ? 'bg-emerald-400 border border-black' : 'bg-neutral-600'}"></span>
                        </div>
                        <div class="min-w-0 flex-1">
                            <div class="flex items-center justify-between gap-1">
                                <span class="font-heading font-bold text-white text-xs truncate group-hover:text-blue-400 transition-colors">${escapeHtml(name)}</span>
                                <span class="text-[9px] text-neutral-500 font-mono shrink-0">${timeStr}</span>
                            </div>
                            <p class="text-[10px] text-neutral-400 truncate mt-0.5">${escapeHtml(preview)}</p>
                        </div>
                    </div>
                </button>
            `;
        }));

        listEl.innerHTML = cards.join('');
    } catch (err) {
        console.error("Error loading widget conversations:", err);
        listEl.innerHTML = '<div class="text-center py-8 text-rose-400 text-xs">Failed to load conversations.</div>';
    }
}

window.czOpenDMWith = async function (friendUid, friendName, friendAvatar, directDmId = null) {
    const activeUser = currentUser || auth.currentUser;
    if (!activeUser) {
        if (window.showErrorToast) window.showErrorToast("Sign In Required", "Please log in to send Direct Messages.");
        else alert("Please log in to send Direct Messages.");
        return;
    }

    if (friendUid === activeUser.uid) {
        if (window.showWarningToast) window.showWarningToast("Notice", "You cannot direct message yourself.");
        return;
    }

    // Open DM card (and close Global Chat card if open)
    toggleDMChat(true);
    switchDMTab('convos');

    const convosView = document.getElementById('cz-dm-convos-view');
    const threadView = document.getElementById('cz-dm-thread-view');
    if (convosView) convosView.classList.add('hidden');
    if (threadView) threadView.classList.remove('hidden');

    const nameEl = document.getElementById('cz-dm-thread-name');
    const avatarEl = document.getElementById('cz-dm-thread-avatar');
    const statusDot = document.getElementById('cz-dm-thread-status-dot');
    const statusText = document.getElementById('cz-dm-thread-status-text');
    const profileBtn = document.getElementById('cz-dm-thread-profile-btn');
    const stream = document.getElementById('cz-dm-thread-stream');

    const displayName = friendName || 'Champion';
    const displayAvatar = friendAvatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(displayName)}&background=111116&color=FFD700&size=36`;
    const isOnline = onlineUsersList.some(u => u.id === friendUid);

    if (nameEl) nameEl.textContent = displayName;
    if (avatarEl) avatarEl.src = displayAvatar;
    if (statusDot) statusDot.className = `absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full ${isOnline ? 'bg-emerald-400 border border-black' : 'bg-neutral-600'}`;
    if (statusText) {
        statusText.textContent = isOnline ? 'Online' : 'Offline';
        statusText.className = `text-[9px] ${isOnline ? 'text-emerald-400' : 'text-neutral-500'} font-mono`;
    }
    if (profileBtn) {
        profileBtn.onclick = () => window.czOpenPlayerModal(friendUid);
    }
    if (stream) {
        stream.innerHTML = `<div class="text-center py-8 text-neutral-500 text-xs italic">Connecting to chat...</div>`;
    }

    try {
        const dmId = directDmId || await getOrCreateDMWidget(activeUser.uid, friendUid);
        activeWidgetDmId = dmId;
        activeWidgetFriendUid = friendUid;
        activeWidgetFriendName = displayName;

        listenToWidgetDMThread(dmId);

        setTimeout(() => {
            const input = document.getElementById('cz-dm-thread-input');
            if (input) input.focus();
        }, 150);
    } catch (e) {
        console.error("Error opening DM thread:", e);
        if (stream) stream.innerHTML = `<div class="text-center py-8 text-rose-400 text-xs">Error opening conversation.</div>`;
    }
};

function listenToWidgetDMThread(dmId) {
    if (unsubscribeDmThread) {
        unsubscribeDmThread();
        unsubscribeDmThread = null;
    }

    try {
        const msgsRef = collection(db, "direct_messages", dmId, "messages");
        const msgsQuery = query(msgsRef, orderBy("createdAt", "asc"));

        unsubscribeDmThread = onSnapshot(msgsQuery, (snapshot) => {
            const stream = document.getElementById('cz-dm-thread-stream');
            if (!stream) return;

            if (snapshot.empty) {
                stream.innerHTML = `<div class="flex flex-col items-center justify-center h-full py-12 text-neutral-500 text-xs italic space-y-1"><p>No messages yet.</p><p class="text-[10px]">Say hello to ${escapeHtml(activeWidgetFriendName || 'your friend')}!</p></div>`;
                return;
            }

            const messages = [];
            snapshot.forEach(d => messages.push({ id: d.id, ...d.data() }));

            const activeUser = currentUser || auth.currentUser;
            const myUid = activeUser ? activeUser.uid : null;

            stream.innerHTML = messages.map(msg => {
                const isMine = msg.senderUid === myUid;
                let timeStr = '';
                if (msg.createdAt) {
                    try {
                        const d = new Date(msg.createdAt);
                        timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                    } catch (e) {}
                }

                return `
                    <div class="flex ${isMine ? 'justify-end' : 'justify-start'} animate-in fade-in duration-150">
                        <div class="max-w-[80%] ${isMine ? 'bg-blue-500/20 border border-blue-500/40 text-white rounded-2xl rounded-br-sm' : 'bg-white/5 border border-white/10 text-neutral-200 rounded-2xl rounded-bl-sm'} px-3.5 py-2">
                            <p class="text-xs break-words leading-relaxed">${escapeHtml(msg.text || '')}</p>
                            <p class="text-[8px] ${isMine ? 'text-blue-300' : 'text-neutral-500'} font-mono mt-1 text-right">${timeStr}</p>
                        </div>
                    </div>
                `;
            }).join('');

            scrollDMThreadToBottom();
        }, (err) => {
            console.error("DM thread listener error:", err);
        });
    } catch (e) {
        console.error("Error setting up DM thread listener:", e);
    }
}

window.czBackToDMList = function () {
    if (unsubscribeDmThread) {
        unsubscribeDmThread();
        unsubscribeDmThread = null;
    }
    activeWidgetDmId = null;
    activeWidgetFriendUid = null;
    activeWidgetFriendName = null;

    const convosView = document.getElementById('cz-dm-convos-view');
    const threadView = document.getElementById('cz-dm-thread-view');
    if (convosView) convosView.classList.remove('hidden');
    if (threadView) threadView.classList.add('hidden');

    loadWidgetDMConversations();
};

window.czSendDMThreadMessage = async function (event) {
    if (event) event.preventDefault();
    if (!activeWidgetDmId) return;
    const activeUser = currentUser || auth.currentUser;
    if (!activeUser) return;

    const input = document.getElementById('cz-dm-thread-input');
    const text = input?.value?.trim();
    if (!text) return;

    input.value = '';

    try {
        const msgsRef = collection(db, "direct_messages", activeWidgetDmId, "messages");
        await addDoc(msgsRef, {
            senderUid: activeUser.uid,
            text: text,
            createdAt: new Date().toISOString()
        });

        const dmDocRef = doc(db, "direct_messages", activeWidgetDmId);
        await updateDoc(dmDocRef, {
            lastMessage: text,
            lastMessageAt: new Date().toISOString()
        });

        scrollDMThreadToBottom();
    } catch (err) {
        console.error("Error sending DM:", err);
        if (window.showErrorToast) window.showErrorToast("Send Failed", "Could not send message: " + (err.message || 'Check connection'));
    }
};

// ----------------------------------------------------
// 7. FRIENDS & FRIEND REQUESTS ENGINE
// ----------------------------------------------------
window.czSendFriendRequest = async function (targetUid, targetName, targetAvatar) {
    const activeUser = currentUser || auth.currentUser;
    if (!activeUser) {
        if (window.showErrorToast) window.showErrorToast("Sign In Required", "Please log in to add friends!");
        else alert("Please log in to add friends!");
        return;
    }

    if (targetUid === activeUser.uid) {
        if (window.showWarningToast) window.showWarningToast("Notice", "You cannot send a friend request to yourself.");
        return;
    }

    const currentStatus = getFriendshipStatus(targetUid);
    if (currentStatus === 'friends') {
        if (window.showSuccessToast) window.showSuccessToast("Already Friends", `You are already friends with ${targetName}.`);
        return;
    }
    if (typeof currentStatus === 'object' && currentStatus.status === 'outgoing_pending') {
        if (window.showSuccessToast) window.showSuccessToast("Pending Request", `Friend invitation is already pending for ${targetName}.`);
        return;
    }
    if (typeof currentStatus === 'object' && currentStatus.status === 'incoming_pending') {
        await window.czRespondFriendRequest(currentStatus.reqId, 'accepted', targetName);
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
        const docRef = await addDoc(collection(db, "friend_requests"), reqPayload);
        outgoingRequestsList.push({ id: docRef.id, ...reqPayload });
        if (window.showSuccessToast) {
            window.showSuccessToast("Friend Request Sent!", `Invitation dispatched to ${targetName}.`);
        }
        if (activeDmTab === 'friends') renderFriendsPanel();
        if (activeDmTab === 'search') {
            const queryVal = document.getElementById('cz-search-input')?.value || '';
            filterAndRenderSearch(queryVal);
        }
    } catch (e) {
        console.warn("Client Firestore write failed, attempting server API fallback:", e);
        try {
            const resp = await fetch('/api/friends/request', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(reqPayload)
            });
            const resData = await resp.json();
            if (resp.ok && resData.id) {
                outgoingRequestsList.push({ id: resData.id, ...reqPayload });
                if (window.showSuccessToast) {
                    window.showSuccessToast("Friend Request Sent!", `Invitation dispatched to ${targetName}.`);
                }
                if (activeDmTab === 'friends') renderFriendsPanel();
                if (activeDmTab === 'search') {
                    const queryVal = document.getElementById('cz-search-input')?.value || '';
                    filterAndRenderSearch(queryVal);
                }
                return;
            }
            throw new Error(resData.error || 'Server error');
        } catch (apiErr) {
            console.error("Error sending friend request:", apiErr);
            if (window.showErrorToast) window.showErrorToast("Error", "Could not send friend request: " + (e.message || 'Check Firestore permissions'));
        }
    }
};

function listenToFriendRequests() {
    const activeUser = currentUser || auth.currentUser;
    if (!activeUser) return;
    if (unsubscribeRequests) unsubscribeRequests();

    try {
        const reqQuery = query(collection(db, "friend_requests"));
        unsubscribeRequests = onSnapshot(reqQuery, (snapshot) => {
            const incoming = [];
            const outgoing = [];
            const friends = [];

            snapshot.forEach(docSnap => {
                const data = { id: docSnap.id, ...docSnap.data() };
                if (data.type === 'friend_request') {
                    if (data.toUid === activeUser.uid && data.status === 'pending') {
                        incoming.push(data);
                    }
                    if (data.fromUid === activeUser.uid && data.status === 'pending') {
                        outgoing.push(data);
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
            outgoingRequestsList = outgoing;
            myFriendsList = friends;

            const reqBadge = document.getElementById('cz-dm-tab-requests-badge');
            const dmUnreadBadge = document.getElementById('cz-dm-unread-badge');
            const reqCount = document.getElementById('cz-requests-count');
            const friendsCount = document.getElementById('cz-friends-count');

            if (reqBadge) reqBadge.classList.toggle('hidden', incoming.length === 0);
            if (dmUnreadBadge) {
                if (incoming.length > 0 && !isDmOpen) {
                    dmUnreadBadge.textContent = incoming.length;
                    dmUnreadBadge.classList.remove('hidden');
                } else if (incoming.length === 0) {
                    dmUnreadBadge.classList.add('hidden');
                }
            }
            if (reqCount) reqCount.textContent = incoming.length;
            if (friendsCount) friendsCount.textContent = `${friends.length} Friends`;

            if (activeDmTab === 'friends') renderFriendsPanel();
            if (activeDmTab === 'search') {
                const queryVal = document.getElementById('cz-search-input')?.value || '';
                filterAndRenderSearch(queryVal);
            }
        });
    } catch (e) {
        console.error("Error setting up friend requests listener:", e);
    }
}

function renderFriendsPanel() {
    const incWrap = document.getElementById('cz-incoming-requests-wrap');
    const incList = document.getElementById('cz-incoming-requests-list');
    const outWrap = document.getElementById('cz-outgoing-requests-wrap');
    const outList = document.getElementById('cz-outgoing-requests-list');
    const outCount = document.getElementById('cz-outgoing-count');
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

    if (outWrap && outList) {
        if (outgoingRequestsList.length > 0) {
            outWrap.classList.remove('hidden');
            if (outCount) outCount.textContent = outgoingRequestsList.length;
            outList.innerHTML = outgoingRequestsList.map(r => `
                <div class="p-2.5 rounded-xl bg-white/[0.02] border border-white/5 flex items-center justify-between gap-2">
                    <div class="flex items-center gap-2 min-w-0">
                        <img src="${escapeHtml(r.toAvatar)}" class="w-7 h-7 rounded-lg object-cover bg-black border border-white/10 shrink-0" alt="Avatar">
                        <span class="font-heading font-bold text-white text-xs truncate">${escapeHtml(r.toName)}</span>
                    </div>
                    <div class="flex items-center gap-1 shrink-0">
                        <span class="px-2 py-0.5 rounded text-[9px] font-mono text-amber-400 bg-amber-500/10 border border-amber-500/20">Pending</span>
                        <button type="button" onclick="window.czCancelFriendRequest('${r.id}', '${escapeHtml(r.toName)}')" title="Cancel Request"
                            class="px-2 py-1 bg-white/5 hover:bg-rose-500/20 text-neutral-400 hover:text-rose-400 text-[10px] font-bold rounded transition-colors cursor-pointer">
                            Cancel
                        </button>
                    </div>
                </div>
            `).join('');
        } else {
            outWrap.classList.add('hidden');
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
                    <div class="flex items-center gap-1.5 shrink-0">
                        <button type="button" onclick="window.czOpenDMWith('${escapeHtml(f.uid)}', '${escapeHtml(f.name)}', '${escapeHtml(f.avatar)}')" title="Send Direct Message"
                            class="px-2 py-1 rounded bg-blue-500/15 hover:bg-blue-500 text-blue-400 hover:text-white text-[10px] font-bold transition-colors cursor-pointer">
                            Message
                        </button>
                        <button type="button" onclick="window.czOpenPlayerModal('${escapeHtml(f.uid)}')"
                            class="px-2 py-1 rounded bg-white/5 hover:bg-white/10 text-neutral-300 text-[10px] font-bold border border-white/10 transition-colors cursor-pointer">
                            Profile
                        </button>
                        <button type="button" onclick="window.czRemoveFriend('${escapeHtml(f.uid)}', '${escapeHtml(f.name)}')" title="Unfriend"
                            class="p-1 rounded text-neutral-500 hover:text-rose-400 hover:bg-rose-500/10 transition-colors cursor-pointer">
                            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                        </button>
                    </div>
                </div>
            `;
        }).join('');
    }
}

window.czRespondFriendRequest = async function (reqId, newStatus, senderName) {
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
        console.warn("Client Firestore update failed, trying server API fallback:", e);
        try {
            await fetch('/api/friends/respond', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ reqId, status: newStatus })
            });
            if (window.showSuccessToast) {
                if (newStatus === 'accepted') window.showSuccessToast("Friend Connected!", `You and ${senderName} are now friends!`);
                else window.showSuccessToast("Request Declined", "Friend request declined.");
            }
        } catch (apiErr) {
            console.error("Error updating friend request:", apiErr);
        }
    }
};

window.czRemoveFriend = async function (friendUid, friendName) {
    const activeUser = currentUser || auth.currentUser;
    if (!activeUser) return;
    const confirmRemove = await (window.showCustomConfirm ? window.showCustomConfirm("Unfriend Player?", `Remove ${friendName} from your friends list?`) : confirm(`Remove ${friendName} from your friends list?`));
    if (!confirmRemove) return;

    try {
        const friendEntry = myFriendsList.find(f => f.uid === friendUid);
        if (friendEntry && friendEntry.docId) {
            await deleteDoc(doc(db, "friend_requests", friendEntry.docId));
        }
        if (window.showSuccessToast) window.showSuccessToast("Friend Removed", `${friendName} removed from friends.`);
    } catch (e) {
        console.warn("Client delete failed, trying server API fallback:", e);
        try {
            const friendEntry = myFriendsList.find(f => f.uid === friendUid);
            if (friendEntry && friendEntry.docId) {
                await fetch('/api/friends/remove', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ reqId: friendEntry.docId })
                });
            }
            if (window.showSuccessToast) window.showSuccessToast("Friend Removed", `${friendName} removed from friends.`);
        } catch (apiErr) {
            console.error("Error removing friend:", apiErr);
            if (window.showErrorToast) window.showErrorToast("Error", "Could not remove friend.");
        }
    }
};

window.czCancelFriendRequest = async function (reqId, targetName) {
    try {
        await deleteDoc(doc(db, "friend_requests", reqId));
        if (window.showSuccessToast) window.showSuccessToast("Request Cancelled", `Friend request to ${targetName} cancelled.`);
    } catch (e) {
        console.warn("Client cancel failed, trying server fallback:", e);
        try {
            await fetch('/api/friends/remove', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ reqId })
            });
            if (window.showSuccessToast) window.showSuccessToast("Request Cancelled", `Friend request to ${targetName} cancelled.`);
        } catch (apiErr) {
            console.error("Error cancelling friend request:", apiErr);
        }
    }
};

window.czChatWithFriend = function (friendUidOrName, name, avatar) {
    if (name) {
        window.czOpenDMWith(friendUidOrName, name, avatar);
    } else {
        const friend = myFriendsList.find(f => f.name === friendUidOrName || f.uid === friendUidOrName);
        if (friend) {
            window.czOpenDMWith(friend.uid, friend.name, friend.avatar);
        } else {
            toggleGlobalChat(true);
            const input = document.getElementById('cz-chat-input');
            if (input) {
                input.value = `@${friendUidOrName} `;
                input.focus();
            }
        }
    }
};

// ----------------------------------------------------
// 8. QUICK MINI PLAYER MODAL
// ----------------------------------------------------
window.czOpenPlayerModal = async function (uid) {
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
        const now = Date.now();
        const isSupporter = Boolean((player.isSupporter || player.supporterTier || player.supporterBadge) && (!player.supporterExpiresAt || player.supporterExpiresAt > now));
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
                    ${(() => {
                        if (isMe) {
                            return `<a href="/profile.html" class="flex-1 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-white font-heading font-black text-[11px] uppercase transition-colors text-center">My Profile</a>`;
                        }

                        const friendship = getFriendshipStatus(player.id);
                        const status = typeof friendship === 'object' ? friendship.status : friendship;

                        if (status === 'friends') {
                            return `
                                <button type="button" onclick="window.czOpenDMWith('${escapeHtml(player.id)}', '${escapeHtml(name)}', '${escapeHtml(avatar)}'); window.czClosePlayerModal();"
                                    class="flex-1 py-2 rounded-xl bg-blue-500 hover:bg-blue-400 text-white font-heading font-black text-[11px] uppercase transition-all shadow cursor-pointer">
                                    Message
                                </button>
                                <button type="button" onclick="window.czRemoveFriend('${escapeHtml(player.id)}', '${escapeHtml(name)}'); window.czClosePlayerModal();"
                                    class="py-2 px-3 rounded-xl bg-rose-500/10 hover:bg-rose-500 hover:text-white text-rose-400 text-[11px] font-bold uppercase border border-rose-500/20 transition-colors cursor-pointer">
                                    Unfriend
                                </button>
                            `;
                        }

                        if (status === 'incoming_pending') {
                            return `
                                <button type="button" onclick="window.czRespondFriendRequest('${friendship.reqId}', 'accepted', '${escapeHtml(name)}'); window.czClosePlayerModal();"
                                    class="flex-1 py-2 rounded-xl bg-[#FFD700] hover:bg-[#FFF099] text-black font-heading font-black text-[11px] uppercase transition-all shadow cursor-pointer">
                                    Accept Request
                                </button>
                                <button type="button" onclick="window.czRespondFriendRequest('${friendship.reqId}', 'declined', '${escapeHtml(name)}'); window.czClosePlayerModal();"
                                    class="py-2 px-3 rounded-xl bg-white/5 hover:bg-white/10 text-neutral-400 hover:text-white text-[11px] font-bold uppercase transition-colors cursor-pointer">
                                    Decline
                                </button>
                            `;
                        }

                        if (status === 'outgoing_pending') {
                            return `
                                <div class="flex-1 py-2 rounded-xl bg-amber-500/15 text-amber-400 border border-amber-500/30 text-[11px] font-bold uppercase text-center">
                                    Request Pending
                                </div>
                                <button type="button" onclick="window.czCancelFriendRequest('${friendship.reqId}', '${escapeHtml(name)}'); window.czClosePlayerModal();"
                                    class="py-2 px-3 rounded-xl bg-white/5 hover:bg-white/10 text-neutral-400 hover:text-white text-[11px] font-bold uppercase transition-colors cursor-pointer">
                                    Cancel
                                </button>
                            `;
                        }

                        return `
                            <button type="button" onclick="window.czSendFriendRequest('${escapeHtml(player.id)}', '${escapeHtml(name)}', '${escapeHtml(avatar)}'); window.czClosePlayerModal();"
                                class="flex-1 py-2 rounded-xl bg-[#FFD700] hover:bg-[#FFF099] text-black font-heading font-black text-[11px] uppercase transition-all shadow cursor-pointer">
                                + Add Friend
                            </button>
                        `;
                    })()}
                </div>
            </div>
        `;
    } catch (e) {
        content.innerHTML = `<div class="py-6 text-rose-400 text-xs">Error loading player profile: ${escapeHtml(e.message)}</div>`;
    }
};

window.czClosePlayerModal = function () {
    const modal = document.getElementById('cz-player-modal');
    if (modal) modal.classList.add('hidden');
};

// ----------------------------------------------------
// 9. INITIALIZE COMMUNITY CHAT ENGINE
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

    const heartbeatInterval = setInterval(() => {
        if (currentUser && document.visibilityState === 'visible') {
            updateMyPresence(true);
        }
    }, 90000);

    document.addEventListener('visibilitychange', () => {
        if (!currentUser) return;
        if (document.visibilityState === 'hidden') {
            updateMyPresence(false);
        } else {
            updateMyPresence(true);
        }
    });

    function cleanupCommunityChat() {
        if (currentUser) updateMyPresence(false);
        if (heartbeatInterval) clearInterval(heartbeatInterval);
        if (typeof unsubscribeChat === 'function') { unsubscribeChat(); unsubscribeChat = null; }
        if (typeof unsubscribeOnline === 'function') { unsubscribeOnline(); unsubscribeOnline = null; }
        if (typeof unsubscribeRequests === 'function') { unsubscribeRequests(); unsubscribeRequests = null; }
        if (typeof unsubscribeDmThread === 'function') { unsubscribeDmThread(); unsubscribeDmThread = null; }
    }

    window.addEventListener('beforeunload', cleanupCommunityChat);
    window.addEventListener('pagehide', cleanupCommunityChat);

    onAuthStateChanged(auth, async (user) => {
        currentUser = user;
        if (user) {
            try {
                const userDoc = await getDoc(doc(db, "users", user.uid));
                if (userDoc.exists()) currentProfile = userDoc.data() || {};
            } catch (e) { }

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
