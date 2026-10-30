"use client";

import { jouer, sonDepuis } from "./sons";
import { MICROINTERACTIONS, type Microinteraction } from "./themes";

/**
 * Les microinteractions de toute l'app, à un seul endroit : on suit les
 * gestes de la personne (pointeur, clavier) et ce qu'ils ouvrent ou ferment,
 * puis on passe par `jouer()`. Les composants n'ont rien à appeler ; un
 * contrôle peut seulement préciser `data-son` : `aucun` (il se tait, avec ce
 * qu'il contient), `panneau` (bouton `aria-pressed` qui ouvre ou ferme un
 * panneau), ou le son voulu (`fermer` sur la croix d'un panneau sans rôle).
 *
 * Un geste ne fait qu'un son, le plus parlant : un son d'événement joué
 * pendant le geste (envoi, interrupteur, validation, aperçu…) ; sinon
 * sélection > ouvrir > choix dans un menu > fermer > clic.
 *
 * Rien ne sonne hors d'un geste (survol, défilement, ce qui s'ouvre tout
 * seul), pendant la frappe dans un champ, ni à la fin d'un glisser.
 */

/** Les contrôles qui sonnent au clic. */
const CONTROLES = [
  "button",
  "a[href]",
  "summary",
  'input[type="checkbox"]',
  'input[type="radio"]',
  ...["button", "link", "menuitem", "menuitemradio", "menuitemcheckbox", "option", "tab", "radio", "checkbox", "switch", "treeitem"].map(
    (role) => `[role="${role}"]`,
  ),
].join(", ");
/** Ce qui s'ouvre et se ferme : menus, popovers, fenêtres, listes. */
const OUVRANTS = '[role="menu"], [role="dialog"], [role="alertdialog"], [role="listbox"]';
/** Les rôles d'un choix parmi d'autres : onglet, filtre, option. */
const CHOIX = new Set(["tab", "radio", "option", "checkbox", "menuitemradio", "menuitemcheckbox"]);
/** Les champs où l'on tape : seules Échap et Entrée y font un geste. */
const SANS_FRAPPE = new Set(["button", "submit", "reset", "checkbox", "radio", "range", "color", "file", "image"]);

/** Au-delà, le pointeur a glissé entre l'appui et le relâchement : ce n'est plus un clic. */
const GLISSER_PX = 6;
/** Un geste resté ouvert (pointeur jamais relâché) est oublié après ce délai. */
const GESTE_MAX_MS = 5000;

/** Le plus parlant l'emporte. Fermer « ailleurs » : un menu fermé parce qu'on a cliqué autre chose. */
const RANG = { fermerAilleurs: 0.5, clic: 1, fermer: 2, choixDansMenu: 2.5, ouvrir: 3, selection: 4 } as const;

interface Demande {
  evenement: Microinteraction;
  rang: number;
}

interface Geste {
  debut: number;
  /** Ce que le pointeur a pressé, ou ce qui avait le focus au clavier. */
  cible: Element | null;
  x: number;
  y: number;
  /** Frappe dans un champ : le geste se tait. */
  frappe: boolean;
  demande: Demande | null;
  /** Les sortes ouvertes, et fermées (avec la cible dedans ou non). Un menu remplacé par un menu ne compte pas. */
  ouverts: Set<string>;
  fermes: Map<string, boolean>;
  /** Les boutons dont `aria-expanded` a changé, avec leur valeur d'avant le geste. */
  deplies: Map<Element, string | null>;
}

let geste: Geste | null = null;

function commencer(cible: Element | null, x = Number.NaN, y = Number.NaN): Geste {
  if (geste && performance.now() - geste.debut < GESTE_MAX_MS) return geste;
  geste = { debut: performance.now(), cible, x, y, frappe: false, demande: null, ouverts: new Set(), fermes: new Map(), deplies: new Map() };
  return geste;
}

/** La cible du geste était dans ce qui s'est fermé (bouton d'une fenêtre, voile, option) : elle a disparu avec. */
const cibleDedans = (g: Geste, el?: Element) => !!g.cible && ((el?.contains(g.cible) ?? false) || !g.cible.isConnected);

function demander(g: Geste, demande: Demande | null) {
  if (demande && (!g.demande || demande.rang > g.demande.rang)) g.demande = demande;
}

/** Le son du geste, une fois tout ce qu'il a déclenché rendu (React, observateur). */
function finirBientot(observateur: MutationObserver) {
  const g = geste;
  setTimeout(() => {
    if (!g || geste !== g) return;
    noter(observateur.takeRecords());
    geste = null;
    for (const sorte of g.ouverts) if (!g.fermes.has(sorte)) demander(g, { evenement: "ouvrir", rang: RANG.ouvrir });
    for (const [sorte, dedans] of g.fermes)
      if (!g.ouverts.has(sorte)) demander(g, { evenement: "fermer", rang: dedans ? RANG.fermer : RANG.fermerAilleurs });
    // Un bouton qui déplie (aria-expanded) : son popover s'est ouvert ou fermé, au clic, à Échap ou à côté.
    for (const [el, avant] of g.deplies) {
      const apres = el.getAttribute("aria-expanded");
      if (apres === avant) continue;
      if (apres === "true") demander(g, { evenement: "ouvrir", rang: RANG.ouvrir });
      else if (avant === "true") demander(g, { evenement: "fermer", rang: cibleDedans(g) ? RANG.fermer : RANG.fermerAilleurs });
    }
    if (g.frappe || !g.demande || sonDepuis(g.debut)) return;
    jouer(g.demande.evenement);
  }, 0);
}

