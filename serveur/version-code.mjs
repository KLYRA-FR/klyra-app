// Généré par scripts/serveur-genere.mjs depuis electron/version-serveur.ts : ne pas modifier à la main.
/**
 * La version du code du serveur de VPS (`serveur/*.mjs` et `lancer.sh`), distincte du protocole : un VPS ne se met
 * pas à jour seul, et son protocole peut rester le même alors que son code a du retard.
 * L'app compare celle que le serveur annonce à celle-ci (`serveurEnRetard`, src/lib/serveur-vps.ts).
 * Écrit par `node scripts/serveur-genere.mjs`, qui la monte quand l'empreinte change ; `pnpm lint` et `test:serveur`
 * échouent si elle n'a pas suivi. Ne pas modifier à la main.
 */
export const VERSION_CODE_SERVEUR = 3;
export const EMPREINTE_CODE_SERVEUR = "d9e59fdff3f0bfa804927d12087cfe15a0c0223233c6d989fafec70488d4e38b";
