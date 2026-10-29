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

// A full, optionally interactive board.
export function renderBoard(host, opts) {
  const {
    fen,
    orientation = 'w',
    lastMove = null,
    selected = null,
    targets = [],
    checkSquare = null,
    interactive = false,
    legalMoves = {},
    onSquare = () => {},
    onDrop = () => {},
  } = opts;

  const grid = boardGrid({ fen, orientation, lastMove, selected, targets, checkSquare, interactive, onSquare });
  if (interactive) enableDrag(grid, legalMoves, onDrop);
  host.replaceChildren(grid);
  return grid;
}

// The board's squares, pieces and coordinates. The game screen and the game
// tiles share it, so the tiles look exactly like the real board.
function boardGrid({ fen, orientation, lastMove, selected = null, targets = [], checkSquare = null, interactive = false, onSquare = () => {}, extraClass = '' }) {
  const board = parseFen(fen);
  const boardClasses = ['board'];
  if (interactive) boardClasses.push('interactive');
  if (extraClass) boardClasses.push(extraClass);
  const grid = el('div', { class: boardClasses.join(' ') });

  for (const square of squares(orientation)) {
    const piece = board[square];
    const classes = ['sq', isLight(square) ? 'light' : 'dark'];
    if (lastMove && (lastMove.from === square || lastMove.to === square)) classes.push('last');
    if (selected === square) classes.push('selected');
    if (targets.includes(square)) classes.push(piece ? 'capture' : 'target');
    if (checkSquare === square) classes.push('check');

    const cell = el('div', {
      class: classes.join(' '),
      'data-square': square,
      onclick: () => interactive && onSquare(square),
    }, [piece ? pieceNode(piece) : null]);

    if (square[1] === (orientation === 'b' ? '8' : '1')) cell.append(el('span', { class: 'coord file', text: square[0] }));
    if (square[0] === (orientation === 'b' ? 'h' : 'a')) cell.append(el('span', { class: 'coord rank', text: square[1] }));
    grid.append(cell);
  }

  return grid;
}

// Drag and drop with pointer events, so mouse and touch both work. A press
// that never moves stays a plain click and falls through to onSquare.
const DRAG_THRESHOLD = 4;

function enableDrag(grid, legalMoves, onDrop) {
  for (const square of Object.keys(legalMoves)) {
    const cell = grid.querySelector(`[data-square="${square}"]`);
    if (cell) cell.classList.add('draggable');
  }

  grid.addEventListener('pointerdown', (down) => {
    if (down.button !== 0) return;
    const cell = down.target.closest('.sq');
    const from = cell && cell.dataset.square;
    const piece = cell && cell.querySelector('.piece');
    if (!piece || !legalMoves[from]) return;
    down.preventDefault();

    let ghost = null;
    let hover = null;

    const squareAt = (x, y) => {
      const under = document.elementFromPoint(x, y);
      const target = under && under.closest('.sq');
      return target && grid.contains(target) ? target : null;
    };

    const start = () => {
      for (const node of grid.querySelectorAll('.selected, .target, .capture')) {
        node.classList.remove('selected', 'target', 'capture');
      }
      cell.classList.add('selected');
      for (const to of legalMoves[from]) {
        const target = grid.querySelector(`[data-square="${to}"]`);
        if (target) target.classList.add(target.querySelector('.piece') ? 'capture' : 'target');
      }
      ghost = piece.cloneNode(true);
      ghost.classList.add('drag-ghost');
      document.body.append(ghost);
      piece.classList.add('drag-source');
    };

    const move = (e) => {
      if (!ghost) {
        if (Math.hypot(e.clientX - down.clientX, e.clientY - down.clientY) < DRAG_THRESHOLD) return;
        start();
      }
      ghost.style.left = `${e.clientX}px`;
      ghost.style.top = `${e.clientY}px`;
      const over = squareAt(e.clientX, e.clientY);
      if (over !== hover) {
        if (hover) hover.classList.remove('drag-over');
        hover = over;
        if (hover) hover.classList.add('drag-over');
      }
    };

    const finish = (e, cancelled) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      if (!ghost) return; // never left the threshold: let the click through
      ghost.remove();
      piece.classList.remove('drag-source');
      if (hover) hover.classList.remove('drag-over');
      // The browser still fires a click after a drag; swallow it once.
      const swallow = (click) => {
        click.stopPropagation();
        click.preventDefault();
      };
      window.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0);
      const target = cancelled ? null : squareAt(e.clientX, e.clientY);
      onDrop(from, target ? target.dataset.square : null);
    };
    const up = (e) => finish(e, false);
    const cancel = (e) => finish(e, true);

    window.addEventListener('pointermove', move);
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
