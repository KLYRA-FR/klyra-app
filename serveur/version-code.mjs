// Généré par scripts/serveur-genere.mjs depuis electron/version-serveur.ts : ne pas modifier à la main.
/**
 * La version du code du serveur de VPS (`serveur/*.mjs` et `lancer.sh`), distincte du protocole : un VPS ne se met
 * pas à jour seul, et son protocole peut rester le même alors que son code a du retard.
 * L'app compare celle que le serveur annonce à celle-ci (`serveurEnRetard`, src/lib/serveur-vps.ts).
 * Écrit par `node scripts/serveur-genere.mjs`, qui la monte quand l'empreinte change ; `pnpm lint` et `test:serveur`
 * échouent si elle n'a pas suivi. Ne pas modifier à la main.
 */
export const VERSION_CODE_SERVEUR = 14;
export const EMPREINTE_CODE_SERVEUR = "5901f83bc13392ea0f11394ca9f36290a3ee9636858a484f370350b6014dfdc4";
