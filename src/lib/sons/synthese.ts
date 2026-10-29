/**
 * La synthèse des sons, sans fichier : chaque son est une recette (des voix
 * posées dans le temps) rendue une fois dans un OfflineAudioContext. Le
 * résultat, un AudioBuffer, est gardé et rejoué tel quel : aucun calcul au
 * moment de jouer, donc aucune latence.
 *
 * Deux sortes de voix suffisent à tout : des partiels (sinus accordés, qui
 * déclinent chacun à son rythme : verre, bois, cloche, bulle) et du bruit
 * filtré (clics, loquets, touches).
 */

/** Un partiel : [rapport à la fréquence de base, gain, durée de déclin en s]. */
export type Partiel = [rapport: number, gain: number, declin: number];

export type Voix =
  | {
      type: "ton";
      /** Départ, en s depuis le début du son. */
      t: number;
      f: number;
      partiels: Partiel[];
      gain: number;
      /** Montée, en s (2 ms par défaut). */
      attaque?: number;
      /** Glissement de hauteur : la fréquence finale (rapport) et sa durée en s. */
      glisse?: { rapport: number; duree: number };
      /** Position stéréo, de -1 à 1. */
      pan?: number;
    }
  | {
      type: "bruit";
      t: number;
      /** Durée de déclin, en s (temps pour perdre 60 dB). */
      declin: number;
      gain: number;
      /** Filtres en série, dans l'ordre. */
      filtres: { type: BiquadFilterType; f: number; q?: number }[];
      attaque?: number;
      pan?: number;
    };

export interface Recette {
  voix: Voix[];
  /** Part de la petite pièce (réverbération), de 0 à 1. */
  piece?: number;
  /** Niveau relatif du son dans son thème (1 : le plus fort). */
  niveau?: number;
}

const ECHANTILLONNAGE = 48_000;
/** Un déclin « à -60 dB » en constante de temps exponentielle. */
const constante = (declin: number) => Math.max(0.001, declin / 6.9);

/** Bruit blanc reproductible : le même son à chaque rendu. */
function bruitBlanc(contexte: BaseAudioContext, duree: number, graine: number): AudioBuffer {
  const tampon = contexte.createBuffer(1, Math.max(1, Math.ceil(duree * contexte.sampleRate)), contexte.sampleRate);
  const donnees = tampon.getChannelData(0);
  let x = graine >>> 0 || 1;
  for (let i = 0; i < donnees.length; i++) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    donnees[i] = ((x >>> 0) / 0xffffffff) * 2 - 1;
  }
  return tampon;
}

/** La réponse d'une petite pièce boisée : un bruit qui s'éteint en 0,5 s, adouci dans les aigus. */
function reponsePiece(contexte: BaseAudioContext): AudioBuffer {
  const longueur = Math.ceil(0.5 * contexte.sampleRate);
  const tampon = contexte.createBuffer(2, longueur, contexte.sampleRate);
  for (let canal = 0; canal < 2; canal++) {
    const d = tampon.getChannelData(canal);
    const bruit = bruitBlanc(contexte, 0.5, 7919 + canal * 104_729).getChannelData(0);
    let doux = 0;
    for (let i = 0; i < longueur; i++) {
      doux += (bruit[i] - doux) * 0.35;
      d[i] = doux * Math.exp((-6.9 * i) / longueur) * (i < 96 ? i / 96 : 1);
    }
  }
  return tampon;
}

/** La fin du son : la dernière voix, plus son déclin. */
function duree(recette: Recette): number {
  let fin = 0;
  for (const v of recette.voix) {
    const declin = v.type === "ton" ? Math.max(...v.partiels.map((p) => p[2])) : v.declin;
    fin = Math.max(fin, v.t + (v.attaque ?? 0.002) + declin);
  }
  return fin + (recette.piece ? 0.35 : 0.02);
}

