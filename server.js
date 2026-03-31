import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { Deck } from './src/card.js';
import { classify, canBeat, TYPE } from './src/logic.js';
import { AIPlayer } from './src/ai.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const app = express();
const server = createServer(app);
const io = new Server(server);

app.use(express.static(__dirname));

// ==================== GAME STATE ====================
const rooms = [];
for (let i = 0; i < 6; i++) {
    rooms.push({
        id: i + 1,
        players: [null, null, null, null],
        isStarted: false,
        gameState: 'WAITING',
        currentTurn: 0,
        lastPlayedCards: [],
        lastPlayerToPlay: -1,
        passedPlayers: new Set(),
        isFirstTurnOfTable: false,
        timerInterval: null,
        timerSeconds: 30,
        countdownInterval: null,
        firstSlot: 0,
        hostSlot: -1, // Slot của chủ bàn
    });
}
const socketRooms = new Map();

// ==================== HELPERS ====================
function serializeCard(card) {
    return {
        rankIndex: card.rankIndex, suitIndex: card.suitIndex,
        rank: card.rank, suit: card.suit, id: card.id,
        absoluteValue: card.absoluteValue,
    };
}
function getPlayerInfo(p, idx, room) {
    if (!p) return null;
    return { name: p.name, isAI: !!p.isAI, cardCount: p.hand ? p.hand.length : 0, isReady: !!p.isReady, isHost: room ? room.hostSlot === idx : false };
}
function broadcastRoomList() { io.emit('room-list', rooms.map(r => ({ id: r.id, playerCount: r.players.filter(p => p).length, isStarted: r.isStarted }))); }
function getPlayersInfo(room) { return room.players.map((p, i) => getPlayerInfo(p, i, room)); }
function resetRoomIfEmpty(room) {
    const humans = room.players.filter(p => p && !p.isAI);
    if (humans.length === 0) {
        // Bàn chỉ còn máy hoặc trống -> reset hoàn toàn
        stopPlayerTimer(room);
        if (room.countdownInterval) { clearInterval(room.countdownInterval); room.countdownInterval = null; }
        room.players = [null, null, null, null];
        room.isStarted = false;
        room.gameState = 'WAITING';
        room.hostSlot = -1;
        room.lastPlayedCards = []; room.passedPlayers = new Set();
        room.lastPlayerToPlay = -1;
        broadcastRoomList();
    }
}
function emitToRoom(room, event, data) {
    room.players.forEach(p => {
        if (p && !p.isAI && p.socketId) {
            const s = io.sockets.sockets.get(p.socketId);
            if (s) s.emit(event, data);
        }
    });
}
function sendRoomState(room) {
    room.players.forEach((p, idx) => {
        if (p && !p.isAI && p.socketId) {
            const s = io.sockets.sockets.get(p.socketId);
            if (s) s.emit('room-state', {
                yourSlot: idx,
                players: getPlayersInfo(room),
                gameState: room.gameState,
                currentTurn: room.currentTurn,
                lastPlayedCards: room.lastPlayedCards.map(serializeCard),
                lastPlayerToPlay: room.lastPlayerToPlay,
                isFirstTurnOfTable: room.isFirstTurnOfTable,
                timerSeconds: room.timerSeconds,
                yourHand: p.hand ? p.hand.map(serializeCard) : [],
                hostSlot: room.hostSlot,
            });
        }
    });
}

// ==================== GAME LOGIC ====================
function checkAllReady(room) {
    const players = room.players.filter(p => p);
    if (players.length < 2) { stopCountdown(room); return; }
    const humans = players.filter(p => !p.isAI);
    if (humans.length === 0 || !humans.every(p => p.isReady)) { stopCountdown(room); return; }
    startCountdown(room);
}

function startCountdown(room) {
    if (room.gameState === 'COUNTDOWN') return;
    room.gameState = 'COUNTDOWN';
    let count = 3;
    emitToRoom(room, 'countdown', { count });
    room.countdownInterval = setInterval(() => {
        count--;
        emitToRoom(room, 'countdown', { count });
        if (count <= 0) { clearInterval(room.countdownInterval); room.countdownInterval = null; startGame(room); }
    }, 1000);
}

