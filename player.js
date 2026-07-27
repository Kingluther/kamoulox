// player.js — téléphone de chaque joueur (?id=1 ou ?id=2)

import { db, ref, onValue, update, get, runTransaction } from './firebase-config.js';

const urlParams = new URLSearchParams(window.location.search);
const myId = `J${urlParams.get('id') || '1'}`;
const otherId = myId === 'J1' ? 'J2' : 'J1';

let gameData = {};
let gameState = {};
let selectionPool = null;
let firstHalf = null;
let poolA = [];
let poolB = [];
let courteOffer = null;   // { kind:'courte', text } ou { kind:'tentative', tentative }

get(ref(db, 'gamedata')).then(s => { gameData = s.val() || {}; render(); });
onValue(ref(db, 'gamestate'), (snap) => { gameState = snap.val() || {}; render(); });

async function fresh() { return (await get(ref(db, 'gamestate'))).val() || {}; }
async function patch(obj) { await update(ref(db, 'gamestate'), obj); }
function names(state) {
    const p = state.players || {};
    return { J1: (p.J1 && p.J1.persona) || 'Joueur 1', J2: (p.J2 && p.J2.persona) || 'Joueur 2' };
}
function myName() { return names(gameState)[myId]; }
function pickN(arr, n, exclude) {
    const ex = new Set((exclude || []).map(x => x.toLowerCase()));
    const copy = (arr || []).filter(x => !ex.has(x.toLowerCase()));
    const out = [];
    while (out.length < n && copy.length) out.push(copy.splice(Math.floor(Math.random() * copy.length), 1)[0]);
    return out;
}
function joinPhrase(a, b) {
    const aClean = a.replace(/[.!?]+\s*$/, '');
    const bClean = b.charAt(0).toLowerCase() + b.slice(1);
    return `${aClean} et ${bClean}`;
}
async function submitLine(role, text) {
    const s = await fresh();
    await patch({ history: (s.history || []).concat([{ role, text }]) });
}

// ---------------- Rendu ----------------
function el(id) { return document.getElementById(id); }
function show(...ids) {
    ['selection-screen', 'wait-screen', 'appuyez-screen', 'game-screen', 'mystere-screen', 'ending-words-screen']
        .forEach(id => el(id) && el(id).classList.toggle('hidden', !ids.includes(id)));
}

function render() {
    el('player-id-display').innerText = myName() || (myId === 'J1' ? 'Joueur 1' : 'Joueur 2');
    const phase = gameState.phase || 'lobby';

    if (phase === 'lobby' || phase === 'generique_debut') {
        show('wait-screen'); setWait('La partie va commencer…'); return;
    }
    if (phase === 'char_selection') { show('selection-screen'); renderSelection(); return; }
    if (phase === 'presentation') { renderPresentation(); return; }
    if (phase === 'playing') { renderGame(); return; }
    if (phase === 'kamoulox_declared') { show('wait-screen'); setWait('KAMOULOX !'); return; }
    if (phase === 'ending_words') { renderEndingWords(); return; }
    if (phase === 'ending') { show('wait-screen'); setWait('Merci et à bientôt !'); return; }
}
function setWait(t) { el('wait-screen').innerText = t; }

// ---------------- Sélection ----------------
function renderSelection() {
    const players = gameState.players || {};
    if (players[myId] && players[myId].persona) {
        el('character-list').innerHTML = `<p>Vous incarnez <b>${players[myId].persona}</b>. En attente…</p>`;
        return;
    }
    if (myId === 'J2' && !(players.J1 && players.J1.persona)) {
        el('character-list').innerHTML = `<p>En attente du choix du Joueur 1…</p>`;
        return;
    }
    if (!selectionPool) {
        const noms = [...new Set((gameData.personnages || []).map(p => p.nom))];
        const exclude = myId === 'J2' && players.J1 ? [players.J1.persona] : [];
        selectionPool = pickN(noms, 6, exclude);
    }
    const div = el('character-list');
    div.innerHTML = '';
    selectionPool.forEach(nom => {
        const b = document.createElement('button');
        b.className = 'card-perso';
        b.innerText = nom;
        b.onclick = () => patch({ [`players/${myId}/persona`]: nom });
        div.appendChild(b);
    });
}

