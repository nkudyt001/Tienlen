import { Card } from './card.js';
import { canBeat, classify, TYPE } from './logic.js';

// Tạo Card object từ dữ liệu server
function cardFromData(d) { return new Card(d.rankIndex, d.suitIndex); }

class GameClient {
    constructor(playerName) {
        this.socket = io();
        this.playerName = playerName;
        this.mySlot = -1;
        this.roomId = null;
        this.myHand = [];
        this.players = [null, null, null, null];
        this.currentTurn = -1;
        this.lastPlayedCards = [];
        this.lastPlayerToPlay = -1;
        this.isFirstTurnOfTable = false;
        this.gameState = 'LOBBY';
        this.selectedCardIds = new Set();
        this.timerInterval = null;
        this.timerSeconds = 30;
        this.hostSlot = -1;

        // DOM
        this.lobbyScreen = document.getElementById('lobby-screen');
        this.gameScreen = document.getElementById('game-container');
        this.tableGrid = document.getElementById('table-grid');
        this.enterTableBtn = document.getElementById('enter-table-btn');
        this.readyBtn = document.getElementById('ready-btn');
        this.leaveBtn = document.getElementById('leave-room-btn');
        this.countdownEl = document.getElementById('start-countdown');
        this.gameActions = document.getElementById('game-actions');
        this.playerHandEl = document.getElementById('player-hand');
        this.boardEl = document.getElementById('last-played-cards');
        this.statusEl = document.getElementById('status-message');
        this.playBtn = document.getElementById('play-btn');
        this.passBtn = document.getElementById('pass-btn');
        this.winnerEl = document.getElementById('winner-message');
        this.mainTimer = document.getElementById('player-main-timer');

        this.setupSocket();
        this.setupUI();
    }

    // ==================== DISPLAY MAPPING ====================
    // Server slot -> Display slot (0=bottom/me, 1=right, 2=top, 3=left)
    // HTML: slot-0=bottom, slot-1=right, slot-2=top, slot-3=left
    serverToDisplay(serverSlot) {
        const offset = (serverSlot - this.mySlot + 4) % 4;
        return [0, 1, 2, 3][offset]; // 0=me, 1=right, 2=across, 3=left
    }
    displayDomId(displayIdx) {
        // display 0=me(slot-0), 1=right(slot-1), 2=top(slot-2), 3=left(slot-3)
        return `slot-${displayIdx}`;
    }

