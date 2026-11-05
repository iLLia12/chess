import { el, GLYPH } from './ui.js';

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

// FEN -> { e4: {type:'p', color:'w'}, ... }
export function parseFen(fen) {
  const board = {};
  const rows = fen.split(' ')[0].split('/');
  rows.forEach((row, index) => {
    const rank = 8 - index;
    let file = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) {
        file += Number(ch);
        continue;
      }
      board[`${FILES[file]}${rank}`] = {
        type: ch.toLowerCase(),
        color: ch === ch.toUpperCase() ? 'w' : 'b',
      };
      file += 1;
    }
  });
  return board;
}

// The position after moving from -> to, for showing a move before the server
// has confirmed it. Only the piece placement is meaningful in the result
// (that is all the board draws); the server stays the judge of legality.
export function previewMove(fen, from, to, promotion = null) {
  const board = parseFen(fen);
  const piece = board[from];
  if (!piece) return fen;
  delete board[from];
  // En passant: a pawn moving diagonally onto an empty square takes the pawn
  // beside it.
  if (piece.type === 'p' && from[0] !== to[0] && !board[to]) delete board[`${to[0]}${from[1]}`];
  // Castling: the king moves two files and the rook jumps over it.
  if (piece.type === 'k' && Math.abs(FILES.indexOf(to[0]) - FILES.indexOf(from[0])) === 2) {
    const kingside = to[0] === 'g';
    const rookFrom = `${kingside ? 'h' : 'a'}${from[1]}`;
    const rookTo = `${kingside ? 'f' : 'd'}${from[1]}`;
    if (board[rookFrom]) {
      board[rookTo] = board[rookFrom];
      delete board[rookFrom];
    }
  }
  board[to] = promotion ? { type: promotion, color: piece.color } : piece;

  const rows = [];
  for (let rank = 8; rank >= 1; rank -= 1) {
    let row = '';
    let empty = 0;
    for (const file of FILES) {
      const p = board[`${file}${rank}`];
      if (!p) {
        empty += 1;
        continue;
      }
      if (empty) row += empty;
      empty = 0;
      row += p.color === 'w' ? p.type.toUpperCase() : p.type;
    }
    rows.push(empty ? row + empty : row);
  }
  return `${rows.join('/')} ${piece.color === 'w' ? 'b' : 'w'} - - 0 1`;
}

export function squares(orientation) {
  const files = orientation === 'b' ? [...FILES].reverse() : FILES;
  const ranks = orientation === 'b' ? [1, 2, 3, 4, 5, 6, 7, 8] : [8, 7, 6, 5, 4, 3, 2, 1];
  const list = [];
  for (const rank of ranks) for (const file of files) list.push(`${file}${rank}`);
  return list;
}

function isLight(square) {
  const file = FILES.indexOf(square[0]);
  const rank = Number(square[1]) - 1;
  return (file + rank) % 2 === 1;
}

export function pieceNode(piece) {
  return el('span', { class: `piece ${piece.color}`, text: GLYPH[piece.type] });
}

// A full, optionally interactive board. Pieces are moved by dragging them;
// onDrop(from, to) gets the target square, or null when the piece was let go
// off the board or back where it started.
export function renderBoard(host, opts) {
  const {
    fen,
    orientation = 'w',
    lastMove = null,
    checkSquare = null,
    interactive = false,
    legalMoves = {},
    onDrop = () => {},
  } = opts;

  const grid = boardGrid({ fen, orientation, lastMove, checkSquare, interactive });
  if (interactive) enableDrag(grid, legalMoves, onDrop);
  host.replaceChildren(grid);
  return grid;
}

// True while a piece is being dragged on this board, so callers can hold off
// re-rendering it (which would pull the piece out from under the pointer).
export function isDragging(host) {
  return Boolean(host.querySelector('.board.dragging'));
}

