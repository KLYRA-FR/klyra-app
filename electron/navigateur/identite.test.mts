import assert from "node:assert/strict";
import test from "node:test";
import { agentPourRequete, agentUtilisateur, enteteMarques, entetesNavigateur, estConnexionGoogle, indicesDeBase } from "./identite.ts";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) klyra-app/0.1.0 Chrome/152.0.7977.167 Electron/44.9.3 Safari/537.36";
const PROPRE = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.7977.167 Safari/537.36";

test("les pages voient Chromium, sans Electron ni le nom de l'app", () => {
  assert.equal(agentUtilisateur(UA, "klyra-app"), PROPRE);
  assert.equal(agentUtilisateur(UA.replace("klyra-app", "KLYRA"), "KLYRA"), PROPRE);
});

test("la connexion Google reçoit « Electron » (Google la refuse sans), les autres sites non", () => {
  assert.equal(
    agentPourRequete("https://accounts.google.com/v3/signin/identifier?flowName=GlifWebSignIn", PROPRE, "44.9.3"),
    PROPRE.replace("Chrome/152.0.7977.167", "Chrome/152.0.7977.167 Electron/44.9.3"),
  );
  assert.equal(agentPourRequete("https://accounts.google.com./x", PROPRE, "44.9.3").includes("Electron/44.9.3"), true);
  for (const url of ["https://www.google.com/search?q=x", "https://app.qonto.com/", "https://accounts.google.com.exemple.fr/", "http://accounts.google.com/", "pas une adresse"]) {
    assert.equal(agentPourRequete(url, PROPRE, "44.9.3"), PROPRE, url);
  }
  assert.equal(agentPourRequete("https://accounts.google.com/", `${PROPRE} Electron/44.9.3`, "44.9.3"), `${PROPRE} Electron/44.9.3`, "jamais deux fois");
});

test("les marques de Chromium, jamais « Google Chrome »", () => {
  assert.equal(enteteMarques("152.0.7977.167"), `"Not?A_Brand";v="24", "Chromium";v="152"`);
  assert.equal(enteteMarques("131.0.6778.86"), `"Chromium";v="131", "Not_A Brand";v="24"`);
  assert.doesNotMatch(enteteMarques("152"), /Google Chrome/);
  assert.throws(() => enteteMarques(""), /illisible/);
  assert.deepEqual(indicesDeBase("152.0.1", "darwin"), { "Sec-CH-UA": enteteMarques("152"), "Sec-CH-UA-Mobile": "?0", "Sec-CH-UA-Platform": `"macOS"` });
});

test("les en-têtes d'une requête : identité de l'adresse, indices de base vers une page sûre", () => {
  const poste = { versionChrome: "152.0.7977.167", versionElectron: "44.9.3", systeme: "win32" };
  const google = entetesNavigateur({ "User-Agent": PROPRE, Accept: "*/*" }, "https://accounts.google.com/v3/signin/identifier", poste);
  assert.match(google["User-Agent"], /Electron\/44\.9\.3/);
  assert.equal(google["Sec-CH-UA"], enteteMarques("152"));
  assert.equal(google["Sec-CH-UA-Platform"], `"Windows"`);
  const site = entetesNavigateur({ "user-agent": PROPRE, "sec-ch-ua": "deja" }, "https://app.qonto.com/", poste);
  assert.equal(site["user-agent"], PROPRE);
  assert.equal(site["sec-ch-ua"], "deja", "un indice déjà là est gardé");
  assert.equal(site["Sec-CH-UA"], undefined);
  assert.deepEqual(entetesNavigateur({ Accept: "*/*" }, "http://exemple.fr/", poste), { Accept: "*/*" }, "pas d'indice vers une page en http");
});

test("une page de connexion de Google", () => {
  assert.equal(estConnexionGoogle("https://accounts.google.com/v3/signin/identifier?flowName=GlifWebSignIn"), true);
  assert.equal(estConnexionGoogle("https://accounts.google.com/signin/rejected"), true);
  assert.equal(estConnexionGoogle("https://www.google.com/search?q=accounts.google.com"), false);
  assert.equal(estConnexionGoogle("https://accounts.google.com.exemple.fr/"), false);
  assert.equal(estConnexionGoogle("http://accounts.google.com/"), false);
  assert.equal(estConnexionGoogle("pas une adresse"), false);
});
