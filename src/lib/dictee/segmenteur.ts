/** La fréquence que lisent Whisper et ElevenLabs. */
export const FREQUENCE = 16_000;
/** Le micro arrive par trames de 100 ms. */
export const TRAME = FREQUENCE / 10;

/** Ce que la dictée locale doit faire après une trame. */
export type Action = "rien" | "partiel" | "definitif";

interface Reglages {
  /** Un blanc de cette durée clôt un segment : son texte devient définitif. */
  silenceMs: number;
  /** Un segment ne dépasse pas cette durée, même sans blanc. */
  maxMs: number;
  /** Un nouveau texte provisoire au plus souvent que ça. */
  intervallePartielMs: number;
}

const DEFAUT: Reglages = { silenceMs: 700, maxMs: 20_000, intervallePartielMs: 900 };
/** Ce qu'on garde avant la première parole (une attaque coupée se transcrit mal). */
const AVANT_MS = 300;
/** Ce qu'on garde du blanc qui clôt un segment. */
const APRES_MS = 200;
/** Le niveau sous lequel tout est du silence, quel que soit le bruit de fond. */
const SEUIL_MIN = 0.012;

const ms = (echantillons: number) => (echantillons / FREQUENCE) * 1000;

/** Le niveau d'une trame (RMS, de 0 à 1). */
export function niveau(trame: Float32Array): number {
  let somme = 0;
  for (const v of trame) somme += v * v;
  return Math.sqrt(somme / Math.max(1, trame.length));
}

/**
 * Découpe la parole en segments pour la dictée locale : Whisper transcrit le
 * segment en cours pour le texte provisoire, puis une dernière fois quand un
 * blanc le clôt, pour le texte définitif. Le silence n'est jamais envoyé
 * (Whisper invente du texte sur un silence). La parole se détecte au niveau
 * sonore, au-dessus du bruit de fond mesuré en continu.
 */
export class Segmenteur {
  private reglages: Reglages;
  private trames: Float32Array[] = [];
  private parole = 0;
  private blanc = 0;
  private bruit = SEUIL_MIN / 3;
  private depuisPartiel = 0;
  private nouveau = false;

  constructor(reglages: Partial<Reglages> = {}) {
    this.reglages = { ...DEFAUT, ...reglages };
  }

  /** Ajoute une trame ; dit s'il faut un texte provisoire ou définitif. */
  ajouter(trame: Float32Array): Action {
    const n = niveau(trame);
    const seuil = Math.max(SEUIL_MIN, this.bruit * 3);
    const parle = n > seuil;
    if (!parle) this.bruit = this.bruit * 0.95 + n * 0.05;

    this.trames.push(trame);
    const duree = ms(trame.length);
    if (parle) {
      this.parole += duree;
      this.blanc = 0;
      this.nouveau = true;
    } else {
      this.blanc += duree;
    }

    if (!this.parole) {
      // Rien de dit : on ne garde que l'attaque possible.
      while (this.trames.length > 1 && ms(this.longueur()) - ms(this.trames[0].length) >= AVANT_MS) this.trames.shift();
      return "rien";
    }
    if (this.blanc >= this.reglages.silenceMs || ms(this.longueur()) >= this.reglages.maxMs) return "definitif";
    this.depuisPartiel += duree;
    if (this.nouveau && this.depuisPartiel >= this.reglages.intervallePartielMs) {
      this.depuisPartiel = 0;
      this.nouveau = false;
      return "partiel";
    }
    return "rien";
  }

  /** Le segment en cours a-t-il de la parole ? */
  get aDeLaParole(): boolean {
    return this.parole > 0;
  }

  /** L'audio du segment en cours, sans le blanc de la fin. */
  segment(): Float32Array {
    const garde = Math.max(0, this.longueur() - Math.max(0, ((this.blanc - APRES_MS) / 1000) * FREQUENCE));
    const sortie = new Float32Array(garde);
    let i = 0;
    for (const t of this.trames) {
      if (i >= garde) break;
      sortie.set(t.subarray(0, garde - i), i);
      i += t.length;
    }
    return sortie;
  }

  /** Clôt le segment en cours : rend son audio et repart de zéro. */
  couper(): Float32Array {
    const audio = this.segment();
    this.trames = [];
    this.parole = 0;
    this.blanc = 0;
    this.depuisPartiel = 0;
    this.nouveau = false;
    return audio;
  }

  private longueur(): number {
    return this.trames.reduce((n, t) => n + t.length, 0);
  }
}

/** Des échantillons (-1 à 1) en PCM 16 bits little-endian, le format des deux moteurs. */
export function versPcm16(echantillons: Float32Array): Uint8Array {
  const pcm = new DataView(new ArrayBuffer(echantillons.length * 2));
  echantillons.forEach((v, i) => {
    const s = Math.max(-1, Math.min(1, v));
    pcm.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  });
  return new Uint8Array(pcm.buffer);
}

/** Du PCM 16 bits mono 16 kHz dans un fichier WAV, pour Whisper. */
export function versWav(pcm: Uint8Array): Uint8Array {
  const wav = new Uint8Array(44 + pcm.length);
  const v = new DataView(wav.buffer);
  const texte = (decalage: number, s: string) => [...s].forEach((c, i) => v.setUint8(decalage + i, c.charCodeAt(0)));
  texte(0, "RIFF");
  v.setUint32(4, 36 + pcm.length, true);
  texte(8, "WAVE");
  texte(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, FREQUENCE, true);
  v.setUint32(28, FREQUENCE * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  texte(36, "data");
  v.setUint32(40, pcm.length, true);
  wav.set(pcm, 44);
  return wav;
}
