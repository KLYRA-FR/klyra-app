/**
 * Signature de l'app Mac, appelée par electron-builder (`build.mac.sign`).
 *
 * Avec un certificat (KLYRA_MAC_SIGN_IDENTITY : son empreinte SHA-1, et
 * KLYRA_MAC_KEYCHAIN : le trousseau où il est importé), l'app est signée par
 * lui. Le même certificat d'une version à l'autre donne la même « exigence
 * désignée » : macOS reconnaît la nouvelle version comme la même app et garde
 * ses autorisations (Accessibilité, Enregistrement de l'écran). Sans
 * certificat, signature ad hoc, comme avant : les autorisations sautent à
 * chaque mise à jour.
 *
 * Le certificat est auto-signé (pas de compte Apple Developer) : Gatekeeper
 * demande toujours d'ouvrir l'app une première fois par clic droit.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports -- electron-builder charge ce fichier en CommonJS
const { execFileSync, spawnSync } = require("node:child_process");
// eslint-disable-next-line @typescript-eslint/no-require-imports -- idem
const { existsSync } = require("node:fs");

module.exports = async function signerMac(options) {
  const app = options.app;
  const identite = process.env.KLYRA_MAC_SIGN_IDENTITY || "-";
  const trousseau = process.env.KLYRA_MAC_KEYCHAIN;
  const args = ["--force", "--deep", "--sign", identite];
  if (identite !== "-" && trousseau) args.push("--keychain", trousseau);
  args.push(app);

  console.log(`  • signature ${identite === "-" ? "ad hoc (aucun certificat configuré)" : `par le certificat ${identite.slice(0, 8)}…`}`);
  execFileSync("/usr/bin/codesign", args, { stdio: "inherit" });
  execFileSync("/usr/bin/codesign", ["--verify", "--deep", "--strict", app], { stdio: "inherit" });
  // L'exigence désignée, dans le journal du build : c'est elle que macOS compare d'une version à l'autre.
  execFileSync("/usr/bin/codesign", ["--display", "--requirements", "-", app], { stdio: "inherit" });
  // Computer Use : cua-driver (Contents/Resources) garde la signature Developer ID de son éditeur et son
  // droit Automation. Le signer de nouveau les retirerait : le pilote ne pourrait plus piloter les apps.
  const pilote = `${app}/Contents/Resources/cua-driver/cua-driver`;
  if (!existsSync(pilote)) throw new Error("cua-driver manque dans l'app : lance « pnpm cua-driver » avant electron-builder.");
  const { stdout, stderr } = spawnSync("/usr/bin/codesign", ["--display", "--verbose=2", pilote], { encoding: "utf8" });
  if (!/Authority=Developer ID Application: Cua AI/.test(`${stdout}${stderr}`)) throw new Error("cua-driver a perdu la signature de son éditeur : Computer Use ne marcherait pas.");
  console.log("  • cua-driver garde la signature de son éditeur");
};