    // ==================== SOCKET EVENTS ====================
    setupSocket() {
        this.socket.on('room-list', (rooms) => this.renderLobby(rooms));

        this.socket.on('room-state', (state) => {
            this.mySlot = state.yourSlot;
            this.players = state.players;
            this.gameState = state.gameState;
            this.currentTurn = state.currentTurn;
            this.lastPlayedCards = state.lastPlayedCards.map(cardFromData);
            this.lastPlayerToPlay = state.lastPlayerToPlay;
            this.isFirstTurnOfTable = state.isFirstTurnOfTable;
            this.myHand = state.yourHand.map(cardFromData);
            this.myHand.sort((a, b) => a.absoluteValue - b.absoluteValue);
            if (state.hostSlot !== undefined) this.hostSlot = state.hostSlot;

            // Reset UI khi ván kết thúc và chuyển về WAITING
            if (state.gameState === 'WAITING') {
                this.selectedCardIds.clear();
                this.boardEl.innerHTML = '';
                this.readyBtn.classList.remove('hidden');
                this.readyBtn.innerText = 'Sẵn Sàng';
                this.playBtn.classList.add('hidden');
                this.passBtn.classList.add('hidden');
                this.gameActions.classList.remove('hidden');
                this.mainTimer.parentElement.classList.add('hidden');
                this.stopLocalTimer();
                this.statusEl.innerText = 'Sẵn sàng để bắt đầu ván mới';
            }

            this.renderRoomSlots();
            this.renderPlayerHand();
            this.updateControls();
        });

        this.socket.on('game-started', async (data) => {
            this.mySlot = data.yourSlot;
            this.players = data.players;
            this.currentTurn = data.currentTurn;
            this.myHand = data.yourHand.map(cardFromData);
            this.myHand.sort((a, b) => a.absoluteValue - b.absoluteValue);
            this.gameState = 'PLAYING';
            this.lastPlayedCards = [];
            this.lastPlayerToPlay = -1;
            this.selectedCardIds.clear();
            if (data.hostSlot !== undefined) this.hostSlot = data.hostSlot;

            this.readyBtn.classList.add('hidden');
            this.gameActions.classList.add('hidden'); // Ẩn controls khi đang chia
            this.countdownEl.classList.add('hidden');
            this.boardEl.innerHTML = '';
            this.playerHandEl.innerHTML = '';
            this.statusEl.innerText = 'Đang chia bài...';
            this.renderRoomSlots();

            // Hiệu ứng chia bài
            await this.animateDeal();

            // Chia xong -> hiện controls và tay bài
            this.gameActions.classList.remove('hidden');
            this.playBtn.classList.remove('hidden');
            this.passBtn.classList.remove('hidden');
            this.statusEl.innerText = 'Chia bài xong!';
            this.renderPlayerHand();
        });

        this.socket.on('turn-start', (data) => {
            this.currentTurn = data.currentTurn;
            this.lastPlayedCards = data.lastPlayedCards.map(cardFromData);
            this.lastPlayerToPlay = data.lastPlayerToPlay;
            this.isFirstTurnOfTable = data.isFirstTurnOfTable;
            if (data.players) this.players = data.players;

            const isMyTurn = data.currentTurn === this.mySlot;
            this.statusEl.innerText = isMyTurn ? 'Lượt của bạn!' : `Lượt của: ${data.playerName}`;
            this.startLocalTimer(data.timerSeconds || 30);
            this.renderRoomSlots();
            this.updateControls();
        });

        this.socket.on('move-made', (data) => {
            const cards = data.cards.map(cardFromData);
            if (data.players) this.players = data.players;

            // Hiệu ứng bay bài (Lấy tọa độ trước khi xoá khỏi DOM)
            this.animateCardsToBoard(data.slotIdx, cards);

            // Nếu là bài của mình, xóa khỏi tay
            if (data.slotIdx === this.mySlot) {
                const ids = cards.map(c => c.id);
                this.myHand = this.myHand.filter(c => !ids.includes(c.id));
                ids.forEach(id => this.selectedCardIds.delete(id));
                this.renderPlayerHand();
            }
        });

        this.socket.on('player-passed', (data) => {
            this.statusEl.innerText = `${data.playerName} bỏ lượt.`;
            if (data.players) this.players = data.players;
            this.renderRoomSlots();
        });

        this.socket.on('round-won', (data) => {
            this.statusEl.innerText = 'Vòng mới!';
            this.boardEl.innerHTML = '';
            this.lastPlayedCards = [];
        });

        this.socket.on('game-ended', (data) => {
            this.gameState = 'ENDED';
            this.stopLocalTimer();
            this.playBtn.classList.add('hidden');
            this.passBtn.classList.add('hidden');
            this.mainTimer.parentElement.classList.add('hidden');

            if (this.winnerEl) {
                if (data.loserSlot !== undefined && data.loserSlot !== -1) {
                    if (data.loserSlot === this.mySlot) {
                        this.winnerEl.innerText = 'BẠN BỊ XỬ THUA (THỐI 2)!';
                        this.winnerEl.style.color = '#ff4d4d';
                        this.winnerEl.style.textShadow = '0 0 50px #ff4d4d, 0 0 10px #000';
                    } else if (data.winnerSlot === this.mySlot) {
                        this.winnerEl.innerText = `BẠN THẮNG (${data.loserName.toUpperCase()} THỐI 2)!`;
                        this.winnerEl.style.color = 'var(--accent-gold)';
                        this.winnerEl.style.textShadow = '0 0 50px var(--accent-gold), 0 0 10px #000';
                    } else {
                        this.winnerEl.innerText = `${data.loserName.toUpperCase()} BỊ XỬ THUA (THỐI 2)!`;
                        this.winnerEl.style.color = '#ff4d4d';
                        this.winnerEl.style.textShadow = '0 0 50px #ff4d4d, 0 0 10px #000';
                    }
                } else {
                    this.winnerEl.innerText = data.winnerSlot === this.mySlot ? 'BẠN ĐÃ THẮNG!' : `${data.winnerName.toUpperCase()} THẮNG!`;
                    this.winnerEl.style.color = 'var(--accent-gold)';
                    this.winnerEl.style.textShadow = '0 0 50px var(--accent-gold), 0 0 10px #000';
                }
                this.winnerEl.classList.remove('hidden');
                setTimeout(() => this.winnerEl.classList.add('hidden'), 3500);
            }
        });

        this.socket.on('countdown', ({ count }) => {
            this.gameState = 'COUNTDOWN';
            this.countdownEl.classList.remove('hidden');
            this.countdownEl.innerText = count;
            if (count <= 0) this.countdownEl.classList.add('hidden');
        });

        this.socket.on('countdown-stop', () => {
            this.countdownEl.classList.add('hidden');
            this.gameState = 'WAITING';
        });

        this.socket.on('timer-tick', ({ seconds, currentTurn }) => {
            this.timerSeconds = seconds;
            // Cập nhật timer hiển thị
            const displayIdx = this.serverToDisplay(currentTurn);
            const timerEl = document.getElementById(`timer-${displayIdx}`);
            if (timerEl) timerEl.innerText = seconds;
            if (currentTurn === this.mySlot && this.mainTimer) this.mainTimer.innerText = seconds;
        });

        this.socket.on('error-msg', ({ message }) => alert(message));

        // Bị chủ bàn kick
        this.socket.on('kicked', ({ message }) => {
            alert(message);
            this.roomId = null;
            this.gameState = 'LOBBY';
            this.gameScreen.classList.add('hidden');
            this.lobbyScreen.classList.remove('hidden');
        });
    }

