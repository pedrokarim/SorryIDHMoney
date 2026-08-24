"""
Renomme des identifiants JS sans toucher aux commentaires ni aux chaines.

Le module XPoster porte ses commentaires en francais, et c'est la convention
voulue : seuls les identifiants passent en anglais. Un remplacement global
mangerait la prose — « la publication » deviendrait « la post ». On decoupe
donc le fichier en zones code / commentaire / chaine, et on ne reecrit que la
premiere.

Les chaines sont epargnees aussi : elles portent les noms de messages, les
cles de stockage et les etats de la file, qui se migrent a part.
"""
import re
import sys


def split_regions(src):
    """Decoupe en (texte, is_code). Gere // /* */ ' " ` et les echappements."""
    out = []
    i = 0
    n = len(src)
    buf = []

    def flush(code):
        if buf:
            out.append(("".join(buf), code))
            buf.clear()

    while i < n:
        c = src[i]
        two = src[i:i + 2]

        if two == "//":
            flush(True)
            j = src.find("\n", i)
            j = n if j == -1 else j
            out.append((src[i:j], False))
            i = j
            continue

        if two == "/*":
            flush(True)
            j = src.find("*/", i + 2)
            j = n if j == -1 else j + 2
            out.append((src[i:j], False))
            i = j
            continue

        if c in "'\"`":
            flush(True)
            quote = c
            j = i + 1
            while j < n:
                if src[j] == "\\":
                    j += 2
                    continue
                if src[j] == quote:
                    j += 1
                    break
                j += 1
            out.append((src[i:j], False))
            i = j
            continue

        buf.append(c)
        i += 1

    flush(True)
    return out


def rename(src, mapping):
    pattern = re.compile(r"\b(" + "|".join(map(re.escape, sorted(mapping, key=len, reverse=True))) + r")\b")
    pieces = []
    for text, is_code in split_regions(src):
        if is_code:
            text = pattern.sub(lambda m: mapping[m.group(1)], text)
        pieces.append(text)
    return "".join(pieces)



# ---------------------------------------------------------------------------
# Verificateur : signale les identifiants francais dans les zones de code.
#
# Les commentaires et les chaines sont ignores : ils DOIVENT rester en
# francais. Seul le code est concerne. Voir CLAUDE.md a la racine du poste.
# ---------------------------------------------------------------------------

# Champs qui franchissent une frontiere : stockage, charge du pont, rapport,
# noms d'action du CLI. Ils se renomment de tous les cotes a la fois, pas ici.
PROTOCOL = {
    "texte", "quand", "publier", "etat", "depose", "rapport", "erreur", "charge",
    "images", "alts", "programmation", "comptesAutorises", "programmerLe",
    "nbImages", "publie", "recu", "horaire", "trace", "traceAlt", "ecriture",
    "methode", "relu", "resume", "programme", "libelle", "compte", "pseudo",
    "vide", "apercu", "resultat", "dejaOuverte", "boutonsVus", "attenduMs",
    "attenteEnvoi", "champTrouve", "pieces", "construits", "dansDataTransfer",
    "apresAffectation", "vignettesVisibles", "recues", "arret", "ecrit",
    "programmer", "annuler", "lister", "capturer", "relancer", "tweets",
    "programmes", "maintenant",
}

FRENCH = re.compile(
    r"^(?!.*(?:clear|client|article))"
    r".*(cles?$|delai|lien|obtenu|essai|reveil|veille|sonde|jour$|mois$|annee|"
    r"heure$|libell|valeur|donnee|reglage|fichier|onglet|fenetre|boite|cadre|"
    r"balay|cout|depart|vus$|zone$|bouton|champ|texte|publi|programm|attente|"
    r"echec|manque|prepar|executer|lire|ecrire|rearmer|annuler|tour$)",
    re.I,
)
IDENT = re.compile(r"[a-zA-Z_][a-zA-Z0-9_]*")


def check(path):
    code = "".join(t for t, is_code in split_regions(open(path, encoding="utf-8").read()) if is_code)
    names = {m.group(0) for m in IDENT.finditer(code)}
    return sorted(n for n in names if FRENCH.match(n) and n not in PROTOCOL)


if __name__ == "__main__":
    import glob
    faults = 0
    for path in sorted(glob.glob("scripts/xposter-*.js")):
        bad = check(path)
        print(f"{path}: {', '.join(bad) if bad else 'propre'}")
        faults += len(bad)
    sys.exit(1 if faults else 0)
