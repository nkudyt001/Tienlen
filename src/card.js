export const RANKS = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2'];
export const SUITS = [
    { name: 'Bích', symbol: '♠', class: 'black', value: 0 },
    { name: 'Chuồn', symbol: '♣', class: 'black', value: 1 },
    { name: 'Rô', symbol: '♦', class: 'red', value: 2 },
    { name: 'Cơ', symbol: '♥', class: 'red', value: 3 }
];

export class Card {
    constructor(rankIndex, suitIndex) {
        this.rankIndex = rankIndex; // 0 (3) to 12 (2)
        this.suitIndex = suitIndex; // 0 to 3
        this.rank = RANKS[rankIndex];
        this.suit = SUITS[suitIndex];
        this.id = `${this.rank}-${this.suit.name}`;
        
        // Giá trị tuyệt đối để so sánh (thứ tự 3 bích < ... < 2 cơ)
        this.absoluteValue = rankIndex * 4 + suitIndex;
    }

    render() {
        const cardDiv = document.createElement('div');
        cardDiv.className = `card ${this.suit.class}`;
        cardDiv.dataset.id = this.id;
        cardDiv.dataset.value = this.absoluteValue;
        
        cardDiv.innerHTML = `
            <div class="rank">${this.rank}</div>
            <div class="suit">${this.suit.symbol}</div>
            <div class="suit-center">${this.suit.symbol}</div>
        `;
        
        return cardDiv;
    }
}

export class Deck {
    constructor() {
        this.cards = [];
        for (let r = 0; r < RANKS.length; r++) {
            for (let s = 0; s < SUITS.length; s++) {
                this.cards.push(new Card(r, s));
            }
        }
    }

    shuffle() {
        for (let i = this.cards.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [this.cards[i], this.cards[j]] = [this.cards[j], this.cards[i]];
        }
    }

    deal(numPlayers = 4) {
        const hands = Array.from({ length: numPlayers }, () => []);
        this.cards.forEach((card, index) => {
            hands[index % numPlayers].push(card);
        });
        return hands;
    }
}
