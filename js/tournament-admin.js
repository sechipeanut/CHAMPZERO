// Tournament Administration Module
import { db } from './firebase-config.js';
import {
    doc,
    getDoc,
    updateDoc,
    addDoc,
    collection,
    query,
    orderBy,
    onSnapshot,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.1.0/firebase-firestore.js";

function qs(sel) { return document.querySelector(sel); }
function escapeHtml(str) { if (!str) return ''; return String(str).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])); }

let currentTournament = null;
let currentEditingTournament = null;
let swapSourceIndex = null;
let matchChatUnsubscribes = {};
let currentUserId = null;
let currentMatchData = null;

// Set current user ID from parent
export function setCurrentUserId(uid) {
    currentUserId = uid;
}

// Open Tournament Manager
export async function openTournamentManager(tournamentId) {
    try {
        const docRef = doc(db, "tournaments", tournamentId);
        const docSnap = await getDoc(docRef);
        
        if (!docSnap.exists()) {
            window.showErrorToast("Error", "Tournament not found.");
            return;
        }
        
        currentTournament = { id: tournamentId, ...docSnap.data() };
        currentEditingTournament = JSON.parse(JSON.stringify(currentTournament));
        if (!currentEditingTournament.participants) currentEditingTournament.participants = [];
        if (!currentEditingTournament.matches) currentEditingTournament.matches = [];
        
        renderTournamentManager();
        window.openModal('tournamentManagerModal');
    } catch (error) {
        console.error("Error opening tournament manager:", error);
        window.showErrorToast("Error", "Failed to load tournament.");
    }
}

function renderTournamentManager() {
    if (!currentTournament) return;
    
    qs('#tm-title').textContent = currentTournament.name;
    qs('#tm-game').textContent = currentTournament.game;
    qs('#tm-format').textContent = currentTournament.format || "Single Elimination";
    
    // Update statistics
    updateOverviewStats();
    
    // Render Participants
    renderTMParticipants();
    
    // Render Bracket
    renderTMBracket();
    
    // Default to overview tab
    switchTMTab('overview');
}

function updateOverviewStats() {
    const participants = currentEditingTournament.participants || [];
    const matches = currentEditingTournament.matches || [];
    const completedMatches = matches.filter(m => m.status === 'completed').length;
    
    const participantsCount = qs('#tm-participants-count');
    const matchesCount = qs('#tm-matches-count');
    const completedCount = qs('#tm-completed-count');
    
    if (participantsCount) participantsCount.textContent = participants.length;
    if (matchesCount) matchesCount.textContent = matches.length;
    if (completedCount) completedCount.textContent = completedMatches;
}

function renderTMParticipants() {
    const list = qs('#tm-participants-list');
    const participants = currentEditingTournament.participants || [];
    
    if (participants.length === 0) {
        list.innerHTML = '<p class="text-gray-500 text-center py-8">No participants registered yet.</p>';
        return;
    }
    
    list.innerHTML = '';
    participants.forEach((p, idx) => {
        const name = typeof p === 'string' ? p : p.name || p.teamName || 'Unknown Team';
        const div = document.createElement('div');
        div.className = "flex items-center justify-between p-3 bg-black/30 rounded border border-white/10 hover:border-[var(--gold)]/50 transition-colors";
        div.innerHTML = `
            <div>
                <div class="text-white font-bold">${escapeHtml(name)}</div>
                <div class="text-xs text-gray-400">Seed ${idx + 1}</div>
            </div>
            <div class="flex gap-2">
                <button onclick="window.tmSelectTeamForSwap(${idx})" class="text-xs bg-blue-900/50 text-blue-300 px-3 py-1 rounded hover:bg-blue-900 transition">Swap</button>
                <button onclick="window.tmRemoveParticipant(${idx})" class="text-xs bg-red-900/50 text-red-300 px-3 py-1 rounded hover:bg-red-900 transition">Remove</button>
            </div>
        `;
        list.appendChild(div);
    });
}

