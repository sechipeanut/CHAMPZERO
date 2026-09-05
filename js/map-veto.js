// js/map-veto.js
// ChampZero Enterprise Real-Time Captain-Controlled Map Veto System
// Server-Authoritative State Machine, Atomic Transactions, Anti-Tamper Clock-Skew Protection

import { auth, db } from './firebase-config.js';
import { 
    doc, 
    getDoc, 
    setDoc, 
    updateDoc, 
    onSnapshot, 
    runTransaction, 
    serverTimestamp, 
    Timestamp 
} from "https://www.gstatic.com/firebasejs/11.1.0/firebase-firestore.js";

// ==========================================
// 1. CONSTANTS & VALORANT MAP ARTWORK
// ==========================================
export const DEFAULT_VALORANT_MAP_POOL = [
    'Ascent', 
    'Bind', 
    'Haven', 
    'Lotus', 
    'Sunset', 
    'Abyss', 
    'Split'
];

export const MAP_METADATA = {
    'Ascent': {
        name: 'Ascent',
        subtitle: 'Venice, Italy • Mid-Control Courtyard',
        themeColor: '#e0a96d',
        accentGradient: 'from-amber-600/30 via-yellow-600/10 to-transparent',
        image: 'https://images.contentstack.io/v3/assets/blt370612131b6e0756/blt46b941ec9235e1be/5ebf91b790d0b040a454d68e/Ascent_KeyArt_1.jpg'
    },
    'Bind': {
        name: 'Bind',
        subtitle: 'Rabat, Morocco • One-Way Teleporters',
        themeColor: '#d97706',
        accentGradient: 'from-orange-600/30 via-amber-700/10 to-transparent',
        image: 'https://images.contentstack.io/v3/assets/blt370612131b6e0756/bltd49e88ac0e10ec04/5ebf91c3be313c4103138b30/Bind_KeyArt_1.jpg'
    },
    'Haven': {
        name: 'Haven',
        subtitle: 'Thimphu, Bhutan • Three Bomb Sites',
        themeColor: '#dc2626',
        accentGradient: 'from-rose-600/30 via-red-800/10 to-transparent',
        image: 'https://images.contentstack.io/v3/assets/blt370612131b6e0756/blta94d80a3c20059e9/5ebf91ccbe313c4103138b34/Haven_KeyArt_1.jpg'
    },
    'Lotus': {
        name: 'Lotus',
        subtitle: 'Western Ghats, India • Rotating Lotus Doors',
        themeColor: '#a855f7',
        accentGradient: 'from-purple-600/30 via-indigo-900/10 to-transparent',
        image: 'https://images.contentstack.io/v3/assets/blt370612131b6e0756/blt6d5731f825e36512/63b8782f254f1510657a8bf2/Lotus_KeyArt_1.jpg'
    },
    'Sunset': {
        name: 'Sunset',
        subtitle: 'Los Angeles, USA • Golden Hour Food Trucks',
        themeColor: '#ec4899',
        accentGradient: 'from-pink-600/30 via-amber-700/10 to-transparent',
        image: 'https://images.contentstack.io/v3/assets/blt370612131b6e0756/bltb0ad8869c8942b0f/64ea6013a77764fba1e7ae57/Sunset_KeyArt_1.jpg'
    },
    'Abyss': {
        name: 'Abyss',
        subtitle: 'Scion of Earth • Subterranean Chasm',
        themeColor: '#06b6d4',
        accentGradient: 'from-cyan-600/30 via-blue-900/10 to-transparent',
        image: 'https://images.contentstack.io/v3/assets/blt370612131b6e0756/blt01feebc27599cb8f/66673bf6f97ef8b894ec0d4d/Abyss_KeyArt_1.jpg'
    },
    'Split': {
        name: 'Split',
        subtitle: 'Tokyo, Japan • Vertical Elevated Ropes',
        themeColor: '#10b981',
        accentGradient: 'from-emerald-600/30 via-teal-900/10 to-transparent',
        image: 'https://images.contentstack.io/v3/assets/blt370612131b6e0756/blt80ec4a57257df926/5ebf91d590d0b040a454d692/Split_KeyArt_1.jpg'
    }
};

// Fallback for custom map names
export function getMapVisuals(mapName) {
    if (MAP_METADATA[mapName]) return MAP_METADATA[mapName];
    return {
        name: mapName,
        subtitle: 'Official Competitive Map',
        themeColor: '#eab308',
        accentGradient: 'from-yellow-500/20 via-neutral-900/10 to-transparent',
        image: ''
    };
}

// ==========================================
// 2. DETERMINISTIC SEQUENCE GENERATOR
// ==========================================
/**
 * Compiles an immutable deterministic sequence of veto steps for BO1, BO3, or BO5.
 * Format rules:
 * - BO1: 6 alternating bans (A, B, A, B, A, B). 7th map is Decider Game 1 with starting side to Team A.
 * - BO3: Bans (A, B) -> Team A picks Game 1 (Team B chooses side) -> Team B picks Game 2 (Team A chooses side) -> Bans (A, B) -> 7th map Decider Game 3 (Team A chooses side).
 * - BO5: Bans (A, B) -> Team A picks Game 1 (Team B chooses side) -> Team B picks Game 2 (Team A chooses side) -> Team A picks Game 3 (Team B chooses side) -> Team B picks Game 4 (Team A chooses side) -> 7th map Decider Game 5 (Team B chooses side).
 */
export function compileVetoSequence(format = 'BO1') {
    const fmt = String(format).toUpperCase();

    if (fmt === 'BO3') {
        return [
            { stepIndex: 0, type: 'ban', team: 'teamA', label: 'Team A Ban', description: 'Team A bans 1st map' },
            { stepIndex: 1, type: 'ban', team: 'teamB', label: 'Team B Ban', description: 'Team B bans 2nd map' },
            { stepIndex: 2, type: 'pick', team: 'teamA', gameNumber: 1, sideTeam: 'teamB', label: 'Team A Pick (Game 1)', description: 'Team A picks Game 1 map (Team B chooses starting side)' },
            { stepIndex: 3, type: 'pick', team: 'teamB', gameNumber: 2, sideTeam: 'teamA', label: 'Team B Pick (Game 2)', description: 'Team B picks Game 2 map (Team A chooses starting side)' },
            { stepIndex: 4, type: 'ban', team: 'teamA', label: 'Team A Ban', description: 'Team A bans 3rd map' },
            { stepIndex: 5, type: 'ban', team: 'teamB', label: 'Team B Ban', description: 'Team B bans 4th map' },
            { stepIndex: 6, type: 'decider', gameNumber: 3, sideTeam: 'teamA', label: 'Decider (Game 3)', description: '7th map locked as Decider (Team A chooses starting side)' }
        ];
    }

    if (fmt === 'BO5') {
        return [
            { stepIndex: 0, type: 'ban', team: 'teamA', label: 'Team A Ban', description: 'Team A bans 1st map' },
            { stepIndex: 1, type: 'ban', team: 'teamB', label: 'Team B Ban', description: 'Team B bans 2nd map' },
            { stepIndex: 2, type: 'pick', team: 'teamA', gameNumber: 1, sideTeam: 'teamB', label: 'Team A Pick (Game 1)', description: 'Team A picks Game 1 map (Team B chooses starting side)' },
            { stepIndex: 3, type: 'pick', team: 'teamB', gameNumber: 2, sideTeam: 'teamA', label: 'Team B Pick (Game 2)', description: 'Team B picks Game 2 map (Team A chooses starting side)' },
            { stepIndex: 4, type: 'pick', team: 'teamA', gameNumber: 3, sideTeam: 'teamB', label: 'Team A Pick (Game 3)', description: 'Team A picks Game 3 map (Team B chooses starting side)' },
            { stepIndex: 5, type: 'pick', team: 'teamB', gameNumber: 4, sideTeam: 'teamA', label: 'Team B Pick (Game 4)', description: 'Team B picks Game 4 map (Team A chooses starting side)' },
            { stepIndex: 6, type: 'decider', gameNumber: 5, sideTeam: 'teamB', label: 'Decider (Game 5)', description: '7th map locked as Decider (Team B chooses starting side)' }
        ];
    }

    // Default: BO1 (or any single-map format)
    return [
        { stepIndex: 0, type: 'ban', team: 'teamA', label: 'Team A Ban', description: 'Team A bans 1st map' },
        { stepIndex: 1, type: 'ban', team: 'teamB', label: 'Team B Ban', description: 'Team B bans 2nd map' },
        { stepIndex: 2, type: 'ban', team: 'teamA', label: 'Team A Ban', description: 'Team A bans 3rd map' },
        { stepIndex: 3, type: 'ban', team: 'teamB', label: 'Team B Ban', description: 'Team B bans 4th map' },
        { stepIndex: 4, type: 'ban', team: 'teamA', label: 'Team A Ban', description: 'Team A bans 5th map' },
        { stepIndex: 5, type: 'ban', team: 'teamB', label: 'Team B Ban', description: 'Team B bans 6th map' },
        { stepIndex: 6, type: 'decider', gameNumber: 1, sideTeam: 'teamA', label: 'Decider (Game 1)', description: '7th map locked as Game 1 (Team A chooses starting side)' }
    ];
}

