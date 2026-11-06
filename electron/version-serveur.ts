/**
 * La version du code du serveur de VPS (`serveur/*.mjs` et `lancer.sh`), distincte du protocole : un VPS ne se met
 * pas à jour seul, et son protocole peut rester le même alors que son code a du retard.
 * L'app compare celle que le serveur annonce à celle-ci (`serveurEnRetard`, src/lib/serveur-vps.ts).
 * Écrit par `node scripts/serveur-genere.mjs`, qui la monte quand l'empreinte change ; `pnpm lint` et `test:serveur`
 * échouent si elle n'a pas suivi. Ne pas modifier à la main.
 */
export const VERSION_CODE_SERVEUR = 19;
export const EMPREINTE_CODE_SERVEUR = "c7af8782c6bf5d46b017384cc1f8a094a84aed0a325e4e29647c60c336030582";
