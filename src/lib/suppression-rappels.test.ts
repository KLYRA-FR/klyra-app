import { describe, expect, it } from "vitest";
import type { Tache } from "@/types/domain";
import { marquerRappelNotifie, restaurerRappels, supprimerRappel, type RappelSupprime } from "./suppression-rappels";

const rappel = (id: string, extra: Partial<Tache> = {}): Tache => ({
  id, titre: "Rappel " + id, notes: "Notes à garder", liste: "clients", date: "2026-10-31", heure: "09:00",
  fin: "2026-11-02", priorite: 2, signalee: true, faite: true, faiteLe: "2026-10-30T10:00:00Z",
  projectId: "projet-fictif", creeLe: "2026-10-29T12:00:00Z", notifiee: true, ...extra,
});
const initial = () => ({ taches: [rappel("a"), rappel("b"), rappel("c"), rappel("d")], rappelsSupprimes: [] as RappelSupprime[], autre: "inchangé" });

describe("annulation de suppression de rappels", () => {
  it("rend une copie complète au même index, sans modifier l'état de départ", () => {
    const avant = initial();
    const supprime = supprimerRappel(avant, "b");
    expect(supprime.taches.map((t) => t.id)).toEqual(["a", "c", "d"]);
    expect(supprime.rappelsSupprimes).toEqual([{ tache: avant.taches[1], index: 1 }]);
    expect(supprime.rappelsSupprimes[0].tache).not.toBe(avant.taches[1]);
    expect(restaurerRappels(supprime)).toEqual(avant);
    expect(avant.taches).toHaveLength(4);
  });
  it.each([["a", "b", "c"], ["d", "b", "a"], ["b", "d", "c"], ["d", "c", "b", "a"]])("restaure des suppressions successives dans l'ordre initial : %s %s %s", (...ids) => {
    const avant = initial();
    expect(restaurerRappels(ids.reduce(supprimerRappel, avant))).toEqual(avant);
  });
  it("borne l'index si d'autres rappels ont disparu", () => {
    const etat = supprimerRappel(initial(), "d");
    expect(restaurerRappels({ ...etat, taches: [] }).taches).toEqual([rappel("d")]);
  });
  it("ne double ni ne remplace un id déjà présent", () => {
    const etat = supprimerRappel(initial(), "b");
    const nouvelle = rappel("b", { titre: "Version plus récente" });
    const rendu = restaurerRappels({ ...etat, taches: [...etat.taches, nouvelle] });
    expect(rendu.taches.filter((t) => t.id === "b")).toEqual([nouvelle]);
    expect(rendu.rappelsSupprimes).toEqual([]);
    expect(restaurerRappels(rendu)).toBe(rendu);
  });
  it("supprimer un id absent ou déjà supprimé est sans effet", () => {
    const etat = initial();
    expect(supprimerRappel(etat, "absent")).toBe(etat);
    const uneFois = supprimerRappel(etat, "b");
    expect(supprimerRappel(uneFois, "b")).toBe(uneFois);
  });
  it.each([true, false])("préserve notifiee=%s, les champs absents et les valeurs nulles", (notifiee) => {
    const t = rappel("a", { notifiee, faite: false, faiteLe: null, date: null, heure: null });
    delete t.fin;
    const etat = { taches: [t], rappelsSupprimes: [] };
    expect(restaurerRappels(supprimerRappel(etat, "a"))).toEqual(etat);
  });
  it("une notification tardive ne recrée pas un rappel supprimé", () => {
    const etat = supprimerRappel(initial(), "b");
    expect(marquerRappelNotifie(etat, "b")).toBe(etat);
  });
  it("marquer notifié ne touche que ce champ, dans la version courante", () => {
    const etat = { taches: [rappel("a", { titre: "Titre fraîchement modifié", notifiee: false })], rappelsSupprimes: [] };
    const rendu = marquerRappelNotifie(etat, "a");
    expect(rendu.taches).toEqual([{ ...etat.taches[0], notifiee: true }]);
    expect(marquerRappelNotifie(rendu, "a")).toBe(rendu);
  });
});