// Generate unique idempotent action UUID
export function generateActionId() {
    return 'act_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
}

// ==========================================
// 3. RUNTIME CONTROLLER & SINGLETON STATE
// ==========================================
let activeVetoUnsubscribe = null;
let activeTimerInterval = null;
let currentVetoContext = {
    tournamentId: null,
    matchId: null,
    vetoData: null,
    tournamentData: null
};

// Clock-skew server time offset estimation
let serverTimeOffsetMs = 0;

// Escape HTML utility
function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/[&<>"']/g, m => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[m]));
}

// ==========================================
// 4. ROLE RESOLUTION & CAPTAIN EXTRACTION
// ==========================================
export function resolveMatchCaptains(tournament, match) {
    const participants = tournament?.participants || [];
    const t1Name = (match.team1 || '').trim().toLowerCase();
    const t2Name = (match.team2 || '').trim().toLowerCase();

    // Match participant by name or teamName
    const p1 = participants.find(p => {
        const pName = (p.name || p.teamName || '').trim().toLowerCase();
        return pName && pName === t1Name;
    });

    const p2 = participants.find(p => {
        const pName = (p.name || p.teamName || '').trim().toLowerCase();
        return pName && pName === t2Name;
    });

    return {
        team1: {
            id: 'team1',
            name: match.team1 || 'Team 1',
            captainUid: p1?.registeredBy || p1?.captainUid || p1?.userId || null,
            captainName: p1?.captain || p1?.registeredByName || p1?.name || match.team1 || 'Captain 1'
        },
        team2: {
            id: 'team2',
            name: match.team2 || 'Team 2',
            captainUid: p2?.registeredBy || p2?.captainUid || p2?.userId || null,
            captainName: p2?.captain || p2?.registeredByName || p2?.name || match.team2 || 'Captain 2'
        }
    };
}

export function isUserMarshalOrAdmin(user, tournament) {
    if (!user) return false;
    const role = String(window.currentUserRole || '').toLowerCase();
    const isEmailAdmin = (user.email === 'admin@champzero.com' || user.email === 'owner@champzero.com');
    const isCreator = (tournament?.createdBy && tournament.createdBy === user.uid);
    const isAppointedStaff = Array.isArray(tournament?.coOrganizerUids) && tournament.coOrganizerUids.includes(user.uid);

    return role === 'admin' || role === 'organizer' || isEmailAdmin || isCreator || isAppointedStaff;
}

// ==========================================
// 5. FIRESTORE STATE INITIALIZATION
// ==========================================
export async function getOrInitializeVetoDoc(tournamentId, matchId, tournamentData) {
    const vetoDocRef = doc(db, "tournaments", tournamentId, "matchVetoes", matchId);
    const snap = await getDoc(vetoDocRef);

    if (snap.exists()) {
        return snap.data();
    }

    const match = tournamentData.matches?.find(m => m.id === matchId);
    if (!match) throw new Error("Match not found in tournament");

    const captains = resolveMatchCaptains(tournamentData, match);
    const mapPool = (tournamentData.mapPool && tournamentData.mapPool.length >= 7)
        ? [...tournamentData.mapPool]
        : [...DEFAULT_VALORANT_MAP_POOL];

    const matchFormat = match.format || tournamentData.roundFormats?.[`Round ${match.round}`] || 'BO1';

    const initialData = {
        tournamentId,
        matchId,
        format: matchFormat,
        status: 'pending_toss',
        mapPool: mapPool,
        team1: captains.team1,
        team2: captains.team2,
        teamA: null, // Assigned after coin flip
        teamB: null,
        coinWinner: null,
        sequence: compileVetoSequence(matchFormat),
        currentStepIndex: 0,
        subPhase: 'map_selection', // 'map_selection' | 'side_selection'
        pendingSideMap: null,
        pendingSideGameNumber: null,
        currentTurnTeam: null, // 'teamA' | 'teamB'
        currentTurnCaptainUid: null,
        currentTurnTeamName: null,
        turnDeadline: null,
        turnDurationSeconds: 30,
        pausedRemainingSeconds: null,
        bannedMaps: [],
        pickedMaps: [],
        deciderMap: null,
        history: [],
        lastActionId: null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
    };

    await setDoc(vetoDocRef, initialData);
    return initialData;
}

// ==========================================
// 6. ATOMIC TRANSACTIONAL OPERATIONS
// ==========================================

/**
 * Marshal Coin Toss:
 * Randomizes Team A and Team B, assigns first turn to Team A, sets server-anchored deadline.
 */
export async function executeMarshalCoinToss(tournamentId, matchId) {
    const user = auth.currentUser;
    if (!user) throw new Error("Authentication required");

    const vetoRef = doc(db, "tournaments", tournamentId, "matchVetoes", matchId);

    await runTransaction(db, async (transaction) => {
        const snap = await transaction.get(vetoRef);
        if (!snap.exists()) throw new Error("Veto session does not exist");
        const data = snap.data();

        if (data.status !== 'pending_toss') {
            return; // Already tossed
        }

        // Randomize coin winner
        const isTeam1Winner = Math.random() < 0.5;
        const teamA = isTeam1Winner ? data.team1 : data.team2;
        const teamB = isTeam1Winner ? data.team2 : data.team1;

        const sequence = compileVetoSequence(data.format);
        const firstStep = sequence[0];
        const firstTurnTeam = firstStep.team; // 'teamA'
        const firstTurnCaptainUid = teamA.captainUid;

        const deadlineMs = Date.now() + (data.turnDurationSeconds || 30) * 1000;
        const deadlineTimestamp = Timestamp.fromMillis(deadlineMs);

        const actionId = generateActionId();
        const tossLog = {
            actionId,
            stepIndex: -1,
            type: 'coin_toss',
            coinWinnerTeam: teamA.name,
            teamA: teamA.name,
            teamB: teamB.name,
            actorUid: user.uid,
            timestamp: Date.now(),
            isAuto: false
        };

        transaction.update(vetoRef, {
            teamA,
            teamB,
            coinWinner: teamA.name,
            sequence,
            status: 'in_progress',
            currentStepIndex: 0,
            subPhase: 'map_selection',
            currentTurnTeam: firstTurnTeam,
            currentTurnCaptainUid: firstTurnCaptainUid,
            currentTurnTeamName: teamA.name,
            turnDeadline: deadlineTimestamp,
            history: [tossLog],
            lastActionId: actionId,
            updatedAt: serverTimestamp()
        });
    });
}