function poserVoix(contexte: OfflineAudioContext, sortie: AudioNode, v: Voix, graine: number) {
  const attaque = v.attaque ?? 0.002;
  const panneau = contexte.createStereoPanner();
  panneau.pan.value = v.pan ?? 0;
  panneau.connect(sortie);

  if (v.type === "ton") {
    for (const [rapport, gainPartiel, declin] of v.partiels) {
      const osc = contexte.createOscillator();
      const f = v.f * rapport;
      osc.frequency.setValueAtTime(f, v.t);
      if (v.glisse) osc.frequency.exponentialRampToValueAtTime(f * v.glisse.rapport, v.t + v.glisse.duree);
      const enveloppe = contexte.createGain();
      enveloppe.gain.setValueAtTime(0, v.t);
      enveloppe.gain.linearRampToValueAtTime(v.gain * gainPartiel, v.t + attaque);
      enveloppe.gain.setTargetAtTime(0, v.t + attaque, constante(declin));
      osc.connect(enveloppe).connect(panneau);
      osc.start(v.t);
      osc.stop(v.t + attaque + declin + 0.05);
    }
    return;
  }

  const source = contexte.createBufferSource();
  source.buffer = bruitBlanc(contexte, attaque + v.declin + 0.05, graine);
  let dernier: AudioNode = source;
  for (const filtre of v.filtres) {
    const biquad = contexte.createBiquadFilter();
    biquad.type = filtre.type;
    biquad.frequency.value = filtre.f;
    if (filtre.q !== undefined) biquad.Q.value = filtre.q;
    dernier.connect(biquad);
    dernier = biquad;
  }
  const enveloppe = contexte.createGain();
  enveloppe.gain.setValueAtTime(0, v.t);
  enveloppe.gain.linearRampToValueAtTime(v.gain, v.t + attaque);
  enveloppe.gain.setTargetAtTime(0, v.t + attaque, constante(v.declin));
  dernier.connect(enveloppe).connect(panneau);
  source.start(v.t);
}

/** Niveau efficace sur la fenêtre la plus forte de 120 ms : ce que l'oreille retient d'un son court. */
function niveauPercu(tampon: AudioBuffer): { crete: number; efficace: number } {
  const fenetre = Math.round(0.12 * tampon.sampleRate);
  let crete = 0;
  let meilleur = 0;
  const canaux = Array.from({ length: tampon.numberOfChannels }, (_, c) => tampon.getChannelData(c));
  const carres = new Float64Array(tampon.length);
  for (let i = 0; i < tampon.length; i++) {
    let s = 0;
    for (const d of canaux) {
      crete = Math.max(crete, Math.abs(d[i]));
      s += d[i] * d[i];
    }
    carres[i] = s / canaux.length;
  }
  let somme = 0;
  for (let i = 0; i < tampon.length; i++) {
    somme += carres[i];
    if (i >= fenetre) somme -= carres[i - fenetre];
    meilleur = Math.max(meilleur, somme);
  }
  return { crete, efficace: Math.sqrt(meilleur / Math.min(fenetre, tampon.length)) };
}

/** Niveau efficace visé pour un son de niveau 1 (environ -18 dBFS), et crête maximale. */
const EFFICACE_CIBLE = 0.125;
const CRETE_MAX = 0.89;

/**
 * Rend une recette en AudioBuffer stéréo, au même niveau perçu que les
 * autres sons (corrigé par son `niveau`), sans dépasser -1 dBFS.
 */
export async function rendre(recette: Recette, frequence = ECHANTILLONNAGE): Promise<AudioBuffer> {
  const longueur = Math.ceil(duree(recette) * frequence);
  const contexte = new OfflineAudioContext(2, longueur, frequence);
  const seche = contexte.createGain();
  seche.connect(contexte.destination);
  let entree: AudioNode = seche;
  if (recette.piece) {
    const melange = contexte.createGain();
    const piece = contexte.createConvolver();
    piece.buffer = reponsePiece(contexte);
    const humide = contexte.createGain();
    humide.gain.value = recette.piece;
    melange.connect(seche);
    melange.connect(piece).connect(humide).connect(contexte.destination);
    entree = melange;
  }
  recette.voix.forEach((v, i) => poserVoix(contexte, entree, v, 2_654_435_761 * (i + 1)));
  const tampon = await contexte.startRendering();

  const { crete, efficace } = niveauPercu(tampon);
  if (crete > 0) {
    const gain = Math.min(CRETE_MAX / crete, (EFFICACE_CIBLE * (recette.niveau ?? 1)) / Math.max(efficace, 1e-6));
    const fondu = Math.min(tampon.length, Math.round(0.006 * frequence));
    for (let c = 0; c < tampon.numberOfChannels; c++) {
      const d = tampon.getChannelData(c);
      for (let i = 0; i < d.length; i++) d[i] *= gain;
      // Fin sans clic.
      for (let i = 0; i < fondu; i++) d[d.length - 1 - i] *= i / fondu;
    }
  }
  return tampon;
}
