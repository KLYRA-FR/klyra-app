import { describe, expect, test } from "vitest";
import type { Chat, Project } from "@/types/domain";
import {
  dossierDeConversation,
  filDansProjet,
  filPeutChoisirDossier,
} from "./dossier-conversation";

const projet = (patch: Partial<Project> = {}): Project =>
  ({
    id: "p1",
    name: "klyra-app",
    folder: "/home/moi/klyra-app",
    ...patch,
  }) as Project;
const chat = (patch: Partial<Chat> = {}): Chat => ({
  id: "c1",
  kind: "direct",
  projectId: null,
  title: "Nouveau fil",
  roleIds: ["principal"],
  updatedAt: "2026-11-09T10:00:00.000Z",
  sessions: {},
  luJusqua: null,
  ...patch,
});
const fil = {
  roleId: "principal",
  statut: "ouvert" as const,
  creeLe: "2026-11-09T10:00:00.000Z",
};

describe("dossierDeConversation", () => {
  test("conversation de projet sur ce PC : le dossier du projet", () => {
    expect(
      dossierDeConversation(
        chat({ kind: "equipe", projectId: "p1" }),
        projet(),
      ),
    ).toEqual({ dossier: "/home/moi/klyra-app", dossierVps: null });
  });
  test("conversation de projet sur un VPS : seulement un projet de ce VPS", () => {
    const vps = "https://vps.exemple";
    expect(
      dossierDeConversation(
        chat({ kind: "equipe", lieu: vps }),
        projet({ lieu: vps, folder: "/home/klyra/app" }),
      ),
    ).toEqual({ dossier: null, dossierVps: "/home/klyra/app" });
    expect(
      dossierDeConversation(chat({ kind: "equipe", lieu: vps }), projet()),
    ).toEqual({ dossier: null, dossierVps: null });
  });
  test("chat d'un agent et fil sans dossier : l'atelier", () => {
    expect(dossierDeConversation(chat(), undefined)).toEqual({
      dossier: null,
      dossierVps: null,
    });
    expect(
      dossierDeConversation(
        chat({ fil: { ...fil, projetId: "p1" } }),
        undefined,
      ),
    ).toEqual({ dossier: null, dossierVps: null });
  });
  test("fil posé dans un projet : son dossier, sur sa machine seulement", () => {
    const pose = filDansProjet(fil, projet());
    expect(pose.projetId).toBe("p1");
    expect(dossierDeConversation(chat({ fil: pose }), undefined)).toEqual({
      dossier: "/home/moi/klyra-app",
      dossierVps: null,
    });
    // Le fil passé sur un VPS : le dossier du PC n'y existe pas.
    expect(
      dossierDeConversation(
        chat({ fil: pose, lieu: "https://vps.exemple" }),
        undefined,
      ),
    ).toEqual({ dossier: null, dossierVps: null });
    const surVps = filDansProjet(
      fil,
      projet({ lieu: "https://vps.exemple", folder: "/home/klyra/app" }),
    );
    expect(
      dossierDeConversation(
        chat({ fil: surVps, lieu: "https://vps.exemple" }),
        undefined,
      ),
    ).toEqual({ dossier: null, dossierVps: "/home/klyra/app" });
  });
});

describe("filPeutChoisirDossier", () => {
  test("seulement un fil neuf, sans dossier", () => {
    expect(filPeutChoisirDossier(chat({ fil }), 0)).toBe(true);
    expect(filPeutChoisirDossier(chat(), 0)).toBe(false);
    expect(filPeutChoisirDossier(chat({ fil }), 1)).toBe(false);
    expect(
      filPeutChoisirDossier(chat({ fil, sessions: { principal: "s1" } }), 0),
    ).toBe(false);
    expect(
      filPeutChoisirDossier(chat({ fil: filDansProjet(fil, projet()) }), 0),
    ).toBe(false);
  });
});
