import type { Recette, Voix } from "./synthese";

/**
 * Les thèmes de sons et leurs recettes. Chaque thème a son jeu complet, d'une
 * même matière, pour tous les événements ; « silence » n'en a pas (la fin de
 * tâche prend alors celle du thème par défaut, cf. sons.ts).
 */

export type ThemeSons = "silence" | "chaleureux" | "mecanique" | "petillant" | "clavier";

/** Ce qui sonne. Pas de son sur un clic ordinaire : seulement ce qui confirme ou prévient. */
export type EvenementSonore =
  | "envoi"
  | "fin-de-tache"
  | "erreur"
  | "notification"
  | "dictee-debut"
  | "dictee-fin"
  | "maj-prete"
  | "active"
  | "desactive"
  | "validation";

export const THEMES: { id: ThemeSons; titre: string; matiere: string }[] = [
  { id: "silence", titre: "Désactivé", matiere: "Silence" },
  { id: "chaleureux", titre: "Chaleureux", matiere: "Verre et bois" },
  { id: "mecanique", titre: "Mécanique", matiere: "Clics et loquets" },
  { id: "petillant", titre: "Pétillant", matiere: "Gouttes et bulles" },
  { id: "clavier", titre: "Clavier", matiere: "Touches mécaniques" },
];

/* Les notes utilisées, en Hz. */
const RE4_DIESE = 311.13;
const SOL4 = 392;
const DO5 = 523.25;
const MI5 = 659.25;
const FA5_DIESE = 739.99;
const SOL5 = 783.99;
const LA5 = 880;
const SI5 = 987.77;
const DO6 = 1046.5;
const MI6 = 1318.51;
const SOL6 = 1567.98;
const LA6 = 1760;
const DO7 = 2093;

/* ─── Matières ───────────────────────────────────────────────────── */

/** Verre frappé : partiels inharmoniques d'une lame libre, l'aigu s'éteint vite, plus l'éclat du choc. */
function verre(t: number, f: number, gain = 1, declin = 1, pan = 0): Voix[] {
  return [
    {
      type: "ton",
      t,
      f,
      gain,
      pan,
      attaque: 0.0015,
      partiels: [
        [1, 1, declin],
        [2.76, 0.32, declin * 0.45],
        [5.4, 0.1, declin * 0.22],
        [8.93, 0.04, declin * 0.12],
      ],
    },
    { type: "bruit", t, declin: 0.012, gain: gain * 0.18, pan, filtres: [{ type: "highpass", f: 5000 }] },
  ];
}

/** Bois : une lame accordée comme un marimba (partiel à 3,93), courte, et le « toc » de la mailloche. */
function bois(t: number, f: number, gain = 1, declin = 0.16, pan = 0): Voix[] {
  return [
    {
      type: "ton",
      t,
      f,
      gain,
      pan,
      attaque: 0.001,
      partiels: [
        [1, 1, declin],
        [3.93, 0.22, declin * 0.4],
        [9.2, 0.05, declin * 0.15],
      ],
    },
    { type: "bruit", t, declin: 0.02, gain: gain * 0.35, pan, attaque: 0.0005, filtres: [{ type: "bandpass", f: f * 2.2, q: 2.5 }] },
  ];
}

/** Clic : un claquement bref, la résonance du ressort, et un petit coup sourd. */
function clic(t: number, f = 3200, gain = 1, pan = 0): Voix[] {
  return [
    { type: "bruit", t, declin: 0.004, gain, pan, attaque: 0.0003, filtres: [{ type: "highpass", f: 2000 }] },
    { type: "bruit", t, declin: 0.03, gain: gain * 0.9, pan, attaque: 0.0003, filtres: [{ type: "bandpass", f, q: 9 }] },
    { type: "ton", t, f: 150, gain: gain * 0.25, pan, partiels: [[1, 1, 0.03]] },
  ];
}

/** Petit anneau de métal : partiels d'une plaque. */
function anneau(t: number, f: number, gain: number, declin: number, pan = 0): Voix {
  return {
    type: "ton",
    t,
    f,
    gain,
    pan,
    attaque: 0.001,
    partiels: [
      [1, 1, declin],
      [1.47, 0.45, declin * 0.7],
      [2.09, 0.25, declin * 0.5],
    ],
  };
}