/**
 * Submit Veto Map Action (Ban or Pick):
 * Atomic validation of stepIndex, subPhase, currentTurnCaptainUid, map availability.
 */
export async function submitVetoAction(tournamentId, matchId, { actionId, stepIndex, mapName, isAuto = false, forceActor = null }) {
    const user = auth.currentUser;
    const actorUid = forceActor || user?.uid;
    if (!actorUid) throw new Error("Authentication required");

    const vetoRef = doc(db, "tournaments", tournamentId, "matchVetoes", matchId);

    await runTransaction(db, async (transaction) => {
        const snap = await transaction.get(vetoRef);
        if (!snap.exists()) throw new Error("Veto document does not exist");
        const data = snap.data();

        // Stale or duplicate check
        if (data.status !== 'in_progress') throw new Error("Veto is not in progress (status: " + data.status + ")");
        if (data.currentStepIndex !== stepIndex) throw new Error("Stale step index. Expected " + data.currentStepIndex + ", got " + stepIndex);
        if (data.subPhase !== 'map_selection') throw new Error("State is currently locked in side selection");

        // Idempotent action ID check
        if (actionId && data.history?.some(h => h.actionId === actionId)) {
            return; // Duplicate click resolved harmlessly
        }

        // Authorization check (captain or marshal force)
        const isMarshal = !isAuto && (forceActor || (user && isUserMarshalOrAdmin(user, currentVetoContext.tournamentData)));
        if (!isAuto && !isMarshal && data.currentTurnCaptainUid && data.currentTurnCaptainUid !== actorUid) {
            throw new Error("Unauthorized: It is not your turn to choose a map.");
        }

        // Map availability check
        const banned = data.bannedMaps || [];
        const picked = (data.pickedMaps || []).map(p => p.map);
        if (banned.includes(mapName) || picked.includes(mapName)) {
            throw new Error(`Map "${mapName}" is no longer available.`);
        }

        const step = data.sequence[stepIndex];
        if (!step) throw new Error("Step out of range");

        const turnTeamKey = step.team; // 'teamA' or 'teamB'
        const activeTeam = data[turnTeamKey];

        const historyItem = {
            actionId: actionId || generateActionId(),
            stepIndex,
            type: step.type,
            team: activeTeam.name,
            teamKey: turnTeamKey,
            map: mapName,
            gameNumber: step.gameNumber || null,
            actorUid,
            timestamp: Date.now(),
            isAuto
        };

        const remainingPool = data.mapPool.filter(m => !banned.includes(m) && !picked.includes(m) && m !== mapName);

        if (step.type === 'ban') {
            const updatedBans = [...banned, mapName];

            // If 1 map remains after this ban, that map is the Decider!
            if (remainingPool.length === 1) {
                const deciderMap = remainingPool[0];
                const deciderStep = data.sequence.find(s => s.type === 'decider') || data.sequence[data.sequence.length - 1];
                const sideTeamKey = deciderStep.sideTeam;
                const sideTeam = data[sideTeamKey];

                const deadlineMs = Date.now() + (data.turnDurationSeconds || 30) * 1000;

                transaction.update(vetoRef, {
                    bannedMaps: updatedBans,
                    currentStepIndex: deciderStep.stepIndex,
                    subPhase: 'side_selection',
                    pendingSideMap: deciderMap,
                    pendingSideGameNumber: deciderStep.gameNumber,
                    currentTurnTeam: sideTeamKey,
                    currentTurnCaptainUid: sideTeam.captainUid,
                    currentTurnTeamName: sideTeam.name,
                    turnDeadline: Timestamp.fromMillis(deadlineMs),
                    history: [...(data.history || []), historyItem],
                    lastActionId: historyItem.actionId,
                    updatedAt: serverTimestamp()
                });
                return;
            }

            // Normal ban: advance to next step in sequence
            const nextStepIndex = stepIndex + 1;
            const nextStep = data.sequence[nextStepIndex];
            const nextTeamKey = nextStep.team;
            const nextTeam = data[nextTeamKey];
            const deadlineMs = Date.now() + (data.turnDurationSeconds || 30) * 1000;

            transaction.update(vetoRef, {
                bannedMaps: updatedBans,
                currentStepIndex: nextStepIndex,
                subPhase: 'map_selection',
                currentTurnTeam: nextTeamKey,
                currentTurnCaptainUid: nextTeam.captainUid,
                currentTurnTeamName: nextTeam.name,
                turnDeadline: Timestamp.fromMillis(deadlineMs),
                history: [...(data.history || []), historyItem],
                lastActionId: historyItem.actionId,
                updatedAt: serverTimestamp()
            });
        } else if (step.type === 'pick') {
            // Map picked! Immediately lock into side selection sub-phase for opposing captain
            const sideTeamKey = step.sideTeam;
            const sideTeam = data[sideTeamKey];
            const deadlineMs = Date.now() + (data.turnDurationSeconds || 30) * 1000;

            transaction.update(vetoRef, {
                subPhase: 'side_selection',
                pendingSideMap: mapName,
                pendingSideGameNumber: step.gameNumber,
                currentTurnTeam: sideTeamKey,
                currentTurnCaptainUid: sideTeam.captainUid,
                currentTurnTeamName: sideTeam.name,
                turnDeadline: Timestamp.fromMillis(deadlineMs),
                history: [...(data.history || []), historyItem],
                lastActionId: historyItem.actionId,
                updatedAt: serverTimestamp()
            });
        }
    });
}

/**
 * Submit Side Selection (Attack vs Defense):
 * Commits chosen side for the pending picked map or decider map.
 */
