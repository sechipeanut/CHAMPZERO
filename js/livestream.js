import { db, auth } from './firebase-config.js';
import { 
    doc, 
    getDoc, 
    collection, 
    addDoc, 
    query, 
    orderBy, 
    limit, 
    onSnapshot,
    serverTimestamp 
} from "https://www.gstatic.com/firebasejs/11.1.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-auth.js";

let currentUser = null;
let chatUnsubscribe = null;
let eventId = null;
let eventData = null;
let viewerCountInterval = null;

function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/[&<>"']/g, m => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    }[m]));
}

// Get event ID from URL
const urlParams = new URLSearchParams(window.location.search);
eventId = urlParams.get('event');

if (!eventId) {
    document.getElementById('playerContainer').innerHTML = `
        <div class="flex items-center justify-center h-full text-gray-500">
            <div class="text-center">
                <p class="text-xl mb-4">No event specified</p>
                <a href="/events" class="text-[var(--gold)] hover:underline">← Back to Events</a>
            </div>
        </div>
    `;
} else {
    loadEvent();
}

// Auth state
onAuthStateChanged(auth, (user) => {
    currentUser = user;
    updateChatUI();
});

async function loadEvent() {
    try {
        const eventRef = doc(db, 'events', eventId);
        const eventSnap = await getDoc(eventRef);

        if (!eventSnap.exists()) {
            showError('Event not found');
            return;
        }

        eventData = eventSnap.data();
        const livestream = eventData.livestream;

        if (!livestream || !livestream.playbackId) {
            showError('This event is not currently streaming');
            return;
        }

        // Update UI
        document.getElementById('eventTitle').textContent = eventData.name;
        document.getElementById('eventDescription').textContent = eventData.description || 'Watch live now!';

        // Load Mux Player
        const playerContainer = document.getElementById('playerContainer');
        playerContainer.innerHTML = `
            <mux-player
                playback-id="${livestream.playbackId}"
                metadata-video-title="${escapeHtml(eventData.name)}"
                accent-color="#FFD700"
                class="w-full h-full"
                stream-type="live"
                autoplay
            ></mux-player>
        `;

        // Initialize chat
        initializeChat();

        // Start fetching viewer count
        updateViewerCount(livestream.playbackId);
        viewerCountInterval = setInterval(() => updateViewerCount(livestream.playbackId), 30000); // Update every 30 seconds

    } catch (error) {
        console.error('Error loading event:', error);
        showError('Failed to load stream');
    }
}

function showError(message) {
    document.getElementById('playerContainer').innerHTML = `
        <div class="flex items-center justify-center h-full text-gray-500">
            <div class="text-center">
                <p class="text-xl mb-4">${escapeHtml(message)}</p>
                <a href="/events" class="text-[var(--gold)] hover:underline">← Back to Events</a>
            </div>
        </div>
    `;
}

function updateChatUI() {
    const chatInputContainer = document.getElementById('chatInputContainer');
    const loginPrompt = document.getElementById('loginPrompt');
    const chatStatus = document.getElementById('chatStatus');

    if (currentUser) {
        chatInputContainer.classList.remove('hidden');
        loginPrompt.classList.add('hidden');
        chatStatus.textContent = `(Signed in as ${currentUser.displayName || currentUser.email})`;
    } else {
        chatInputContainer.classList.add('hidden');
        loginPrompt.classList.remove('hidden');
        chatStatus.textContent = '(Sign in to chat)';
    }
}

function initializeChat() {
    if (!eventId) return;

    // Listen to chat messages in real-time
    const chatRef = collection(db, 'events', eventId, 'chat');
    const q = query(chatRef, orderBy('timestamp', 'desc'), limit(50));

    chatUnsubscribe = onSnapshot(q, (snapshot) => {
        const messages = [];
        snapshot.forEach((doc) => {
            messages.push({ id: doc.id, ...doc.data() });
        });

        // Reverse to show oldest first
        messages.reverse();
        renderMessages(messages);
    });

    // Set up chat form
    const chatForm = document.getElementById('chatForm');
    chatForm.addEventListener('submit', handleChatSubmit);
}

function renderMessages(messages) {
    const container = document.getElementById('chatMessages');
    
    if (messages.length === 0) {
        container.innerHTML = `
            <div class="text-center text-gray-500 text-sm py-8">
                Be the first to send a message!
            </div>
        `;
        return;
    }

    container.innerHTML = messages.map(msg => {
        const timestamp = msg.timestamp?.toDate?.();
        const timeStr = timestamp ? timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
        const isCurrentUser = currentUser && msg.userId === currentUser.uid;

        return `
            <div class="chat-message ${isCurrentUser ? 'bg-[var(--gold)]/10 border border-[var(--gold)]/20' : ''} rounded-lg p-3">
                <div class="flex items-center gap-2 mb-1">
                    <span class="font-semibold text-sm ${isCurrentUser ? 'text-[var(--gold)]' : 'text-white'}">
                        ${escapeHtml(msg.username || 'Anonymous')}
                    </span>
                    ${msg.isAdmin ? '<span class="text-xs bg-red-500 text-white px-2 py-0.5 rounded">ADMIN</span>' : ''}
                    <span class="text-xs text-gray-500 ml-auto">${timeStr}</span>
                </div>
                <p class="text-gray-300 text-sm">${escapeHtml(msg.message)}</p>
            </div>
        `;
    }).join('');

    // Auto-scroll to bottom
    container.scrollTop = container.scrollHeight;
}

async function handleChatSubmit(e) {
    e.preventDefault();

    if (!currentUser) {
        alert('Please sign in to chat');
        return;
    }

    const input = document.getElementById('chatInput');
    const message = input.value.trim();

    if (!message) return;

    try {
        // Get user data
        const userRef = doc(db, 'users', currentUser.uid);
        const userSnap = await getDoc(userRef);
        const userData = userSnap.exists() ? userSnap.data() : {};

        // Add message to Firestore
        const chatRef = collection(db, 'events', eventId, 'chat');
        await addDoc(chatRef, {
            message: message,
            username: userData.ign || userData.displayName || currentUser.displayName || currentUser.email.split('@')[0],
            userId: currentUser.uid,
            isAdmin: userData.role === 'admin',
            timestamp: serverTimestamp()
        });

        // Clear input
        input.value = '';

    } catch (error) {
        console.error('Error sending message:', error);
        alert('Failed to send message. Please try again.');
    }
}

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    if (chatUnsubscribe) {
        chatUnsubscribe();
    }
    if (viewerCountInterval) {
        clearInterval(viewerCountInterval);
    }
});

async function updateViewerCount(playbackId) {
    try {
        const response = await fetch(`/.netlify/functions/get-viewer-count?playbackId=${playbackId}`);
        if (response.ok) {
            const data = await response.json();
            const viewerCountEl = document.getElementById('viewerCount');
            if (viewerCountEl) {
                viewerCountEl.textContent = `👁️ ${data.viewerCount || 0} viewers`;
            }
        }
    } catch (error) {
        console.warn('Could not fetch viewer count:', error);
        // Don't show error to user, just keep previous count
    }
}
