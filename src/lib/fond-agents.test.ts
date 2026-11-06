import { afterEach, describe, expect, it } from "vitest";
import { finSuiviFond, nouveauSuiviFond, suivreFond } from "../../electron/taches-fond";
import { fondsDe, noterReponse, poserFond, poserFondParReponse, resumeFond, viderFonds } from "./fond-agents";

/**
 * Les messages de Claude Code 2.1.318 (stream-json) quand un agent lance une commande en fond, rend sa
 * réponse, puis reprend la parole quand la commande se termine : relevés tels quels (champs utiles seulement)
 * avec le vrai Claude Code face à un faux fournisseur, le 06/11/2026.
 */
const RELEVE = [
  { type: "system", subtype: "init" },
  { type: "system", subtype: "status", status: "requesting" },
  { type: "assistant" },
  { type: "system", subtype: "task_summary" },
  { type: "system", subtype: "background_tasks_changed", tasks: [{ task_id: "bnr8xnuf0", task_type: "local_bash", description: "Capture de la vidéo" }] },
  { type: "system", subtype: "task_started", task_id: "bnr8xnuf0", tool_use_id: "toolu_b42524cd", description: "Capture de la vidéo", is_backgrounded: true, task_type: "local_bash" },
  { type: "user" },
  { type: "system", subtype: "status", status: "requesting" },
  { type: "assistant" },
  { type: "system", subtype: "post_turn_summary" },
  { type: "result", subtype: "success" },
  // Réponse rendue : la commande tourne encore.
  { type: "system", subtype: "task_summary" },
  { type: "system", subtype: "task_updated", task_id: "bnr8xnuf0", patch: { status: "completed" } },
  { type: "system", subtype: "task_notification", status: "completed", task_id: "bnr8xnuf0", tool_use_id: "toolu_b42524cd" },
  { type: "system", subtype: "background_tasks_changed", tasks: [] },
  { type: "system", subtype: "init" },
  // Claude Code reprend de lui-même : aucune réponse ouverte dans l'app.
  { type: "system", subtype: "status", status: "requesting" },
  { type: "assistant" },
  { type: "system", subtype: "post_turn_summary" },
  { type: "result", subtype: "success" },
];

describe("ce qu'un agent fait en fond (electron/taches-fond.ts)", () => {
  it("suit le relevé de Claude Code : la commande, sa fin, puis la reprise", () => {
    const suivi = nouveauSuiviFond();
    /* La réponse est ouverte jusqu'au premier `result`, puis l'app n'attend plus rien. */
    let ouverte = true;
    const dits: unknown[] = [];
    RELEVE.forEach((msg, i) => {
      const evt = suivreFond(suivi, msg, 1000 + i, ouverte);
      if (evt) dits.push(evt);
      if (msg.type === "result") ouverte = false;
    });
    expect(dits).toEqual([
      { type: "fond", taches: [{ id: "bnr8xnuf0", description: "Capture de la vidéo", genre: "commande", debut: 1004 }], reprise: false },
      { type: "fond", taches: [], reprise: false },
      { type: "fond", taches: [], reprise: true },
      { type: "fond", taches: [], reprise: false },
    ]);
  });

  it("ne dit pas de reprise pendant la réponse à un message", () => {
    const suivi = nouveauSuiviFond();
    expect(suivreFond(suivi, { type: "system", subtype: "status", status: "requesting" }, 0, true)).toBeNull();
    expect(suivreFond(suivi, { type: "result", subtype: "success" }, 0, true)).toBeNull();
  });

  it("garde le début d'une tâche lancée au premier plan puis passée en fond", () => {
    const suivi = nouveauSuiviFond();
    expect(suivreFond(suivi, { type: "system", subtype: "task_started", task_id: "a", description: "Build", task_type: "local_bash", is_backgrounded: false }, 10, true)).toBeNull();
    const evt = suivreFond(suivi, { type: "system", subtype: "background_tasks_changed", tasks: [{ task_id: "a", task_type: "local_bash", description: "Build" }] }, 50, false);
    expect(evt?.taches).toEqual([{ id: "a", description: "Build", genre: "commande", debut: 10 }]);
  });

  it("range un agent de fond, et vide tout quand Claude Code s'arrête", () => {
    const suivi = nouveauSuiviFond();
    suivreFond(suivi, { type: "system", subtype: "background_tasks_changed", tasks: [{ task_id: "b", task_type: "local_agent", description: "Relire la maquette" }, { task_id: "c", task_type: "autre_chose" }] }, 5, false);
    expect([...suivi.taches.values()].map((t) => [t.genre, t.description])).toEqual([
      ["agent", "Relire la maquette"],
      ["autre", "Tâche de fond"],
    ]);
    expect(finSuiviFond(suivi)).toEqual({ type: "fond", taches: [], reprise: false });
    expect(finSuiviFond(suivi)).toBeNull();
  });
});

describe("l'écran (src/lib/fond-agents.ts)", () => {
  afterEach(() => viderFonds());
  const tache = { id: "t", description: "Capture de la vidéo", genre: "commande" as const, debut: 0 };

  it("range ce qui arrive après la fin de la réponse par sa conversation et son agent", () => {
    noterReponse("r1", "dm-iris", "iris");
    expect(poserFondParReponse("r1", { type: "fond", taches: [tache], reprise: false })).toBe(true);
    expect(fondsDe("dm-iris")).toEqual([{ roleId: "iris", taches: [tache], reprise: false }]);
    /* Une réponse inconnue (app relancée) : rien n'est rangé. */
    expect(poserFondParReponse("inconnue", { type: "fond", taches: [tache], reprise: false })).toBe(false);
    poserFondParReponse("r1", { type: "fond", taches: [], reprise: false });
    expect(fondsDe("dm-iris")).toEqual([]);
  });

  it("garde une liste stable tant qu'elle ne change pas, un agent par ligne, à sa place", () => {
    poserFond("equipe", "iris", { taches: [tache], reprise: false });
    poserFond("equipe", "hugo", { taches: [], reprise: true });
    const liste = fondsDe("equipe");
    expect(fondsDe("equipe")).toBe(liste);
    poserFond("equipe", "iris", { taches: [], reprise: true });
    expect(fondsDe("equipe").map((f) => [f.roleId, f.reprise])).toEqual([
      ["iris", true],
      ["hugo", true],
    ]);
    poserFond("autre", "iris", { taches: [], reprise: false });
    expect(fondsDe("autre")).toEqual([]);
  });

  it("résume ce qui tourne", () => {
    expect(resumeFond([])).toBe("");
    expect(resumeFond([tache])).toBe("1 commande");
    expect(resumeFond([tache, { ...tache, id: "u" }, { ...tache, id: "v", genre: "agent" }])).toBe("2 commandes et 1 agent");
    expect(resumeFond([tache, { ...tache, id: "v", genre: "agent" }, { ...tache, id: "w", genre: "autre" }])).toBe("1 commande, 1 agent et 1 tâche");
  });
});