// The board's squares, pieces and coordinates. The game screen and the game
// tiles share it, so the tiles look exactly like the real board.
function boardGrid({ fen, orientation, lastMove, checkSquare = null, interactive = false, extraClass = '' }) {
  const board = parseFen(fen);
  const boardClasses = ['board'];
  if (interactive) boardClasses.push('interactive');
  if (extraClass) boardClasses.push(extraClass);
  const grid = el('div', { class: boardClasses.join(' ') });

  for (const square of squares(orientation)) {
    const piece = board[square];
    const classes = ['sq', isLight(square) ? 'light' : 'dark'];
    if (lastMove && (lastMove.from === square || lastMove.to === square)) classes.push('last');
    if (checkSquare === square) classes.push('check');

    const cell = el('div', { class: classes.join(' '), 'data-square': square }, [piece ? pieceNode(piece) : null]);

    if (square[1] === (orientation === 'b' ? '8' : '1')) cell.append(el('span', { class: 'coord file', text: square[0] }));
    if (square[0] === (orientation === 'b' ? 'h' : 'a')) cell.append(el('span', { class: 'coord rank', text: square[1] }));
    grid.append(cell);
  }

  return grid;
}

// Drag and drop with pointer events, so mouse and touch both work. Pressing
// a movable piece picks it up straight away: its legal squares light up and
// the piece follows the pointer until it is let go.
function enableDrag(grid, legalMoves, onDrop) {
  for (const square of Object.keys(legalMoves)) {
    const cell = grid.querySelector(`[data-square="${square}"]`);
    if (cell) cell.classList.add('draggable');
  }

  grid.addEventListener('pointerdown', (down) => {
    if (down.button !== 0 || grid.classList.contains('dragging')) return;
    const cell = down.target.closest('.sq');
    const from = cell && cell.dataset.square;
    const piece = cell && cell.querySelector('.piece');
    if (!piece || !legalMoves[from]) return;
    down.preventDefault();

    const marked = [];
    for (const to of legalMoves[from]) {
      const target = grid.querySelector(`[data-square="${to}"]`);
      if (!target) continue;
      const kind = target.querySelector('.piece') ? 'capture' : 'target';
      target.classList.add(kind);
      marked.push([target, kind]);
    }
    cell.classList.add('selected');
    grid.classList.add('dragging');

    // The floating copy lives on <body>, outside the board, so it takes the
    // board's square size with it to come out the same size as the piece.
    const ghost = piece.cloneNode(true);
    ghost.classList.add('drag-ghost');
    const style = getComputedStyle(grid);
    ghost.style.setProperty('--sq', style.getPropertyValue('--sq'));
    ghost.style.setProperty('--px', style.getPropertyValue('--px'));
    document.body.append(ghost);
    piece.classList.add('drag-source');

    let hover = null;
    const squareAt = (x, y) => {
      const under = document.elementFromPoint(x, y);
      const target = under && under.closest('.sq');
      return target && grid.contains(target) ? target : null;
    };
    const follow = (e) => {
      ghost.style.left = `${e.clientX}px`;
      ghost.style.top = `${e.clientY}px`;
      const over = squareAt(e.clientX, e.clientY);
      if (over !== hover) {
        if (hover) hover.classList.remove('drag-over');
        hover = over;
        if (hover) hover.classList.add('drag-over');
      }
    };
    follow(down);

    const finish = (e, cancelled) => {
      window.removeEventListener('pointermove', follow);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      ghost.remove();
      piece.classList.remove('drag-source');
      cell.classList.remove('selected');
      for (const [target, kind] of marked) target.classList.remove(kind);
      if (hover) hover.classList.remove('drag-over');
      grid.classList.remove('dragging');
      const target = cancelled ? null : squareAt(e.clientX, e.clientY);
      const to = target ? target.dataset.square : null;
      onDrop(from, to === from ? null : to);
    };
    const up = (e) => finish(e, false);
    const cancel = (e) => finish(e, true);

    window.addEventListener('pointermove', follow);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
  });
}

// The real board drawn at tile size (see .board.mini in the stylesheet).
export function miniBoard(fen, orientation = 'w', lastMove = null) {
  return el('div', { class: 'mini-wrap' }, [boardGrid({ fen, orientation, lastMove, extraClass: 'mini' })]);
}

export function findKing(fen, color) {
  const board = parseFen(fen);
  for (const [square, piece] of Object.entries(board)) {
    if (piece.type === 'k' && piece.color === color) return square;
  }
  return null;
}
