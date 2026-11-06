import assert from "node:assert/strict";
import test from "node:test";
import { enteteMarques, entetesAvecIndices, estConnexionGoogle, identiteChrome, indicesDemandes, marquesChrome, recoitIndices, versionWindowsChrome } from "./identite.ts";

test("les marques de Chrome, dans l'ordre que Chrome tire de son numéro", () => {
  // Relevés sur de vrais Chrome.
  assert.equal(enteteMarques(marquesChrome("120.0.6099.71", false)), `"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"`);
  assert.equal(enteteMarques(marquesChrome("131.0.6778.86", false)), `"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"`);
  assert.equal(
    enteteMarques(marquesChrome("131.0.6778.86", true)),
    `"Google Chrome";v="131.0.6778.86", "Chromium";v="131.0.6778.86", "Not_A Brand";v="24.0.0.0"`,
  );
  assert.throws(() => marquesChrome("", false), /illisible/);
});

test("l'identité d'un Google Chrome sur Windows, Mac et Linux", () => {
  const win = identiteChrome({ versionChrome: "146.0.7680.65", systeme: "win32", arch: "x64", versionSysteme: "10.0.26100" });
  assert.equal(win.userAgent, "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36");
  assert.doesNotMatch(win.userAgent, /Electron|klyra/i);
  assert.equal(win.metadonnees.platform, "Windows");
  assert.equal(win.metadonnees.platformVersion, "19.0.0");
  assert.equal(win.metadonnees.architecture, "x86");
  assert.equal(win.metadonnees.bitness, "64");
  assert.equal(win.metadonnees.fullVersion, "146.0.7680.65");
  assert.ok(win.metadonnees.brands.some((m) => m.brand === "Google Chrome" && m.version === "146"));

  const mac = identiteChrome({ versionChrome: "146.0.7680.65", systeme: "darwin", arch: "arm64", versionSysteme: "15.3.1" });
  assert.match(mac.userAgent, /^Mozilla\/5\.0 \(Macintosh; Intel Mac OS X 10_15_7\) /);
  assert.deepEqual([mac.metadonnees.platform, mac.metadonnees.platformVersion, mac.metadonnees.architecture], ["macOS", "15.3.1", "arm"]);

  const linux = identiteChrome({ versionChrome: "146.0.7680.65", systeme: "linux", arch: "x64", versionSysteme: "6.8" });
  assert.match(linux.userAgent, /\(X11; Linux x86_64\)/);
  assert.equal(linux.metadonnees.platformVersion, "6.8.0");

  // Ce que Chromium dit du poste passe avant nos déductions.
  const natif = identiteChrome({ versionChrome: "146.0.7680.65", systeme: "win32", arch: "x64", versionSysteme: "10.0.26200", natif: { platformVersion: "19.0.0", wow64: false } });
  assert.equal(natif.metadonnees.platformVersion, "19.0.0");
});

test("la version de Windows annoncée par Chrome", () => {
  assert.equal(versionWindowsChrome("10.0.19045"), "10.0.0");
  assert.equal(versionWindowsChrome("10.0.22000"), "14.0.0");
  assert.equal(versionWindowsChrome("10.0.22631"), "15.0.0");
  assert.equal(versionWindowsChrome("10.0.26100"), "19.0.0");
  assert.equal(versionWindowsChrome("bizarre"), "10.0.0");
});

test("les en-têtes : les indices de base toujours, les détaillés sur demande, en https", () => {
  const id = identiteChrome({ versionChrome: "131.0.6778.86", systeme: "win32", arch: "x64", versionSysteme: "10.0.22631" });
  const base = entetesAvecIndices({ "User-Agent": id.userAgent, Accept: "*/*" }, "https://accounts.google.com/", id);
  assert.equal(base["sec-ch-ua"], `"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"`);
  assert.equal(base["sec-ch-ua-mobile"], "?0");
  assert.equal(base["sec-ch-ua-platform"], `"Windows"`);
  assert.equal(base["sec-ch-ua-platform-version"], undefined);
  assert.equal(base.Accept, "*/*");

  const demandes = indicesDemandes(["Sec-CH-UA-Full-Version-List, sec-ch-ua-platform-version", "Sec-CH-UA-Arch, Sec-CH-Prefers-Color-Scheme, Downlink"]);
  assert.deepEqual(demandes, ["sec-ch-ua-full-version-list", "sec-ch-ua-platform-version", "sec-ch-ua-arch"]);
  const detail = entetesAvecIndices({ "Sec-CH-UA": `"Chromium";v="131"` }, "https://accounts.google.com/x", id, demandes);
  assert.equal(detail["Sec-CH-UA"], undefined, "celui d'Electron est remplacé");
  assert.equal(detail["sec-ch-ua-full-version-list"], `"Google Chrome";v="131.0.6778.86", "Chromium";v="131.0.6778.86", "Not_A Brand";v="24.0.0.0"`);
  assert.equal(detail["sec-ch-ua-platform-version"], `"15.0.0"`);
  assert.equal(detail["sec-ch-ua-arch"], `"x86"`);

  // Pas d'indice vers une page en http (sauf ce poste), comme Chrome.
  assert.deepEqual(entetesAvecIndices({ Accept: "*/*" }, "http://exemple.fr/", id), { Accept: "*/*" });
  assert.equal(recoitIndices("http://localhost:3000/"), true);
  assert.equal(recoitIndices("http://127.0.0.1:8080/"), true);
  assert.equal(recoitIndices("data:text/html,x"), false);
});

test("une page de connexion de Google", () => {
  assert.equal(estConnexionGoogle("https://accounts.google.com/v3/signin/identifier?flowName=GlifWebSignIn"), true);
  assert.equal(estConnexionGoogle("https://accounts.google.com/signin/rejected"), true);
  assert.equal(estConnexionGoogle("https://www.google.com/search?q=accounts.google.com"), false);
  assert.equal(estConnexionGoogle("https://accounts.google.com.exemple.fr/"), false);
  assert.equal(estConnexionGoogle("http://accounts.google.com/"), false);
  assert.equal(estConnexionGoogle("pas une adresse"), false);
});
