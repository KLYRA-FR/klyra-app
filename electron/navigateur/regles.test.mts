import assert from "node:assert/strict";
import test from "node:test";
import {
  adresseAutorisee,
  choisirElements,
  evenementsTouche,
  formaterInstantane,
  hoteDe,
  ligneElement,
  normaliserAdresse,
  RECHERCHE,
  trancheTexte,
  type ElementPage,
  type InstantanePage,
} from "./regles.ts";

test("adresses : domaine en https, serveur local en http, mots cherchés", () => {
  assert.equal(normaliserAdresse("klyra.fr"), "https://klyra.fr/");
  assert.equal(normaliserAdresse("  www.klyra.fr/contact?x=1 "), "https://www.klyra.fr/contact?x=1");
  assert.equal(normaliserAdresse("localhost:3000/admin"), "http://localhost:3000/admin");
  assert.equal(normaliserAdresse("127.0.0.1:8080"), "http://127.0.0.1:8080/");
  assert.equal(normaliserAdresse("http://exemple.com"), "http://exemple.com/");
  assert.equal(normaliserAdresse("météo paris"), `${RECHERCHE}m%C3%A9t%C3%A9o%20paris`);
  assert.equal(normaliserAdresse("bonjour"), `${RECHERCHE}bonjour`);
  assert.equal(normaliserAdresse("about:blank"), "about:blank");
});

test("adresses : tout autre protocole est refusé", () => {
  for (const a of ["file:///etc/passwd", "javascript:alert(1)", "data:text/html,x", "klyra://rejoindre", "chrome://settings", "view-source:https://a.fr"]) {
    assert.throws(() => normaliserAdresse(a), /pages web|illisible/, a);
    assert.equal(adresseAutorisee(a), false, a);
  }
  assert.throws(() => normaliserAdresse("   "), /vide/);
  assert.equal(adresseAutorisee("https://klyra.fr/"), true);
});

test("le site d'une adresse", () => {
  assert.equal(hoteDe("https://www.klyra.fr/a/b"), "klyra.fr");
  assert.equal(hoteDe("http://localhost:3000/"), "localhost:3000");
  assert.equal(hoteDe("pas une adresse"), "pas une adresse");
});

test("Entrée porte son caractère, Tab non", () => {
  const entree = evenementsTouche("Enter");
  assert.deepEqual(entree.map((e) => e.type), ["rawKeyDown", "char", "keyUp"]);
  assert.equal(entree[1].text, "\r");
  assert.deepEqual(evenementsTouche("Tab").map((e) => e.type), ["rawKeyDown", "keyUp"]);
});

test("un raccourci : modificateurs tenus puis relâchés, pas de caractère sous une commande", () => {
  const e = evenementsTouche("Control+a");
  assert.deepEqual(
    e.map((x) => `${x.type}:${x.key}:${x.modifiers}`),
    ["rawKeyDown:Control:2", "rawKeyDown:a:2", "keyUp:a:2", "keyUp:Control:0"],
  );
  const maj = evenementsTouche("Shift+a");
  assert.equal(maj.find((x) => x.type === "char")?.text, "A");
  assert.throws(() => evenementsTouche("Hyper+a"), /Modificateur inconnu/);
  assert.throws(() => evenementsTouche("Touchefolle"), /Touche inconnue/);
});

const el = (ref: string, vu: boolean, nom = ref): ElementPage => ({ ref, role: "bouton", nom, vu });

test("trop d'éléments : ceux qu'on voit d'abord, dans l'ordre de la page", () => {
  const liste = [el("e1", false), el("e2", true), el("e3", false), el("e4", true), { role: "titre", nom: "Titre", niveau: 1, vu: true }];
  const { gardes, omis } = choisirElements(liste, 3);
  assert.deepEqual(gardes.map((e) => e.ref ?? e.nom), ["e1", "e2", "e4", "Titre"]);
  assert.equal(omis, 1);
});

test("une ligne par élément, mots de passe jamais lus", () => {
  assert.equal(ligneElement({ ref: "e4", role: "champ (email)", nom: "E-mail", valeur: "a@b.fr", vu: true }), '[e4] champ (email) « E-mail » = "a@b.fr"');
  assert.equal(ligneElement({ ref: "e5", role: "case", nom: "J’accepte", etats: ["coché"], vu: false }), "[e5] case « J’accepte » · coché, hors écran");
  assert.equal(ligneElement({ role: "titre", nom: "Contact", niveau: 2, vu: true }), "## Contact");
});

const page: InstantanePage = {
  titre: "Contact",
  url: "https://klyra.fr/contact",
  vue: { largeur: 1280, hauteur: 800 },
  defilement: { y: 0, max: 1200 },
  elements: [el("e1", true, "Envoyer"), { ref: "e2", role: "champ", nom: "Nom", vu: true }, el("e3", true, "Annuler")],
  cadres: 1,
  texte: "Écrivez-nous\nNous répondons sous 48 h\nEnvoyer",
  texteTotal: 44,
};

test("la page formatée : adresse, éléments, cadres, texte", () => {
  const t = formaterInstantane(page);
  assert.match(t, /^Page : Contact — https:\/\/klyra\.fr\/contact/);
  assert.match(t, /\[e1\] bouton « Envoyer »/);
  assert.match(t, /1 cadre \(iframe\)/);
  assert.match(t, /Nous répondons sous 48 h/);
});

test("une requête ne garde que ce qui la contient", () => {
  const t = formaterInstantane(page, { requete: "envoy" });
  assert.match(t, /\[e1\]/);
  assert.doesNotMatch(t, /\[e2\]|\[e3\]/);
  assert.doesNotMatch(t, /48 h/);
});

test("le texte par tranches, avec la suite indiquée", () => {
  const t = trancheTexte("abcdefghij", 2, 5);
  assert.match(t, /^cdefg/);
  assert.match(t, /depuis = 7/);
  assert.equal(trancheTexte("abc", 0, 10), "abc");
});