// ---------------- Présentation / ouverture : bouton unique par intervenant ----------------
function renderPresentation() {
    const script = gameState.presentationScript || [];
    const i = gameState.presentationIndex || 0;
    const line = script[i];
    if (!line) { show('wait-screen'); setWait('…'); return; }

    if (line.role === 'BUZZER') {
        show('appuyez-screen');
        if (navigator.vibrate) navigator.vibrate(200);
        const btn = el('btn-appuyez-joueur');
        btn.innerText = line.text;
        btn.disabled = false;
        btn.onclick = async () => {
            btn.disabled = true;
            const result = await runTransaction(ref(db, 'gamestate/buzzerWinner'), (current) => current ? current : myId);
            if (!(result.committed && result.snapshot.val() === myId)) {
                setWait('Trop tard, l\'adversaire a été plus rapide !');
                show('wait-screen');
            }
        };
        return;
    }

    if (line.role === myId) {
        show('appuyez-screen');
        if (navigator.vibrate) navigator.vibrate(200);
        el('btn-appuyez-joueur').onclick = () => patch({ presAdvanceRequest: true });
    } else {
        show('wait-screen');
        setWait('👀 Regardez l\'écran central');
    }
}

// ---------------- Boucle principale ----------------
function kamouloxReady(s) {
    const cu = s.courteUsedBy || {};
    const cible = !!(cu.J1 && cu.J2 && (s.oppositionCount || 0) >= 1 && s.carteMystereUsed
        && s.contreUsed && (s.contreUsed.J1 || s.contreUsed.J2) && (s.comboCount || 0) >= 8);
    return cible || (s.turnCount || 0) >= 12;
}

function hasSpoken(s) {
    const last = (s.history || [])[(s.history || []).length - 1];
    return !!(last && last.role === s.turn);
}

function renderGame() {
    // Alerte double (ex. larsen) : les deux joueurs voient la même alerte, l'animateur fait la prestation
    if (gameState.alerteDouble) {
        show('game-screen');
        el('btn-et').classList.add('hidden'); el('btn-courte').classList.add('hidden');
        el('btn-contre').classList.add('hidden'); el('btn-kamoulox').classList.add('hidden');
        if (navigator.vibrate) navigator.vibrate([200, 100, 200, 100, 200]);
        el('phrase-pool').innerHTML =
            `<div style="background:#c62828; padding:24px; border-radius:10px; font-size:22px; font-weight:bold; animation: blink 0.5s infinite;">${gameState.alerteDouble.consigne_joueurs}</div>`;
        return;
    }

    // Défi minuté (imitation/chant chronométré) : bloque tout jusqu'à validation animateur
    if (gameState.defiMinute) {
        show('game-screen');
        el('btn-et').classList.add('hidden'); el('btn-courte').classList.add('hidden');
        el('btn-contre').classList.add('hidden'); el('btn-kamoulox').classList.add('hidden');
        const d = gameState.defiMinute;
        if (d.pourJoueur === myId) {
            if (navigator.vibrate) navigator.vibrate(200);
            el('phrase-pool').innerHTML = `<p style="font-size:20px;">${d.consigne_joueur}</p>` +
                (d.indice ? `<p style="font-size:14px;color:#ccc;">indice : ${d.indice}</p>` : '');
        } else {
            setInPool('Regardez et écoutez l\'écran central…');
        }
        return;
    }

    // Carte mystère : ce joueur doit retourner sa carte
    if (gameState.mystereCard && gameState.turn === myId && !gameState.mystereRevealJoueur) {
        show('mystere-screen');
        el('btn-mystere-retourner').onclick = () => patch({ mystereRevealJoueur: true });
        return;
    }
    if (gameState.mystereCard) { show('wait-screen'); setWait('Carte mystère en cours…'); return; }

    // Kamoulox : une fois les seuils atteints, le joueur perdant désigné est bloqué / l'autre peut conclure
    const prereq = kamouloxReady(gameState);
    if (prereq && gameState.turn === gameState.loser) {
        if (myId === gameState.loser) {
            show('game-screen');
            renderStuck();
        } else {
            show('game-screen');
            renderKamouloxOpportunity();
        }
        return;
    }

    // Réponse courte en attente d'arbitrage (contre possible) : prioritaire sur le tour normal
    if (gameState.courteAwaitingDecision) {
        show('game-screen');
        el('phrase-pool').innerHTML = '';
        el('btn-et').classList.add('hidden');
        el('btn-courte').classList.add('hidden');
        el('btn-kamoulox').classList.remove('glow');
        if (gameState.courteAwaitingDecision.by === myId) {
            setInPool('En attente (l\'animateur peut valider, ou l\'adversaire peut contrer)…');
            el('btn-contre').classList.add('hidden');
        } else {
            setInPool('Réponse courte de l\'adversaire !');
            renderContre(false);
        }
        return;
    }

    if (gameState.turn !== myId || (hasSpoken(gameState) && !firstHalf)) {
        show('wait-screen');
        setWait(gameState.turn === myId ? 'C\'est noté, en attente de la suite…' : 'En attente de l\'adversaire…');
        return;
    }

    show('game-screen');
    renderNormalTurn();
}
function setInPool(html) { el('phrase-pool').innerHTML = `<p>${html}</p>`; }