function stopCountdown(room) {
    if (room.gameState !== 'COUNTDOWN') return;
    clearInterval(room.countdownInterval); room.countdownInterval = null;
    room.gameState = 'WAITING';
    emitToRoom(room, 'countdown-stop', {});
    sendRoomState(room);
}

function startGame(room) {
    room.gameState = 'PLAYING';
    room.isStarted = true;
    room.isFirstTurnOfTable = true;
    room.lastPlayedCards = [];
    room.lastPlayerToPlay = -1;
    room.passedPlayers = new Set();

    const deck = new Deck(); deck.shuffle();
    const hands = deck.deal(4);
    room.players.forEach((p, idx) => { if (p) p.hand = hands[idx]; });

    // Người đầu tiên trong bàn đánh trước
    room.currentTurn = room.firstSlot;
    if (!room.players[room.currentTurn]) {
        room.currentTurn = room.players.findIndex(p => p !== null);
    }

    // Gửi tay bài cho từng người
    room.players.forEach((p, idx) => {
        if (p && !p.isAI && p.socketId) {
            const s = io.sockets.sockets.get(p.socketId);
            if (s) s.emit('game-started', {
                yourSlot: idx, yourHand: p.hand.map(serializeCard),
                players: getPlayersInfo(room), currentTurn: room.currentTurn,
                hostSlot: room.hostSlot,
            });
        }
    });
    broadcastRoomList();
    setTimeout(() => startTurn(room), 2500);
}

function startTurn(room) {
    if (room.gameState !== 'PLAYING') return;
    const player = room.players[room.currentTurn];
    if (!player) { nextTurn(room); return; }

    if (room.passedPlayers.has(room.currentTurn) && room.lastPlayerToPlay !== room.currentTurn) {
        setTimeout(() => nextTurn(room), 300);
        return;
    }
    if (room.lastPlayerToPlay === room.currentTurn) {
        room.lastPlayedCards = []; room.passedPlayers.clear();
    }

    startPlayerTimer(room);
    emitToRoom(room, 'turn-start', {
        currentTurn: room.currentTurn, playerName: player.name,
        lastPlayedCards: room.lastPlayedCards.map(serializeCard),
        lastPlayerToPlay: room.lastPlayerToPlay,
        isFirstTurnOfTable: room.isFirstTurnOfTable, timerSeconds: 30,
        players: getPlayersInfo(room),
    });
    if (player.isAI) runAI(room);
}

async function runAI(room) {
    const ai = room.players[room.currentTurn];
    if (!ai || !ai.isAI) return;
    const fakeCtrl = { currentRoom: room };
    const move = await ai.decideMove(room.lastPlayedCards, fakeCtrl);
    if (room.gameState !== 'PLAYING') return;
    if (move) executeMove(room, room.currentTurn, move);
    else handlePass(room, room.currentTurn);
}

function executeMove(room, slotIdx, cards) {
    stopPlayerTimer(room);
    const player = room.players[slotIdx];
    if (!player) return;
    if (room.lastPlayedCards.length > 0 && !canBeat(room.lastPlayedCards, cards)) return;

    room.lastPlayedCards = cards;
    room.lastPlayerToPlay = slotIdx;
    const ids = cards.map(c => c.id);
    player.hand = player.hand.filter(c => !ids.includes(c.id));
    room.isFirstTurnOfTable = false;

    emitToRoom(room, 'move-made', {
        slotIdx, playerName: player.name,
        cards: cards.map(serializeCard),
        players: getPlayersInfo(room),
    });

    if (player.hand.length === 0) {
        setTimeout(() => endGame(room, slotIdx), 600);
    } else {
        setTimeout(() => nextTurn(room), 800);
    }
}

function handlePass(room, slotIdx) {
    stopPlayerTimer(room);
    room.isFirstTurnOfTable = false;
    room.passedPlayers.add(slotIdx);

    emitToRoom(room, 'player-passed', {
        slotIdx, playerName: room.players[slotIdx]?.name,
        players: getPlayersInfo(room),
    });

    const activeSlots = [];
    room.players.forEach((p, i) => { if (p && !room.passedPlayers.has(i)) activeSlots.push(i); });

    if (activeSlots.length <= 1) {
        if (activeSlots.length === 1) {
            room.currentTurn = activeSlots[0];
            room.lastPlayedCards = []; room.lastPlayerToPlay = -1; room.passedPlayers.clear();
            emitToRoom(room, 'round-won', { slotIdx: activeSlots[0] });
            setTimeout(() => startTurn(room), 800);
        } else { nextTurn(room); }
    } else { nextTurn(room); }
}

