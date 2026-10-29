// klyra-entrees (Windows) : clavier et souris pour Computer Use, par SendInput.
// Une commande JSON par ligne sur l'entrée standard, une réponse JSON par ligne
// sur la sortie. Coordonnées en pixels physiques du bureau virtuel : l'app les
// convertit depuis ses DIP (screen.dipToScreenPoint). Le processus se déclare
// « per monitor DPI aware » pour que Windows ne les retouche pas.
// Limite de Windows : une app lancée en administrateur ne reçoit pas ces
// événements (UIPI), sans message d'erreur.
// Compilé par le compilateur C# de .NET Framework 4 (présent sur Windows 10 et 11) :
// scripts/preparer-entrees.mjs. Lancé seulement par l'app, jamais sans l'interrupteur.
using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

static class Entrees
{
    const int VERSION = 1;

    [StructLayout(LayoutKind.Sequential)]
    struct INPUT { public uint type; public UNION u; }

    [StructLayout(LayoutKind.Explicit)]
    struct UNION
    {
        [FieldOffset(0)] public MOUSEINPUT mi;
        [FieldOffset(0)] public KEYBDINPUT ki;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct MOUSEINPUT { public int dx; public int dy; public int mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }

    [StructLayout(LayoutKind.Sequential)]
    struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }

    [DllImport("user32.dll", SetLastError = true)] static extern uint SendInput(uint n, INPUT[] inputs, int taille);
    [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr valeur);
    [DllImport("user32.dll")] static extern bool SetProcessDPIAware();

    const uint INPUT_MOUSE = 0, INPUT_KEYBOARD = 1;
    const uint KEYEVENTF_EXTENDEDKEY = 0x1, KEYEVENTF_KEYUP = 0x2, KEYEVENTF_UNICODE = 0x4;
    const uint LEFTDOWN = 0x2, LEFTUP = 0x4, RIGHTDOWN = 0x8, RIGHTUP = 0x10, MIDDLEDOWN = 0x20, MIDDLEUP = 0x40, WHEEL = 0x800, HWHEEL = 0x1000;

    // Les touches par leur nom (codes virtuels de Windows) ; étendues : flèches, début, fin, pages, suppr.
    static readonly Dictionary<string, ushort> TOUCHES = new Dictionary<string, ushort> {
        { "entree", 0x0D }, { "tab", 0x09 }, { "espace", 0x20 }, { "retour", 0x08 }, { "echap", 0x1B }, { "suppr", 0x2E },
        { "debut", 0x24 }, { "fin", 0x23 }, { "page-haut", 0x21 }, { "page-bas", 0x22 },
        { "gauche", 0x25 }, { "haut", 0x26 }, { "droite", 0x27 }, { "bas", 0x28 },
    };
    static readonly HashSet<ushort> ETENDUES = new HashSet<ushort> { 0x2E, 0x24, 0x23, 0x21, 0x22, 0x25, 0x26, 0x27, 0x28 };
    static readonly Dictionary<string, ushort> MODIFICATEURS = new Dictionary<string, ushort> {
        { "ctrl", 0x11 }, { "maj", 0x10 }, { "alt", 0x12 }, { "option", 0x12 }, { "win", 0x5B }, { "cmd", 0x11 },
    };

    static int taille = Marshal.SizeOf(typeof(INPUT));

    static void Envoyer(params INPUT[] entrees)
    {
        if (SendInput((uint)entrees.Length, entrees, taille) != entrees.Length)
            throw new Exception("Windows a refusé l’événement (fenêtre lancée en administrateur ?)");
    }

    static INPUT Souris(uint flags, int data = 0)
    {
        var i = new INPUT { type = INPUT_MOUSE };
        i.u.mi = new MOUSEINPUT { dwFlags = flags, mouseData = data };
        return i;
    }

    static INPUT Clavier(ushort vk, ushort scan, uint flags)
    {
        var i = new INPUT { type = INPUT_KEYBOARD };
        i.u.ki = new KEYBDINPUT { wVk = vk, wScan = scan, dwFlags = flags };
        return i;
    }

    static ushort CodeTouche(string nom)
    {
        ushort vk;
        if (TOUCHES.TryGetValue(nom, out vk) || MODIFICATEURS.TryGetValue(nom, out vk)) return vk;
        if (nom.Length == 1 && char.IsLetterOrDigit(nom[0])) return (ushort)char.ToUpperInvariant(nom[0]);
        if (nom.Length >= 2 && nom[0] == 'f') { int n; if (int.TryParse(nom.Substring(1), out n) && n >= 1 && n <= 12) return (ushort)(0x6F + n); }
        throw new Exception("touche inconnue : " + nom);
    }

