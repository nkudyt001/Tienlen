// src/logic.js
// Các hằng số về loại bộ bài
export const TYPE = {
    INVALID: 0,
    SINGLE: 1,
    PAIR: 2,
    TRIPLE: 3,
    SEQUENCE: 4,
    THREE_PAIRS_LINK: 5,
    FOUR_QUADS: 6,
    FOUR_PAIRS_LINK: 7
};

/**
 * Phân loại bộ bài được đánh ra.
 * Trả về { type, highestValue, length }
 */
export function classify(cards) {
    if (!cards || cards.length === 0) return { type: TYPE.INVALID };
    
    // Sắp xếp bài theo giá trị tuyệt đối
    const sorted = [...cards].sort((a, b) => a.absoluteValue - b.absoluteValue);
    const n = sorted.length;
    const highest = sorted[n - 1];

    // 1. Rác (Single)
    if (n === 1) return { type: TYPE.SINGLE, highestValue: highest.absoluteValue };

    // 2. Đôi (Pair)
    if (n === 2 && sorted[0].rankIndex === sorted[1].rankIndex) {
        return { type: TYPE.PAIR, highestValue: highest.absoluteValue };
    }

    // 3. Sám cô (Triple)
    if (n === 3 && sorted[0].rankIndex === sorted[1].rankIndex && sorted[1].rankIndex === sorted[2].rankIndex) {
        return { type: TYPE.TRIPLE, highestValue: highest.absoluteValue };
    }

    // 4. Sảnh (Sequence) - Ít nhất 3 lá liên tiếp, không chứa heo (2)
    if (n >= 3) {
        let isSeq = true;
        for (let i = 0; i < n - 1; i++) {
            // Rank liên tiếp và không có quân 2 (index 12)
            if (sorted[i].rankIndex + 1 !== sorted[i+1].rankIndex || sorted[i+1].rankIndex === 12) {
                isSeq = false;
                break;
            }
        }
        if (isSeq) return { type: TYPE.SEQUENCE, highestValue: highest.absoluteValue, length: n };
    }

    // 5. Tứ quý (Four Quads)
    if (n === 4 && sorted.every(c => c.rankIndex === sorted[0].rankIndex)) {
        return { type: TYPE.FOUR_QUADS, highestValue: highest.absoluteValue };
    }

    // 6. Đôi thông (Pairs Link)
    if (n >= 6 && n % 2 === 0) {
        let isPairsLink = true;
        for (let i = 0; i < n; i += 2) {
            // Mỗi cặp phải là một đôi
            if (sorted[i].rankIndex !== sorted[i+1].rankIndex) {
                isPairsLink = false;
                break;
            }
            // Các giá trị rank của các đôi phải liên tiếp
            if (i > 0 && sorted[i].rankIndex !== sorted[i-1].rankIndex + 1) {
                isPairsLink = false;
                break;
            }
        }
        if (isPairsLink) {
            const numPairs = n / 2;
            if (numPairs === 3) return { type: TYPE.THREE_PAIRS_LINK, highestValue: highest.absoluteValue };
            if (numPairs === 4) return { type: TYPE.FOUR_PAIRS_LINK, highestValue: highest.absoluteValue };
            // Trường hợp > 4 đôi thông vẫn được tính nhưng cơ bản xử lý 3 và 4
            return { type: TYPE.FOUR_PAIRS_LINK, highestValue: highest.absoluteValue, numPairs };
        }
    }

    return { type: TYPE.INVALID };
}

/**
 * Kiểm tra xem bộ bài mới có đè được bộ bài cũ không
 */
export function canBeat(lastPlayed, newPlayed) {
    const old = classify(lastPlayed);
    const curr = classify(newPlayed);

    if (curr.type === TYPE.INVALID) return false;

    // Nếu bàn đang trống, chỉ cần bài hợp lệ
    if (!lastPlayed || lastPlayed.length === 0) return true;

    // Quy tắc chặt heo và hàng
    const isOldHeo = old.type === TYPE.SINGLE && lastPlayed[0].rankIndex === 12;
    const isOldDoiHeo = old.type === TYPE.PAIR && lastPlayed[0].rankIndex === 12;

    // Đôi thông / Tứ quý chặt heo
    if (isOldHeo) {
        if (curr.type === TYPE.THREE_PAIRS_LINK || curr.type === TYPE.FOUR_QUADS || curr.type === TYPE.FOUR_PAIRS_LINK) return true;
    }
    
    // Tứ quý / 4 đôi thông chặt đôi heo
    if (isOldDoiHeo) {
        if (curr.type === TYPE.FOUR_QUADS || curr.type === TYPE.FOUR_PAIRS_LINK) return true;
    }

    // Tứ quý chặt 3 đôi thông
    if (old.type === TYPE.THREE_PAIRS_LINK && (curr.type === TYPE.FOUR_QUADS || curr.type === TYPE.FOUR_PAIRS_LINK)) return true;

    // 4 Đôi thông chặt mọi thứ (trừ sảnh và bộ rác lớn hơn)
    if (old.type === TYPE.FOUR_QUADS && curr.type === TYPE.FOUR_PAIRS_LINK) return true;

    // So sánh cùng loại
    if (curr.type === old.type) {
        // Sảnh phải cùng độ dài
        if (curr.type === TYPE.SEQUENCE) {
            return curr.length === old.length && curr.highestValue > old.highestValue;
        }
        // Các loại khác chỉ cần bài cao hơn
        return curr.highestValue > old.highestValue;
    }

    return false;
}
