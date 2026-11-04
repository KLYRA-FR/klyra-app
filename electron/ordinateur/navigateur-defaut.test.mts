import assert from "node:assert/strict";
import test from "node:test";
import {
  MESSAGE_ILLISIBLE,
  MESSAGE_PLATEFORME,
  adresseHttp,
  bundleDepuisHandlers,
  detectionDe,
  executableDepuisCommande,
  fenetreDuNavigateur,
  messageNonPrisEnCharge,
  planDeLancement,
  progIdDepuisReg,
  reconnaitre,
} from "./navigateur-defaut.ts";

const interdit = /user-data-dir|profile-directory|--profile\b|-profile\b|incognito|--guest\b|make new tab/i;

test("Windows et Mac reconnaissent Chrome, Edge, Firefox, Safari et Brave", () => {
  assert.equal(reconnaitre("ChromeHTML").navigateur, "chrome");
  assert.equal(reconnaitre("MSEdgeHTM").navigateur, "edge");
  assert.equal(reconnaitre("FirefoxURL-1234").navigateur, "firefox");
  assert.equal(reconnaitre("BraveHTML").navigateur, "brave");
  assert.equal(reconnaitre("com.apple.Safari").navigateur, "safari");
  assert.equal(reconnaitre("com.google.Chrome").nom, "Google Chrome");
  assert.equal(reconnaitre("com.operasoftware.Opera").navigateur, null);
  assert.equal(reconnaitre("com.operasoftware.Opera").nom, "Opera");
  assert.equal(reconnaitre("com.google.Chrome.canary").navigateur, null);
});

test("une nouvelle fenêtre, le profil habituel, et rien sur Linux", () => {
  const chrome = detectionDe({ plateforme: "win32", indice: "ChromeHTML", commande: '"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --single-argument %1' });
  const plan = planDeLancement(chrome, "win32", "https://exemple.fr/a?b=1");
  assert.ok(!("erreur" in plan));
  if ("erreur" in plan) return;
  assert.deepEqual(plan.args.slice(0, 1), ["--new-window"]);
  assert.equal(plan.args.at(-1), "https://exemple.fr/a?b=1");
  assert.equal(interdit.test([plan.fichier, ...plan.args].join(" ")), false);

  const firefox = planDeLancement(detectionDe({ plateforme: "darwin", indice: "org.mozilla.firefox", commande: null }), "darwin", null);
  assert.ok(!("erreur" in firefox));
  if ("erreur" in firefox) return;
  assert.deepEqual(firefox.args.slice(0, 4), ["-a", "Firefox", "--args", "-new-window"]);

  const safari = planDeLancement(detectionDe({ plateforme: "darwin", indice: "com.apple.Safari", commande: null }), "darwin", "https://exemple.fr");
  assert.ok(!("erreur" in safari));
  if ("erreur" in safari) return;
  assert.match(safari.args[1] ?? "", /make new document/);
  assert.doesNotMatch(safari.args[1] ?? "", /make new tab/);

  const vide = planDeLancement(detectionDe({ plateforme: "darwin", indice: "com.brave.Browser", commande: null }), "darwin", null);
  assert.ok(!("erreur" in vide) && vide.args[1] === 'tell application "Brave Browser" to make new window');

  assert.equal(detectionDe({ plateforme: "linux", indice: "google-chrome.desktop", commande: null }).message, MESSAGE_PLATEFORME);
  assert.match(messageNonPrisEnCharge("Opera"), /Rien n'a été ouvert/);
  assert.match(detectionDe({ plateforme: "win32", indice: "OperaStable", commande: null }).message, /OperaStable/);
  assert.equal(detectionDe({ plateforme: "darwin", indice: null, commande: null }).message, MESSAGE_ILLISIBLE);
  assert.match(detectionDe({ plateforme: "win32", indice: "SafariHTML", commande: null }).message, /Mac/);
});

test("l'adresse et l'exécutable ne sortent pas du navigateur", () => {
  assert.equal(adresseHttp(undefined), null);
  assert.equal(adresseHttp("  "), null);
  assert.equal(adresseHttp("https://exemple.fr"), "https://exemple.fr");
  assert.equal(adresseHttp("file:///etc/passwd"), "refus");
  assert.equal(adresseHttp('https://exemple.fr/"'), "refus");
  assert.equal(executableDepuisCommande('"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --single-argument %1'), "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe");
  assert.equal(executableDepuisCommande("chrome --new-window"), null);
  assert.equal(progIdDepuisReg("    ProgId    REG_SZ    ChromeHTML\r\n"), "ChromeHTML");
  assert.equal(bundleDepuisHandlers({ LSHandlers: [{ LSHandlerURLScheme: "http", LSHandlerRoleAll: "com.apple.Safari" }, { LSHandlerURLScheme: "https", LSHandlerRoleAll: "com.google.Chrome" }] }), "com.google.Chrome");
});

test("le panneau ne retient que la fenêtre de ce navigateur, au premier plan", () => {
  const enveloppe = {
    ok: true,
    result: {
      structuredContent: {
        windows: [
          { window_id: 1, pid: 10, app: "Google Chrome", title: "Courrier", focused: false },
          { window_id: 2, pid: 10, app: "Google Chrome", title: "KLYRA", focused: true },
          { window_id: 3, pid: 11, app: "Chromium", title: "Autre", focused: true },
        ],
      },
    },
  };
  assert.deepEqual(fenetreDuNavigateur(enveloppe, "chrome"), { windowId: 2, pid: 10, titre: "KLYRA" });
  assert.equal(fenetreDuNavigateur(enveloppe, "firefox"), null);
});
