import { FREQUENCE } from "./segmenteur";

export interface Micro {
  arreter: () => void;
}

/**
 * Ouvre le micro et rend sa voix en trames de 100 ms, à 16 kHz mono : le
 * navigateur rééchantillonne, le capteur (public/dictee/capteur.js) découpe.
 * Lève une erreur si le micro est refusé ou absent.
 */
export async function ouvrirMicro(surTrame: (trame: Float32Array) => void): Promise<Micro> {
  const flux = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  const contexte = new AudioContext({ sampleRate: FREQUENCE });
  const arreter = () => {
    flux.getTracks().forEach((t) => t.stop());
    void contexte.close();
  };
  try {
    await contexte.audioWorklet.addModule("/dictee/capteur.js");
    const capteur = new AudioWorkletNode(contexte, "capteur-dictee");
    capteur.port.onmessage = (e: MessageEvent<Float32Array>) => surTrame(e.data);
    contexte.createMediaStreamSource(flux).connect(capteur);
    // Relié à la sortie pour être joué par le navigateur ; il n'y écrit rien.
    capteur.connect(contexte.destination);
  } catch (e) {
    arreter();
    throw e;
  }
  return { arreter };
}
