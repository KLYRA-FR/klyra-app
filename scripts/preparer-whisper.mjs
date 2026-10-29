// Prépare Whisper (whisper-server, de whisper.cpp) à embarquer dans l'app, pour la dictée : rien à
// installer chez la personne. Rangé dans vendor/whisper/<système>/ (hors git),
// que electron-builder copie dans l'app (extraResources).
// - Windows : le binaire officiel de la version, téléchargé.
// - Mac : compilé ici, en un seul fichier (Metal compris) ; il faut cmake. Sans
//   cmake, rien n'est embarqué et l'app se rabat sur le Whisper de Homebrew.
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const VERSION = "v1.9.2";
const racine = path.resolve(import.meta.dirname, "..");
const cible = path.join(racine, "vendor", "whisper", process.platform);
const temoin = path.join(cible, `.${VERSION}-serveur`);

if (existsSync(temoin)) process.exit(0);
rmSync(cible, { recursive: true, force: true });
mkdirSync(cible, { recursive: true });
const travail = mkdtempSync(path.join(os.tmpdir(), "klyra-whisper-"));
const lancer = (bin, args, cwd = travail) => execFileSync(bin, args, { cwd, stdio: "inherit" });

try {
  if (process.platform === "win32") {
    const zip = path.join(travail, "whisper.zip");
    const reponse = await fetch(`https://github.com/ggml-org/whisper.cpp/releases/download/${VERSION}/whisper-bin-x64.zip`);
    if (!reponse.ok) throw new Error(`Téléchargement de Whisper impossible (${reponse.status})`);
    writeFileSync(zip, Buffer.from(await reponse.arrayBuffer()));
    // Le tar de Windows (il lit les .zip), pas celui de Git Bash qui pourrait passer devant dans le PATH.
    lancer(path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe"), ["-xf", zip]);
    const release = path.join(travail, "Release");
    for (const nom of readdirSync(release)) {
      if (nom === "whisper-server.exe" || nom.endsWith(".dll")) copyFileSync(path.join(release, nom), path.join(cible, nom));
    }
  } else if (process.platform === "darwin") {
    try {
      execFileSync("cmake", ["--version"], { stdio: "ignore" });
    } catch {
      console.warn("cmake absent : Whisper n'est pas embarqué (l'app utilisera celui de Homebrew).");
      process.exit(0);
    }
    lancer("git", ["clone", "--depth", "1", "--branch", VERSION, "https://github.com/ggml-org/whisper.cpp.git", "src"]);
    const src = path.join(travail, "src");
    lancer("cmake", ["-B", "build", "-DCMAKE_BUILD_TYPE=Release", "-DBUILD_SHARED_LIBS=OFF", "-DGGML_METAL_EMBED_LIBRARY=ON", "-DWHISPER_BUILD_TESTS=OFF", "-DWHISPER_SDL2=OFF"], src);
    lancer("cmake", ["--build", "build", "--config", "Release", "--target", "whisper-server", "-j"], src);
    copyFileSync(path.join(src, "build", "bin", "whisper-server"), path.join(cible, "whisper-server"));
  } else {
    process.exit(0);
  }
  writeFileSync(temoin, "");
  console.log(`Whisper ${VERSION} prêt : ${cible}`);
} finally {
  rmSync(travail, { recursive: true, force: true });
}