    // ==================== UI EVENTS ====================
    setupUI() {
        this.leaveBtn.onclick = () => {
            this.socket.emit('leave-room');
            this.roomId = null;
            this.gameState = 'LOBBY';
            this.gameScreen.classList.add('hidden');
            this.lobbyScreen.classList.remove('hidden');
        };
        this.enterTableBtn.onclick = () => {
            this.socket.emit('join-room', { roomId: this.roomId, playerName: this.playerName });
            this.enterTableBtn.classList.add('hidden');
            this.gameActions.classList.remove('hidden');
            this.readyBtn.classList.remove('hidden');
            this.playBtn.classList.add('hidden');
            this.passBtn.classList.add('hidden');
        };
        this.readyBtn.onclick = () => this.socket.emit('toggle-ready');
        this.playBtn.onclick = () => this.handlePlay();
        this.passBtn.onclick = () => this.socket.emit('pass');
    }

    // ==================== LOBBY ====================
    renderLobby(rooms) {
        this.tableGrid.innerHTML = '';
        rooms.forEach(room => {
            const card = document.createElement('div');
            card.className = `table-card ${room.isStarted ? 'playing' : ''}`;
            const statusText = room.isStarted ? '<span style="color: #ff4d4d">ĐANG CHƠI</span>' : 'Đang chờ';
            card.innerHTML = `<h3>BÀN ${room.id}</h3><div class="player-info">${room.playerCount}/4 Người chơi</div><div class="room-status">${statusText}</div>`;
            card.onclick = () => {
                if (room.isStarted) return alert('Bàn đang chơi!');
                this.showRoom(room.id);
            };
            this.tableGrid.appendChild(card);
        });
    }