function renderTMBracket() {
    const container = qs('#tm-bracket-container');
    if (!container) return;
    
    const format = currentEditingTournament.format || "Single Elimination";
    const participants = currentEditingTournament.participants || [];
    
    container.innerHTML = '';
    
    if (participants.length < 2) {
        container.innerHTML = '<p class="text-gray-500 text-center py-8">At least 2 participants required to generate bracket.</p>';
        return;
    }
    
    // Generate matches if not exist
    if (!currentEditingTournament.matches || currentEditingTournament.matches.length === 0) {
        generateMatches(format, participants);
    }
    
    // Update stats after generating
    updateOverviewStats();
    
    // Render matches based on format
    if (format === 'Single Elimination') {
        renderSingleEliminationAdmin(container, currentEditingTournament.matches);
    } else if (format === 'Double Elimination') {
        renderDoubleEliminationAdmin(container, currentEditingTournament.matches);
    } else {
        renderRoundRobinAdmin(container, currentEditingTournament.matches);
    }
}

function generateMatches(format, participants) {
    const matches = [];
    
    if (format === 'Single Elimination') {
        // Use actual participant count instead of rounding to power of 2
        const actualCount = participants.length;
        
        // Calculate rounds needed
        const rounds = Math.ceil(Math.log2(actualCount));
        let matchId = 0;
        
        let seeds = [...participants];
        
        // Generate first round with actual teams only
        const firstRoundMatches = Math.floor(actualCount / 2);
        const byes = actualCount % 2; // Check if odd number
        
        for (let m = 0; m < firstRoundMatches; m++) {
            const team1 = typeof seeds[m * 2] === 'string' ? seeds[m * 2] : seeds[m * 2].name;
            const team2 = typeof seeds[m * 2 + 1] === 'string' ? seeds[m * 2 + 1] : seeds[m * 2 + 1].name;
            
            matches.push({
                id: `match-${matchId++}`,
                round: 1,
                matchNumber: m + 1,
                team1: team1,
                team2: team2,
                winner: null,
                score1: null,
                score2: null,
                status: 'pending'
            });
        }
        
        // If odd number of teams, last team gets a bye (advances automatically)
        if (byes > 0) {
            const byeTeam = typeof seeds[actualCount - 1] === 'string' ? seeds[actualCount - 1] : seeds[actualCount - 1].name;
            matches.push({
                id: `match-${matchId++}`,
                round: 1,
                matchNumber: firstRoundMatches + 1,
                team1: byeTeam,
                team2: 'BYE',
                winner: byeTeam,
                score1: null,
                score2: null,
                status: 'completed'
            });
        }
        
        // Generate subsequent rounds dynamically based on first round
        let teamsInPreviousRound = Math.ceil(actualCount / 2);
        for (let r = 2; r <= rounds; r++) {
            const matchesInRound = Math.ceil(teamsInPreviousRound / 2);
            for (let m = 0; m < matchesInRound; m++) {
                matches.push({
                    id: `match-${matchId++}`,
                    round: r,
                    matchNumber: m + 1,
                    team1: 'TBD',
                    team2: 'TBD',
                    winner: null,
                    score1: null,
                    score2: null,
                    status: 'pending'
                });
            }
            teamsInPreviousRound = matchesInRound;
        }
    } else if (format === 'Double Elimination') {
        // Use actual participant count
        const actualCount = participants.length;
    } else if (format === 'Double Elimination') {
        // Use actual participant count
        const actualCount = participants.length;
        
        let matchId = 0;
        let seeds = [...participants];
        
        // Winner's bracket first round with actual teams
        const firstRoundMatches = Math.floor(actualCount / 2);
        const byes = actualCount % 2;
        
        for (let m = 0; m < firstRoundMatches; m++) {
            const team1 = typeof seeds[m * 2] === 'string' ? seeds[m * 2] : seeds[m * 2].name;
            const team2 = typeof seeds[m * 2 + 1] === 'string' ? seeds[m * 2 + 1] : seeds[m * 2 + 1].name;
            
            matches.push({
                id: `match-${matchId++}`,
                bracket: 'winners',
                round: 1,
                matchNumber: m + 1,
                team1: team1,
                team2: team2,
                winner: null,
                score1: null,
                score2: null,
                status: 'pending'
            });
        }
        
        // Handle bye in winner's bracket
        if (byes > 0) {
            const byeTeam = typeof seeds[actualCount - 1] === 'string' ? seeds[actualCount - 1] : seeds[actualCount - 1].name;
            matches.push({
                id: `match-${matchId++}`,
                bracket: 'winners',
                round: 1,
                matchNumber: firstRoundMatches + 1,
                team1: byeTeam,
                team2: 'BYE',
                winner: byeTeam,
                score1: null,
                score2: null,
                status: 'completed'
            });
        }
        
        // Generate subsequent winner's bracket rounds
        let teamsInPreviousRound = Math.ceil(actualCount / 2);
        const wbRounds = Math.ceil(Math.log2(actualCount));
        for (let r = 2; r <= wbRounds; r++) {
            const matchesInRound = Math.ceil(teamsInPreviousRound / 2);
            for (let m = 0; m < matchesInRound; m++) {
                matches.push({
                    id: `match-${matchId++}`,
                    bracket: 'winners',
                    round: r,
                    matchNumber: m + 1,
                    team1: 'TBD',
                    team2: 'TBD',
                    winner: null,
                    score1: null,
                    score2: null,
                    status: 'pending'
                });
            }
            teamsInPreviousRound = matchesInRound;
        }
        
        // Add initial loser's bracket matches (will be filled as teams lose)
        for (let m = 0; m < Math.max(1, Math.floor(firstRoundMatches / 2)); m++) {
            matches.push({
                id: `match-${matchId++}`,
                bracket: 'losers',
                round: 1,
                matchNumber: m + 1,
                team1: 'TBD',
                team2: 'TBD',
                winner: null,
                score1: null,
                score2: null,
                status: 'pending'
            });
        }
    } else if (format === 'Round Robin') {
        let matchId = 0;
        // Generate all possible matchups
        for (let i = 0; i < participants.length; i++) {
            for (let j = i + 1; j < participants.length; j++) {
                const team1 = typeof participants[i] === 'string' ? participants[i] : participants[i].name;
                const team2 = typeof participants[j] === 'string' ? participants[j] : participants[j].name;
                
                matches.push({
                    id: `match-${matchId++}`,
                    matchNumber: matchId,
                    team1: team1,
                    team2: team2,
                    winner: null,
                    score1: null,
                    score2: null,
                    status: 'pending'
                });
            }
        }
    }
    
    currentEditingTournament.matches = matches;
}