function renderStuck() {
    el('phrase-pool').innerHTML = '';
    const single = (gameData.demi_phrases && gameData.demi_phrases[0]) || '…';
    const grid = document.createElement('div');
    grid.className = 'grid4';
    const b = document.createElement('button');
    b.className = 'card-phrase selected'; b.innerText = single;
    grid.appendChild(b);
    el('phrase-pool').appendChild(grid);
    el('btn-et').classList.remove('hidden');
    el('btn-et').disabled = false;
    el('btn-et').onclick = () => {}; // volontairement sans effet
    el('btn-courte').classList.add('hidden');
    el('btn-contre').classList.add('hidden');
    el('btn-kamoulox').classList.remove('glow');
}
function renderKamouloxOpportunity() {
    el('phrase-pool').innerHTML = `<p>Votre adversaire semble bloqué…</p>`;
    el('btn-et').classList.add('hidden');
    el('btn-courte').classList.add('hidden');
    el('btn-contre').classList.add('hidden');
    const kb = el('btn-kamoulox');
    kb.classList.remove('hidden');
    kb.classList.add('glow');
    if (navigator.vibrate) navigator.vibrate([300, 150, 300, 150, 300]);
    kb.onclick = async () => {
        const s = await fresh();
        const stuckText = (gameData.demi_phrases && gameData.demi_phrases[0]) || '…';
        const hist = (s.history || []).concat([
            { role: s.loser, text: `${stuckText} et…` },
            { role: 'SYSTEM', text: 'KAMOULOX !!' },
        ]);
        await patch({ history: hist, phase: 'kamoulox_declared', winner: myId });
    };
}

function renderNormalTurn() {
    if (navigator.vibrate) navigator.vibrate(200);
    el('btn-kamoulox').classList.remove('glow');
    el('btn-kamoulox').onclick = null;
    const used = gameState.usedDemiPhrases || [];

    if (!firstHalf) {
        if (!poolA.length) poolA = pickN(gameData.demi_phrases, 4, used);
        renderGrid(poolA, false);
        el('btn-et').disabled = true;
        el('btn-et').classList.remove('hidden');
        el('btn-et').onclick = () => {
            const chosen = document.querySelector('#phrase-pool .card-phrase.selected');
            if (!chosen) return;
            firstHalf = chosen.dataset.value;
            poolB = pickN(gameData.demi_phrases, 4, used.concat([firstHalf]));
            renderGame();
        };
        renderOffers(true);
        renderContre(true);
    } else {
        renderGrid(poolB, true);
        el('btn-et').classList.add('hidden');
        renderOffers(false);
        renderContre(false);
    }
}

function renderGrid(pool, autoSubmitOnPick) {
    const container = el('phrase-pool');
    container.innerHTML = '';
    const grid = document.createElement('div');
    grid.className = 'grid4';
    pool.forEach(txt => {
        const b = document.createElement('button');
        b.className = 'card-phrase';
        b.dataset.value = txt;
        b.innerText = txt;
        b.onclick = async () => {
            if (autoSubmitOnPick) {
                document.querySelectorAll('#phrase-pool .card-phrase').forEach(x => { x.disabled = true; x.style.opacity = '0.5'; });
                const full = joinPhrase(firstHalf, txt);
                await submitLine(myId, full);
                const s = await fresh();
                await patch({
                    usedDemiPhrases: (s.usedDemiPhrases || []).concat([firstHalf, txt]),
                    turnCount: (s.turnCount || 0) + 1,
                    comboCount: (s.comboCount || 0) + 1,
                });
                firstHalf = null; poolA = []; poolB = [];
                await checkConditionalTrigger(txt);
            } else {
                document.querySelectorAll('#phrase-pool .card-phrase').forEach(x => x.classList.remove('selected'));
                b.classList.add('selected');
                el('btn-et').disabled = false;
            }
        };
        grid.appendChild(b);
    });
    container.appendChild(grid);
}

