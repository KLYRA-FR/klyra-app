import assert from "node:assert/strict";
import test from "node:test";
import { apresExtrait, apresFin, apresOutil, cibleDepuis, etatInitial, extraitDeResultat, lectureVoulue, lireRequete } from "./apercu-cible.ts";

const image = (data = "AAAA") => ({
  ok: true,
  result: {
    content: [{ type: "image", data, mimeType: "image/png" }, { type: "text", text: "Fenêtre lue." }],
    structuredContent: { window_id: 42, pid: 7, title: "Brave", has_screenshot: true },
  },
});

test("un clic vise la fenêtre, pas le bureau", () => {
  const c = cibleDepuis("mcp__ordinateur__click", { target: { kind: "window", pid: 7, window_id: 42 } });
  assert.deepEqual(c, { kind: "fenetre", windowId: 42, pid: 7, titre: null });
  assert.equal(cibleDepuis("mcp__ordinateur__get_desktop_state", {})?.kind, "bureau");
  assert.equal(cibleDepuis("mcp__ordinateur__click", { target: { kind: "desktop", display_id: "primary" } })?.kind, "bureau");
  assert.equal(cibleDepuis("Bash", { command: "ls" }), null);
});

test("la réponse d'une fenêtre garde l'image ; le bureau, une fenêtre masquée ou trop grande, non", () => {
  const fenetre = extraitDeResultat(image(), { name: "get_window_state", bureau: false });
  assert.equal(fenetre?.base64, "AAAA");
  assert.equal(fenetre?.windowId, 42);
  assert.equal(fenetre?.titre, "Brave");
  assert.equal(fenetre?.masquee, false);

  const bureau = extraitDeResultat(image("B".repeat(100)), { name: "get_desktop_state", bureau: true });
  assert.equal(bureau?.bureau, true);
  assert.equal(bureau?.base64, null);

  const masquee = extraitDeResultat(
    { ok: true, result: { content: [{ type: "image", data: "CCCC", mimeType: "image/png" }], structuredContent: { window_id: 9, minimized: true, has_screenshot: false } } },
    { name: "get_window_state", bureau: false },
  );
  assert.equal(masquee?.masquee, true);
  assert.equal(masquee?.base64, null);

  const enorme = extraitDeResultat(image("D".repeat(12_000_001)), { name: "get_window_state", bureau: false });
  assert.equal(enorme?.base64, null);
  assert.equal(enorme?.bureau, true);
});

test("une fenêtre introuvable s'arrête, une fenêtre seulement hors écran sans image se dit masquée", () => {
  const partie = extraitDeResultat({ ok: false, error: "unknown window 3" }, { name: "get_window_state", bureau: false });
  assert.equal(partie?.absente, true);
  assert.equal(partie?.masquee, false);
  const cachee = extraitDeResultat({ ok: false, error: "window minimized" }, { name: "get_window_state", bureau: false });
  assert.equal(cachee?.masquee, true);
  const hors = extraitDeResultat({ ok: true, result: { content: [], structuredContent: { window_id: 4, is_on_screen: false } } }, { name: "get_window_state", bureau: false });
  assert.equal(hors?.masquee, true);
  assert.equal(hors?.base64, null);
});

test("on ne relit que la fenêtre pendant que l'agent s'en sert", () => {
  const depart = etatInitial("dm");
  assert.equal(lectureVoulue(apresOutil(depart, "dm", "mcp__ordinateur__get_desktop_state", {})!), false);
  const visee = apresOutil(depart, "dm", "mcp__ordinateur__click", { pid: 7, window_id: 42 })!;
  assert.equal(visee.actif, true);
  assert.equal(visee.windowId, 42);
  assert.equal(lectureVoulue(visee), true);
  const avecImage = apresExtrait(visee, extraitDeResultat(image(), { name: "get_window_state", bureau: false })!);
  assert.equal(avecImage.titre, "Brave");
  assert.equal(avecImage.masquee, false);
  const reduite = apresExtrait(avecImage, { name: "get_window_state", windowId: 42, pid: 7, titre: "Brave", base64: null, mime: null, masquee: true, absente: false, bureau: false });
  assert.equal(reduite.image, null);
  assert.equal(reduite.masquee, true);
  assert.equal(lectureVoulue(apresFin(reduite)), false);
  assert.equal(apresOutil(null, "dm", "Read", { file_path: "a" }), null);
});

test("une requête du démon se lit sans garder le bureau pour une fenêtre", () => {
  const fenetre = lireRequete(JSON.stringify({ method: "call", name: "click", args: { target: { kind: "window", pid: 7, window_id: 42 } } }));
  assert.deepEqual(fenetre, { name: "click", windowId: 42, pid: 7, bureau: false });
  const bureau = lireRequete(JSON.stringify({ method: "call", name: "get_desktop_state", args: {} }));
  assert.equal(bureau?.bureau, true);
  assert.equal(bureau?.windowId, null);
  assert.equal(lireRequete(JSON.stringify({ method: "ping" })), null);
});
