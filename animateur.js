// animateur.js — écran de contrôle uniquement (téléphone ou PC de l'animateur).
// N'affiche PAS l'historique complet ni le plateau : ça, c'est le rôle
// d'ecran-central.html, sur un autre appareil/une autre fenêtre. Cet écran
// communique avec l'écran central uniquement via des champs "signal" écrits
// dans /gamestate (board, oppositionFlashAt), jamais en touchant son DOM.

import { db, ref, onValue, update, get, set } from './firebase-config.js';

let gameData = {};
let gameState = {};

get(ref(db, 'gamedata')).then((snap) => { if (snap.exists()) gameData = snap.val(); });
onValue(ref(db, 'gamestate'), (snap) => { gameState = snap.val() || {}; render(); });

// ---------- Utilitaires ----------
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function otherOf(j) { return j === 'J1' ? 'J2' : 'J1'; }
async function fresh() { return (await get(ref(db, 'gamestate'))).val() || {}; }

function names(state) {
    const p = state.players || {};
    return { J1: (p.J1 && p.J1.persona) || 'Joueur 1', J2: (p.J2 && p.J2.persona) || 'Joueur 2' };
}
function fillNames(text, state, current, adverse) {
    const n = names(state);
    return text
        .split('[joueur actuel]').join(n[current] || current)
        .split('[joueur adverse]').join(n[adverse] || adverse)
        .split('[J1]').join(n.J1)
        .split('[J2]').join(n.J2);
}
function displayRole(state, role) {
    if (role === 'ANIM') return 'Animateur';
    const n = names(state);
    return n[role] || role;
}
function addLog(state, role, text) {
    return { history: (state.history || []).concat([{ role, text }]) };
}

// Signal pour le plateau : l'écran central observe ce champ et anime le pion lui-même.
function signalBoardRandom() {
    return { board: { row: Math.floor(Math.random() * 5), col: Math.floor(Math.random() * 5), ts: Date.now() } };
}
function signalBoardNamedCell(name) {
    const c = gameData.board_grid && gameData.board_grid.cellules_nommees && gameData.board_grid.cellules_nommees[name];
    return c ? { board: { row: c.row, col: c.col, ts: Date.now() } } : signalBoardRandom();
}
function detectBoardTrigger(text) {
    const dotSyll = text.match(/[A-Za-zÀ-ÿ]+(?:\s*[.]{2,}\s*[A-Za-zÀ-ÿ]+){2,}/);
    const dashSyll = text.match(/[A-Za-zÀ-ÿ]+(?:-[A-Za-zÀ-ÿ]+){2,}/);
    if (dotSyll || dashSyll) return true;
    return /avan[cç]ez|reculez|en case/i.test(text);
}
function maybeBoardPatch(text) { return detectBoardTrigger(text) ? signalBoardRandom() : {}; }

// ---------- Rendu (minimal, juste pour l'animateur) ----------
function render() {
    const phase = gameState.phase || 'lobby';
    const banner = document.getElementById('phase-banner');
    if (banner) banner.innerText = phase;

    const last = (gameState.history || [])[(gameState.history || []).length - 1];
    const lastEl = document.getElementById('derniere-replique');
    if (lastEl) lastEl.innerText = last ? `${displayRole(gameState, last.role)} : ${last.text}` : '';

    showOnly(
        phase === 'lobby' ? 'btn-lancer'
        : (phase === 'generique_debut' || phase === 'char_selection') ? 'zone-attente'
        : phase === 'presentation' ? 'btn-appuyez-ici-wrap'
        : phase === 'playing' ? 'bar-jeu'
        : phase === 'kamoulox_declared' ? 'btn-conclure'
        : phase === 'ending_words' ? (Object.keys(gameState.mots || {}).length >= 2 ? 'btn-generique-final' : 'zone-attente')
        : 'zone-attente'
    );

    if (phase === 'generique_debut') setText('zone-attente', 'Générique en cours…');
    if (phase === 'char_selection') setText('zone-attente', 'Les joueurs choisissent leurs personnages…');
    if (phase === 'ending_words' && Object.keys(gameState.mots || {}).length < 2) {
        setText('zone-attente', `En attente du petit mot (${Object.keys(gameState.mots || {}).length}/2)…`);
    }
    if (phase === 'presentation') renderPresentationStep();
    if (phase === 'playing') renderJeuBar();
}
function showOnly(...ids) {
    ['btn-lancer', 'btn-appuyez-ici-wrap', 'bar-jeu', 'btn-conclure', 'btn-generique-final', 'zone-attente']
        .forEach(id => { const el = document.getElementById(id); if (el) el.classList.toggle('hidden', !ids.includes(id)); });
}
function setText(id, txt) { const el = document.getElementById(id); if (el) el.innerText = txt; }