/** Loquet qui se ferme : le clic, le corps qui encaisse, le métal qui tinte un instant. */
function loquet(t: number, f = 2100, tinte = 2900, gain = 1, declin = 0.14, pan = 0): Voix[] {
  return [
    ...clic(t, f, gain, pan),
    { type: "bruit", t, declin, gain: gain * 0.35, pan, filtres: [{ type: "bandpass", f: tinte, q: 40 }] },
    anneau(t, tinte, gain * 0.12, declin, pan),
    { type: "ton", t, f: 110, gain: gain * 0.35, pan, partiels: [[1, 1, 0.05]] },
  ];
}

/** Coup sourd, mat : rien ne s'enclenche. */
function sourd(t: number, gain = 1): Voix[] {
  return [
    { type: "bruit", t, declin: 0.05, gain, filtres: [{ type: "lowpass", f: 900 }, { type: "bandpass", f: 480, q: 2.5 }] },
    { type: "ton", t, f: 105, gain: gain * 0.6, partiels: [[1, 1, 0.07], [2.4, 0.3, 0.03]] },
  ];
}

/** Bulle : une résonance dont la hauteur monte en s'éteignant. */
function bulle(t: number, f: number, gain = 1, rapport = 1.9, declin = 0.07, pan = 0): Voix[] {
  return [
    {
      type: "ton",
      t,
      f,
      gain,
      pan,
      attaque: 0.003,
      glisse: { rapport, duree: declin * 0.6 },
      partiels: [
        [1, 1, declin],
        [2, 0.08, declin * 0.5],
      ],
    },
  ];
}

/** Goutte : un « plink » clair, presque une note, après un petit impact. */
function goutte(t: number, f: number, gain = 1, pan = 0): Voix[] {
  return [
    {
      type: "ton",
      t,
      f,
      gain,
      pan,
      attaque: 0.001,
      glisse: { rapport: 1.35, duree: 0.012 },
      partiels: [
        [1, 1, 0.16],
        [2.1, 0.12, 0.06],
      ],
    },
    { type: "bruit", t, declin: 0.006, gain: gain * 0.15, pan, filtres: [{ type: "highpass", f: 3000 }] },
  ];
}

/** Goutte qui retombe : la hauteur descend. */
function chute(t: number, f: number, gain = 1): Voix[] {
  return [{ type: "ton", t, f, gain, attaque: 0.002, glisse: { rapport: 0.62, duree: 0.09 }, partiels: [[1, 1, 0.14], [2, 0.06, 0.05]] }];
}

/** Touche enfoncée jusqu'au fond : le contact, le capuchon qui claque, le boîtier qui résonne. */
function touche(t: number, corps = 220, gain = 1, pan = 0): Voix[] {
  return [
    { type: "bruit", t, declin: 0.006, gain: gain * 0.6, pan, attaque: 0.0003, filtres: [{ type: "highpass", f: 3500 }] },
    { type: "bruit", t, declin: 0.022, gain, pan, attaque: 0.0003, filtres: [{ type: "lowpass", f: 2600 }, { type: "bandpass", f: 1100, q: 1.2 }] },
    { type: "ton", t, f: corps, gain: gain * 0.45, pan, partiels: [[1, 1, 0.05], [2.3, 0.3, 0.025]] },
  ];
}

/** Touche relâchée : plus léger, plus haut. */
function relache(t: number, gain = 1, pan = 0): Voix[] {
  return [
    { type: "bruit", t, declin: 0.005, gain: gain * 0.4, pan, filtres: [{ type: "highpass", f: 2500 }] },
    { type: "bruit", t, declin: 0.012, gain: gain * 0.35, pan, filtres: [{ type: "bandpass", f: 1600, q: 1.5 }] },
    { type: "ton", t, f: 320, gain: gain * 0.15, pan, partiels: [[1, 1, 0.02]] },
  ];
}

const frappe = (t: number, corps: number, gain: number, pan = 0) => [...touche(t, corps, gain, pan), ...relache(t + 0.075, gain * 0.8, pan)];

/** Le petit interrupteur tactile : un clic sec, sans corps. */
function bascule(t: number, f: number, gain = 1): Voix[] {
  return [
    { type: "bruit", t, declin: 0.005, gain, attaque: 0.0003, filtres: [{ type: "highpass", f: 4000 }] },
    { type: "bruit", t, declin: 0.012, gain: gain * 0.7, attaque: 0.0003, filtres: [{ type: "bandpass", f, q: 4 }] },
  ];
}