export async function submitSideSelection(tournamentId, matchId, { actionId, stepIndex, sideChoice, isAuto = false, forceActor = null }) {
    const user = auth.currentUser;
    const actorUid = forceActor || user?.uid;
    if (!actorUid) throw new Error("Authentication required");

    const validChoice = (sideChoice === 'Attack' || sideChoice === 'Defense') ? sideChoice : 'Defense';
    const vetoRef = doc(db, "tournaments", tournamentId, "matchVetoes", matchId);
    const tourneyRef = doc(db, "tournaments", tournamentId);

    let finalizedResult = null;

    await runTransaction(db, async (transaction) => {
        const snap = await transaction.get(vetoRef);
        if (!snap.exists()) throw new Error("Veto document does not exist");
        const data = snap.data();

        if (data.status !== 'in_progress') throw new Error("Veto is not in progress");
        if (data.subPhase !== 'side_selection') throw new Error("Veto is not waiting for side selection");
        if (data.currentStepIndex !== stepIndex) throw new Error("Stale step index during side selection");

        // Idempotent action ID check
        if (actionId && data.history?.some(h => h.actionId === actionId)) {
            return;
        }

        const isMarshal = !isAuto && (forceActor || (user && isUserMarshalOrAdmin(user, currentVetoContext.tournamentData)));
        if (!isAuto && !isMarshal && data.currentTurnCaptainUid && data.currentTurnCaptainUid !== actorUid) {
            throw new Error("Unauthorized: You are not the captain authorized to select side.");
        }

        const step = data.sequence[stepIndex];
        const sideTeamKey = data.currentTurnTeam;
        const sideTeam = data[sideTeamKey];
        const pickingTeamKey = (sideTeamKey === 'teamA') ? 'teamB' : 'teamA';
        const pickingTeam = data[pickingTeamKey];

        const sideLog = {
            actionId: actionId || generateActionId(),
            stepIndex,
            type: 'side_selection',
            map: data.pendingSideMap,
            gameNumber: data.pendingSideGameNumber,
            sideChoice: validChoice,
            selectedByTeam: sideTeam.name,
            actorUid,
            timestamp: Date.now(),
            isAuto
        };

        const updatedHistory = [...(data.history || []), sideLog];

        if (step.type === 'decider') {
            // Decider map completed! Veto is finished.
            const deciderObj = {
                gameNumber: step.gameNumber || 1,
                map: data.pendingSideMap,
                sideChoice: validChoice,
                sideSelectedBy: sideTeam.name
            };

            const updatedPicks = [
                ...(data.pickedMaps || []),
                {
                    gameNumber: step.gameNumber || 1,
                    map: data.pendingSideMap,
                    pickedBy: 'Decider',
                    sideChoice: validChoice,
                    sideSelectedBy: sideTeam.name
                }
            ];

            transaction.update(vetoRef, {
                status: 'completed',
                deciderMap: deciderObj,
                pickedMaps: updatedPicks,
                pendingSideMap: null,
                pendingSideGameNumber: null,
                subPhase: 'completed',
                currentTurnCaptainUid: null,
                turnDeadline: null,
                history: updatedHistory,
                lastActionId: sideLog.actionId,
                completedAt: serverTimestamp(),
                updatedAt: serverTimestamp()
            });

            finalizedResult = {
                map: data.pendingSideMap,
                side: validChoice,
                games: updatedPicks,
                bannedMaps: data.bannedMaps || [],
                coinWinner: data.coinWinner,
                format: data.format,
                completedAt: Date.now()
            };
        } else {
            // Non-decider pick: commit to pickedMaps
            const updatedPicks = [
                ...(data.pickedMaps || []),
                {
                    gameNumber: data.pendingSideGameNumber,
                    map: data.pendingSideMap,
                    pickedBy: pickingTeam.name,
                    sideChoice: validChoice,
                    sideSelectedBy: sideTeam.name
                }
            ];

            const remainingPool = data.mapPool.filter(m =>
                !(data.bannedMaps || []).includes(m) &&
                !updatedPicks.some(p => p.map === m)
            );

            // Check if remaining pool is now 1 map and next step is decider
            if (remainingPool.length === 1) {
                const deciderMap = remainingPool[0];
                const deciderStep = data.sequence.find(s => s.type === 'decider') || data.sequence[data.sequence.length - 1];
                const nextSideTeamKey = deciderStep.sideTeam;
                const nextSideTeam = data[nextSideTeamKey];
                const deadlineMs = Date.now() + (data.turnDurationSeconds || 30) * 1000;

                transaction.update(vetoRef, {
                    pickedMaps: updatedPicks,
                    currentStepIndex: deciderStep.stepIndex,
                    subPhase: 'side_selection',
                    pendingSideMap: deciderMap,
                    pendingSideGameNumber: deciderStep.gameNumber,
                    currentTurnTeam: nextSideTeamKey,
                    currentTurnCaptainUid: nextSideTeam.captainUid,
                    currentTurnTeamName: nextSideTeam.name,
                    turnDeadline: Timestamp.fromMillis(deadlineMs),
                    history: updatedHistory,
                    lastActionId: sideLog.actionId,
                    updatedAt: serverTimestamp()
                });
            } else {
                // Advance to next step
                const nextStepIndex = stepIndex + 1;
                const nextStep = data.sequence[nextStepIndex];
                const nextTeamKey = nextStep.team;
                const nextTeam = data[nextTeamKey];
                const deadlineMs = Date.now() + (data.turnDurationSeconds || 30) * 1000;

                transaction.update(vetoRef, {
                    pickedMaps: updatedPicks,
                    currentStepIndex: nextStepIndex,
                    subPhase: 'map_selection',
                    pendingSideMap: null,
                    pendingSideGameNumber: null,
                    currentTurnTeam: nextTeamKey,
                    currentTurnCaptainUid: nextTeam.captainUid,
                    currentTurnTeamName: nextTeam.name,
                    turnDeadline: Timestamp.fromMillis(deadlineMs),
                    history: updatedHistory,
                    lastActionId: sideLog.actionId,
                    updatedAt: serverTimestamp()
                });
            }
        }
    });

    // Mirror finalized result to tournament match record if completed
    if (finalizedResult) {
        try {
            const tSnap = await getDoc(tourneyRef);
            if (tSnap.exists()) {
                const matches = tSnap.data().matches || [];
                const mIdx = matches.findIndex(m => m.id === matchId);
                if (mIdx !== -1) {
                    matches[mIdx].veto = finalizedResult;
                    await updateDoc(tourneyRef, { matches });
                }
            }
        } catch (err) {
            console.error("[Map Veto] Failed to mirror completed veto to tournament bracket:", err);
        }
    }
}

/**
 * Automated Timeout Fallback (AFK Protection):
 * Invoked when synchronized turn timer expires with no action submitted.
 */
export async function executeTimeoutFallback(tournamentId, matchId, expectedStepIndex, expectedSubPhase) {
    const vetoRef = doc(db, "tournaments", tournamentId, "matchVetoes", matchId);
    const snap = await getDoc(vetoRef);
    if (!snap.exists()) return;
    const data = snap.data();

    if (data.status !== 'in_progress') return;
    if (data.currentStepIndex !== expectedStepIndex || data.subPhase !== expectedSubPhase) return;

    // Verify turn deadline has actually passed (grace window: 500ms)
    const deadlineMs = data.turnDeadline?.toMillis() || 0;
    if (deadlineMs > Date.now() + 500) return;

    if (expectedSubPhase === 'map_selection') {
        const step = data.sequence[expectedStepIndex];
        const banned = data.bannedMaps || [];
        const picked = (data.pickedMaps || []).map(p => p.map);
        const remaining = data.mapPool.filter(m => !banned.includes(m) && !picked.includes(m));

        if (remaining.length === 0) return;

        // Deterministic pseudo-random pick from remaining
        const randomMap = remaining[Math.floor(Math.random() * remaining.length)];
        const actionId = generateActionId();

        await submitVetoAction(tournamentId, matchId, {
            actionId,
            stepIndex: expectedStepIndex,
            mapName: randomMap,
            isAuto: true
        });
    } else if (expectedSubPhase === 'side_selection') {
        // Default side for AFK team is 'Defense'
        const actionId = generateActionId();
        await submitSideSelection(tournamentId, matchId, {
            actionId,
            stepIndex: expectedStepIndex,
            sideChoice: 'Defense',
            isAuto: true
        });
    }
}

// ==========================================
// 7. MARSHAL LIVE OVERRIDE TOOLS
// ==========================================
export async function marshalToggleTimerPause(tournamentId, matchId) {
    const user = auth.currentUser;
    if (!user) throw new Error("Authentication required");

    const vetoRef = doc(db, "tournaments", tournamentId, "matchVetoes", matchId);

    await runTransaction(db, async (transaction) => {
        const snap = await transaction.get(vetoRef);
        if (!snap.exists()) throw new Error("Veto document does not exist");
        const data = snap.data();

        if (data.status === 'in_progress') {
            // Pause timer: calculate remaining seconds
            const deadlineMs = data.turnDeadline?.toMillis() || Date.now();
            const remainingSec = Math.max(1, Math.floor((deadlineMs - Date.now()) / 1000));

            transaction.update(vetoRef, {
                status: 'paused',
                pausedRemainingSeconds: remainingSec,
                history: [...(data.history || []), {
                    actionId: generateActionId(),
                    type: 'marshal_pause',
                    actorUid: user.uid,
                    timestamp: Date.now()
                }],
                updatedAt: serverTimestamp()
            });
        } else if (data.status === 'paused') {
            // Resume timer
            const remainingSec = data.pausedRemainingSeconds || 30;
            const newDeadlineMs = Date.now() + remainingSec * 1000;

            transaction.update(vetoRef, {
                status: 'in_progress',
                turnDeadline: Timestamp.fromMillis(newDeadlineMs),
                pausedRemainingSeconds: null,
                history: [...(data.history || []), {
                    actionId: generateActionId(),
                    type: 'marshal_resume',
                    actorUid: user.uid,
                    timestamp: Date.now()
                }],
                updatedAt: serverTimestamp()
            });
        }
    });
}