/** Le son d'un clic, d'après le contrôle et son état avant le clic. */
function classer(cible: Element): Demande | null {
  const controle = cible.closest(CONTROLES);
  if (!controle || controle.matches(':disabled, [aria-disabled="true"]')) return null;
  if (controle.closest('[data-son="aucun"]')) return null;
  const consigne = controle.getAttribute("data-son");
  const impose = MICROINTERACTIONS.find((m) => m === consigne);
  if (impose) return { evenement: impose, rang: RANG[impose] };
  const role = controle.getAttribute("role");
  // L'interrupteur a ses propres sons (activé, désactivé).
  if (role === "switch") return null;
  const deplie =
    controle.getAttribute("aria-expanded") ??
    (consigne === "panneau" ? controle.getAttribute("aria-pressed") : null) ??
    (controle.parentElement instanceof HTMLDetailsElement && controle.tagName === "SUMMARY" ? String(controle.parentElement.open) : null);
  if (deplie !== null) return deplie === "true" ? { evenement: "fermer", rang: RANG.fermer } : { evenement: "ouvrir", rang: RANG.ouvrir };
  if ((role && CHOIX.has(role)) || controle.matches('input[type="checkbox"], input[type="radio"], [aria-pressed]'))
    return { evenement: "selection", rang: RANG.selection };
  return { evenement: "clic", rang: role === "menuitem" ? RANG.choixDansMenu : RANG.clic };
}

function dansUnChamp(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable || el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLInputElement) return !SANS_FRAPPE.has(el.type);
  const role = el.getAttribute("role");
  return role === "textbox" || role === "searchbox";
}

function ouvrants(n: Node): Element[] {
  if (!(n instanceof Element)) return [];
  const dedans = Array.from(n.querySelectorAll(OUVRANTS));
  return n.matches(OUVRANTS) ? [n, ...dedans] : dedans;
}

const sorte = (el: Element) => el.getAttribute("role") ?? "";

/** Ce qui s'est ouvert ou fermé pendant le geste. Hors geste : rien à faire, et rien à lire. */
function noter(enregistrements: MutationRecord[]) {
  const g = geste;
  if (!g) return;
  for (const e of enregistrements) {
    if (e.type === "attributes") {
      if (!g.deplies.has(e.target as Element)) g.deplies.set(e.target as Element, e.oldValue);
      continue;
    }
    for (const n of e.addedNodes) for (const el of ouvrants(n)) g.ouverts.add(sorte(el));
    for (const n of e.removedNodes) for (const el of ouvrants(n)) g.fermes.set(sorte(el), !!g.fermes.get(sorte(el)) || cibleDedans(g, el));
  }
}

/**
 * Suit les gestes et ce qu'ils ouvrent ou ferment, pour toute l'app. Une fois,
 * au démarrage (SonsApp) ; renvoie de quoi tout arrêter.
 */
export function ecouterInteractions(): () => void {
  const observateur = new MutationObserver(noter);
  observateur.observe(document.body, { childList: true, subtree: true, attributeFilter: ["aria-expanded"], attributeOldValue: true });

  const appui = (e: PointerEvent) => {
    if (e.isTrusted) commencer(e.target instanceof Element ? e.target : null, e.clientX, e.clientY);
  };
  const relache = () => {
    if (geste) finirBientot(observateur);
  };
  const clic = (e: MouseEvent) => {
    if (!e.isTrusted || !(e.target instanceof Element)) return;
    const nouveau = !geste;
    const g = commencer(e.target);
    // detail 0 : clic du clavier (Entrée, Espace), sans position.
    const glisse = e.detail > 0 && Number.isFinite(g.x) && Math.hypot(e.clientX - g.x, e.clientY - g.y) > GLISSER_PX;
    if (!glisse) demander(g, classer(e.target));
    if (nouveau) finirBientot(observateur);
  };
  const touche = (e: KeyboardEvent) => {
    if (!e.isTrusted) return;
    const g = commencer(document.activeElement);
    if (e.isComposing || (dansUnChamp(e.target) && e.key !== "Escape" && e.key !== "Enter")) g.frappe = true;
    finirBientot(observateur);
  };

  window.addEventListener("pointerdown", appui, true);
  window.addEventListener("pointerup", relache, true);
  window.addEventListener("pointercancel", relache, true);
  window.addEventListener("click", clic, true);
  window.addEventListener("keydown", touche, true);

  return () => {
    observateur.disconnect();
    geste = null;
    window.removeEventListener("pointerdown", appui, true);
    window.removeEventListener("pointerup", relache, true);
    window.removeEventListener("pointercancel", relache, true);
    window.removeEventListener("click", clic, true);
    window.removeEventListener("keydown", touche, true);
  };
}
