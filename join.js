// join.js
import { db, ref, runTransaction, onValue, set, update } from './firebase-config.js';

new QRCode(document.getElementById('qrcode'), {
    text: window.location.href,
    width: 200, height: 200,
});

if (['localhost', '127.0.0.1'].includes(window.location.hostname)) {
    document.getElementById('status').innerText =
        "⚠️ Cette page est ouverte via localhost — le QR code ne fonctionnera pas depuis un téléphone. " +
        "Rouvrez cette page en remplaçant localhost/127.0.0.1 par l'adresse IP locale de ce PC (ex. http://10.33.184.157:5500/join.html).";
}

const myClientId = 'c_' + Math.random().toString(36).slice(2, 10);

onValue(ref(db, 'gamestate/roles'), (snap) => {
    const roles = snap.val() || {};
    document.getElementById('role-J1').disabled = !!roles.J1;
    document.getElementById('role-J1').classList.toggle('free', !roles.J1);
    document.getElementById('role-J2').disabled = !!roles.J2;
    document.getElementById('role-J2').classList.toggle('free', !roles.J2);
    document.getElementById('role-anim').disabled = !!roles.animateur;
    document.getElementById('role-anim').classList.toggle('free', !roles.animateur);

    if (roles.J1 && roles.J2 && roles.animateur) {
        document.getElementById('status').innerText = 'Les 3 rôles sont pris — bascule sur l\'écran central…';
        update(ref(db, 'gamestate'), { phase: 'lobby', mots: null, history: [], players: null });
        setTimeout(() => { window.location.href = 'ecran-central.html'; }, 1500);
    }
});

async function claim(roleKey, redirect) {
    const r = ref(db, `gamestate/roles/${roleKey}`);
    const result = await runTransaction(r, (current) => current ? current : myClientId);
    if (result.committed && result.snapshot.val() === myClientId) {
        window.location.href = redirect;
    } else {
        document.getElementById('status').innerText = "Ce rôle vient d'être pris par quelqu'un d'autre — choisissez-en un autre.";
    }
}

document.getElementById('role-J1').addEventListener('click', () => claim('J1', 'player.html?id=1'));
document.getElementById('role-J2').addEventListener('click', () => claim('J2', 'player.html?id=2'));
document.getElementById('role-anim').addEventListener('click', () => claim('animateur', 'animateur.html'));