function renderOffers(active) {
    const btn = el('btn-courte');
    if (!active) { btn.classList.add('hidden'); return; }
    const turnCount = gameState.turnCount || 0;
    const isLoserTurn = gameState.turn === gameState.loser;
    const canTentative = isLoserTurn && !gameState.tentativeUsed && turnCount >= 4;
    // Désormais proposée à chaque tour (banque suffisamment fournie)

    if (canTentative && !courteOffer) {
        courteOffer = { kind: 'tentative', tentative: pick(gameData.tentatives_mini_jeux) };
    } else if (!courteOffer) {
        const opt = pickN(gameData.phrases_courtes, 1, gameState.usedPhrasesCourtes || [])[0];
        if (opt) courteOffer = { kind: 'courte', text: opt };
    }
    if (!courteOffer) { btn.classList.add('hidden'); return; }

    btn.classList.remove('hidden');
    btn.innerText = courteOffer.kind === 'tentative' ? `Je tente le ${courteOffer.tentative.nom}` : courteOffer.text;
    btn.onclick = async () => {
        const offer = courteOffer;
        if (offer.kind === 'tentative') {
            await submitLine(myId, `Je tente le ${offer.tentative.nom}…`);
            await patch({ tentativeUsed: true, tentativeRequest: { tentative: offer.tentative } });
        } else {
            await submitLine(myId, offer.text);
            const s = await fresh();
            await patch({
                usedPhrasesCourtes: (s.usedPhrasesCourtes || []).concat([offer.text]),
                [`courteUsedBy/${myId}`]: true,
            });
            const declenche = await checkConditionalTrigger(offer.text);
            if (!declenche) {
                await patch({ contrePending: false, courteAwaitingDecision: { by: myId, text: offer.text }, hapticFor: otherId });
            }
        }
        courteOffer = null;
    };
}

function renderContre(active) {
    const btn = el('btn-contre');
    // contre suite à une réponse courte de l'adversaire
    if (gameState.courteAwaitingDecision && gameState.courteAwaitingDecision.by === otherId) {
        const canContre = !(gameState.contreUsed && gameState.contreUsed[myId]);
        btn.classList.toggle('hidden', !canContre);
        btn.innerText = 'Contrer !';
        if (navigator.vibrate) navigator.vibrate(250);
        btn.onclick = async () => {
            const phrase = (gameData.je_contre && gameData.je_contre.length) ? gameData.je_contre[Math.floor(Math.random() * gameData.je_contre.length)] : 'Je contre !';
            await submitLine(myId, phrase);
            const s = await fresh();
            await patch({
                [`contreUsed/${myId}`]: true,
                courteAwaitingDecision: null,
                contrePending: true,
            });
        };
        return;
    }
    if (!active) { btn.classList.add('hidden'); return; }
    const canContre = !(gameState.contreUsed && gameState.contreUsed[myId]);
    btn.classList.toggle('hidden', !canContre);
    btn.innerText = 'Je contre !';
    btn.onclick = async () => {
        const phrase = (gameData.je_contre && pick(gameData.je_contre)) || 'Je contre !';
        await submitLine(myId, phrase);
        const s = await fresh();
        await patch({ [`contreUsed/${myId}`]: true, turnCount: (s.turnCount || 0) + 1, contrePending: true });
        firstHalf = null; poolA = []; poolB = [];
    };
}

// ---------------- Mot de fin ----------------
function renderEndingWords() {
    show('ending-words-screen');
    const mots = gameState.mots || {};
    if (mots[myId]) {
        el('ending-words-list').innerHTML = `<p>Vous avez dit : <b>${mots[myId]}</b>. En attente de l'autre joueur…</p>`;
        return;
    }
    const options = pickN(gameData.monosyllabes, 6, []);
    el('ending-words-list').innerHTML = '';
    options.forEach(mot => {
        const b = document.createElement('button');
        b.className = 'card-phrase';
        b.innerText = mot;
        b.onclick = async () => {
            const s = await fresh();
            await patch({ [`mots/${myId}`]: mot, history: (s.history || []).concat([{ role: myId, text: mot }]) });
        };
        el('ending-words-list').appendChild(b);
    });
}

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

async function checkConditionalTrigger(texteJoue) {
    const low = texteJoue.toLowerCase();
    const carte = (gameData.cartes_mystere_conditionnelles || []).find(c => c.type === 'demi_phrase' && low.includes(c.declencheur_action.toLowerCase()));
    if (carte) {
        await patch({ mystereCard: Object.assign({}, carte, { ts: Date.now() }), mystereManche: 0, mystereRevealJoueur: false });
        return true;
    }
    const evt = (gameData.evenements_plateau_imitation || []).find(e =>
        (e.declencheur_demi_phrase && low.includes(e.declencheur_demi_phrase.toLowerCase())) ||
        (e.declencheur_phrase_courte && low.includes(e.declencheur_phrase_courte.toLowerCase())));
    if (evt && evt.consigne_joueur) {
        await patch({
            defiMinute: {
                pourJoueur: myId, consigne_joueur: evt.consigne_joueur, indice: evt.indice || null,
                consigne_animateur: evt.consigne_animateur, duree_secondes: evt.duree_secondes || 3,
                passeAuAdversaire: !evt.garde_la_main,
            },
        });
        return true;
    }
    return false;
}
