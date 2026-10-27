import { BrowserWindow } from "electron";
import { createServer, type Server } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/**
 * Ce que les workflows demandent au système : écrire le fichier d'une sortie,
 * et recevoir les appels de leurs webhooks. Le serveur n'écoute que sur ce Mac
 * (127.0.0.1) ; chaque déclencheur a son secret dans l'adresse.
 */

/** Un chemin absolu, « ~/… », ou relatif aux Documents. */
function resoudre(chemin: string): string {
  const brut = chemin.trim();
  if (brut.startsWith("~/")) return path.join(os.homedir(), brut.slice(2));
  if (path.isAbsolute(brut)) return brut;
  return path.join(os.homedir(), "Documents", brut);
}

export async function ecrireFichierTexte(chemin: string, texte: string): Promise<string> {
  if (typeof chemin !== "string" || !chemin.trim()) throw new Error("Chemin vide.");
  const complet = resoudre(chemin);
  await mkdir(path.dirname(complet), { recursive: true });
  await writeFile(complet, String(texte ?? ""), "utf8");
  return complet;
}

const PORT_DE_DEPART = 3199;
const TAILLE_MAX = 100_000;
let serveur: Server | null = null;
let port = 0;

function demarrer(): Promise<number> {
  if (serveur && port) return Promise.resolve(port);
  return new Promise((ok, ko) => {
    const essayer = (p: number) => {
      const s = createServer((req, res) => {
        const m = /^\/webhook\/([A-Za-z0-9_-]{8,64})\/?$/.exec(req.url?.split("?")[0] ?? "");
        if (!m) {
          res.writeHead(404, { "content-type": "application/json" }).end('{"ok":false}');
          return;
        }
        let corps = "";
        req.setEncoding("utf8");
        req.on("data", (morceau: string) => {
          if (corps.length < TAILLE_MAX) corps += morceau;
        });
        req.on("end", () => {
          for (const win of BrowserWindow.getAllWindows()) win.webContents.send("webhooks:appel", m[1], corps.slice(0, TAILLE_MAX));
          res.writeHead(202, { "content-type": "application/json" }).end('{"ok":true}');
        });
      });
      s.once("error", (e: NodeJS.ErrnoException) => (e.code === "EADDRINUSE" && p < PORT_DE_DEPART + 20 ? essayer(p + 1) : ko(e)));
      s.listen(p, "127.0.0.1", () => {
        serveur = s;
        port = p;
        ok(p);
      });
    };
    essayer(PORT_DE_DEPART);
  });
}

export async function adresseWebhook(secret: string): Promise<string> {
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(secret)) throw new Error("Secret invalide.");
  const p = await demarrer();
  return `http://127.0.0.1:${p}/webhook/${secret}`;
}

/** Au lancement : le serveur démarre tout de suite, pour les webhooks déjà créés. */
export function demarrerWebhooks(): void {
  void demarrer().catch(() => {});
}
