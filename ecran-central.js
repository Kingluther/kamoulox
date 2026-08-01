// ecran-central.js — écran de projection, LECTURE SEULE (aucune écriture ici).
// Toutes les actions viennent d'animateur.js, qui écrit des "signaux" dans
// /gamestate (board, oppositionFlashAt...) que cet écran se contente d'observer.

import { db, ref, onValue, get } from './firebase-config.js';

let gameData = {};
let gameState = {};
let lastFlashTs = 0;
let lastBoardTs = 0;

get(ref(db, 'gamedata')).then(s => { gameData = s.val() || {}; });

onValue(ref(db, 'gamestate'), (snap) => {
    gameState = snap.val() || {};
    render();
});

function names(state) {
    const p = state.players || {};
    return { J1: (p.J1 && p.J1.persona) || 'Joueur 1', J2: (p.J2 && p.J2.persona) || 'Joueur 2' };
}
function displayRole(role) {
    if (role === 'ANIM') return 'Animateur';
    if (role === 'SYSTEM') return '';
    const p = gameState.players || {};
    return (p[role] && p[role].persona) || role;
}

function render() {
    renderHistory();
    renderPhase();
    renderBoard();
    renderFlash();
    renderCarteMystere();
    renderMots();
}

function renderMots() {
    const div = document.getElementById('mots-fin');
    if (!div) return;
    const mots = gameState.mots || {};
    const n = names(gameState);
    div.innerHTML = Object.entries(mots).map(([role, mot]) => `<p>${n[role] || role} : <b>${mot}</b></p>`).join('');
}

let lastCarteTs = 0;
function renderCarteMystere() {
    const overlay = document.getElementById('carte-mystere-overlay');
    const card = gameState.mystereCard;
    if (!card) { overlay.classList.remove('show'); return; }
    // le plateau sert de fond visuel derrière la carte, même sans déplacement de pion en cours
    const container = document.getElementById('board-container');
    if (container.style.display !== 'block') { container.style.display = 'block'; container.classList.add('mini'); }
    if (card.ts && card.ts !== lastCarteTs) {
        lastCarteTs = card.ts;
        overlay.classList.remove('show');
        void overlay.offsetWidth; // relance l'animation CSS
        overlay.classList.add('show');
    }
}

function renderHistory() {
    const div = document.getElementById('dialogue-history');
    div.innerHTML = '';
    (gameState.history || []).forEach(line => {
        const p = document.createElement('p');
        p.className = `replique-${(line.role === 'ANIM' ? 'anim' : line.role === 'SYSTEM' ? 'system' : line.role).toLowerCase()}`;
        p.innerText = line.role === 'SYSTEM' ? line.text : `${displayRole(line.role)} : ${line.text}`;
        div.appendChild(p);
    });
    div.scrollTop = div.scrollHeight;
}

let lastPhase = null;
document.getElementById('generique-audio').addEventListener('error', () => {
    document.getElementById('btn-activer-son').innerText = '⚠️ kamoulox.mp3 introuvable';
});

let audioUnlocked = false;
document.getElementById('btn-activer-son').addEventListener('click', function unlock() {
    audioUnlocked = true;
    const audio = document.getElementById('generique-audio');
    audio.play().then(() => { audio.pause(); audio.currentTime = 0; this.style.display = 'none'; }).catch(() => {
        this.innerText = '🔊 Réessayer';
    });
});

function renderPhase() {
    const phase = gameState.phase || 'lobby';
    if (phase !== lastPhase && (phase === 'generique_debut' || phase === 'ending')) {
        const audio = document.getElementById('generique-audio');
        audio.currentTime = 0;
        audio.play().catch(() => { /* lecture auto bloquée tant qu'aucun clic n'a eu lieu sur cette page */ });
    }
    lastPhase = phase;

    const labels = {
        lobby: '', generique_debut: 'Générique…', char_selection: 'Choix des personnages…',
        presentation: (gameState.presentationScript || [])[gameState.presentationIndex || 0]?.segment || '',
        playing: '', kamoulox_declared: 'KAMOULOX !', ending_words: 'Un petit mot avant de se quitter…', ending: '',
    };
    document.getElementById('phase-banner').innerText = labels[phase] || '';
    document.getElementById('kamoulox-central-banner').style.display = phase === 'kamoulox_declared' ? 'block' : 'none';
}

function cellPercent(row, col) { return { leftPct: ((col + 0.5) / 5) * 100, topPct: ((row + 0.5) / 5) * 100 }; }

function renderBoard() {
    const b = gameState.board;
    const container = document.getElementById('board-container');
    const pion = document.getElementById('pion');
    if (!b || !b.ts) { container.style.display = 'none'; return; }
    container.style.display = 'block';
    const { leftPct, topPct } = cellPercent(b.row, b.col);
    pion.style.left = `calc(${leftPct}% - 28px)`;
    pion.style.top = `calc(${topPct}% - 66px)`;
    if (b.ts !== lastBoardTs) {
        lastBoardTs = b.ts;
        container.classList.remove('mini');
        clearTimeout(window._miniTimeout);
        window._miniTimeout = setTimeout(() => container.classList.add('mini'), 6500);
    }
}

function renderFlash() {
    if (gameState.oppositionFlashAt && gameState.oppositionFlashAt !== lastFlashTs) {
        lastFlashTs = gameState.oppositionFlashAt;
        const el = document.getElementById('central-screen');
        el.classList.add('alert-rouge');
        setTimeout(() => el.classList.remove('alert-rouge'), 1600);
    }
}
