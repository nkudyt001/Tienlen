import { classify, canBeat, TYPE } from './logic.js';

export class AIPlayer {
    constructor(id, name) {
        this.id = id;
        this.name = name;
        this.hand = [];
        this.isAI = true;
    }

    // ============================================================
    // PHÂN TÍCH BÀI TRÊN TAY - Tìm tất cả combo có thể
    // ============================================================

    /**
     * Phân tích bài trên tay, trả về tất cả combo khả dụng
     */
    analyzeHand() {
        const sorted = [...this.hand].sort((a, b) => a.absoluteValue - b.absoluteValue);
        const result = {
            singles: [],
            pairs: [],
            triples: [],
            quads: [],
            sequences: [],
            threePairsLink: [],
            fourPairsLink: [],
        };

        // Nhóm theo rank
        const byRank = {};
        sorted.forEach(c => {
            if (!byRank[c.rankIndex]) byRank[c.rankIndex] = [];
            byRank[c.rankIndex].push(c);
        });

        // Tìm tứ quý, sám cô, đôi, lẻ
        Object.values(byRank).forEach(group => {
            if (group.length === 4) result.quads.push([...group]);
            if (group.length >= 3) result.triples.push(group.slice(0, 3));
            if (group.length >= 2) result.pairs.push(group.slice(0, 2));
            group.forEach(c => result.singles.push([c]));
        });

        // Sắp xếp theo giá trị
        result.singles.sort((a, b) => a[0].absoluteValue - b[0].absoluteValue);
        result.pairs.sort((a, b) => a[0].absoluteValue - b[0].absoluteValue);
        result.triples.sort((a, b) => a[0].absoluteValue - b[0].absoluteValue);
        result.quads.sort((a, b) => a[0].absoluteValue - b[0].absoluteValue);

        // Tìm sảnh (3 lá trở lên, không chứa quân 2)
        const nonTwoRanks = [...new Set(sorted.filter(c => c.rankIndex !== 12).map(c => c.rankIndex))].sort((a, b) => a - b);
        
        // Tìm các chuỗi rank liên tiếp
        let seqStart = 0;
        for (let i = 1; i <= nonTwoRanks.length; i++) {
            if (i === nonTwoRanks.length || nonTwoRanks[i] !== nonTwoRanks[i - 1] + 1) {
                const seqRanks = nonTwoRanks.slice(seqStart, i);
                // Thử mọi sảnh từ 3 lá trở lên
                for (let len = 3; len <= seqRanks.length; len++) {
                    for (let start = 0; start <= seqRanks.length - len; start++) {
                        const ranks = seqRanks.slice(start, start + len);
                        const seqCards = ranks.map(r => {
                            // Lấy quân bài nhỏ nhất trong rank đó
                            return byRank[r][0];
                        });
                        if (classify(seqCards).type === TYPE.SEQUENCE) {
                            result.sequences.push(seqCards);
                        }
                    }
                }
                seqStart = i;
            }
        }

        // Tìm đôi thông (3 đôi thông, 4 đôi thông)
        const pairRanks = Object.entries(byRank)
            .filter(([, g]) => g.length >= 2)
            .map(([r]) => parseInt(r))
            .filter(r => r !== 12) // Không dùng quân 2
            .sort((a, b) => a - b);

        let pSeqStart = 0;
        for (let i = 1; i <= pairRanks.length; i++) {
            if (i === pairRanks.length || pairRanks[i] !== pairRanks[i - 1] + 1) {
                const consecutivePairRanks = pairRanks.slice(pSeqStart, i);
                // 3 đôi thông
                for (let start = 0; start <= consecutivePairRanks.length - 3; start++) {
                    const ranks = consecutivePairRanks.slice(start, start + 3);
                    const cards = ranks.flatMap(r => byRank[r].slice(0, 2));
                    if (classify(cards).type === TYPE.THREE_PAIRS_LINK) {
                        result.threePairsLink.push(cards);
                    }
                }
                // 4 đôi thông
                for (let start = 0; start <= consecutivePairRanks.length - 4; start++) {
                    const ranks = consecutivePairRanks.slice(start, start + 4);
                    const cards = ranks.flatMap(r => byRank[r].slice(0, 2));
                    if (classify(cards).type === TYPE.FOUR_PAIRS_LINK) {
                        result.fourPairsLink.push(cards);
                    }
                }
                pSeqStart = i;
            }
        }

        return result;
    }