export async function marshalRollbackStep(tournamentId, matchId) {
    const user = auth.currentUser;
    if (!user) throw new Error("Authentication required");

    const vetoRef = doc(db, "tournaments", tournamentId, "matchVetoes", matchId);

    await runTransaction(db, async (transaction) => {
        const snap = await transaction.get(vetoRef);
        if (!snap.exists()) throw new Error("Veto document does not exist");
        const data = snap.data();

        if (data.history.length <= 1) {
            throw new Error("Cannot rollback beyond coin toss. Use Reset Veto instead.");
        }

        const history = [...data.history];
        const lastAction = history.pop();

        let banned = [...(data.bannedMaps || [])];
        let picked = [...(data.pickedMaps || [])];
        let currentStepIndex = data.currentStepIndex;
        let subPhase = 'map_selection';
        let pendingSideMap = null;
        let pendingSideGameNumber = null;

        if (lastAction.type === 'side_selection') {
            // Undo side selection -> return to side_selection sub-phase or previous pick
            picked.pop();
            subPhase = 'side_selection';
            pendingSideMap = lastAction.map;
            pendingSideGameNumber = lastAction.gameNumber;
        } else if (lastAction.type === 'ban') {
            banned = banned.filter(m => m !== lastAction.map);
            currentStepIndex = Math.max(0, currentStepIndex - 1);
            subPhase = 'map_selection';
        } else if (lastAction.type === 'pick') {
            currentStepIndex = Math.max(0, currentStepIndex);
            subPhase = 'map_selection';
            pendingSideMap = null;
        }

        const step = data.sequence[currentStepIndex] || data.sequence[0];
        const turnTeamKey = (subPhase === 'side_selection') ? step.sideTeam : step.team;
        const turnTeam = data[turnTeamKey];
        const deadlineMs = Date.now() + (data.turnDurationSeconds || 30) * 1000;

        transaction.update(vetoRef, {
            status: 'in_progress',
            currentStepIndex,
            subPhase,
            pendingSideMap,
            pendingSideGameNumber,
            bannedMaps: banned,
            pickedMaps: picked,
            deciderMap: null,
            currentTurnTeam: turnTeamKey,
            currentTurnCaptainUid: turnTeam.captainUid,
            currentTurnTeamName: turnTeam.name,
            turnDeadline: Timestamp.fromMillis(deadlineMs),
            history,
            lastActionId: generateActionId(),
            updatedAt: serverTimestamp()
        });
    });
}

export async function marshalResetVeto(tournamentId, matchId) {
    const user = auth.currentUser;
    if (!user) throw new Error("Authentication required");

    const vetoRef = doc(db, "tournaments", tournamentId, "matchVetoes", matchId);
    const tourneyRef = doc(db, "tournaments", tournamentId);

    const snap = await getDoc(vetoRef);
    if (!snap.exists()) return;
    const data = snap.data();

    const initialSequence = compileVetoSequence(data.format);

    await updateDoc(vetoRef, {
        status: 'pending_toss',
        teamA: null,
        teamB: null,
        coinWinner: null,
        sequence: initialSequence,
        currentStepIndex: 0,
        subPhase: 'map_selection',
        pendingSideMap: null,
        pendingSideGameNumber: null,
        currentTurnTeam: null,
        currentTurnCaptainUid: null,
        currentTurnTeamName: null,
        turnDeadline: null,
        pausedRemainingSeconds: null,
        bannedMaps: [],
        pickedMaps: [],
        deciderMap: null,
        history: [],
        lastActionId: null,
        completedAt: null,
        updatedAt: serverTimestamp()
    });

    // Clear bracket veto result
    try {
        const tSnap = await getDoc(tourneyRef);
        if (tSnap.exists()) {
            const matches = tSnap.data().matches || [];
            const mIdx = matches.findIndex(m => m.id === matchId);
            if (mIdx !== -1 && matches[mIdx].veto) {
                delete matches[mIdx].veto;
                await updateDoc(tourneyRef, { matches });
            }
        }
    } catch (e) {
        console.error(e);
    }
}

// ==========================================
// 8. REAL-TIME SUBSCRIPTION & UI RENDERER
// ==========================================

/**
 * Opens and subscribes to the real-time Captain Map Veto session.
 * Rehydrates completely from snapshot on page reload, network reconnections, or device switch.
 */
export async function openLiveMapVeto(tournamentId, matchId, tournamentData) {
    // Clean up any stale subscription
    closeLiveMapVeto();

    currentVetoContext.tournamentId = tournamentId;
    currentVetoContext.matchId = matchId;
    currentVetoContext.tournamentData = tournamentData;

    const modal = document.getElementById('mapVetoModal');
    if (!modal) return;

    modal.classList.remove('hidden');
    modal.classList.add('flex');

    // Ensure document is initialized
    await getOrInitializeVetoDoc(tournamentId, matchId, tournamentData);

    const vetoRef = doc(db, "tournaments", tournamentId, "matchVetoes", matchId);

    activeVetoUnsubscribe = onSnapshot(vetoRef, (docSnap) => {
        if (!docSnap.exists()) return;
        const data = docSnap.data();
        currentVetoContext.vetoData = data;
        renderLiveVetoUI(data, tournamentData);
    }, (error) => {
        console.error("[Map Veto] Snapshot error:", error);
    });
}

/**
 * Cleans up real-time snapshot listeners and timers on modal close.
 */
export function closeLiveMapVeto() {
    if (activeVetoUnsubscribe) {
        activeVetoUnsubscribe();
        activeVetoUnsubscribe = null;
    }
    if (activeTimerInterval) {
        clearInterval(activeTimerInterval);
        activeTimerInterval = null;
    }
    currentVetoContext.tournamentId = null;
    currentVetoContext.matchId = null;
    currentVetoContext.vetoData = null;

    const modal = document.getElementById('mapVetoModal');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }
}

/**
 * Main UI Render function responding reactively to every Firestore state change.
 */
