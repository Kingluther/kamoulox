// animateur.js — écran de contrôle uniquement (téléphone ou PC de l'animateur).
// N'affiche PAS l'historique complet ni le plateau : ça, c'est le rôle
// d'ecran-central.html, sur un autre appareil/une autre fenêtre. Cet écran
// communique avec l'écran central uniquement via des champs "signal" écrits
// dans /gamestate (board, oppositionFlashAt), jamais en touchant son DOM.

import { db, ref, onValue, update, get, set } from './firebase-config.js';

let gameData = {};
let gameState = {};
let mimeAnimTimerIndex = null, mimeAnimReady = false, mimeAnimTimerHandle = null; // mime_unlock:'anim' — délai avant "Continuer"

get(ref(db, 'gamedata')).then((snap) => { if (snap.exists()) gameData = snap.val(); });
onValue(ref(db, 'gamestate'), (snap) => { gameState = snap.val() || {}; render(); });

// ---------- Utilitaires ----------
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function pickUnused(arr, used) {
    const usedSet = new Set(used || []);
    const dispo = arr.filter(x => !usedSet.has(x));
    return dispo.length ? pick(dispo) : pick(arr); // si tout a déjà servi, on recommence plutôt que planter
}
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

    const sequenceActive = phase === 'playing' && gameState.sequenceScript && (gameState.sequenceIndex || 0) < gameState.sequenceScript.length;

    showOnly(
        phase === 'lobby' ? 'btn-lancer'
        : (phase === 'generique_debut' || phase === 'char_selection') ? 'zone-attente'
        : phase === 'presentation' ? 'btn-appuyez-ici-wrap'
        : sequenceActive ? 'btn-appuyez-ici-wrap'
        : phase === 'playing' ? 'bar-jeu'
        : phase === 'kamoulox_declared' ? 'btn-conclure'
        : phase === 'ending_words' ? (Object.keys(gameState.mots || {}).length >= 2 ? 'btn-generique-final' : 'zone-attente')
        : phase === 'ending' ? 'btn-recommencer'
        : 'zone-attente'
    );

    if (phase === 'generique_debut') setText('zone-attente', 'Générique en cours…');
    if (phase === 'char_selection') setText('zone-attente', 'Les joueurs choisissent leurs personnages…');
    if (phase === 'ending_words' && Object.keys(gameState.mots || {}).length < 2) {
        setText('zone-attente', `En attente du petit mot (${Object.keys(gameState.mots || {}).length}/2)…`);
    }
    if (phase === 'presentation') renderPresentationStep();
    if (sequenceActive) { renderSequenceStepAnim(); return; }
    if (phase === 'playing') renderJeuBar();
}
function showOnly(...ids) {
    ['btn-lancer', 'btn-appuyez-ici-wrap', 'bar-jeu', 'btn-conclure', 'btn-generique-final', 'btn-recommencer', 'zone-attente']
        .forEach(id => { const el = document.getElementById(id); if (el) el.classList.toggle('hidden', !ids.includes(id)); });
}
function setText(id, txt) { const el = document.getElementById(id); if (el) el.innerText = txt; }

document.getElementById('btn-recommencer').addEventListener('click', async () => {
    await set(ref(db, 'gamestate'), null);
    window.location.href = 'join.html';
});