    /**
     * Kiểm tra xem có đối thủ nào sắp hết bài không
     * Trả về số bài ít nhất của đối thủ
     */
    getOpponentMinCards(gameController) {
        if (!gameController) return 13;
        const room = gameController.currentRoom;
        if (!room) return 13;

        let minCards = 13;
        room.players.forEach((p, idx) => {
            if (p && idx !== this.id && p.hand && p.hand.length > 0) {
                minCards = Math.min(minCards, p.hand.length);
            }
        });
        return minCards;
    }

    /**
     * Kiểm tra xem người chơi cụ thể có bao nhiêu bài
     */
    getPlayerCardCount(gameController, playerIdx) {
        if (!gameController || !gameController.currentRoom) return 13;
        const player = gameController.currentRoom.players[playerIdx];
        return player && player.hand ? player.hand.length : 0;
    }

    // ============================================================
    // CHIẾN THUẬT KHI PHẢI CHẶN BÀI ĐỐI THỦ
    // ============================================================

    /**
     * Tìm bài chặn lẻ thông minh
     */
    findSingleBeat(lastPlayed, opponentMinCards) {
        const targetVal = lastPlayed[0].absoluteValue;
        const sorted = [...this.hand].sort((a, b) => a.absoluteValue - b.absoluteValue);
        const combos = this.analyzeHand();

        // Lọc các quân có thể chặn
        const beatable = sorted.filter(c => c.absoluteValue > targetVal);
        if (beatable.length === 0) return null;

        // Nếu đối thủ còn <= 2 bài → PHẢI chặn mạnh, dùng quân lớn nhất
        if (opponentMinCards <= 2) {
            return [beatable[beatable.length - 1]];
        }

        // Kiểm tra quân nào nằm "cô lập" (không thuộc đôi, sảnh nào) 
        // → Ưu tiên đánh quân cô lập trước
        const isolatedBeatable = beatable.filter(c => {
            // Kiểm tra xem quân này có thuộc đôi nào không
            const inPair = combos.pairs.some(p => p.some(pc => pc.id === c.id));
            // Kiểm tra xem có thuộc sảnh khả thi nào không
            const inSequence = combos.sequences.some(s => s.some(sc => sc.id === c.id));
            const inTriple = combos.triples.some(t => t.some(tc => tc.id === c.id));
            return !inPair && !inSequence && !inTriple;
        });

        if (isolatedBeatable.length > 0) {
            // Đánh quân cô lập nhỏ nhất
            return [isolatedBeatable[0]];
        }

        // Nếu không có quân cô lập, đánh quân nhỏ nhất có thể chặn
        // nhưng tránh phá đôi nếu có thể
        const notInPairBeatable = beatable.filter(c => {
            return !combos.pairs.some(p => p.some(pc => pc.id === c.id));
        });

        if (notInPairBeatable.length > 0) {
            return [notInPairBeatable[0]];
        }

        // Cuối cùng mới dùng quân nhỏ nhất (có thể phá combo)
        return [beatable[0]];
    }

    /**
     * Tìm đôi chặn thông minh
     */
    findPairBeat(lastPlayed, opponentMinCards) {
        const combos = this.analyzeHand();
        const validPairs = combos.pairs.filter(p => canBeat(lastPlayed, p));

        if (validPairs.length === 0) return null;

        // Đối thủ còn <= 2 bài → Chặn bằng đôi lớn nhất
        if (opponentMinCards <= 2) {
            return validPairs[validPairs.length - 1];
        }

        // Tránh phá đôi thông nếu có thể
        const notInPairLink = validPairs.filter(p => {
            const pRank = p[0].rankIndex;
            return !combos.threePairsLink.some(link => link.some(c => c.rankIndex === pRank))
                && !combos.fourPairsLink.some(link => link.some(c => c.rankIndex === pRank));
        });

        if (notInPairLink.length > 0) {
            return notInPairLink[0]; // Đôi nhỏ nhất không thuộc đôi thông
        }

        return validPairs[0]; // Đôi nhỏ nhất
    }