    static INPUT Touche(ushort vk, bool haut)
    {
        return Clavier(vk, 0, (haut ? KEYEVENTF_KEYUP : 0) | (ETENDUES.Contains(vk) ? KEYEVENTF_EXTENDEDKEY : 0));
    }

    static int Entier(object v) { return (int)Math.Round(Convert.ToDouble(v)); }

    static Dictionary<string, object> Executer(Dictionary<string, object> c)
    {
        var r = new Dictionary<string, object>();
        string action = c.ContainsKey("action") ? c["action"] as string : "";
        switch (action)
        {
            case "ping":
                r["version"] = VERSION;
                return r;

            case "deplacer":
                SetCursorPos(Entier(c["x"]), Entier(c["y"]));
                return r;

            case "clic":
            {
                SetCursorPos(Entier(c["x"]), Entier(c["y"]));
                Thread.Sleep(20);
                string bouton = c.ContainsKey("bouton") ? c["bouton"] as string : "gauche";
                uint bas = bouton == "droit" ? RIGHTDOWN : bouton == "milieu" ? MIDDLEDOWN : LEFTDOWN;
                uint haut = bouton == "droit" ? RIGHTUP : bouton == "milieu" ? MIDDLEUP : LEFTUP;
                int n = c.ContainsKey("nombre") ? Math.Max(1, Math.Min(3, Entier(c["nombre"]))) : 1;
                for (int i = 0; i < n; i++) Envoyer(Souris(bas), Souris(haut));
                return r;
            }

            case "taper":
            {
                string texte = c["texte"] as string ?? "";
                foreach (char ch in texte)
                {
                    Envoyer(Clavier(0, ch, KEYEVENTF_UNICODE), Clavier(0, ch, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP));
                    Thread.Sleep(4);
                }
                return r;
            }

            case "touche":
            {
                var noms = new List<string>();
                foreach (object o in (IEnumerable)c["touches"]) noms.Add(o as string);
                if (noms.Count == 0) throw new Exception("touches attendues");
                var codes = noms.ConvertAll(CodeTouche);
                var suite = new List<INPUT>();
                foreach (var vk in codes) suite.Add(Touche(vk, false));
                for (int i = codes.Count - 1; i >= 0; i--) suite.Add(Touche(codes[i], true));
                Envoyer(suite.ToArray());
                return r;
            }

            case "defiler":
            {
                SetCursorPos(Entier(c["x"]), Entier(c["y"]));
                int dy = c.ContainsKey("dy") ? Entier(c["dy"]) : 0;
                int dx = c.ContainsKey("dx") ? Entier(c["dx"]) : 0;
                // En crans (120 par cran) ; positif vers le bas et la droite pour l'app, l'inverse pour la molette.
                if (dy != 0) Envoyer(Souris(WHEEL, -dy * 120));
                if (dx != 0) Envoyer(Souris(HWHEEL, dx * 120));
                return r;
            }

            case "relacher-tout":
            {
                // Arrêt d'urgence : plus aucune touche ni bouton enfoncé.
                var suite = new List<INPUT>();
                foreach (var vk in new ushort[] { 0x11, 0x10, 0x12, 0x5B }) suite.Add(Touche(vk, true));
                suite.Add(Souris(LEFTUP));
                suite.Add(Souris(RIGHTUP));
                Envoyer(suite.ToArray());
                return r;
            }

            default:
                throw new Exception("action inconnue");
        }
    }

    static void Main()
    {
        // Pixels physiques, sans virtualisation de Windows (PER_MONITOR_AWARE_V2 = -4), sinon l'ancienne API.
        try { if (!SetProcessDpiAwarenessContext(new IntPtr(-4))) SetProcessDPIAware(); } catch { SetProcessDPIAware(); }
        var json = new JavaScriptSerializer();
        var entree = new StreamReader(Console.OpenStandardInput(), new UTF8Encoding(false));
        var sortie = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false)) { AutoFlush = true };
        string ligne;
        while ((ligne = entree.ReadLine()) != null)
        {
            object id = null;
            try
            {
                var commande = json.Deserialize<Dictionary<string, object>>(ligne);
                if (commande.ContainsKey("id")) id = commande["id"];
                var r = Executer(commande);
                r["id"] = id;
                r["ok"] = true;
                sortie.WriteLine(json.Serialize(r));
            }
            catch (Exception e)
            {
                sortie.WriteLine(json.Serialize(new Dictionary<string, object> { { "id", id }, { "ok", false }, { "erreur", e.Message } }));
            }
        }
    }
}