function nextTurn(room) {
    let next = (room.currentTurn + 1) % 4, loop = 0;
    while ((!room.players[next] || room.passedPlayers.has(next)) && loop < 4) { next = (next + 1) % 4; loop++; }
    room.currentTurn = next;
    startTurn(room);
}

function startPlayerTimer(room) {
    stopPlayerTimer(room);
    room.timerSeconds = 30;
    room.timerInterval = setInterval(() => {
        room.timerSeconds--;
        emitToRoom(room, 'timer-tick', { seconds: room.timerSeconds, currentTurn: room.currentTurn });
        if (room.timerSeconds <= 0) { stopPlayerTimer(room); onTimeout(room); }
    }, 1000);
}
function stopPlayerTimer(room) { if (room.timerInterval) { clearInterval(room.timerInterval); room.timerInterval = null; } }

function onTimeout(room) {
    if (room.isFirstTurnOfTable) {
        const p = room.players[room.currentTurn];
        if (p && p.hand.length > 0) {
            p.hand.sort((a, b) => a.absoluteValue - b.absoluteValue);
            executeMove(room, room.currentTurn, [p.hand[0]]); return;
        }
    }
    handlePass(room, room.currentTurn);
}

function endGame(room, winnerSlot) {
    room.gameState = 'ENDED'; room.isStarted = false;
    stopPlayerTimer(room);
    emitToRoom(room, 'game-ended', { winnerSlot, winnerName: room.players[winnerSlot]?.name });

    setTimeout(() => {
        room.gameState = 'WAITING';
        room.players.forEach(p => { if (p) { p.isReady = !!p.isAI; p.hand = []; } });
        room.lastPlayedCards = []; room.lastPlayerToPlay = -1; room.passedPlayers.clear();
        room.firstSlot = winnerSlot; // Người thắng đánh trước ván sau
        sendRoomState(room);
        broadcastRoomList();
    }, 3000);
}

