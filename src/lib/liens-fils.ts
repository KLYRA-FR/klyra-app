/**
 * Les identifiants de fils cités dans un message (« Rapport hebdo (klyra-fil-0f830d35) ») :
 * `klyra-fil-` et 8 caractères hexadécimaux, ni collés à un mot ni prolongés (`klyra-fil-0f830d35a` n'en est pas un).
 */
export const MOTIF_FIL = /(?<![\w-])klyra-fil-[0-9a-f]{8}(?![\w-])/g;

/** Un morceau de texte : du texte simple, ou l'identifiant d'un fil. */
export type MorceauFil = { texte: string; fil: boolean };

/** Coupe un texte simple (hors code et hors lien : c'est au rendu de ne pas les donner) autour des identifiants de fils. */
export function decouperFils(texte: string): MorceauFil[] {
  const morceaux: MorceauFil[] = [];
  let debut = 0;
  for (const m of texte.matchAll(MOTIF_FIL)) {
    const i = m.index ?? 0;
    if (i > debut) morceaux.push({ texte: texte.slice(debut, i), fil: false });
    morceaux.push({ texte: m[0], fil: true });
    debut = i + m[0].length;
  }
  if (debut < texte.length) morceaux.push({ texte: texte.slice(debut), fil: false });
  return morceaux;
}