function renderSingleEliminationAdmin(container, matches) {
    const rounds = {};
    matches.forEach(m => {
        if (!rounds[m.round]) rounds[m.round] = [];
        rounds[m.round].push(m);
    });
    
    const bracketWrapper = document.createElement('div');
    bracketWrapper.className = "flex gap-8 overflow-x-auto pb-4";
    
    Object.keys(rounds).sort((a, b) => a - b).forEach(roundNum => {
        const roundDiv = document.createElement('div');
        roundDiv.className = "flex flex-col gap-6 min-w-[280px]";
        
        let roundName = `Round ${roundNum}`;
        if (roundNum == Object.keys(rounds).length) roundName = "Grand Final";
        else if (roundNum == Object.keys(rounds).length - 1) roundName = "Semi Finals";
        
        roundDiv.innerHTML = `<h4 class="text-center text-sm font-bold text-[var(--gold)] mb-2">${roundName}</h4>`;
        
        rounds[roundNum].forEach(match => {
            const matchDiv = document.createElement('div');
            const isCompleted = match.status === 'completed';
            matchDiv.className = `bg-[var(--dark-card)] border ${isCompleted ? 'border-green-500/30' : 'border-white/20'} rounded-lg p-3 hover:border-[var(--gold)]/50 transition-colors`;
            matchDiv.innerHTML = `
                <div class="flex justify-between items-center mb-2">
                    <span class="text-xs text-gray-500">Match ${match.matchNumber}</span>
                    <button onclick="window.tmOpenMatchManager('${match.id}')" class="text-xs bg-[var(--gold)]/20 text-[var(--gold)] px-2 py-1 rounded hover:bg-[var(--gold)]/30 transition">Manage</button>
                </div>
                <div class="space-y-2">
                    <div class="flex justify-between items-center ${match.winner === match.team1 ? 'text-[var(--gold)] font-bold' : 'text-white'}">
                        <span class="text-sm">${escapeHtml(match.team1)}</span>
                        <span class="text-sm font-bold">${match.score1 !== null && match.score1 !== undefined ? match.score1 : '-'}</span>
                    </div>
                    <div class="flex justify-between items-center ${match.winner === match.team2 ? 'text-[var(--gold)] font-bold' : 'text-white'}">
                        <span class="text-sm">${escapeHtml(match.team2)}</span>
                        <span class="text-sm font-bold">${match.score2 !== null && match.score2 !== undefined ? match.score2 : '-'}</span>
                    </div>
                </div>
                ${isCompleted ? `<div class="mt-2 text-center text-xs text-green-400 font-bold">✓ Complete</div>` : ''}
            `;
            roundDiv.appendChild(matchDiv);
        });
        
        bracketWrapper.appendChild(roundDiv);
    });
    
    container.appendChild(bracketWrapper);
}