// ---------- 1) Lancement ----------
document.getElementById('btn-lancer').addEventListener('click', async () => {
    await set(ref(db, 'gamestate'), {
        phase: 'generique_debut', history: [],
        usedDemiPhrases: [], usedPhrasesCourtes: [],
        oppositionCount: 0, oppositionUsedBy: { J1: false, J2: false },
        contreUsed: { J1: false, J2: false }, carteMystereUsed: false, tentativeUsed: false,
        turnCount: 0, loser: Math.random() < 0.5 ? 'J1' : 'J2',
        roles: (gameState.roles) || null, // on garde qui est J1/J2/animateur d'une partie à l'autre
    });
    setTimeout(async () => {
        const s = await fresh();
        if (s.phase === 'generique_debut') await update(ref(db, 'gamestate'), { phase: 'char_selection' });
    }, 2500);
});

// ---------- 2-4) Présentations + ouverture ----------
let presentationBuilt = false;
onValue(ref(db, 'gamestate/players'), (snap) => {
    const players = snap.val();
    if (players && players.J1 && players.J1.persona && players.J2 && players.J2.persona
        && gameState.phase === 'char_selection' && !presentationBuilt) {
        presentationBuilt = true;
        buildPresentationScript(players.J1.persona, players.J2.persona);
    }
    if (!(players && players.J1 && players.J1.persona)) presentationBuilt = false;
});

function findPersona(nom) { return (gameData.personnages || []).find(p => p.nom === nom); }

async function buildPresentationScript(nomJ1, nomJ2) {
    const p1 = findPersona(nomJ1), p2 = findPersona(nomJ2);
    const accueil = pick(gameData.phrases_intro_jeu).texte.split('[J1]').join(nomJ1);
    const jonction = pick(gameData.phrases_jonction).texte.split('[joueur actuel]').join(nomJ1).split('[J2]').join(nomJ2);
    const ouv = pick(gameData.ouverture);
    const swap = Math.random() < 0.5;
    const realOfLabel = { J1: swap ? 'J2' : 'J1', J2: swap ? 'J1' : 'J2' };

    const script = [];
    script.push({ role: 'ANIM', text: accueil, segment: 'PRESENTATION JOUEUR 1' });
    (p1.dialogue || []).forEach((t, i) => script.push({ role: i % 2 === 0 ? 'J1' : 'ANIM', text: t, segment: 'PRESENTATION JOUEUR 1' }));
    script.push({ role: 'ANIM', text: jonction, segment: 'PRESENTATION JOUEUR 2' });
    (p2.dialogue || []).forEach((t, i) => script.push({ role: i % 2 === 0 ? 'J2' : 'ANIM', text: t, segment: 'PRESENTATION JOUEUR 2' }));

    if (ouv.anim_intro) script.push({ role: 'ANIM', text: ouv.anim_intro, segment: 'CHIFOUMI' });
    if (ouv.reponse_j1) script.push({ role: realOfLabel.J1, text: ouv.reponse_j1, segment: 'CHIFOUMI' });
    if (ouv.reponse_j2) script.push({ role: realOfLabel.J2, text: ouv.reponse_j2, segment: 'CHIFOUMI' });
    let finalTurn = 'J1';
    if (ouv.tour_final) {
        const label = ouv.tour_final.includes('[J1]') ? 'J1' : (ouv.tour_final.includes('[J2]') ? 'J2' : null);
        if (label) finalTurn = realOfLabel[label];
        script.push({ role: 'ANIM', text: ouv.tour_final, segment: 'CHIFOUMI', _labels: realOfLabel });
    }
    await update(ref(db, 'gamestate'), { phase: 'presentation', presentationScript: script, presentationIndex: 0, finalTurn });
}

function renderPresentationStep() {
    const script = gameState.presentationScript || [];
    const i = gameState.presentationIndex || 0;
    const line = script[i];
    const wrap = document.getElementById('btn-appuyez-ici-wrap');
    const btn = document.getElementById('btn-appuyez-ici');
    const label = document.getElementById('presentation-segment');
    if (label) label.innerText = line ? (line.segment || '') : '';
    if (!line) { showOnly('zone-attente'); setText('zone-attente', '…'); return; }
    if (line.role === 'ANIM') {
        btn.disabled = false; btn.classList.add('green'); btn.innerText = 'APPUYEZ ICI';
        btn.onclick = () => advancePresentation();
    } else {
        btn.disabled = true; btn.classList.remove('green');
        btn.innerText = `En attente de ${displayRole(gameState, line.role)}…`;
        btn.onclick = null;
    }
}