// ==================== SOCKET.IO ====================
io.on('connection', (socket) => {
    console.log(`+ Kết nối: ${socket.id}`);
    socket.emit('room-list', rooms.map(r => ({ id: r.id, playerCount: r.players.filter(p => p).length, isStarted: r.isStarted })));

    socket.on('join-room', ({ roomId, playerName }) => {
        const room = rooms[roomId - 1];
        if (!room) return socket.emit('error-msg', { message: 'Bàn không tồn tại!' });
        if (room.isStarted) return socket.emit('error-msg', { message: 'Bàn đang chơi!' });

        const slot = room.players.findIndex(p => p === null);
        if (slot === -1) return socket.emit('error-msg', { message: 'Bàn đã đầy!' });

        leaveCurrentRoom(socket);
        room.players[slot] = { socketId: socket.id, name: playerName || `Người ${slot + 1}`, isAI: false, isReady: false, hand: [] };
        // Người đầu tiên vào bàn = chủ bàn + đánh trước
        const humanCount = room.players.filter(p => p && !p.isAI).length;
        if (humanCount === 1) { room.hostSlot = slot; room.firstSlot = slot; }
        socketRooms.set(socket.id, { roomId: roomId - 1, slot });
        sendRoomState(room); broadcastRoomList();
    });

    socket.on('add-ai', ({ slotIdx }) => {
        const info = socketRooms.get(socket.id);
        if (!info) return;
        const room = rooms[info.roomId];
        // Chỉ chủ bàn mới được add AI
        if (room.hostSlot !== info.slot) return socket.emit('error-msg', { message: 'Chỉ chủ bàn mới được thêm máy!' });
        if (room.isStarted || room.players[slotIdx]) return;
        const ai = new AIPlayer(slotIdx, `Máy ${slotIdx + 1}`);
        ai.isReady = true;
        room.players[slotIdx] = ai;
        sendRoomState(room); broadcastRoomList();
        checkAllReady(room);
    });

    socket.on('kick-player', ({ slotIdx }) => {
        const info = socketRooms.get(socket.id);
        if (!info) return;
        const room = rooms[info.roomId];
        // Chỉ chủ bàn, không đang chơi, không tự kick
        if (room.hostSlot !== info.slot) return socket.emit('error-msg', { message: 'Chỉ chủ bàn mới được kick!' });
        if (room.isStarted) return socket.emit('error-msg', { message: 'Không thể kick khi đang chơi!' });
        if (slotIdx === info.slot) return;
        const target = room.players[slotIdx];
        if (!target) return;
        // Nếu kick người thật, ngắt kết nối họ khỏi bàn
        if (!target.isAI && target.socketId) {
            const targetSocket = io.sockets.sockets.get(target.socketId);
            if (targetSocket) targetSocket.emit('kicked', { message: 'Bạn đã bị chủ bàn kick!' });
            socketRooms.delete(target.socketId);
        }
        room.players[slotIdx] = null;
        sendRoomState(room); broadcastRoomList();
        checkAllReady(room);
    });

    socket.on('toggle-ready', () => {
        const info = socketRooms.get(socket.id);
        if (!info) return;
        const room = rooms[info.roomId];
        const p = room.players[info.slot];
        if (!p || p.isAI) return;
        p.isReady = !p.isReady;
        sendRoomState(room);
        checkAllReady(room);
    });

    socket.on('play-cards', ({ cardIds }) => {
        const info = socketRooms.get(socket.id);
        if (!info) return;
        const room = rooms[info.roomId];
        if (room.gameState !== 'PLAYING' || room.currentTurn !== info.slot) return;
        const player = room.players[info.slot];
        const cards = player.hand.filter(c => cardIds.includes(c.id));
        if (!cards.length) return;
        // Bàn trống thì chỉ cần bài hợp lệ, có bài thì phải chặn được
        if (room.lastPlayedCards.length > 0 && !canBeat(room.lastPlayedCards, cards)) {
            return socket.emit('error-msg', { message: 'Bài không hợp lệ!' });
        }
        if (room.lastPlayedCards.length === 0 && classify(cards).type === TYPE.INVALID) {
            return socket.emit('error-msg', { message: 'Bộ bài không hợp lệ!' });
        }
        executeMove(room, info.slot, cards);
    });

    socket.on('pass', () => {
        const info = socketRooms.get(socket.id);
        if (!info) return;
        const room = rooms[info.roomId];
        if (room.gameState !== 'PLAYING' || room.currentTurn !== info.slot) return;
        if (room.isFirstTurnOfTable) return;
        handlePass(room, info.slot);
    });

    socket.on('leave-room', () => leaveCurrentRoom(socket));
    socket.on('disconnect', () => { console.log(`- Ngắt kết nối: ${socket.id}`); leaveCurrentRoom(socket); });
});

function leaveCurrentRoom(socket) {
    const info = socketRooms.get(socket.id);
    if (!info) return;
    const room = rooms[info.roomId];
    room.players[info.slot] = null;
    socketRooms.delete(socket.id);

    // Chuyển quyền chủ bàn: tìm người thật tiếp theo theo vòng bên trái
    if (room.hostSlot === info.slot) {
        let nextHost = -1;
        for (let i = 1; i < 4; i++) {
            const idx = (info.slot + i) % 4;
            if (room.players[idx] && !room.players[idx].isAI) { nextHost = idx; break; }
        }
        room.hostSlot = nextHost; // -1 nếu chỉ còn máy
    }

    if (room.gameState === 'PLAYING') {
        const humansLeft = room.players.filter(p => p && !p.isAI).length;
        if (humansLeft === 0) {
            resetRoomIfEmpty(room);
        } else if (room.currentTurn === info.slot) { nextTurn(room); }
    } else if (room.gameState === 'COUNTDOWN') { checkAllReady(room); }

    // Kiểm tra nếu bàn chỉ còn máy
    resetRoomIfEmpty(room);
    sendRoomState(room); broadcastRoomList();
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🃏 Tiến Lên Miền Nam - Server`);
    console.log(`   Truy cập: http://localhost:${PORT}`);
    console.log(`   LAN: http://<IP-máy-bạn>:${PORT}\n`);
});