    /**
     * Tìm sảnh chặn
     */
    findSequenceBeat(lastPlayed) {
        const combos = this.analyzeHand();
        const len = lastPlayed.length;
        const validSeqs = combos.sequences.filter(s => s.length === len && canBeat(lastPlayed, s));

        if (validSeqs.length === 0) return null;

        // Dùng sảnh nhỏ nhất có thể
        validSeqs.sort((a, b) => a[a.length - 1].absoluteValue - b[b.length - 1].absoluteValue);
        return validSeqs[0];
    }

    /**
     * Tìm sám cô chặn
     */
    findTripleBeat(lastPlayed) {
        const combos = this.analyzeHand();
        const validTriples = combos.triples.filter(t => canBeat(lastPlayed, t));
        if (validTriples.length === 0) return null;
        return validTriples[0]; // Sám cô nhỏ nhất
    }

    /**
     * Tìm tứ quý chặn
     */
    findQuadBeat(lastPlayed) {
        const combos = this.analyzeHand();
        const validQuads = combos.quads.filter(q => canBeat(lastPlayed, q));
        if (validQuads.length === 0) return null;
        return validQuads[0];
    }

    /**
     * Quyết định có nên chặn hay bỏ lượt (chiến thuật)
     * Trả về true nếu nên bỏ lượt
     */
    shouldPass(bestMove, lastPlayed, opponentMinCards) {
        if (!bestMove) return true;

        // Nếu đối thủ sắp hết bài → KHÔNG BAO GIỜ bỏ lượt (trừ khi không có bài)
        if (opponentMinCards <= 3) return false;

        // Nếu mình cũng sắp hết bài → Đánh luôn
        if (this.hand.length <= 4) return false;

        const sorted = [...this.hand].sort((a, b) => a.absoluteValue - b.absoluteValue);
        const playType = classify(lastPlayed).type;

        // Nếu bài trên bàn là quân rác nhỏ (dưới 8) và mình phải dùng bài lớn (A, 2) → Cân nhắc bỏ lượt
        if (playType === TYPE.SINGLE && lastPlayed[0].rankIndex <= 5) {
            // Quân nhỏ nhất có thể chặn
            const minBeatCard = bestMove[0];
            // Nếu phải dùng A hoặc 2 để chặn quân nhỏ → Bỏ lượt
            if (minBeatCard.rankIndex >= 11 && this.hand.length > 6) {
                return true;
            }
        }

        // Nếu bài trên bàn là đôi nhỏ và mình phải phá combo mạnh → Bỏ lượt
        if (playType === TYPE.PAIR && lastPlayed[0].rankIndex <= 4) {
            const combos = this.analyzeHand();
            // Kiểm tra xem đôi này có thuộc đôi thông không
            const pairRank = bestMove[0].rankIndex;
            const breaksPairLink = combos.threePairsLink.some(link => link.some(c => c.rankIndex === pairRank))
                || combos.fourPairsLink.some(link => link.some(c => c.rankIndex === pairRank));
            if (breaksPairLink && this.hand.length > 6) {
                return true;
            }
        }

        return false;
    }

    // ============================================================
    // CHIẾN THUẬT KHI ĐƯỢC ĐÁNH TỰ DO (BÀN TRỐNG)
    // ============================================================

    /**
     * Chọn bài đánh khi bàn trống - ĐÂY LÀ CHIẾN THUẬT QUAN TRỌNG NHẤT
     */
    chooseFreePlay(opponentMinCards) {
        const combos = this.analyzeHand();
        const sorted = [...this.hand].sort((a, b) => a.absoluteValue - b.absoluteValue);

        // === TRƯỜNG HỢP ĐẶC BIỆT: Còn ít bài ===

        // Nếu còn 1 bài → Đánh luôn
        if (this.hand.length === 1) return [this.hand[0]];

        // Nếu còn 2 bài → Kiểm tra có phải đôi không
        if (this.hand.length === 2 && combos.pairs.length > 0) {
            return combos.pairs[0]; // Đánh đôi để về nhất
        }

        // Nếu còn đúng 1 combo (đôi/sảnh/sám cô) bao gồm tất cả bài → Đánh hết
        if (this.hand.length <= 4) {
            const allCards = classify(this.hand);
            if (allCards.type !== TYPE.INVALID) return [...this.hand];
        }

        // === ĐỐI THỦ SẮP HẾT BÀI → Chiến thuật phòng thủ ===
        if (opponentMinCards <= 2) {
            return this.defensivePlay(combos, sorted, opponentMinCards);
        }

        // === CHIẾN THUẬT BÌNH THƯỜNG ===
        return this.normalFreePlay(combos, sorted);
    }