function renderDoubleEliminationAdmin(container, matches) {
    const winnersMatches = matches.filter(m => m.bracket === 'winners');
    const losersMatches = matches.filter(m => m.bracket === 'losers');
    
    const wbTitle = document.createElement('h4');
    wbTitle.className = "text-[var(--gold)] font-bold mb-4";
    wbTitle.textContent = "Winner's Bracket";
    container.appendChild(wbTitle);
    
    const wbDiv = document.createElement('div');
    renderSingleEliminationAdmin(wbDiv, winnersMatches);
    container.appendChild(wbDiv);
    
    const lbTitle = document.createElement('h4');
    lbTitle.className = "text-red-400 font-bold mt-8 mb-4";
    lbTitle.textContent = "Loser's Bracket";
    container.appendChild(lbTitle);
    
    const lbDiv = document.createElement('div');
    renderSingleEliminationAdmin(lbDiv, losersMatches);
    container.appendChild(lbDiv);
}

function renderRoundRobinAdmin(container, matches) {
    const wrapper = document.createElement('div');
    wrapper.className = "space-y-3";
    
    matches.forEach((match, idx) => {
        const isCompleted = match.status === 'completed';
        const matchDiv = document.createElement('div');
        matchDiv.className = `bg-[var(--dark-card)] border ${isCompleted ? 'border-green-500/30' : 'border-white/20'} rounded-lg p-4 hover:border-[var(--gold)]/50 transition-colors`;
        matchDiv.innerHTML = `
            <div class="flex justify-between items-center mb-3">
                <span class="text-sm text-gray-400">Match ${idx + 1}</span>
                <button onclick="window.tmOpenMatchManager('${match.id}')" class="text-xs bg-[var(--gold)]/20 text-[var(--gold)] px-3 py-1 rounded hover:bg-[var(--gold)]/30 transition">Manage</button>
            </div>
            <div class="grid grid-cols-2 gap-4">
                <div class="${match.winner === match.team1 ? 'text-[var(--gold)]' : 'text-white'}">
                    <div class="font-bold mb-1">${escapeHtml(match.team1)}</div>
                    <div class="text-2xl font-bold">${match.score1 !== null && match.score1 !== undefined ? match.score1 : '-'}</div>
                </div>
                <div class="${match.winner === match.team2 ? 'text-[var(--gold)]' : 'text-white'}">
                    <div class="font-bold mb-1">${escapeHtml(match.team2)}</div>
                    <div class="text-2xl font-bold">${match.score2 !== null && match.score2 !== undefined ? match.score2 : '-'}</div>
                </div>
            </div>
            ${isCompleted ? `<div class="mt-3 text-center text-xs text-green-400 font-bold">✓ Match Complete</div>` : ''}
        `;
        wrapper.appendChild(matchDiv);
    });
    
    container.appendChild(wrapper);
}

