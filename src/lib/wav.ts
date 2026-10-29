/** La fréquence que lit Whisper. */
const FREQUENCE = 16_000;

/**
 * Un enregistrement du micro (WebM/Opus) en WAV 16 kHz mono, 16 bits : le format
 * que lit Whisper. Décodé et rééchantillonné par le navigateur, sans ffmpeg.
 */
export async function versWav16k(enregistrement: Blob): Promise<Uint8Array> {
  const contexte = new AudioContext();
  let source: AudioBuffer;
  try {
    source = await contexte.decodeAudioData(await enregistrement.arrayBuffer());
  } finally {
    void contexte.close();
  }
  const rendu = new OfflineAudioContext(1, Math.max(1, Math.ceil(source.duration * FREQUENCE)), FREQUENCE);
  const lecteur = rendu.createBufferSource();
  lecteur.buffer = source;
  lecteur.connect(rendu.destination);
  lecteur.start();
  const echantillons = (await rendu.startRendering()).getChannelData(0);

  const wav = new DataView(new ArrayBuffer(44 + echantillons.length * 2));
  const texte = (decalage: number, s: string) => [...s].forEach((c, i) => wav.setUint8(decalage + i, c.charCodeAt(0)));
  texte(0, "RIFF");
  wav.setUint32(4, 36 + echantillons.length * 2, true);
  texte(8, "WAVE");
  texte(12, "fmt ");
  wav.setUint32(16, 16, true);
  wav.setUint16(20, 1, true); // PCM
  wav.setUint16(22, 1, true); // mono
  wav.setUint32(24, FREQUENCE, true);
  wav.setUint32(28, FREQUENCE * 2, true);
  wav.setUint16(32, 2, true);
  wav.setUint16(34, 16, true);
  texte(36, "data");
  wav.setUint32(40, echantillons.length * 2, true);
  echantillons.forEach((v, i) => wav.setInt16(44 + i * 2, Math.max(-1, Math.min(1, v)) * 0x7fff, true));
  return new Uint8Array(wav.buffer);
}
