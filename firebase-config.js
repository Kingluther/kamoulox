// firebase-config.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getDatabase, ref, onValue, set, update, get, runTransaction } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

// Votre configuration Firebase
const firebaseConfig = {
  apiKey: "AIzaSyD1hWT0TNUiwJ4J_GUa9bcHTp9QR0l5tyE",
  authDomain: "kamoulox-3af31.firebaseapp.com",
  projectId: "kamoulox-3af31",
  storageBucket: "kamoulox-3af31.firebasestorage.app",
  messagingSenderId: "883891967275",
  appId: "1:883891967275:web:bb91c4f23ae42b38b3a16e",
  databaseURL: "https://kamoulox-3af31-default-rtdb.europe-west1.firebasedatabase.app"
};

// Initialisation de Firebase
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// Exportation des modules nécessaires pour les autres fichiers (admin.html, host.js, player.js)
export { db, ref, onValue, set, update, get, runTransaction };