// Exported functions for window
export function updateMatchScore(matchId, teamNum, score) {
    const match = currentEditingTournament.matches.find(m => m.id === matchId);
    if (match) {
        if (teamNum === 1) match.score1 = parseInt(score) || 0;
        else match.score2 = parseInt(score) || 0;
    }
}

export async function declareWinner(matchId, winnerName) {
    const match = currentEditingTournament.matches.find(m => m.id === matchId);
    if (!match) return;
    
    match.winner = winnerName;
    match.status = 'completed';
    
    // Update next match if applicable
    updateNextMatch(match);
    
    // Save to database
    await saveTournamentChanges();
    
    // Send notifications
    await sendMatchNotification(match, 'result');
    
    // Update stats and re-render
    updateOverviewStats();
    renderTMBracket();
    window.showSuccessToast("Winner Declared", `${winnerName} advances!`, 2000);
}

function updateNextMatch(completedMatch) {
    const format = currentEditingTournament.format;
    
    if (format === 'Single Elimination') {
        const nextRound = completedMatch.round + 1;
        const nextMatchNumber = Math.ceil(completedMatch.matchNumber / 2);
        const nextMatch = currentEditingTournament.matches.find(
            m => m.round === nextRound && m.matchNumber === nextMatchNumber
        );
        
        if (nextMatch) {
            if (completedMatch.matchNumber % 2 === 1) {
                nextMatch.team1 = completedMatch.winner;
            } else {
                nextMatch.team2 = completedMatch.winner;
            }
        }
    }
}

export async function saveTournamentChanges() {
    if (!currentTournament || !currentEditingTournament) return;
    
    try {
        const ref = doc(db, "tournaments", currentTournament.id);
        await updateDoc(ref, {
            participants: currentEditingTournament.participants,
            matches: currentEditingTournament.matches,
            format: currentEditingTournament.format
        });
        
        currentTournament = { ...currentTournament, ...currentEditingTournament };
        window.showSuccessToast("Saved", "Tournament updated successfully!", 2000);
    } catch (error) {
        console.error("Error saving tournament:", error);
        window.showErrorToast("Error", "Failed to save changes.");
    }
}

export function selectTeamForSwap(index) {
    if (swapSourceIndex === null) {
        swapSourceIndex = index;
        window.showSuccessToast("Team Selected", "Select another team to swap.", 2000);
    } else {
        const temp = currentEditingTournament.participants[swapSourceIndex];
        currentEditingTournament.participants[swapSourceIndex] = currentEditingTournament.participants[index];
        currentEditingTournament.participants[index] = temp;
        
        swapSourceIndex = null;
        renderTMParticipants();
        renderTMBracket();
        window.showSuccessToast("Swapped", "Teams swapped successfully!", 2000);
    }
}

export async function removeParticipant(index) {
    const confirmed = await window.showCustomConfirm("Remove Participant?", "This will regenerate the bracket.");
    if (!confirmed) return;
    
    currentEditingTournament.participants.splice(index, 1);
    currentEditingTournament.matches = [];
    
    // Save to Firebase
    await saveTournamentChanges();
    
    renderTMParticipants();
    renderTMBracket();
    updateOverviewStats();
}