// ---------- 1) Lancement ----------
document.getElementById('btn-lancer').addEventListener('click', async () => {
    await set(ref(db, 'gamestate'), {
        phase: 'generique_debut', history: [],
        usedDemiPhrases: [], usedPhrasesCourtes: [],
        oppositionCount: 0, oppositionUsedBy: { J1: false, J2: false },
        contreUsed: { J1: false, J2: false }, carteMystereUsed: false, tentativeUsed: false,
        turnCount: 0, loser: Math.random() < 0.5 ? 'J1' : 'J2',
        roles: (gameState.roles) || null, buzzerWinner: null, kamouloxStuckActive: false, kamouloxFrozenPhrase: null,
        usedTransitions: [], usedOppositions: [],
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

function pushDialogue(script, persona, monLabel, adverseLabel, segment) {
    if (persona.dialogue_explicite) {
        persona.dialogue_explicite.forEach(entry => {
            const role = entry.role === 'ANIM' ? 'ANIM' : entry.role === 'ADVERSAIRE' ? adverseLabel : monLabel;
            script.push({ role, text: entry.text, segment, chant: !!entry.chant });
        });
    } else {
        (persona.dialogue || []).forEach((t, i) => script.push({ role: i % 2 === 0 ? monLabel : 'ANIM', text: t, segment }));
    }
}

async function buildPresentationScript(nomJ1, nomJ2) {
    const p1 = findPersona(nomJ1), p2 = findPersona(nomJ2);
    const accueil = pick(gameData.phrases_intro_jeu).texte.split('[J1]').join(nomJ1);
    const jonction = pick(gameData.phrases_jonction).texte.split('[joueur actuel]').join(nomJ1).split('[J2]').join(nomJ2);
    const ouv = pick(gameData.ouverture);
    const swap = Math.random() < 0.5;
    const realOfLabel = { J1: swap ? 'J2' : 'J1', J2: swap ? 'J1' : 'J2' };

    const script = [];
    script.push({ role: 'ANIM', text: accueil, segment: 'PRESENTATION JOUEUR 1' });
    pushDialogue(script, p1, 'J1', 'J2', 'PRESENTATION JOUEUR 1');
    script.push({ role: 'ANIM', text: jonction, segment: 'PRESENTATION JOUEUR 2' });
    pushDialogue(script, p2, 'J2', 'J1', 'PRESENTATION JOUEUR 2');

    const nomActuel = nomJ2; // celui qui vient d'être présenté en dernier
    const dispJ1early = realOfLabel.J1 === 'J1' ? nomJ1 : nomJ2;
    const dispJ2early = realOfLabel.J2 === 'J1' ? nomJ1 : nomJ2;
    if (ouv.buzzer) {
        script.push({ role: 'BUZZER', text: ouv.buzzer, segment: 'CHIFOUMI' });
        script.push({ role: 'ANIM', text: (ouv.tour_final || 'A vous [buzzer_gagnant].'), segment: 'CHIFOUMI', _buzzerFinal: true });
        await update(ref(db, 'gamestate'), { phase: 'presentation', presentationScript: script, presentationIndex: 0, finalTurn: null });
        return;
    }
    if (ouv.anim_intro) {
        const t = ouv.anim_intro.split('[J1]').join(dispJ1early).split('[J2]').join(dispJ2early).split('[joueur actuel]').join(nomActuel);
        script.push({ role: 'ANIM', text: t, segment: 'CHIFOUMI' });
    }
    if (ouv.reponse_j1) script.push({ role: realOfLabel.J1, text: ouv.reponse_j1, segment: 'CHIFOUMI' });
    if (ouv.reponse_j2) script.push({ role: realOfLabel.J2, text: ouv.reponse_j2, segment: 'CHIFOUMI' });
    (ouv.etapes_finales || []).forEach(e => script.push({ role: realOfLabel[e.role] || e.role, text: e.text, segment: 'CHIFOUMI' }));
    let finalTurn = realOfLabel.J1;
    const numJ1 = ouv.reponse_j1 && ouv.reponse_j1.match(/\d+/);
    const numJ2 = ouv.reponse_j2 && ouv.reponse_j2.match(/\d+/);
    if (numJ1 && numJ2) {
        finalTurn = parseInt(numJ2[0], 10) > parseInt(numJ1[0], 10) ? realOfLabel.J2 : realOfLabel.J1;
    }
    if (ouv.tour_final) {
        const label = ouv.tour_final.includes('[J1]') ? 'J1' : (ouv.tour_final.includes('[J2]') ? 'J2' : (ouv.tour_final.includes('[joueur actuel]') ? 'ACTUEL' : null));
        if (label === 'ACTUEL') finalTurn = realOfLabel.J1; else if (label) finalTurn = realOfLabel[label];
        // dispJ1/dispJ2 : le prénom de la persona qui porte réellement le label J1/J2
        // dans CETTE ouverture (après le tirage au sort réalOfLabel), pas le prénom fixe.
        const dispJ1 = realOfLabel.J1 === 'J1' ? nomJ1 : nomJ2;
        const dispJ2 = realOfLabel.J2 === 'J1' ? nomJ1 : nomJ2;
        const nomFinalTurn = finalTurn === 'J1' ? nomJ1 : nomJ2;
        const t = ouv.tour_final.split('[J1]').join(dispJ1).split('[J2]').join(dispJ2).split('[joueur actuel]').join(nomFinalTurn);
        script.push({ role: 'ANIM', text: t, segment: 'CHIFOUMI' });
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
    if (line.role === 'BUZZER') {
        showOnly('zone-attente');
        setText('zone-attente', `Buzzer en cours (${line.text}) — premier joueur à cliquer…`);
        return;
    }
    if (line.mime && line.mime_unlock === 'anim') {
        if (mimeAnimTimerIndex !== i) {
            mimeAnimTimerIndex = i;
            mimeAnimReady = false;
            clearTimeout(mimeAnimTimerHandle);
            mimeAnimTimerHandle = setTimeout(() => { mimeAnimReady = true; render(); }, 5000);
        }
        if (!mimeAnimReady) {
            btn.disabled = true; btn.classList.remove('green');
            btn.innerText = line.mime_wait_anim || 'En attente du joueur…';
            btn.onclick = null;
        } else {
            btn.disabled = false; btn.classList.add('green');
            btn.innerText = 'Continuer';
            btn.onclick = () => advancePresentation();
        }
    } else if (line.mime) {
        btn.disabled = true; btn.classList.remove('green');
        btn.innerText = line.mime_wait_anim || 'Attendez que le joueur ait fini son mime…';
        btn.onclick = null;
    } else if (line.role === 'ANIM') {
        btn.disabled = false; btn.classList.add('green'); btn.innerText = 'APPUYEZ ICI';
        btn.onclick = () => advancePresentation();
    } else if (line.chant) {
        btn.disabled = true; btn.classList.remove('green');
        btn.innerText = `Attendez la fin de la prestation de ${displayRole(gameState, line.role)}…`;
        btn.onclick = null;
        // le bouton devient actif seulement quand le joueur a lancé sa prestation (voir onValue plus bas)
        if (gameState.chantEnCours) {
            btn.disabled = false; btn.classList.add('green');
            btn.innerText = 'Valider la fin de la performance du joueur';
            btn.onclick = () => advancePresentation();
        }
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
        if (line._buzzerFinal) text = text.split('[buzzer_gagnant]').join(names(s)[s.buzzerWinner] || '');
        const isLast = i === script.length - 1;
        await update(ref(db, 'gamestate'), Object.assign(
            { presentationIndex: i + 1, chantEnCours: false },
            addLog(s, line.role, text),
            isLast ? { phase: 'playing', turn: s.finalTurn || s.buzzerWinner || 'J1' } : {}
        ));
    } finally { presAdvancing = false; }
}
onValue(ref(db, 'gamestate/buzzerWinner'), async (snap) => {
    const winner = snap.val();
    if (!winner) return;
    const s = await fresh();
    const script = s.presentationScript || [];
    const i = s.presentationIndex || 0;
    const line = script[i];
    if (!line || line.role !== 'BUZZER') return;
    const text = fillNames(line.text, s, winner, otherOf(winner));
    await update(ref(db, 'gamestate'), Object.assign({ presentationIndex: i + 1 }, addLog(s, winner, text)));
});

onValue(ref(db, 'gamestate/presAdvanceRequest'), (snap) => {
    if (snap.val()) { set(ref(db, 'gamestate/presAdvanceRequest'), null); advancePresentation(); }
});

function renderSequenceStepAnim() {
    const script = gameState.sequenceScript || [];
    const i = gameState.sequenceIndex || 0;
    const line = script[i];
    const btn = document.getElementById('btn-appuyez-ici');
    const label = document.getElementById('presentation-segment');
    if (label) label.innerText = '';
    if (!line) return;
    if (line.role === 'ANIM') {
        btn.disabled = false; btn.classList.add('green'); btn.innerText = 'APPUYEZ ICI';
        btn.onclick = () => advanceSequence();
    } else {
        btn.disabled = true; btn.classList.remove('green');
        btn.innerText = `En attente de ${displayRole(gameState, line.role)}…`;
        btn.onclick = null;
    }
}

let seqAdvancing = false;
async function advanceSequence() {
    if (seqAdvancing) return;
    seqAdvancing = true;
    try {
        const s = await fresh();
        const script = s.sequenceScript || [];
        const i = s.sequenceIndex || 0;
        const line = script[i];
        if (!line) return;
        const isLast = i === script.length - 1;
        const patchObj = Object.assign({ sequenceIndex: i + 1 }, addLog(s, line.role, line.text));
        if (isLast) {
            patchObj.sequenceScript = null;
            patchObj.turn = s.sequenceAfterTurn != null ? s.sequenceAfterTurn : s.turn;
            patchObj.contrePending = true;
        }
        await update(ref(db, 'gamestate'), patchObj);
    } finally { seqAdvancing = false; }
}
onValue(ref(db, 'gamestate/sequenceAdvanceRequest'), (snap) => {
    if (snap.val()) { set(ref(db, 'gamestate/sequenceAdvanceRequest'), null); advanceSequence(); }
});

// ---------- 5) Boucle principale ----------
function hasSpoken(state) {
    const last = (state.history || [])[(state.history || []).length - 1];
    return !!(last && last.role === state.turn);
}

function renderJeuBar() {
    const cur = gameState.turn;
    document.getElementById('turn-indicator').innerText = `Tour de ${displayRole(gameState, cur)}`;

    // Défi chronométré en cours : on masque la barre normale, un seul bouton "Valider la prestation"
    document.getElementById('bar-jeu-normale').classList.toggle('hidden', !!gameState.defiMinute);
    document.getElementById('bar-defi-minute').classList.toggle('hidden', !gameState.defiMinute);
    if (gameState.defiMinute) {
        document.getElementById('defi-consigne-anim').innerText = gameState.defiMinute.consigneAnimateur || 'Attendez la prestation…';
        return;
    }

    const spoken = hasSpoken(gameState) || !!gameState.courteAwaitingDecision;
    const oppUsedTarget = gameState.oppositionUsedBy && gameState.oppositionUsedBy[cur];
    const oppCount = gameState.oppositionCount || 0;

    const btnContinuer = document.getElementById('btn-continuer');
    btnContinuer.disabled = !spoken || !!gameState.mystereCard || !!gameState.mystereForced;
    btnContinuer.classList.toggle('green', spoken && !gameState.mystereCard && !gameState.mystereForced && !gameState.contrePending);

    document.getElementById('btn-opposition').disabled = !spoken || !!gameState.mystereCard || oppUsedTarget || oppCount >= 2 || !!gameState.mystereForced;
    document.getElementById('btn-carte-mystere').disabled = !!gameState.mystereCard || !(gameState.mystereForced || (spoken && !gameState.carteMystereUsed && (gameState.turnCount || 0) >= (gameState.carteMystereThreshold || 3)));
    document.getElementById('btn-carte-mystere').classList.toggle('green', !gameState.mystereCard && (gameState.mystereForced || (!gameState.carteMystereUsed && spoken && (gameState.turnCount || 0) >= (gameState.carteMystereThreshold || 3))));
    document.getElementById('btn-valider').disabled = !gameState.contrePending;
    const overlay = document.getElementById('mystere-anim-overlay');
    overlay.classList.toggle('show', !!gameState.mystereCard);
    if (gameState.mystereCard) {
        const mvm = document.getElementById('mystere-valider-manche');
        const attenteJoueur = !gameState.mystereRevealJoueur;
        mvm.disabled = attenteJoueur;
        document.getElementById('mystere-anim-info').innerText =
            attenteJoueur ? `En attente de ${displayRole(gameState, gameState.turn)}…` : '';
    }
}

document.getElementById('btn-continuer').addEventListener('click', () => avancerTransition());
document.getElementById('btn-valider').addEventListener('click', () => avancerTransition());

// Certaines défis ne peuvent apparaître que si une demi-phrase précise vient d'être jouée.
function defiConditionnelEnAttente(s) {
    const dernier = (s.history || [])[(s.history || []).length - 1];
    const dernierTexte = dernier ? dernier.text.toLowerCase() : '';
    return (gameData.defis_chronometres || []).find(e =>
        e.declencheur_demi_phrase && dernierTexte.includes(e.declencheur_demi_phrase.toLowerCase()));
}

async function avancerTransition() {
    const s = await fresh();
    if (!hasSpoken(s) && !s.courteAwaitingDecision && !s.contrePending) return;
    const cur = s.turn;

    const forced = defiConditionnelEnAttente(s);
    if (forced) { await lancerDefi(s, forced, cur); return; }

    const raw = pickUnused(gameData.transitions, s.usedTransitions);
    const defi = (gameData.defis_chronometres || []).find(e => e.declencheur === raw);
    if (defi) { await lancerDefi(s, defi, cur); return; }

    if (raw === 'Oui, bravo ! Vous doublez votre capital point et vous tirez une carte mystère') {
        const text = fillNames(raw, s, cur, otherOf(cur));
        await update(ref(db, 'gamestate'), Object.assign(
            { mystereForced: true, turnCount: (s.turnCount || 0) + 1, contrePending: false, courteAwaitingDecision: null,
              usedTransitions: (s.usedTransitions || []).concat([raw]) },
            addLog(s, 'ANIM', text)
        ));
        return;
    }

    const text = fillNames(raw, s, cur, otherOf(cur));
    const boardSignal = maybeBoardPatch(text);
    const garde = /vous gardez la main/i.test(raw);
    const turnCount = (s.turnCount || 0) + 1;
    const threshold = s.carteMystereThreshold != null ? s.carteMystereThreshold : (Math.floor(Math.random() * 3) + 3);
    await update(ref(db, 'gamestate'), Object.assign(
        { turn: garde ? cur : otherOf(cur), turnCount, carteMystereThreshold: threshold, contrePending: false, courteAwaitingDecision: null,
          usedTransitions: (s.usedTransitions || []).concat([raw]) },
        addLog(s, 'ANIM', text), boardSignal
    ));
}

async function lancerDefi(s, defi, cur) {
    const boardPatch = defi.case_plateau ? signalBoardNamedCell(defi.case_plateau)
        : defi.deplacement_aleatoire_cases ? signalBoardRandom() : {};
    const text = fillNames(defi.declencheur, s, cur, otherOf(cur));
    const patchObj = Object.assign({}, boardPatch, addLog(s, 'ANIM', text));
    patchObj.defiMinute = {
        pourJoueur: cur, quiExecute: defi.qui_execute, consigne: defi.consigne, indice: defi.indice || null,
        consigneJoueursAlerte: defi.consigne_joueurs_alerte || null,
        consigneAnimateur: defi.consigne_animateur_defaut || `Attendez que ${defi.qui_execute === 'les_deux_joueurs' ? 'les joueurs aient' : 'le joueur ait'} fini`,
        duree_secondes: defi.duree_secondes || 3, apres: defi.apres || 'transition_normale',
    };
    await update(ref(db, 'gamestate'), patchObj);
}

document.getElementById('btn-valider-prestation').addEventListener('click', async () => {
    const s = await fresh();
    const d = s.defiMinute;
    if (!d) return;
    if (d.apres === 'contre_force_adversaire') {
        await update(ref(db, 'gamestate'), {
            defiMinute: null, contreForce: otherOf(d.pourJoueur), turn: otherOf(d.pourJoueur),
        });
        return;
    }
    await update(ref(db, 'gamestate'), { defiMinute: null, turn: otherOf(d.pourJoueur), turnCount: (s.turnCount || 0) + 1, courteAwaitingDecision: null, contrePending: false });
});

document.getElementById('btn-opposition').addEventListener('click', async () => {
    const s = await fresh();
    if (!hasSpoken(s)) return;
    const target = s.turn;
    if (s.oppositionUsedBy && s.oppositionUsedBy[target] && !s.mystereForced) return;
    const raw = pickUnused(gameData.oppositions, s.usedOppositions);
    const adv = otherOf(target);

    if (raw.startsWith('Impossible, vous avez Madonna qui jongle avec ses seins en opposition.')) {
        const decl = fillNames('Impossible, vous avez Madonna qui jongle avec ses seins en opposition.', s, target, adv);
        const hist = (s.history || []).concat([
            { role: 'ANIM', text: decl },
            { role: 'ANIM', text: '1, 2, 3...' },
            { role: adv, text: 'Nous irons au bois' },
            { role: 'ANIM', text: '4, 5, 6...' },
            { role: adv, text: 'Manger du pastis' },
            { role: 'ANIM', text: fillNames("C'est encore à vous [joueur actuel]", s, adv, target) },
        ]);
        await update(ref(db, 'gamestate'), {
            history: hist, turn: adv, phase: 'playing', contrePending: false, courteAwaitingDecision: null,
            oppositionCount: (s.oppositionCount || 0) + 1,
            [`oppositionUsedBy/${target}`]: true, hapticFor: target,
            oppositionFlashAt: Date.now(), usedOppositions: (s.usedOppositions || []).concat([raw]),
        });
        return;
    }

    const text = fillNames(raw, s, target, adv);
    await update(ref(db, 'gamestate'), Object.assign(
        {
            turn: adv, phase: 'playing', contrePending: false, courteAwaitingDecision: null,
            oppositionCount: (s.oppositionCount || 0) + 1,
            [`oppositionUsedBy/${target}`]: true, hapticFor: target,
            oppositionFlashAt: Date.now(), usedOppositions: (s.usedOppositions || []).concat([raw]),
        },
        addLog(s, 'ANIM', text)
    ));
});

document.getElementById('btn-carte-mystere').addEventListener('click', async () => {
    const s = await fresh();
    if (s.mystereCard || s.carteMystereUsed) return; // une seule carte mystère par partie, jamais deux à la fois
    if (!s.mystereForced && !hasSpoken(s)) return;
    const card = Object.assign({}, (s.mystereForced && s.mystereForcedCard) ? s.mystereForcedCard : pick(gameData.cartes_mystere_aleatoires), { ts: Date.now() });
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
            courteAwaitingDecision: finished ? null : s.courteAwaitingDecision,
            contrePending: finished ? false : s.contrePending,
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
    const shuffled = [...(gameData.monosyllabes || [])].sort(() => Math.random() - 0.5);
    const motsOptions = { J1: shuffled.slice(0, 6), J2: shuffled.slice(6, 12) };
    await update(ref(db, 'gamestate'), Object.assign({ phase: 'ending_words', motsOptions }, addLog(s, 'ANIM', text)));
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
    } else if (t.type === 'forced_contre_adversaire_scripted' && t.echange) {
        const roles = ['ANIM', cur, adv, cur, 'ANIM'];
        const script = [{ role: adv, text: t.contre_force_texte || 'Je contre !' }]
            .concat(t.echange.map((l, i) => ({ role: roles[i % roles.length], text: fillNames(l, s, cur, adv) })));
        await update(ref(db, 'gamestate'), { sequenceScript: script, sequenceIndex: 0, sequenceAfterTurn: adv });
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
    } else if (t.type === 'larsen_double_alerte' || t.type === 'defi_chronometre_ref') {
        const ref = t.type === 'larsen_double_alerte' ? '2 secondes de larsen' : t.ref;
        const defi = (gameData.defis_chronometres || []).find(e => e.declencheur === ref);
        if (defi) await lancerDefi(s, defi, cur);
    } else if (t.type === 'repeat_tap' || t.type === 'repeat_tap_reveal') {
        await update(ref(db, 'gamestate'), { repeatTap: { total: t.repetitions, count: 0, texte: t.texte_repete, final: t.texte_final } });
    }
});

// ---------- Mode animateur automatique ----------
// Ne fait rien de spécifique : se contente de "cliquer" les mêmes boutons que
// l'animateur humain, seulement quand ils sont visibles et actifs — aucune
// logique dupliquée, donc aucun risque de divergence avec le mode manuel.
let autoTimer = null;
document.getElementById('chk-auto-anim').addEventListener('change', (e) => {
    if (e.target.checked) {
        autoTimer = setInterval(autoTick, 3200);
    } else {
        clearInterval(autoTimer);
    }
});
function visible(el) { return el && !el.closest('.hidden') && el.offsetParent !== null; }
function autoTick() {
    const appuyez = document.getElementById('btn-appuyez-ici');
    if (visible(appuyez) && !appuyez.disabled) { appuyez.click(); return; }

    const validerPresta = document.getElementById('btn-valider-prestation');
    if (visible(validerPresta)) { validerPresta.click(); return; }

    const mystereManche = document.getElementById('mystere-valider-manche');
    if (visible(mystereManche) && !mystereManche.disabled) { mystereManche.click(); return; }

    const conclure = document.getElementById('btn-conclure');
    if (visible(conclure)) { conclure.click(); return; }
    const generiqueFinal = document.getElementById('btn-generique-final');
    if (visible(generiqueFinal)) { generiqueFinal.click(); return; }

    if (visible(document.getElementById('bar-jeu-normale'))) {
        const continuer = document.getElementById('btn-continuer');
        const opposition = document.getElementById('btn-opposition');
        const carteMystere = document.getElementById('btn-carte-mystere');
        const valider = document.getElementById('btn-valider');
        const roll = Math.random();
        if (!valider.disabled && roll < 0.5) { valider.click(); return; }
        if (!carteMystere.disabled && roll < 0.55) { carteMystere.click(); return; }
        if (!opposition.disabled && roll < 0.70) { opposition.click(); return; }
        if (!continuer.disabled) { continuer.click(); return; }
    }
}