    showRoom(roomId) {
        this.roomId = roomId;
        this.lobbyScreen.classList.add('hidden');
        this.gameScreen.classList.remove('hidden');
        this.enterTableBtn.classList.remove('hidden');
        this.gameActions.classList.add('hidden');
        this.boardEl.innerHTML = '';
        this.playerHandEl.innerHTML = '';
        this.gameState = 'LOBBY_PREVIEW';
        document.getElementById('room-id-display').innerText = roomId;
        this.statusEl.innerText = 'Bấm vào giữa bàn để vào ván';
        // Request room state
        this.socket.emit('join-room', { roomId, playerName: this.playerName });
        this.enterTableBtn.classList.add('hidden');
        this.gameActions.classList.remove('hidden');
        this.readyBtn.classList.remove('hidden');
        this.readyBtn.innerText = 'Sẵn Sàng';
        this.playBtn.classList.add('hidden');
        this.passBtn.classList.add('hidden');
    }

    // ==================== RENDER ====================
    renderRoomSlots() {
        const isHost = this.mySlot === this.hostSlot;

        for (let displayIdx = 0; displayIdx < 4; displayIdx++) {
            const slotEl = document.getElementById(this.displayDomId(displayIdx));
            if (!slotEl) continue;

            const serverSlot = (this.mySlot + [0, 1, 2, 3][displayIdx]) % 4;
            const player = this.players[serverSlot];

            if (!player) {
                const isPlaying = this.gameState === 'PLAYING' || this.gameState === 'ENDED';
                // Chỉ chủ bàn mới thấy nút + add AI
                const canAdd = !isPlaying && displayIdx !== 0 && isHost;
                slotEl.innerHTML = `
                    <div class="slot-content empty">
                        ${canAdd ? `<button class="add-ai-btn" data-slot="${serverSlot}">+</button>` : ''}
                        <span>Trống</span>
                    </div>`;
                const btn = slotEl.querySelector('.add-ai-btn');
                if (btn) btn.onclick = (e) => { e.stopPropagation(); this.socket.emit('add-ai', { slotIdx: serverSlot }); };
            } else {
                const avatar = player.isAI ? '🤖' : '👤';
                const isActive = this.currentTurn === serverSlot && (this.gameState === 'PLAYING');
                const showReady = player.isReady && (this.gameState === 'WAITING' || this.gameState === 'COUNTDOWN');
                const isPlaying = this.gameState === 'PLAYING' || this.gameState === 'ENDED';
                const cardCountText = isPlaying ? ` <span class="card-count">(${player.cardCount} lá)</span>` : '';
                const hostTag = player.isHost ? '<span class="host-tag">Chủ bàn</span>' : '';
                // Nút kick: chỉ chủ bàn thấy, không tự kick, không kick khi đang chơi
                const showKick = isHost && displayIdx !== 0 && !isPlaying;

                slotEl.innerHTML = `
                    <div class="slot-content ${showReady ? 'is-ready' : ''} ${isActive ? 'active' : ''}">
                        <div class="avatar">${avatar}</div>
                        <div class="info">
                            ${hostTag}
                            <span class="name">${displayIdx === 0 ? player.name + ' (Bạn)' : player.name}${cardCountText}</span>
                            <span class="ready-tag">Sẵn sàng</span>
                            <div class="player-timer ${isActive ? '' : 'hidden'}" id="timer-${displayIdx}">${this.timerSeconds}</div>
                        </div>
                        ${showKick ? `<button class="kick-btn" data-slot="${serverSlot}">✕</button>` : ''}
                    </div>`;

                // Gắn event kick
                const kickBtn = slotEl.querySelector('.kick-btn');
                if (kickBtn) kickBtn.onclick = (e) => { e.stopPropagation(); this.socket.emit('kick-player', { slotIdx: serverSlot }); };

                if (displayIdx === 0 && (this.gameState === 'WAITING' || this.gameState === 'COUNTDOWN')) {
                    this.readyBtn.innerText = player.isReady ? 'Bỏ Sẵn Sàng' : 'Sẵn Sàng';
                }
            }
        }
    }

