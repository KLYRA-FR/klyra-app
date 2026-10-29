// Capteur de la dictée (AudioWorklet, cf. src/lib/dictee/micro.ts) : regroupe
// le micro en trames de 100 ms (1 600 échantillons à 16 kHz) et les envoie à
// l'interface. Il ne joue rien : sa sortie reste silencieuse.
const TRAME = 1600;

class CapteurDictee extends AudioWorkletProcessor {
  constructor() {
    super();
    this.trame = new Float32Array(TRAME);
    this.rempli = 0;
  }

  process(entrees) {
    const canal = entrees[0] && entrees[0][0];
    if (!canal) return true;
    for (let i = 0; i < canal.length; i++) {
      this.trame[this.rempli++] = canal[i];
      if (this.rempli === TRAME) {
        this.port.postMessage(this.trame, [this.trame.buffer]);
        this.trame = new Float32Array(TRAME);
        this.rempli = 0;
      }
    }
    return true;
  }
}

registerProcessor("capteur-dictee", CapteurDictee);