    /**
     * Chiến thuật phòng thủ khi đối thủ sắp hết bài
     */
    defensivePlay(combos, sorted, opponentMinCards) {
        // MỤC TIÊU: Đánh bài lớn để đối thủ không chặn được
        // và hạn chế đánh đôi (vì đối thủ còn 1-2 bài thì ít khi có đôi)

        // Đối thủ còn 1 quân:
        // → Đánh quân lớn nhất (heo, A) để giữ quyền chủ động
        // → TUYỆT ĐỐI KHÔNG đánh quân nhỏ (vì đối thủ có thể chặn được)
        if (opponentMinCards === 1) {
            // Ưu tiên đánh đôi hoặc sảnh (vì đối thủ có 1 quân không thể chặn đôi/sảnh)
            // → Đối thủ bị buộc phải bỏ lượt
            if (combos.pairs.length > 0) {
                // Đánh đôi nhỏ nhất (đối thủ 1 quân không chặn được đôi)
                return combos.pairs[0];
            }
            if (combos.sequences.length > 0) {
                return combos.sequences[0];
            }
            if (combos.triples.length > 0) {
                return combos.triples[0];
            }
            // Buộc phải đánh lẻ → Đánh quân lớn nhất
            return [sorted[sorted.length - 1]];
        }

        // Đối thủ còn 2 quân:
        // → Họ có thể có đôi hoặc 2 lẻ
        // → Đánh sảnh hoặc sám cô (họ không chặn được)
        // → Nếu đánh lẻ, đánh quân lớn (A, 2)
        // → Hạn chế đánh đôi nhỏ (họ có thể có đôi lớn hơn)
        if (opponentMinCards === 2) {
            // Ưu tiên sảnh (đối thủ 2 quân không chặn được sảnh 3+)
            if (combos.sequences.length > 0) {
                return combos.sequences[0];
            }
            if (combos.triples.length > 0) {
                return combos.triples[0];
            }
            // Đánh đôi lớn (A hoặc 2) để chặn đôi của đối thủ
            const bigPairs = combos.pairs.filter(p => p[0].rankIndex >= 11); // A, 2
            if (bigPairs.length > 0) {
                return bigPairs[bigPairs.length - 1]; // Đôi lớn nhất
            }
            // Đánh lẻ lớn
            return [sorted[sorted.length - 1]];
        }

        // Đối thủ còn 3 quân → Đánh bài cẩn thận
        if (combos.sequences.length > 0) {
            return combos.sequences[0];
        }
        // Đánh quân lớn nhất
        return [sorted[sorted.length - 1]];
    }

    /**
     * Chiến thuật bình thường khi đánh tự do
     */
    normalFreePlay(combos, sorted) {
        // Chiến thuật: Ưu tiên xả combo dài trước (sảnh, đôi thông)
        // → Giảm nhanh số quân trên tay
        // → Giữ bài lớn (heo, A) để phòng thủ cuối ván

        // Bước 1: Ưu tiên đánh bộ đặc biệt nếu có (giảm nhiều bài)
        if (combos.fourPairsLink.length > 0) return combos.fourPairsLink[0];
        if (combos.threePairsLink.length > 0) return combos.threePairsLink[0];

        // Bước 2: Đánh sảnh dài nhất (giảm nhiều bài nhất)
        if (combos.sequences.length > 0) {
            const longestSeq = combos.sequences.reduce((best, s) => s.length > best.length ? s : best);
            return longestSeq;
        }

        // Bước 3: Đánh sám cô nếu có
        if (combos.triples.length > 0) {
            return combos.triples[0];
        }

        // Bước 4: Đánh đôi nhỏ nhất
        if (combos.pairs.length > 0) {
            // Tránh đánh đôi heo (giữ lại để phòng thủ)
            const nonHeoPairs = combos.pairs.filter(p => p[0].rankIndex !== 12);
            if (nonHeoPairs.length > 0) return nonHeoPairs[0];
        }

        // Bước 5: Cuối cùng mới đánh rác
        // Tìm quân lẻ cô lập nhỏ nhất (không thuộc combo nào)
        const isolated = sorted.filter(c => {
            const inPair = combos.pairs.some(p => p.some(pc => pc.id === c.id));
            const inSeq = combos.sequences.some(s => s.some(sc => sc.id === c.id));
            const inTriple = combos.triples.some(t => t.some(tc => tc.id === c.id));
            return !inPair && !inSeq && !inTriple;
        });

        if (isolated.length > 0) {
            // Đánh quân cô lập nhỏ nhất, nhưng tránh heo
            const nonHeoIsolated = isolated.filter(c => c.rankIndex !== 12);
            if (nonHeoIsolated.length > 0) return [nonHeoIsolated[0]];
        }

        // Fallback: Đánh quân nhỏ nhất (tránh heo nếu có thể)
        const nonHeo = sorted.filter(c => c.rankIndex !== 12);
        if (nonHeo.length > 0) return [nonHeo[0]];

        return [sorted[0]];
    }