let presAdvancing = false;
async function advancePresentation() {
    if (presAdvancing) return;
    presAdvancing = true;
    try {
        const s = await fresh();
        const script = s.presentationScript || [];
        const i = s.presentationIndex || 0;
        const line = script[i];
        if (!line) return;
        let text = line.text;
        if (line._labels) text = text.split('[J1]').join(names(s).J1).split('[J2]').join(names(s).J2);
        const isLast = i === script.length - 1;
        await update(ref(db, 'gamestate'), Object.assign(
            { presentationIndex: i + 1 },
            addLog(s, line.role, text),
            maybeBoardPatch(text),
            isLast ? { phase: 'playing', turn: s.finalTurn } : {}
        ));
    } finally { presAdvancing = false; }
}
onValue(ref(db, 'gamestate/presAdvanceRequest'), (snap) => {
    if (snap.val()) { set(ref(db, 'gamestate/presAdvanceRequest'), null); advancePresentation(); }
});

// ---------- 5) Boucle principale ----------
function renderJeuBar() {
    const cur = gameState.turn;
    document.getElementById('turn-indicator').innerText = `Tour de ${displayRole(gameState, cur)}`;
    const oppUsedTarget = gameState.oppositionUsedBy && gameState.oppositionUsedBy[cur];
    const oppCount = gameState.oppositionCount || 0;
    document.getElementById('btn-continuer').disabled = !!gameState.mystereForced;
    document.getElementById('btn-opposition').disabled = !!gameState.mystereForced || oppUsedTarget || oppCount >= 2;
    document.getElementById('btn-carte-mystere').disabled = !(gameState.mystereForced || (!gameState.carteMystereUsed && (gameState.turnCount || 0) >= (gameState.carteMystereThreshold || 3)));
    document.getElementById('btn-carte-mystere').classList.toggle('green', !!gameState.mystereForced);
    document.getElementById('btn-valider').disabled = !gameState.contrePending;
    document.getElementById('btn-valider').classList.toggle('green', !!gameState.contrePending);
    document.getElementById('mystere-valider-manche').classList.toggle('hidden', !gameState.mystereCard);
}

document.getElementById('btn-continuer').addEventListener('click', () => avancerTransition());
document.getElementById('btn-valider').addEventListener('click', () => avancerTransition());

async function avancerTransition() {
    const s = await fresh();
    const cur = s.turn;
    const raw = pick(gameData.transitions);
    const text = fillNames(raw, s, cur, otherOf(cur));
    const turnCount = (s.turnCount || 0) + 1;
    const threshold = s.carteMystereThreshold != null ? s.carteMystereThreshold : (Math.floor(Math.random() * 3) + 3);
    await update(ref(db, 'gamestate'), Object.assign(
        { turn: otherOf(cur), turnCount, carteMystereThreshold: threshold, contrePending: false, courteAwaitingDecision: null },
        addLog(s, 'ANIM', text), maybeBoardPatch(text)
    ));
}

document.getElementById('btn-opposition').addEventListener('click', async () => {
    const s = await fresh();
    const target = s.turn;
    if (s.oppositionUsedBy && s.oppositionUsedBy[target] && !s.mystereForced) return;
    const raw = pick(gameData.oppositions);
    const text = fillNames(raw, s, target, otherOf(target));
    await update(ref(db, 'gamestate'), Object.assign(
        {
            turn: otherOf(target), phase: 'playing', contrePending: false, courteAwaitingDecision: null,
            oppositionCount: (s.oppositionCount || 0) + 1,
            [`oppositionUsedBy/${target}`]: true, hapticFor: target,
            oppositionFlashAt: Date.now(),
        },
        addLog(s, 'ANIM', text)
    ));
});

document.getElementById('btn-carte-mystere').addEventListener('click', async () => {
    const s = await fresh();
    const card = (s.mystereForced && s.mystereForcedCard) ? s.mystereForcedCard : pick(gameData.cartes_mystere_aleatoires);
    const decl = fillNames(card.declencheur, s, s.turn, otherOf(s.turn));
    await update(ref(db, 'gamestate'), Object.assign(
        { mystereCard: card, mystereManche: 0, mystereRevealJoueur: false, mystereForced: false, mystereForcedCard: null },
        addLog(s, 'ANIM', decl), maybeBoardPatch(decl)
    ));
});

onValue(ref(db, 'gamestate/mystereRevealJoueur'), async (snap) => {
    if (!snap.val()) return;
    const s = await fresh();
    if (!s.mystereCard) return;
    const manche = s.mystereCard.manches[s.mystereManche];
    const text = fillNames(manche.joueur, s, s.turn, otherOf(s.turn));
    await update(ref(db, 'gamestate'), Object.assign(addLog(s, s.turn, text), maybeBoardPatch(text)));
});