    renderPlayerHand() {
        this.playerHandEl.innerHTML = '';
        this.myHand.sort((a, b) => a.absoluteValue - b.absoluteValue);
        this.myHand.forEach((card, index) => {
            const el = card.render();
            el.style.zIndex = index + 1;
            if (this.selectedCardIds.has(card.id)) el.classList.add('selected');
            el.onclick = () => {
                if (this.gameState !== 'PLAYING') return;
                if (el.classList.toggle('selected')) this.selectedCardIds.add(card.id);
                else this.selectedCardIds.delete(card.id);
                this.updateControls();
            };
            this.playerHandEl.appendChild(el);
        });
    }

    updateControls() {
        if (this.gameState !== 'PLAYING') {
            this.playBtn.disabled = true;
            this.passBtn.disabled = true;
            return;
        }
        const isMyTurn = this.currentTurn === this.mySlot;
        if (!isMyTurn) {
            this.playBtn.disabled = true; this.passBtn.disabled = true; return;
        }

        const selected = this.myHand.filter(c => this.selectedCardIds.has(c.id));
        const valid = canBeat(this.lastPlayedCards, selected);
        this.playBtn.disabled = !valid;
        this.passBtn.disabled = this.isFirstTurnOfTable || this.lastPlayerToPlay === -1;

        // Hiển thị timer khi là lượt mình
        this.mainTimer.parentElement.classList.remove('hidden');
    }

    handlePlay() {
        const selected = this.myHand.filter(c => this.selectedCardIds.has(c.id));
        if (!selected.length) return;
        this.socket.emit('play-cards', { cardIds: selected.map(c => c.id) });
    }

    // ==================== ANIMATIONS ====================
    async animateDeal() {
        const boardRect = this.boardEl.getBoundingClientRect();
        const startX = boardRect.left + boardRect.width / 2 - 45;
        const startY = boardRect.top + boardRect.height / 2 - 65;

        // Lấy vị trí 4 slot
        const slotRects = [];
        for (let d = 0; d < 4; d++) {
            const el = document.getElementById(this.displayDomId(d));
            slotRects[d] = el ? el.getBoundingClientRect() : boardRect;
        }

        // Chia 13 quân x 4 người, xoay vòng
        const totalCards = this.players.filter(p => p).length * 13;
        const activeDisplaySlots = [];
        for (let d = 0; d < 4; d++) {
            const sSlot = (this.mySlot + d) % 4;
            if (this.players[sSlot]) activeDisplaySlots.push(d);
        }

        for (let i = 0; i < 13; i++) {
            for (const displayIdx of activeDisplaySlots) {
                const animCard = document.createElement('div');
                animCard.className = 'card card-back card-animation';
                animCard.style.left = `${startX}px`;
                animCard.style.top = `${startY}px`;
                animCard.style.transform = 'scale(0.3)';
                animCard.style.zIndex = 1000;
                document.body.appendChild(animCard);

                const targetRect = slotRects[displayIdx];
                void animCard.offsetWidth;
                animCard.style.left = `${targetRect.left + targetRect.width / 2 - 45}px`;
                animCard.style.top = `${targetRect.top + targetRect.height / 2 - 65}px`;
                animCard.style.transform = 'scale(1) rotate(360deg)';

                setTimeout(() => animCard.remove(), 300);
                await new Promise(r => setTimeout(r, 60));
            }
        }
        // Đợi animation cuối bay xong
        await new Promise(r => setTimeout(r, 300));
    }