export function switchTMTab(tabName) {
    ['overview', 'bracket', 'participants'].forEach(t => {
        const tab = qs(`#tm-tab-${t}`);
        const content = qs(`#tm-content-${t}`);
        if (tab && content) {
            if (t === tabName) {
                tab.classList.add('bg-[var(--gold)]/20', 'text-[var(--gold)]', 'border-[var(--gold)]');
                tab.classList.remove('text-gray-400');
                content.classList.remove('hidden');
            } else {
                tab.classList.remove('bg-[var(--gold)]/20', 'text-[var(--gold)]', 'border-[var(--gold)]');
                tab.classList.add('text-gray-400');
                content.classList.add('hidden');
            }
        }
    });
}

// Match Manager
export function openMatchManager(matchId) {
    const match = currentEditingTournament.matches.find(m => m.id === matchId);
    if (!match) return;
    
    currentMatchData = match;
    
    qs('#match-title').textContent = `Match ${match.matchNumber} - Round ${match.round || 1}`;
    qs('#match-team1').textContent = match.team1;
    qs('#match-team2').textContent = match.team2;
    
    // Set current scores if they exist
    const score1Input = qs('#match-score1');
    const score2Input = qs('#match-score2');
    if (score1Input) score1Input.value = match.score1 || '';
    if (score2Input) score2Input.value = match.score2 || '';
    
    startMatchChatListener(currentTournament.id, matchId);
    
    window.openModal('matchManagerModal');
}

// Quick win declaration
export function quickWin(teamNum) {
    if (!currentMatchData) return;
    
    const winnerName = teamNum === 1 ? currentMatchData.team1 : currentMatchData.team2;
    declareWinner(currentMatchData.id, winnerName);
}

// Update scores from inputs
export async function updateScores() {
    if (!currentMatchData) return;
    
    const score1 = parseInt(qs('#match-score1')?.value) || 0;
    const score2 = parseInt(qs('#match-score2')?.value) || 0;
    
    currentMatchData.score1 = score1;
    currentMatchData.score2 = score2;
    
    // Update in the tournament
    const match = currentEditingTournament.matches.find(m => m.id === currentMatchData.id);
    if (match) {
        match.score1 = score1;
        match.score2 = score2;
    }
    
    await saveTournamentChanges();
    updateOverviewStats();
    renderTMBracket();
    
    window.showSuccessToast("Scores Updated", "Match scores have been saved.", 2000);
}

// Reset match
export async function resetMatch() {
    if (!currentMatchData) return;
    
    const confirmed = await window.showCustomConfirm(
        "Reset Match?", 
        "This will clear the winner and scores. Continue?"
    );
    
    if (!confirmed) return;
    
    const match = currentEditingTournament.matches.find(m => m.id === currentMatchData.id);
    if (match) {
        match.winner = null;
        match.score1 = null;
        match.score2 = null;
        match.status = 'pending';
        
        // Clear inputs
        const score1Input = qs('#match-score1');
        const score2Input = qs('#match-score2');
        if (score1Input) score1Input.value = '';
        if (score2Input) score2Input.value = '';
    }
    
    await saveTournamentChanges();
    updateOverviewStats();
    renderTMBracket();
    
    window.showSuccessToast("Match Reset", "Match has been reset to pending.", 2000);
}