document.getElementById('mystere-valider-manche').addEventListener('click', async () => {
    const s = await fresh();
    if (!s.mystereCard) return;
    const manche = s.mystereCard.manches[s.mystereManche];
    const text = fillNames(manche.animateur, s, s.turn, otherOf(s.turn));
    const next = s.mystereManche + 1;
    const finished = next >= s.mystereCard.manches.length;
    await update(ref(db, 'gamestate'), Object.assign(
        {
            mystereManche: next, mystereRevealJoueur: false,
            carteMystereUsed: finished ? true : s.carteMystereUsed,
            mystereCard: finished ? null : s.mystereCard,
            turn: finished ? otherOf(s.turn) : s.turn,
        },
        addLog(s, 'ANIM', text)
    ));
});

// ---------- Kamoulox déclaré -> conclure ----------
document.getElementById('btn-conclure').addEventListener('click', async () => {
    const s = await fresh();
    const winner = s.winner;
    const raw = pick(gameData.fins);
    const text = fillNames(raw, s, winner, otherOf(winner)).split('[gagnant]').join(names(s)[winner]);
    await update(ref(db, 'gamestate'), Object.assign({ phase: 'ending_words' }, addLog(s, 'ANIM', text)));
});

document.getElementById('btn-generique-final').addEventListener('click', async () => {
    const s = await fresh();
    await update(ref(db, 'gamestate'), Object.assign({ phase: 'ending' }, addLog(s, 'ANIM', 'Merci, bonsoir, et à demain !')));
});

// ---------- Interpréteur générique des mini-jeux "je tente" ----------
onValue(ref(db, 'gamestate/tentativeRequest'), async (snap) => {
    const req = snap.val();
    if (!req) return;
    await set(ref(db, 'gamestate/tentativeRequest'), null);
    const s = await fresh();
    const t = req.tentative;
    const cur = s.turn, adv = otherOf(cur);
    await update(ref(db, 'gamestate'), addLog(s, cur, `Je tente le ${t.nom}…`));

    if (t.type === 'carte_mystere_libre' || t.type === 'carte_mystere_libre_ref') {
        const card = t.ref_declencheur
            ? (gameData.cartes_mystere_aleatoires || []).find(c => c.declencheur === t.ref_declencheur)
            : pick(gameData.cartes_mystere_aleatoires);
        await update(ref(db, 'gamestate'), { mystereForced: true, mystereForcedCard: card || pick(gameData.cartes_mystere_aleatoires), turnCount: (s.turnCount || 0) + 1 });
    } else if (t.type === 'carte_mystere_conditionnelle_ref') {
        const card = (gameData.cartes_mystere_conditionnelles || []).find(c => c.declencheur_action === t.ref);
        await update(ref(db, 'gamestate'), { mystereForced: true, mystereForcedCard: card, turnCount: (s.turnCount || 0) + 1 });
    } else if (t.type === 'forced_opposition') {
        const raw = pick(gameData.oppositions);
        const text = fillNames(raw, s, cur, adv);
        await update(ref(db, 'gamestate'), Object.assign({ turn: adv, oppositionFlashAt: Date.now() }, addLog(s, 'ANIM', text)));
    } else if (t.type === 'forced_contre_adversaire' || t.type === 'forced_contre_adversaire_scripted') {
        const line = t.contre_force_texte || (gameData.je_contre && pick(gameData.je_contre)) || 'Je contre !';
        let hist = (s.history || []).concat([{ role: adv, text: line }]);
        if (t.echange) {
            const roles = ['ANIM', cur, adv, cur, 'ANIM'];
            t.echange.forEach((l, i) => hist.push({ role: roles[i % roles.length], text: fillNames(l, s, cur, adv) }));
        }
        await update(ref(db, 'gamestate'), { history: hist, turn: adv });
    } else if (t.type === 'dialogue_chain_then_transition') {
        const roles = [cur, adv, cur, adv, cur, adv];
        const hist = (s.history || []).concat(t.echange.map((l, i) => ({ role: roles[i % roles.length], text: l })));
        const raw = pick(gameData.transitions);
        hist.push({ role: 'ANIM', text: fillNames(raw, s, cur, adv) });
        await update(ref(db, 'gamestate'), { history: hist, turn: adv });
    } else if (t.type === 'imitation_avec_case' || t.type === 'imitation_flash') {
        await update(ref(db, 'gamestate'), Object.assign(
            addLog(s, 'ANIM', t.formule || t.consigne_animateur),
            signalBoardNamedCell(t.case)
        ));
    } else if (t.type === 'repeat_tap' || t.type === 'repeat_tap_reveal') {
        await update(ref(db, 'gamestate'), { repeatTap: { total: t.repetitions, count: 0, texte: t.texte_repete, final: t.texte_final } });
    }
});