export function renderLiveVetoUI(veto, tournament) {
    const user = auth.currentUser;
    const isMarshal = isUserMarshalOrAdmin(user, tournament);
    const isCurrentCaptain = user && veto.currentTurnCaptainUid && (user.uid === veto.currentTurnCaptainUid);

    // Team names header
    const t1El = document.getElementById('vetoTeam1Name');
    const t2El = document.getElementById('vetoTeam2Name');
    if (t1El) t1El.textContent = veto.team1?.name || 'Team 1';
    if (t2El) t2El.textContent = veto.team2?.name || 'Team 2';

    // Format badge
    const fmtBadge = document.getElementById('vetoFormatBadge');
    if (fmtBadge) fmtBadge.textContent = `${veto.format || 'BO1'} • 7-Map Pool`;

    // Sections
    const tossSection = document.getElementById('vetoCoinTossSection');
    const actionSection = document.getElementById('vetoPickBanSection');
    const sideModal = document.getElementById('vetoSideSelectionModal');
    const marshalPanel = document.getElementById('vetoMarshalControlPanel');

    // Toggle Marshal Control Panel
    if (marshalPanel) {
        if (isMarshal) {
            marshalPanel.classList.remove('hidden');
            renderMarshalControls(veto);
        } else {
            marshalPanel.classList.add('hidden');
        }
    }

    if (veto.status === 'pending_toss') {
        if (tossSection) tossSection.classList.remove('hidden');
        if (actionSection) actionSection.classList.add('hidden');
        if (sideModal) sideModal.classList.add('hidden');
        renderPendingTossState(veto, isMarshal);
        return;
    }

    // Status: in_progress, paused, or completed
    if (tossSection) tossSection.classList.add('hidden');
    if (actionSection) actionSection.classList.remove('hidden');

    // Breadcrumb / Step tracker
    renderStepBreadcrumbs(veto);

    // Dynamic Turn Banner (Active Captain vs Spectator Mode)
    renderTurnBanner(veto, isCurrentCaptain, isMarshal);

    // Turn Countdown Timer
    startSynchronizedTimer(veto);

    // Map Cards Grid
    renderMapCardsGrid(veto, isCurrentCaptain, isMarshal);

    // Side Selection Sub-Phase Modal
    if (veto.subPhase === 'side_selection' && veto.pendingSideMap) {
        if (sideModal) sideModal.classList.remove('hidden');
        renderSideSelectionModal(veto, isCurrentCaptain, isMarshal);
    } else {
        if (sideModal) sideModal.classList.add('hidden');
    }

    // Completed summary banner
    if (veto.status === 'completed') {
        renderCompletedSummary(veto);
    }
}

// ----------------------------------------------------
// UI Render Helpers
// ----------------------------------------------------

function renderPendingTossState(veto, isMarshal) {
    const flipBtn = document.getElementById('flipCoinBtn');
    const waitingMsg = document.getElementById('coinWaitingNotice');
    const resultDisplay = document.getElementById('coinResultDisplay');

    if (resultDisplay) resultDisplay.innerHTML = '';

    if (isMarshal) {
        if (flipBtn) {
            flipBtn.classList.remove('hidden');
            flipBtn.disabled = false;
            flipBtn.onclick = () => window.vetoExecuteCoinFlip();
        }
        if (waitingMsg) waitingMsg.classList.add('hidden');
    } else {
        if (flipBtn) flipBtn.classList.add('hidden');
        if (waitingMsg) {
            waitingMsg.classList.remove('hidden');
            waitingMsg.innerHTML = `
                <div class="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs font-mono-tag">
                    <span class="w-2 h-2 rounded-full bg-amber-400 animate-ping"></span>
                    <span>Waiting for Tournament Marshal to flip the coin...</span>
                </div>
            `;
        }
    }
}

function renderStepBreadcrumbs(veto) {
    const container = document.getElementById('vetoStepBreadcrumbs');
    if (!container) return;

    const sequence = veto.sequence || [];
    const currentIdx = veto.currentStepIndex;

    container.innerHTML = sequence.map((s, idx) => {
        const isPast = idx < currentIdx;
        const isCurrent = idx === currentIdx && veto.status !== 'completed';
        const isFuture = idx > currentIdx;

        let bg = 'bg-white/5 border-white/10 text-neutral-500';
        if (isCurrent) {
            bg = (s.type === 'ban') 
                ? 'bg-rose-500/20 border-rose-500 text-rose-300 font-bold shadow-[0_0_10px_rgba(244,63,94,0.3)] animate-pulse'
                : 'bg-emerald-500/20 border-emerald-500 text-emerald-300 font-bold shadow-[0_0_10px_rgba(16,185,129,0.3)] animate-pulse';
        } else if (isPast) {
            bg = 'bg-white/10 border-white/20 text-neutral-300';
        }

        const tag = (s.type === 'ban') ? 'BAN' : (s.type === 'pick' ? `P${s.gameNumber}` : 'DEC');
        const teamLabel = s.team === 'teamA' ? (veto.teamA?.name || 'Team A') : (veto.teamB?.name || 'Team B');

        return `
            <div class="px-2 py-1 rounded border ${bg} text-[9px] font-mono-tag truncate flex items-center gap-1">
                <span class="font-bold opacity-75">${tag}</span>
                <span class="truncate max-w-[60px]">${escapeHtml(teamLabel)}</span>
            </div>
        `;
    }).join('');
}

function renderTurnBanner(veto, isCurrentCaptain, isMarshal) {
    const banner = document.getElementById('vetoTurnIndicatorBanner');
    if (!banner) return;

    if (veto.status === 'completed') {
        banner.className = "p-3 rounded-xl bg-gradient-to-r from-emerald-950/80 to-teal-950/80 border border-emerald-500/50 flex items-center justify-between";
        banner.innerHTML = `
            <div class="flex items-center gap-3">
                <div class="w-3 h-3 rounded-full bg-emerald-400 shadow-[0_0_10px_#34d399]"></div>
                <div>
                    <span class="text-[10px] uppercase font-mono-tag font-bold tracking-wider text-emerald-400">VETO FINALIZED</span>
                    <h4 class="font-heading font-black text-sm text-white uppercase">Match Maps &amp; Sides Confirmed</h4>
                </div>
            </div>
            <span class="px-3 py-1 rounded bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 font-mono-tag text-xs font-bold uppercase">Ready to Play</span>
        `;
        return;
    }

    if (veto.status === 'paused') {
        banner.className = "p-3 rounded-xl bg-amber-950/40 border border-amber-500/40 flex items-center justify-between";
        banner.innerHTML = `
            <div class="flex items-center gap-3">
                <div class="w-3 h-3 rounded-full bg-amber-400 animate-pulse"></div>
                <div>
                    <span class="text-[10px] uppercase font-mono-tag font-bold tracking-wider text-amber-400">// TECHNICAL PAUSE</span>
                    <h4 class="font-heading font-black text-sm text-white uppercase">Timer Paused by Tournament Marshal</h4>
                </div>
            </div>
            <span class="px-2.5 py-1 rounded bg-amber-500/20 text-amber-300 font-mono-tag text-xs font-bold uppercase">PAUSED</span>
        `;
        return;
    }

    const step = veto.sequence[veto.currentStepIndex];
    const turnTeamName = veto.currentTurnTeamName || 'Captain';
    const isBan = (step?.type === 'ban' && veto.subPhase !== 'side_selection');
    const isSide = (veto.subPhase === 'side_selection');

    if (isCurrentCaptain) {
        // ACTIVE CAPTAIN STATE
        banner.className = "p-3 rounded-xl bg-gradient-to-r from-yellow-500/20 via-amber-500/10 to-transparent border-2 border-[#FFD700] shadow-[0_0_20px_rgba(255,215,0,0.25)] flex items-center justify-between";
        banner.innerHTML = `
            <div class="flex items-center gap-3">
                <div class="w-3.5 h-3.5 rounded-full bg-[#FFD700] shadow-[0_0_12px_#FFD700] animate-ping"></div>
                <div>
                    <span class="text-[10px] uppercase font-mono-tag font-extrabold tracking-widest text-[#FFD700]">// ACTION REQUIRED</span>
                    <h4 class="font-heading font-black text-sm text-white uppercase">
                        YOUR TURN: SELECT MAP TO ${isSide ? 'CHOOSE STARTING SIDE' : (isBan ? 'BAN' : 'PICK')}
                    </h4>
                </div>
            </div>
            <span class="px-3 py-1 rounded-lg bg-[#FFD700] text-black font-heading font-extrabold text-xs uppercase shadow-sm">
                Active Captain
            </span>
        `;
    } else {
        // SPECTATOR / OPPONENT WAITING STATE
        banner.className = "p-3 rounded-xl bg-white/5 border border-white/10 flex items-center justify-between";
        banner.innerHTML = `
            <div class="flex items-center gap-3">
                <div class="w-2.5 h-2.5 rounded-full bg-neutral-400"></div>
                <div>
                    <span class="text-[10px] uppercase font-mono-tag font-bold tracking-wider text-neutral-400">SPECTATOR / WAITING MODE</span>
                    <h4 class="font-heading font-bold text-sm text-neutral-200 uppercase">
                        Awaiting ${escapeHtml(turnTeamName)} to ${isSide ? 'select side' : (isBan ? 'ban a map' : 'pick a map')}...
                    </h4>
                </div>
            </div>
            <span class="px-2.5 py-1 rounded bg-white/10 text-neutral-400 font-mono-tag text-[10px] uppercase">
                ${isMarshal ? 'Marshal Watching' : 'Read-Only Feed'}
            </span>
        `;
    }
}