function startMatchChatListener(tournamentId, matchId) {
    const chatContainer = qs('#match-chat-messages');
    if (!chatContainer) return;
    
    chatContainer.innerHTML = '<p class="text-center text-gray-500 mt-4">Loading messages...</p>';
    
    if (matchChatUnsubscribes[matchId]) {
        matchChatUnsubscribes[matchId]();
    }
    
    const messagesRef = collection(db, "tournaments", tournamentId, "matchChats", matchId, "messages");
    const q = query(messagesRef, orderBy("createdAt", "asc"));
    
    matchChatUnsubscribes[matchId] = onSnapshot(q, (snapshot) => {
        chatContainer.innerHTML = '';
        if (snapshot.empty) {
            chatContainer.innerHTML = '<p class="text-center text-gray-500 mt-10">No messages yet. Start the conversation!</p>';
            return;
        }
        
        snapshot.forEach((doc) => {
            const msg = doc.data();
            const isAdmin = msg.senderRole === 'admin';
            const isMe = msg.senderId === currentUserId;
            
            const bubble = document.createElement('div');
            bubble.className = `mb-3 ${isMe ? 'text-right' : 'text-left'}`;
            bubble.innerHTML = `
                <div class="inline-block max-w-[80%] ${isMe ? 'bg-[var(--gold)]/20 border-[var(--gold)]' : 'bg-white/5 border-white/10'} border rounded-lg p-3">
                    <div class="font-bold text-[10px] mb-1 ${isAdmin ? 'text-[var(--gold)]' : 'text-gray-400'}">${escapeHtml(msg.senderName)}${isAdmin ? ' (Admin)' : ''}</div>
                    <div class="text-sm text-white">${escapeHtml(msg.text)}</div>
                    <div class="text-[10px] text-gray-500 mt-1">${msg.createdAt ? new Date(msg.createdAt.toDate()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}</div>
                </div>
            `;
            chatContainer.appendChild(bubble);
        });
        
        chatContainer.scrollTop = chatContainer.scrollHeight;
    });
}

export async function sendMatchMessage() {
    const input = qs('#match-chat-input');
    const text = input.value.trim();
    if (!text || !currentMatchData || !currentTournament) return;
    
    input.value = '';
    
    try {
        const messagesRef = collection(db, "tournaments", currentTournament.id, "matchChats", currentMatchData.id, "messages");
        await addDoc(messagesRef, {
            text: text,
            senderId: currentUserId,
            senderName: "Admin",
            senderRole: 'admin',
            createdAt: serverTimestamp()
        });
    } catch (err) {
        console.error("Chat error:", err);
        window.showErrorToast("Error", "Failed to send message.");
    }
}

// Notification System Integration
async function sendMatchNotification(match, type) {
    if (!currentTournament) return;
    
    let message = '';
    if (type === 'result') {
        message = `Match ${match.matchNumber}: ${match.winner} wins against ${match.winner === match.team1 ? match.team2 : match.team1}`;
    } else if (type === 'schedule') {
        message = `Match ${match.matchNumber} is scheduled: ${match.team1} vs ${match.team2}`;
    }
    
    try {
        await addDoc(collection(db, "notifications"), {
            title: `${currentTournament.name} Update`,
            type: 'tournament',
            message: message,
            tournamentId: currentTournament.id,
            matchId: match.id,
            createdAt: serverTimestamp()
        });
    } catch (error) {
        console.error("Error sending notification:", error);
    }
}

export async function sendTournamentNotification(tournamentId, type, customMessage) {
    if (!currentTournament) return;
    
    let message = customMessage;
    if (!message) {
        if (type === 'registration') message = 'You have been registered for the tournament!';
        else if (type === 'start') message = 'The tournament is starting! Check your matches.';
        else if (type === 'winner') message = 'Tournament winner has been decided!';
    }
    
    try {
        await addDoc(collection(db, "notifications"), {
            title: `${currentTournament.name}`,
            type: 'tournament',
            message: message,
            tournamentId: tournamentId,
            createdAt: serverTimestamp()
        });
    } catch (error) {
        console.error("Error sending notification:", error);
    }
}

// Expose functions to window for HTML onclick handlers
window.tmOpenTournamentManager = openTournamentManager;
window.tmUpdateMatchScore = updateMatchScore;
window.tmDeclareWinner = declareWinner;
window.tmSaveTournamentChanges = saveTournamentChanges;
window.tmSelectTeamForSwap = selectTeamForSwap;
window.tmRemoveParticipant = removeParticipant;
window.tmSwitchTab = switchTMTab;
window.tmOpenMatchManager = openMatchManager;
window.tmSendMatchMessage = sendMatchMessage;
window.tmSendTournamentNotification = sendTournamentNotification;
window.tmQuickWin = quickWin;
window.tmUpdateScores = updateScores;
window.tmResetMatch = resetMatch;