/** La clochette de fin de ligne d'une machine à écrire. */
function clochette(t: number, f = 2350, gain = 1, declin = 1): Voix[] {
  return [
    {
      type: "ton",
      t,
      f,
      gain,
      attaque: 0.001,
      partiels: [
        [1, 1, declin],
        [2.42, 0.45, declin * 0.6],
        [4.13, 0.2, declin * 0.35],
        [6.3, 0.08, declin * 0.2],
      ],
    },
    { type: "bruit", t, declin: 0.01, gain: gain * 0.2, filtres: [{ type: "highpass", f: 4000 }] },
  ];
}

/* ─── Les jeux ───────────────────────────────────────────────────── */

type Jeu = Record<EvenementSonore, Recette>;

const CHALEUREUX: Jeu = {
  envoi: { piece: 0.18, niveau: 0.8, voix: [...bois(0, MI5, 0.8, 0.12), ...verre(0.04, MI6, 0.6, 0.5)] },
  "fin-de-tache": { piece: 0.22, voix: [...bois(0, DO5, 0.35, 0.14), ...verre(0, DO6, 0.8, 1.1, -0.15), ...verre(0.12, SOL6, 0.7, 1.3, 0.15)] },
  erreur: { piece: 0.15, niveau: 0.9, voix: [...bois(0, SOL4, 1, 0.22), ...bois(0.14, RE4_DIESE, 1, 0.28)] },
  notification: { piece: 0.22, niveau: 0.95, voix: [...verre(0, SOL6, 0.75, 1), ...verre(0.16, MI6, 0.75, 1.3)] },
  "dictee-debut": { piece: 0.12, niveau: 0.6, voix: [...bois(0, LA5, 0.5, 0.07), ...verre(0.012, LA6, 0.5, 0.22)] },
  "dictee-fin": { piece: 0.12, niveau: 0.6, voix: [...bois(0, MI5, 0.5, 0.07), ...verre(0.012, MI6, 0.5, 0.22)] },
  "maj-prete": {
    piece: 0.22,
    voix: [...verre(0, DO6, 0.6, 0.9, -0.3), ...verre(0.085, MI6, 0.6, 0.9, -0.1), ...verre(0.17, SOL6, 0.6, 1, 0.1), ...verre(0.255, DO7, 0.6, 1.4, 0.3)],
  },
  active: { piece: 0.1, niveau: 0.45, voix: bois(0, SI5, 0.7, 0.06) },
  desactive: { piece: 0.1, niveau: 0.45, voix: bois(0, FA5_DIESE, 0.7, 0.06) },
  validation: { piece: 0.16, niveau: 0.75, voix: [...bois(0, SOL5, 0.7, 0.1), ...verre(0.03, SOL6, 0.5, 0.6)] },
};

const MECANIQUE: Jeu = {
  envoi: { piece: 0.08, niveau: 0.75, voix: [...clic(0, 3400, 0.8), ...loquet(0.038, 2100, 2900, 1)] },
  "fin-de-tache": {
    piece: 0.1,
    niveau: 0.95,
    voix: [...clic(0, 2600, 0.55, -0.2), ...clic(0.06, 2900, 0.6, -0.1), ...clic(0.11, 3200, 0.65), ...loquet(0.2, 1900, 3150, 1, 0.3, 0.1)],
  },
  erreur: { piece: 0.08, niveau: 0.9, voix: [...sourd(0), ...sourd(0.12)] },
  notification: { piece: 0.12, niveau: 0.9, voix: [...clic(0, 3000, 0.6), ...clic(0.05, 3300, 0.6), anneau(0.1, 3150, 0.7, 0.45)] },
  "dictee-debut": { niveau: 0.6, voix: [...clic(0, 3800, 0.9), ...clic(0.014, 4400, 0.5)] },
  "dictee-fin": { niveau: 0.6, voix: [...clic(0, 2600, 0.9), ...clic(0.014, 2200, 0.5)] },
  "maj-prete": {
    piece: 0.1,
    voix: [...[2400, 2700, 3000, 3300, 3600].flatMap((f, i) => clic(i * 0.05, f, 0.55 + i * 0.05, -0.2 + i * 0.1)), ...loquet(0.3, 2000, 3150, 1, 0.5)],
  },
  active: { niveau: 0.45, voix: clic(0, 4200) },
  desactive: { niveau: 0.45, voix: clic(0, 2700) },
  validation: { piece: 0.08, niveau: 0.75, voix: [...sourd(0, 0.5), ...loquet(0.012, 2300, 2900, 0.9)] },
};