    animateCardsToBoard(serverSlot, cards) {
        const boardRect = this.boardEl.getBoundingClientRect();
        const targetX = boardRect.left + boardRect.width / 2;
        const targetY = boardRect.top + boardRect.height / 2;
        const displayIdx = this.serverToDisplay(serverSlot);

        let startRect;
        if (serverSlot === this.mySlot) {
            startRect = this.playerHandEl.getBoundingClientRect();
        } else {
            const slotEl = document.getElementById(this.displayDomId(displayIdx));
            startRect = slotEl ? slotEl.getBoundingClientRect() : boardRect;
        }

        const animPromises = cards.map((card, i) => {
            const animCard = card.render();
            animCard.classList.add('card-animation');
            animCard.style.margin = '0'; // Fix margin offset

            let startX = startRect.left + startRect.width / 2 - 45;
            let startY = startRect.top;

            if (serverSlot === this.mySlot) {
                const domCard = this.playerHandEl.querySelector(`[data-id="${card.id}"]`);
                if (domCard) {
                    const rect = domCard.getBoundingClientRect();
                    startX = rect.left;
                    startY = rect.top;
                }
            }

            animCard.style.left = `${startX}px`;
            animCard.style.top = `${startY}px`;
            animCard.style.zIndex = 1000 + i;
            document.body.appendChild(animCard);

            return new Promise(resolve => {
                void animCard.offsetWidth;
                animCard.style.left = `${targetX - 45 + (i - cards.length / 2) * 30}px`;
                animCard.style.top = `${targetY - 65}px`;
                animCard.style.transform = `rotate(${Math.random() * 20 - 10}deg)`;
                setTimeout(() => { animCard.remove(); resolve(); }, 500);
            });
        });

        Promise.all(animPromises).then(() => {
            this.boardEl.innerHTML = '';
            const sorted = [...cards].sort((a, b) => a.absoluteValue - b.absoluteValue);
            const combo = classify(sorted);

            if (combo.type === TYPE.THREE_PAIRS_LINK || combo.type === TYPE.FOUR_PAIRS_LINK) {
                // Đôi thông: hiển thị từng đôi thành nhóm, cách nhau
                for (let i = 0; i < sorted.length; i += 2) {
                    const pairGroup = document.createElement('div');
                    pairGroup.className = 'pair-group';
                    for (let j = i; j < i + 2 && j < sorted.length; j++) {
                        const el = sorted[j].render();
                        el.style.marginLeft = j === i ? '0' : '-40px';
                        pairGroup.appendChild(el);
                    }
                    this.boardEl.appendChild(pairGroup);
                }
            } else if (combo.type === TYPE.SEQUENCE) {
                // Sảnh: xếp ngang gọn gàng, overlap vừa phải
                sorted.forEach((card, i) => {
                    const el = card.render();
                    el.style.marginLeft = i === 0 ? '0' : '-50px';
                    this.boardEl.appendChild(el);
                });
            } else {
                // Rác, đôi, sám, tứ quý: giữ nguyên kiểu cũ
                cards.forEach((card, i) => {
                    const el = card.render();
                    el.style.marginLeft = i === 0 ? '0' : '-30px';
                    el.style.transform = `rotate(${Math.random() * 10 - 5}deg)`;
                    this.boardEl.appendChild(el);
                });
            }
            this.renderRoomSlots();
        });
    }

    // ==================== TIMER ====================
    startLocalTimer(seconds) {
        this.stopLocalTimer();
        this.timerSeconds = seconds;
        if (this.currentTurn === this.mySlot) {
            this.mainTimer.parentElement.classList.remove('hidden');
            this.mainTimer.innerText = seconds;
        }
    }
    stopLocalTimer() {
        if (this.timerInterval) { clearInterval(this.timerInterval); this.timerInterval = null; }
    }
}

// ==================== INIT ====================
window.addEventListener('DOMContentLoaded', () => {
    const nameDialog = document.getElementById('name-dialog');
    const nameInput = document.getElementById('player-name-input');
    const nameConfirm = document.getElementById('name-confirm-btn');

    nameConfirm.onclick = () => {
        const name = nameInput.value.trim() || 'Người chơi';
        nameDialog.classList.add('hidden');
        document.getElementById('lobby-screen').classList.remove('hidden');
        document.getElementById('user-greeting').innerText = `Xin chào, ${name}!`;
        window.game = new GameClient(name);
    };

    nameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') nameConfirm.click();
    });
});
