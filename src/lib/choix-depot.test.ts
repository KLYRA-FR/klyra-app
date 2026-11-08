import { describe, expect, test } from "vitest";
import { lireValeurDepot, optionsDepot } from "@/lib/choix-depot";
import type { Project } from "@/types/domain";

const projet = (p: Partial<Project>): Project => ({ id: "x", name: "x", subtitle: "", status: "en-cours", pinned: false, roleIds: ["principal"], brief: "", previewUrl: "", folder: "/x", files: [], updatedAt: "2026-11-01T00:00:00.000Z", ...p });
const depot = (nom: string, p: Partial<{ archive: boolean; branche: string; pousseLe: string }> = {}) => ({ nom, prive: false, branche: "main", archive: false, ...p });

describe("optionsDepot", () => {
  const projets = [
    projet({ id: "app", name: "klyra-app", depot: "KLYRA-FR/klyra-app", updatedAt: "2026-11-08T00:00:00.000Z" }),
    projet({ id: "site", name: "Site vitrine", depot: "KLYRA-FR/site", updatedAt: "2026-11-01T00:00:00.000Z" }),
    projet({ id: "vps", name: "Sur le VPS", lieu: "https://vps.exemple.fr" }),
  ];
  test("sans dépôt, puis les projets de la machine, puis les dépôts GitHub pas encore ouverts", () => {
    const options = optionsDepot(projets, [depot("KLYRA-FR/klyra-app"), depot("KLYRA-FR/neuf"), depot("KLYRA-FR/vieux", { archive: true }), depot("KLYRA-FR/vide", { branche: "" })], null, "pret");
    expect(options.map((o) => o.value)).toEqual(["", "projet:app", "projet:site", "depot:KLYRA-FR/neuf"]);
    expect(options.find((o) => o.value === "projet:site")?.label).toBe("Site vitrine · KLYRA-FR/site");
    expect(options.find((o) => o.value === "projet:app")?.label).toBe("klyra-app");
  });
  test("sur un VPS : ses projets seulement, et ses dépôts", () => {
    expect(optionsDepot(projets, [depot("KLYRA-FR/klyra-app")], "https://vps.exemple.fr", "pret").map((o) => o.value)).toEqual(["", "projet:vps", "depot:KLYRA-FR/klyra-app"]);
  });
  test("GitHub en chargement, non connecté ou en erreur : une ligne qui le dit, jamais choisissable", () => {
    for (const etat of ["charge", "deconnecte", "erreur"] as const) {
      const info = optionsDepot([], null, null, etat).at(-1);
      expect(info?.type).toBe("info");
      expect(info?.disabled).toBe(true);
      expect(lireValeurDepot(info!.value)).toBeNull();
    }
    expect(optionsDepot([], null, null, "absent").map((o) => o.value)).toEqual([""]);
  });
});

test("lireValeurDepot", () => {
  expect(lireValeurDepot("projet:app")).toEqual({ projet: "app" });
  expect(lireValeurDepot("depot:KLYRA-FR/neuf")).toEqual({ depot: "KLYRA-FR/neuf" });
  expect(lireValeurDepot("")).toBeNull();
});
