// Prépare klyra-entrees, le petit exécutable qui envoie clavier et souris pour
// Computer Use (native/entrees/), rangé dans vendor/entrees/<système>/ (hors
// git), que electron-builder copie dans l'app (extraResources).
// - Mac : compilé par swiftc (outils en ligne de commande d'Xcode).
// - Windows : compilé par le compilateur C# de .NET Framework 4, présent sur
//   Windows 10 et 11 ; aucune dépendance à installer chez la personne.
// - Ailleurs : rien (Linux n'est pas une cible de l'app).
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";

const racine = path.resolve(import.meta.dirname, "..");
const cible = path.join(racine, "vendor", "entrees", process.platform);
const lancer = (bin, args) => execFileSync(bin, args, { cwd: racine, stdio: "inherit" });

rmSync(cible, { recursive: true, force: true });
mkdirSync(cible, { recursive: true });

if (process.platform === "darwin") {
  lancer("xcrun", ["swiftc", "-O", "-o", path.join(cible, "klyra-entrees"), path.join("native", "entrees", "mac", "main.swift")]);
} else if (process.platform === "win32") {
  const windir = process.env.SystemRoot ?? "C:\\Windows";
  const csc = [path.join(windir, "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe"), path.join(windir, "Microsoft.NET", "Framework", "v4.0.30319", "csc.exe")].find(existsSync);
  if (!csc) throw new Error("Compilateur C# de .NET Framework 4 introuvable.");
  lancer(csc, ["/nologo", "/optimize+", "/target:exe", "/r:System.Web.Extensions.dll", `/out:${path.join(cible, "klyra-entrees.exe")}`, path.join("native", "entrees", "windows", "Entrees.cs")]);
} else {
  console.log("klyra-entrees : rien à préparer sur ce système (Mac et Windows seulement).");
}