function startSynchronizedTimer(veto) {
    if (activeTimerInterval) {
        clearInterval(activeTimerInterval);
        activeTimerInterval = null;
    }

    const timerText = document.getElementById('vetoTimerCount');
    const timerCircle = document.getElementById('vetoTimerProgressCircle');
    if (!timerText) return;

    if (veto.status === 'paused') {
        timerText.textContent = `${veto.pausedRemainingSeconds || 30}s`;
        timerText.className = "font-mono font-black text-lg text-amber-400";
        return;
    }

    if (veto.status === 'completed' || !veto.turnDeadline) {
        timerText.textContent = '--';
        timerText.className = "font-mono font-black text-lg text-neutral-500";
        return;
    }

    const totalSeconds = veto.turnDurationSeconds || 30;
    const deadlineMs = veto.turnDeadline.toMillis();

    const updateTimer = () => {
        const now = Date.now() + serverTimeOffsetMs;
        const diffMs = deadlineMs - now;
        const remainingSec = Math.max(0, Math.ceil(diffMs / 1000));

        timerText.textContent = `${remainingSec}s`;

        if (remainingSec <= 5) {
            timerText.className = "font-mono font-black text-lg text-rose-500 animate-ping";
        } else if (remainingSec <= 10) {
            timerText.className = "font-mono font-black text-lg text-amber-400";
        } else {
            timerText.className = "font-mono font-black text-lg text-emerald-400";
        }

        if (timerCircle) {
            const fraction = remainingSec / totalSeconds;
            const strokeDashoffset = 100 - (fraction * 100);
            timerCircle.style.strokeDashoffset = strokeDashoffset;
        }

        // Automated fallback trigger when expired
        if (remainingSec === 0) {
            clearInterval(activeTimerInterval);
            activeTimerInterval = null;
            // Let active captain or marshal trigger timeout transaction
            window.vetoTriggerTimeoutFallback();
        }
    };

    updateTimer();
    activeTimerInterval = setInterval(updateTimer, 500);
}

function renderMapCardsGrid(veto, isCurrentCaptain, isMarshal) {
    const grid = document.getElementById('vetoMapGrid');
    if (!grid) return;

    const banned = veto.bannedMaps || [];
    const picked = veto.pickedMaps || [];
    const step = veto.sequence[veto.currentStepIndex];
    const isBan = (step?.type === 'ban');
    const canInteract = (isCurrentCaptain || isMarshal) && (veto.status === 'in_progress') && (veto.subPhase === 'map_selection');

    grid.innerHTML = veto.mapPool.map(mapName => {
        const visuals = getMapVisuals(mapName);
        const isBanned = banned.includes(mapName);
        const pickedObj = picked.find(p => p.map === mapName);
        const isDecider = (veto.deciderMap?.map === mapName) || (veto.pendingSideMap === mapName && step?.type === 'decider');

        // Identify banning team from history
        const banHistory = isBanned ? veto.history?.find(h => h.type === 'ban' && h.map === mapName) : null;

        let cardBorder = "border-white/10 hover:border-[#FFD700]/50";
        let cardOverlay = "bg-black/60";
        let statusBadge = `<span class="px-2 py-0.5 rounded bg-white/10 text-neutral-400 text-[10px] font-mono-tag uppercase">Available</span>`;
        let actionBtn = '';

        if (isBanned) {
            cardBorder = "border-red-600/40 opacity-50 grayscale";
            cardOverlay = "bg-red-950/80";
            statusBadge = `
                <span class="px-2 py-0.5 rounded bg-red-500/20 border border-red-500/40 text-red-400 text-[10px] font-mono-tag font-bold uppercase line-through">
                    BANNED ${banHistory ? `• ${escapeHtml(banHistory.team)}` : ''}
                </span>
            `;
        } else if (pickedObj) {
            cardBorder = "border-emerald-500 shadow-[0_0_15px_rgba(16,185,129,0.3)]";
            cardOverlay = "bg-emerald-950/60";
            statusBadge = `
                <span class="px-2 py-0.5 rounded bg-emerald-500/20 border border-emerald-500/50 text-emerald-300 text-[10px] font-mono-tag font-extrabold uppercase">
                    GAME ${pickedObj.gameNumber} PICK • ${escapeHtml(pickedObj.pickedBy)} (${pickedObj.sideChoice || 'Selected'})
                </span>
            `;
        } else if (isDecider) {
            cardBorder = "border-[#FFD700] shadow-[0_0_20px_rgba(255,215,0,0.4)]";
            cardOverlay = "bg-yellow-950/60";
            statusBadge = `
                <span class="px-2 py-0.5 rounded bg-[#FFD700] text-black text-[10px] font-mono-tag font-black uppercase">
                    DECIDER MAP • GAME ${step?.gameNumber || 1}
                </span>
            `;
        } else if (canInteract) {
            actionBtn = `
                <button type="button" onclick="window.vetoSubmitMapSelection('${escapeHtml(mapName)}')"
                    class="w-full mt-2 py-1.5 px-2 rounded-lg font-heading font-extrabold text-[11px] uppercase transition-all shadow cursor-pointer ${
                        isBan 
                            ? 'bg-red-600 hover:bg-red-500 text-white' 
                            : 'bg-emerald-500 hover:bg-emerald-400 text-black'
                    }">
                    ${isBan ? 'BAN MAP' : 'PICK MAP'}
                </button>
            `;
        }

        const bgImgStyle = visuals.image ? `background-image: url('${visuals.image}'); background-size: cover; background-position: center;` : '';

        return `
            <div class="relative rounded-xl border ${cardBorder} overflow-hidden flex flex-col justify-between p-3.5 min-h-[140px] transition-all group"
                 style="${bgImgStyle}">
                <div class="absolute inset-0 ${cardOverlay} backdrop-blur-[2px] pointer-events-none"></div>
                <div class="relative z-10 flex items-center justify-between">
                    <span class="font-mono-tag text-[9px] font-bold text-neutral-400 uppercase">// MAP</span>
                    ${statusBadge}
                </div>
                <div class="relative z-10 my-2">
                    <h4 class="font-heading font-black text-base text-white uppercase tracking-wider group-hover:text-[#FFD700] transition-colors">
                        ${escapeHtml(mapName)}
                    </h4>
                    <p class="text-[10px] text-neutral-400 font-sans truncate">${escapeHtml(visuals.subtitle)}</p>
                </div>
                <div class="relative z-10">
                    ${actionBtn}
                </div>
            </div>
        `;
    }).join('');
}