const PETILLANT: Jeu = {
  envoi: { piece: 0.2, niveau: 0.75, voix: bulle(0, 620, 1, 2.1, 0.08) },
  "fin-de-tache": {
    piece: 0.24,
    niveau: 0.95,
    voix: [...bulle(0, 700, 0.8, 1.8, 0.08, -0.3), ...bulle(0.075, LA5, 0.8, 1.8, 0.08), ...bulle(0.15, 1100, 0.8, 1.8, 0.09, 0.3), ...goutte(0.25, SOL6, 0.9)],
  },
  erreur: { piece: 0.2, niveau: 0.85, voix: [...chute(0, 520), ...chute(0.15, 415)] },
  notification: { piece: 0.26, niveau: 0.9, voix: [...goutte(0, MI6), ...goutte(0.17, LA6, 0.6, 0.2)] },
  "dictee-debut": { piece: 0.15, niveau: 0.6, voix: bulle(0, 800, 1, 2, 0.06) },
  "dictee-fin": { piece: 0.15, niveau: 0.6, voix: bulle(0, 520, 1, 1.5, 0.06) },
  "maj-prete": {
    piece: 0.24,
    voix: [...[600, 740, 900, 1080, 1320].flatMap((f, i) => bulle(i * 0.06, f, 0.75, 1.8, 0.08, -0.4 + i * 0.2)), ...goutte(0.33, LA6, 0.8)],
  },
  active: { piece: 0.12, niveau: 0.45, voix: bulle(0, 1300, 1, 1.8, 0.04) },
  desactive: { piece: 0.12, niveau: 0.45, voix: bulle(0, 820, 1, 1.6, 0.04) },
  validation: { piece: 0.2, niveau: 0.75, voix: [...bulle(0, SOL5, 0.8, 1.8, 0.07), ...bulle(0.065, 1175, 0.8, 1.8, 0.08)] },
};

const CLAVIER: Jeu = {
  envoi: {
    piece: 0.06,
    niveau: 0.8,
    voix: [...touche(0, 165), { type: "bruit", t: 0.012, declin: 0.01, gain: 0.3, filtres: [{ type: "bandpass", f: 2200, q: 3 }] }, ...relache(0.095)],
  },
  "fin-de-tache": {
    piece: 0.1,
    niveau: 0.95,
    voix: [...frappe(0, 230, 0.7, -0.2), ...frappe(0.075, 250, 0.65, 0.1), ...frappe(0.14, 215, 0.75, -0.05), ...clochette(0.26, 2350, 0.7)],
  },
  erreur: { piece: 0.06, niveau: 0.85, voix: [...touche(0, 125), ...touche(0.11, 115)] },
  notification: { piece: 0.12, niveau: 0.9, voix: [...touche(0, 210, 0.5), ...clochette(0.03, 2350, 0.8, 1.2)] },
  "dictee-debut": { niveau: 0.6, voix: touche(0, 240) },
  "dictee-fin": { niveau: 0.6, voix: relache(0) },
  "maj-prete": {
    piece: 0.1,
    voix: [...[230, 250, 215, 240, 225].flatMap((corps, i) => frappe(i * 0.055, corps, 0.6, -0.3 + i * 0.15)), ...clochette(0.36, 2350, 0.75)],
  },
  active: { niveau: 0.45, voix: bascule(0, 2600) },
  desactive: { niveau: 0.45, voix: bascule(0, 1800) },
  validation: {
    piece: 0.06,
    niveau: 0.75,
    voix: [...touche(0, 150), { type: "bruit", t: 0.011, declin: 0.01, gain: 0.3, filtres: [{ type: "bandpass", f: 2200, q: 3 }] }, ...relache(0.09)],
  },
};

export const JEUX: Record<Exclude<ThemeSons, "silence">, Jeu> = {
  chaleureux: CHALEUREUX,
  mecanique: MECANIQUE,
  petillant: PETILLANT,
  clavier: CLAVIER,
};