    // ============================================================
    // QUYẾT ĐỊNH CHÍNH
    // ============================================================

    /**
     * Logic máy đánh bài thông minh
     * @param {Array} lastPlayed - Bài trên bàn hiện tại
     * @param {Object} gameController - Tham chiếu đến GameController để biết thông tin đối thủ
     */
    async decideMove(lastPlayed, gameController) {
        // Delay 1-2s cho giống người chơi đang nghĩ
        const thinkTime = 800 + Math.random() * 1200;
        await new Promise(resolve => setTimeout(resolve, thinkTime));

        // Sắp xếp bài
        this.hand.sort((a, b) => a.absoluteValue - b.absoluteValue);

        // Lấy thông tin đối thủ
        const opponentMinCards = this.getOpponentMinCards(gameController);

        // === BÀN TRỐNG: Được quyền đánh tự do ===
        if (!lastPlayed || lastPlayed.length === 0) {
            return this.chooseFreePlay(opponentMinCards);
        }

        // === CÓ BÀI TRÊN BÀN: Phải chặn ===
        const oldType = classify(lastPlayed);
        let bestMove = null;

        switch (oldType.type) {
            case TYPE.SINGLE:
                bestMove = this.findSingleBeat(lastPlayed, opponentMinCards);
                break;
            case TYPE.PAIR:
                bestMove = this.findPairBeat(lastPlayed, opponentMinCards);
                break;
            case TYPE.TRIPLE:
                bestMove = this.findTripleBeat(lastPlayed);
                break;
            case TYPE.SEQUENCE:
                bestMove = this.findSequenceBeat(lastPlayed);
                break;
            case TYPE.FOUR_QUADS:
                bestMove = this.findQuadBeat(lastPlayed);
                break;
            case TYPE.THREE_PAIRS_LINK: {
                // Chặn ba đôi thông bằng ba đôi thông lớn hơn hoặc tứ quý
                const combos = this.analyzeHand();
                const validLinks = combos.threePairsLink.filter(l => canBeat(lastPlayed, l));
                if (validLinks.length > 0) {
                    bestMove = validLinks[0];
                } else {
                    // Thử tứ quý
                    const validQuads = combos.quads.filter(q => canBeat(lastPlayed, q));
                    if (validQuads.length > 0) bestMove = validQuads[0];
                }
                break;
            }
            case TYPE.FOUR_PAIRS_LINK: {
                const combos = this.analyzeHand();
                const validLinks = combos.fourPairsLink.filter(l => canBeat(lastPlayed, l));
                if (validLinks.length > 0) bestMove = validLinks[0];
                break;
            }
        }

        // Nếu đối thủ sắp hết bài → Thử dùng bộ đặc biệt chặt heo
        if (opponentMinCards <= 2 && oldType.type === TYPE.SINGLE && lastPlayed[0].rankIndex === 12) {
            const combos = this.analyzeHand();
            // Thử 3 đôi thông, tứ quý, 4 đôi thông
            if (combos.threePairsLink.length > 0 && canBeat(lastPlayed, combos.threePairsLink[0])) {
                return combos.threePairsLink[0];
            }
            if (combos.quads.length > 0 && canBeat(lastPlayed, combos.quads[0])) {
                return combos.quads[0];
            }
            if (combos.fourPairsLink.length > 0 && canBeat(lastPlayed, combos.fourPairsLink[0])) {
                return combos.fourPairsLink[0];
            }
        }

        // Quyết định có nên pass hay không
        if (this.shouldPass(bestMove, lastPlayed, opponentMinCards)) {
            return null;
        }

        return bestMove;
    }
}
