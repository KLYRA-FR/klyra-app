import { afterEach, describe, expect, test, vi } from "vitest";
import { cleEnOctets, estIphone, etatNavigateur, lienMessage, lienWorkflow, pousserAuTelephone, raisonSansNotifications, EVENEMENT_POUSSER, type Navigateur } from "./push";
import { lienValable } from "../../convex/model/push";

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";
const IPAD = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15";
const ANDROID = "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36";

const navigateur = (n: Partial<Navigateur>): Navigateur => ({ userAgent: ANDROID, pointsTactiles: 5, installee: false, push: true, permission: "default", ...n });

describe("notifications du téléphone : ce que le navigateur permet", () => {
  test("iPhone et iPad (qui se dit Mac) sont reconnus", () => {
    expect(estIphone({ userAgent: IPHONE, pointsTactiles: 5 })).toBe(true);
    expect(estIphone({ userAgent: IPAD, pointsTactiles: 5 })).toBe(true);
    expect(estIphone({ userAgent: IPAD, pointsTactiles: 0 })).toBe(false);
    expect(estIphone({ userAgent: ANDROID, pointsTactiles: 5 })).toBe(false);
  });

  test("sur iPhone, il faut l'app posée sur l'écran d'accueil", () => {
    expect(etatNavigateur(navigateur({ userAgent: IPHONE, push: false, permission: null }))).toBe("iphone-a-installer");
    expect(etatNavigateur(navigateur({ userAgent: IPHONE, installee: true }))).toBe("a-demander");
    expect(raisonSansNotifications("iphone-a-installer")).toContain("iOS 16.4");
  });

  test("permission du système : à demander, accordée, refusée ; navigateur sans push", () => {
    expect(etatNavigateur(navigateur({}))).toBe("a-demander");
    expect(etatNavigateur(navigateur({ permission: "granted" }))).toBe("accordee");
    expect(etatNavigateur(navigateur({ permission: "denied" }))).toBe("refusee");
    expect(etatNavigateur(navigateur({ push: false }))).toBe("non-supporte");
    expect(raisonSansNotifications("a-demander")).toBeNull();
    expect(raisonSansNotifications("sans-cles")).toContain("rien ne part");
  });

  test("la clé publique VAPID passe en octets", () => {
    expect([...cleEnOctets("AQID_-8")]).toEqual([1, 2, 3, 255, 239]);
  });
});

describe("l'ordinateur prévient le téléphone", () => {
  afterEach(() => vi.unstubAllGlobals());

  function fenetre(focus: boolean) {
    const recus: unknown[] = [];
    vi.stubGlobal("document", { hasFocus: () => focus });
    vi.stubGlobal("window", { dispatchEvent: (e: CustomEvent) => recus.push(e.type === EVENEMENT_POUSSER ? e.detail : null) });
    return recus;
  }

  test("pas de doublon : rien ne part quand la fenêtre de KLYRA a le focus", () => {
    const recus = fenetre(true);
    pousserAuTelephone({ evenement: "agentFini", titre: "Hugo a fini", corps: "", lien: "/chats" });
    expect(recus).toEqual([]);
  });

  test("fenêtre sans focus : la demande part au relais", () => {
    const recus = fenetre(false);
    const demande = { evenement: "accord" as const, titre: "Hugo demande ton accord", corps: "Lancer pnpm build", lien: lienMessage("dm-hugo", "m 1") };
    pousserAuTelephone(demande);
    expect(recus).toEqual([demande]);
  });

  test("les liens ouvrent l'écran visé et passent la règle du serveur", () => {
    expect(lienMessage("dm-hugo", "m 1")).toBe("/chat?id=dm-hugo&message=m%201");
    expect(lienWorkflow("wf/1")).toBe("/routines?vue=workflows&workflow=wf%2F1");
    expect(lienValable(lienMessage("dm-hugo", "m 1"))).toBe(true);
    expect(lienValable(lienWorkflow("wf/1"))).toBe(true);
  });
});