function renderSideSelectionModal(veto, isCurrentCaptain, isMarshal) {
    const modal = document.getElementById('vetoSideSelectionModal');
    if (!modal) return;

    const mapName = veto.pendingSideMap;
    const gameNum = veto.pendingSideGameNumber || 1;
    const turnTeamName = veto.currentTurnTeamName || 'Active Team';

    const titleEl = document.getElementById('vetoSideMapTitle');
    const noticeEl = document.getElementById('vetoSideNotice');
    const actionsWrap = document.getElementById('vetoSideActionsWrap');

    if (titleEl) titleEl.textContent = `${mapName} (Game ${gameNum})`;
    if (noticeEl) {
        noticeEl.innerHTML = isCurrentCaptain
            ? `<span class="text-[#FFD700] font-bold">YOUR TURN:</span> Select whether ${escapeHtml(turnTeamName)} starts on Attack or Defense.`
            : `Awaiting <strong class="text-white">${escapeHtml(turnTeamName)}</strong> to select starting side (Attack vs Defense)...`;
    }

    if (actionsWrap) {
        if (isCurrentCaptain || isMarshal) {
            actionsWrap.innerHTML = `
                <button type="button" onclick="window.vetoSubmitSideChoice('Attack')"
                    class="flex-1 py-3 px-4 rounded-xl bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 text-white font-heading font-black text-sm uppercase tracking-wider shadow-lg hover:scale-[1.02] transition-all cursor-pointer">
                    ⚔️ Attack (First Half)
                </button>
                <button type="button" onclick="window.vetoSubmitSideChoice('Defense')"
                    class="flex-1 py-3 px-4 rounded-xl bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-500 hover:to-cyan-500 text-white font-heading font-black text-sm uppercase tracking-wider shadow-lg hover:scale-[1.02] transition-all cursor-pointer">
                    🛡️ Defense (First Half)
                </button>
            `;
        } else {
            actionsWrap.innerHTML = `
                <div class="w-full text-center py-2 text-xs font-mono-tag text-neutral-400">
                    Waiting for captain's selection...
                </div>
            `;
        }
    }
}

function renderMarshalControls(veto) {
    const pauseBtn = document.getElementById('marshalPauseTimerBtn');
    if (pauseBtn) {
        pauseBtn.textContent = (veto.status === 'paused') ? 'Resume Timer' : 'Pause Timer';
        pauseBtn.className = (veto.status === 'paused')
            ? "px-3 py-1.5 rounded-lg bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 hover:bg-emerald-500/30 text-xs font-mono-tag font-bold uppercase transition-colors"
            : "px-3 py-1.5 rounded-lg bg-amber-500/20 text-amber-300 border border-amber-500/40 hover:bg-amber-500/30 text-xs font-mono-tag font-bold uppercase transition-colors";
    }
}

function renderCompletedSummary(veto) {
    const summaryWrap = document.getElementById('vetoCompletedSummaryWrap');
    if (!summaryWrap) return;

    summaryWrap.classList.remove('hidden');
    const picks = veto.pickedMaps || [];

    summaryWrap.innerHTML = `
        <div class="p-4 rounded-xl bg-black/40 border border-emerald-500/40 space-y-3 font-mono-tag">
            <h4 class="text-xs font-bold text-emerald-400 uppercase tracking-wider">// Confirmed Match Structure</h4>
            <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                ${picks.map(p => `
                    <div class="p-3 rounded-lg bg-white/5 border border-white/10 text-xs">
                        <span class="text-neutral-400 text-[10px] block uppercase">Game ${p.gameNumber}</span>
                        <div class="font-heading font-black text-white text-sm uppercase mt-0.5">${escapeHtml(p.map)}</div>
                        <div class="mt-1 text-[11px] text-[#FFD700]">Picked by: ${escapeHtml(p.pickedBy)}</div>
                        <div class="text-[10px] text-neutral-300">Side: ${escapeHtml(p.sideChoice)} (${escapeHtml(p.sideSelectedBy)})</div>
                    </div>
                `).join('')}
            </div>
        </div>
    `;
}

// ==========================================
// 9. GLOBAL WINDOW BINDINGS
// ==========================================
window.vetoExecuteCoinFlip = async function() {
    const ctx = currentVetoContext;
    if (!ctx.tournamentId || !ctx.matchId) return;
    try {
        const coinGraphic = document.getElementById('coinGraphic');
        if (coinGraphic) {
            coinGraphic.style.transition = 'transform 1s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
            coinGraphic.style.transform = 'rotateY(1080deg) scale(1.2)';
        }
        await executeMarshalCoinToss(ctx.tournamentId, ctx.matchId);
    } catch (err) {
        console.error("Coin toss error:", err);
        if (window.showErrorToast) window.showErrorToast("Coin Toss Failed", err.message);
    }
};

window.vetoSubmitMapSelection = async function(mapName) {
    const ctx = currentVetoContext;
    if (!ctx.tournamentId || !ctx.matchId || !ctx.vetoData) return;

    try {
        const actionId = generateActionId();
        await submitVetoAction(ctx.tournamentId, ctx.matchId, {
            actionId,
            stepIndex: ctx.vetoData.currentStepIndex,
            mapName
        });
    } catch (err) {
        console.error("Map selection error:", err);
        if (window.showErrorToast) window.showErrorToast("Action Rejected", err.message);
    }
};

window.vetoSubmitSideChoice = async function(sideChoice) {
    const ctx = currentVetoContext;
    if (!ctx.tournamentId || !ctx.matchId || !ctx.vetoData) return;

    try {
        const actionId = generateActionId();
        await submitSideSelection(ctx.tournamentId, ctx.matchId, {
            actionId,
            stepIndex: ctx.vetoData.currentStepIndex,
            sideChoice
        });
    } catch (err) {
        console.error("Side choice error:", err);
        if (window.showErrorToast) window.showErrorToast("Side Selection Rejected", err.message);
    }
};

window.vetoTriggerTimeoutFallback = async function() {
    const ctx = currentVetoContext;
    if (!ctx.tournamentId || !ctx.matchId || !ctx.vetoData) return;

    try {
        await executeTimeoutFallback(
            ctx.tournamentId, 
            ctx.matchId, 
            ctx.vetoData.currentStepIndex, 
            ctx.vetoData.subPhase
        );
    } catch (err) {
        console.warn("[Map Veto] Timeout fallback skipped or already handled:", err);
    }
};

// Marshal Override Handlers
window.marshalTogglePause = async function() {
    const ctx = currentVetoContext;
    if (!ctx.tournamentId || !ctx.matchId) return;
    try {
        await marshalToggleTimerPause(ctx.tournamentId, ctx.matchId);
    } catch (err) {
        alert("Marshal Pause Error: " + err.message);
    }
};

window.marshalRollbackStep = async function() {
    const ctx = currentVetoContext;
    if (!ctx.tournamentId || !ctx.matchId) return;
    if (!confirm("Are you sure you want to rollback to the previous step?")) return;
    try {
        await marshalRollbackStep(ctx.tournamentId, ctx.matchId);
    } catch (err) {
        alert("Marshal Rollback Error: " + err.message);
    }
};

window.marshalResetVeto = async function() {
    const ctx = currentVetoContext;
    if (!ctx.tournamentId || !ctx.matchId) return;
    if (!confirm("RESET VETO WARNING: This will completely reset the map veto back to the pre-coin toss state. Proceed?")) return;
    try {
        await marshalResetVeto(ctx.tournamentId, ctx.matchId);
    } catch (err) {
        alert("Marshal Reset Error: " + err.message);
    }
};

window.closeMapVetoModal = function() {
    closeLiveMapVeto();
};
