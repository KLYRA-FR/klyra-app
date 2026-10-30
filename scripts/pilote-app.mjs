/**
 * Lance l'app de bureau (export statique) sur un profil donné et la pilote par le
 * protocole de Chrome (CDP). Partagé par les tests des agents.
 * Prérequis : `pnpm build && pnpm build:electron`.
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";

const APP = path.resolve(import.meta.dirname, "..");
const ELECTRON = createRequire(import.meta.url)("electron");
export const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

/** Un compteur d'échecs, et la ligne OK / ÉCHEC de chaque vérification. */
export function verificateur() {
  const echecs = [];
  const verifier = (ok, message) => {
    console.log(`${ok ? "OK    " : "ÉCHEC "} ${message}`);
    if (!ok) echecs.push(message);
    return ok;
  };
  return { echecs, verifier };
}

/**
 * Lance l'app avec ces variables (HOME, KLYRA_USER_DATA…). Les variables d'une session Claude Code
 * en cours sont retirées : l'app ne doit jamais hériter d'un vrai compte pendant un test.
 */
export async function lancerApp({ env, port }) {
  const propre = Object.fromEntries(Object.entries({ ...process.env, ...env }).filter(([k]) => !/^(CLAUDE|ANTHROPIC)/.test(k) || k in env));
  delete propre.ELECTRON_RUN_AS_NODE;
  delete propre.KLYRA_DEV_URL;
  let processus;
  let cible;
  /* Juste après une fermeture, l'instance précédente peut encore tenir le verrou : on relance une fois. */
  for (let essai = 0; essai < 2 && !cible; essai++) {
    processus = spawn(ELECTRON, [".", `--remote-debugging-port=${port}`, ...process.argv.slice(2)], { cwd: APP, env: propre, stdio: "ignore" });
    for (let i = 0; i < 40 && !cible && processus.exitCode === null; i++) {
      await attendre(500);
      cible = await fetch(`http://127.0.0.1:${port}/json`)
        .then((r) => r.json())
        .then((t) => t.find((x) => x.type === "page" && x.url.startsWith("app://")))
        .catch(() => undefined);
    }
    if (!cible) {
      processus.kill();
      await attendre(2000);
    }
  }
  if (!cible) throw new Error("la fenêtre de l’app n’apparaît pas");
  const ws = new WebSocket(cible.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0;
  const attente = {};
  const erreurs = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.method === "Runtime.exceptionThrown") erreurs.push(m.params.exceptionDetails.exception?.description);
    attente[m.id]?.(m.result);
  };
  const send = (method, params = {}) =>
    new Promise((r) => {
      attente[++id] = r;
      ws.send(JSON.stringify({ id, method, params }));
    });
  await send("Runtime.enable");
  const ev = async (x) => (await send("Runtime.evaluate", { expression: x, returnByValue: true, awaitPromise: true })).result?.value;
  for (let i = 0; i < 40 && !(await ev("document.body?.innerText.length > 0 && !!window.klyra")); i++) await attendre(500);
  const app = {
    erreurs,
    ev,
    send,
    async aller(chemin) {
      await ev(`window.next?.router ? window.next.router.push(${JSON.stringify(chemin)}) : (location.href = ${JSON.stringify(chemin)})`);
      await attendre(1200);
    },
    /** Attend qu'une expression soit vraie (au plus `ms`). */
    async quand(expression, ms = 15000) {
      for (let t = 0; t < ms; t += 250) {
        if (await ev(`(() => { try { return !!(${expression}); } catch { return false; } })()`)) return true;
        await attendre(250);
      }
      return false;
    },
    texte: () => ev("document.querySelector('main')?.innerText ?? ''"),
    /** Clique le premier bouton (ou lien) actif dont le texte est exactement `libelle`, dans `dans` si donné. */
    cliquer: (libelle, dans = "document") =>
      ev(`(() => { const b = [...(${dans}).querySelectorAll('button, a, [role="menuitem"], [role="tab"]')].find((b) => b.innerText.trim() === ${JSON.stringify(libelle)} && !b.disabled && b.getAttribute('aria-disabled') !== 'true'); if (!b) return false; b.click(); return true; })()`),
    /** Saisit une valeur dans un champ (input ou textarea) comme au clavier. */
    saisir: (selecteur, valeur) =>
      ev(`(() => { const el = document.querySelector(${JSON.stringify(selecteur)}); if (!el) return false; const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(valeur)}); el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`),
    /** Une touche envoyée par le système (vrai geste clavier). */
    async touche(key, code = key, keyCode = 0) {
      await send("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode: keyCode });
      await send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: keyCode });
    },
    fermer() {
      ws.close();
      processus.kill();
      return new Promise((r) => processus.once("exit", r));
    },
  };
  return app;
}
