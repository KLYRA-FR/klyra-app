// klyra-entrees (Mac) : clavier et souris pour Computer Use, par CGEvent.
// Une commande JSON par ligne sur l'entrée standard, une réponse JSON par ligne
// sur la sortie. Coordonnées en points du bureau (comme Electron), origine en
// haut à gauche de l'écran principal. Il faut l'autorisation Accessibilité de
// KLYRA (le processus parent) : sans elle, macOS ignore les événements.
// Lancé seulement par l'app (electron/ordinateur/entrees.ts), jamais sans l'interrupteur.
import ApplicationServices
import CoreGraphics
import Foundation

let VERSION = 1
let source = CGEventSource(stateID: .hidSystemState)

func repondre(_ d: [String: Any]) {
  guard let data = try? JSONSerialization.data(withJSONObject: d) else { return }
  FileHandle.standardOutput.write(data)
  FileHandle.standardOutput.write("\n".data(using: .utf8)!)
}

struct Erreur: Error { let message: String }

func nombre(_ v: Any?) throws -> Double {
  if let n = v as? NSNumber { return n.doubleValue }
  throw Erreur(message: "nombre attendu")
}

// Les touches par leur nom (codes virtuels de macOS).
let TOUCHES: [String: CGKeyCode] = [
  "a": 0, "s": 1, "d": 2, "f": 3, "h": 4, "g": 5, "z": 6, "x": 7, "c": 8, "v": 9, "b": 11, "q": 12, "w": 13, "e": 14, "r": 15,
  "y": 16, "t": 17, "1": 18, "2": 19, "3": 20, "4": 21, "6": 22, "5": 23, "9": 25, "7": 26, "8": 28, "0": 29, "o": 31, "u": 32,
  "i": 34, "p": 35, "l": 37, "j": 38, "k": 40, "n": 45, "m": 46,
  "entree": 36, "tab": 48, "espace": 49, "retour": 51, "echap": 53, "suppr": 117,
  "debut": 115, "fin": 119, "page-haut": 116, "page-bas": 121, "gauche": 123, "droite": 124, "bas": 125, "haut": 126,
  "f1": 122, "f2": 120, "f3": 99, "f4": 118, "f5": 96, "f6": 97, "f7": 98, "f8": 100, "f9": 101, "f10": 109, "f11": 103, "f12": 111,
]
let MODIFICATEURS: [String: (CGKeyCode, CGEventFlags)] = [
  "cmd": (55, .maskCommand), "maj": (56, .maskShift), "option": (58, .maskAlternate), "alt": (58, .maskAlternate), "ctrl": (59, .maskControl),
]

func clavier(_ code: CGKeyCode, bas: Bool, flags: CGEventFlags) {
  let e = CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: bas)!
  e.flags = flags
  e.post(tap: .cghidEventTap)
}

func souris(_ type: CGEventType, _ p: CGPoint, _ bouton: CGMouseButton, clics: Int64 = 1) {
  let e = CGEvent(mouseEventSource: source, mouseType: type, mouseCursorPosition: p, mouseButton: bouton)!
  e.setIntegerValueField(.mouseEventClickState, value: clics)
  e.post(tap: .cghidEventTap)
}

func point(_ c: [String: Any]) throws -> CGPoint {
  CGPoint(x: try nombre(c["x"]), y: try nombre(c["y"]))
}

func executer(_ c: [String: Any]) throws -> [String: Any] {
  switch c["action"] as? String ?? "" {
  case "ping":
    return ["version": VERSION, "accessibilite": AXIsProcessTrusted()]

  case "deplacer":
    souris(.mouseMoved, try point(c), .left)
    return [:]

  case "clic":
    let p = try point(c)
    let nombreClics = max(1, min(3, Int((c["nombre"] as? NSNumber)?.intValue ?? 1)))
    let (bas, haut, bouton): (CGEventType, CGEventType, CGMouseButton) = {
      switch c["bouton"] as? String ?? "gauche" {
      case "droit": return (.rightMouseDown, .rightMouseUp, .right)
      case "milieu": return (.otherMouseDown, .otherMouseUp, .center)
      default: return (.leftMouseDown, .leftMouseUp, .left)
      }
    }()
    souris(.mouseMoved, p, bouton)
    for i in 1...nombreClics {
      souris(bas, p, bouton, clics: Int64(i))
      souris(haut, p, bouton, clics: Int64(i))
    }
    return [:]

  case "taper":
    guard let texte = c["texte"] as? String else { throw Erreur(message: "texte attendu") }
    for caractere in texte {
      let unites = Array(String(caractere).utf16)
      for bas in [true, false] {
        let e = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: bas)!
        e.keyboardSetUnicodeString(stringLength: unites.count, unicodeString: unites)
        e.post(tap: .cghidEventTap)
      }
      usleep(4000)
    }
    return [:]

  case "touche":
    guard let noms = c["touches"] as? [String], let principale = noms.last else { throw Erreur(message: "touches attendues") }
    let mods = try noms.dropLast().map { nom -> (CGKeyCode, CGEventFlags) in
      guard let m = MODIFICATEURS[nom] else { throw Erreur(message: "modificateur inconnu : \(nom)") }
      return m
    }
    var flags: CGEventFlags = []
    for (code, flag) in mods {
      flags.insert(flag)
      clavier(code, bas: true, flags: flags)
    }
    if let (code, flag) = MODIFICATEURS[principale] {
      clavier(code, bas: true, flags: flags.union(flag))
      clavier(code, bas: false, flags: flags)
    } else {
      guard let code = TOUCHES[principale] else { throw Erreur(message: "touche inconnue : \(principale)") }
      clavier(code, bas: true, flags: flags)
      clavier(code, bas: false, flags: flags)
    }
    for (code, flag) in mods.reversed() {
      flags.remove(flag)
      clavier(code, bas: false, flags: flags)
    }
    return [:]

  case "defiler":
    souris(.mouseMoved, try point(c), .left)
    let dy = Int32(try nombre(c["dy"]))
    let dx = Int32((c["dx"] as? NSNumber)?.intValue ?? 0)
    // En lignes ; positif vers le bas et la droite pour l'app, l'inverse pour macOS.
    let e = CGEvent(scrollWheelEvent2Source: source, units: .line, wheelCount: 2, wheel1: -dy, wheel2: -dx, wheel3: 0)!
    e.post(tap: .cghidEventTap)
    return [:]

  case "relacher-tout":
    // Arrêt d'urgence : plus aucune touche ni bouton enfoncé.
    for (code, _) in MODIFICATEURS.values { clavier(code, bas: false, flags: []) }
    let p = CGEvent(source: nil)?.location ?? .zero
    souris(.leftMouseUp, p, .left)
    souris(.rightMouseUp, p, .right)
    return [:]

  default:
    throw Erreur(message: "action inconnue")
  }
}

setvbuf(stdout, nil, _IONBF, 0)
while let ligne = readLine() {
  guard let data = ligne.data(using: .utf8),
    let commande = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
  else {
    repondre(["ok": false, "erreur": "JSON invalide"])
    continue
  }
  let id = commande["id"] ?? NSNull()
  do {
    var r = try executer(commande)
    r["id"] = id
    r["ok"] = true
    repondre(r)
  } catch let e as Erreur {
    repondre(["id": id, "ok": false, "erreur": e.message])
  } catch {
    repondre(["id": id, "ok": false, "erreur": "\(error)"])
  }
}
