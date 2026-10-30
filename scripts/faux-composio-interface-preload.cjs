/* eslint-disable @typescript-eslint/no-require-imports -- Preload réservé au harnais UI. */
const { contextBridge, ipcRenderer } = require("electron");
const succes = (data = null) => Promise.resolve({ ok: true, data });
const ecouter = () => () => {};
const appel = (nom) => (...args) => ipcRenderer.invoke("fixture:composio", nom, ...args);
contextBridge.exposeInMainWorld("klyra", {
  agents: { list: () => succes({ dir: "/fixture/agents", exists: true, agents: [] }), readMeta: () => succes({}), mes: () => succes({ version: 1, depart: "reprise", assistant: { nom: "Assistant test", teinte: null }, agents: {} }), onChange: ecouter },
  conversations: { read: () => succes({ version: 1, chats: [], messages: [], projects: [], routines: [], artefacts: [], currentUser: { id: "fixture", name: "Profil simulé", title: "Test", initial: "T" } }), write: () => succes(), avantFermeture: ecouter },
  claude: { compte: () => succes({ installe: false, chemin: null, version: null, connecte: false, methode: null, email: null, organisation: null, abonnement: null, verifieLe: Date.now() }), onEvent: ecouter, utilisation: () => succes(null), onUtilisation: ecouter },
  systeme: { utilisateur: () => succes({ nom: "Profil simulé", identifiant: "fixture" }), sonsCoupes: () => succes(true), onOuvrirChat: ecouter },
  planning: { ecrire: () => succes() },
  composio: Object.fromEntries(["etat", "importer", "retirer", "selectionner", "connecter", "deconnecter", "console"].map((nom) => [nom, appel(nom)])),
});
