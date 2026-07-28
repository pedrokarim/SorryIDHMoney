Récupère le logo/favicon d'un site web pour l'utiliser dans la config de l'extension.

**Argument** : $ARGUMENTS (URL du site, ex: https://www.crunchyroll.com)

> **Priorité** : toujours le **vrai logo du site** (favicon / apple-touch-icon) — c'est le
> logo authentique, avec ses vraies couleurs et son design. Simple Icons n'est qu'un
> **dernier recours** (il ne fournit qu'une silhouette mono-couleur, pas le vrai logo).

## Source 1 (prioritaire) — Favicon / logo du site

1. Naviguer sur le site via le navigateur DevTools MCP
2. Extraire les URLs des icônes via `evaluate_script` :
   ```js
   () => Array.from(document.querySelectorAll('link[rel*="icon"]')).map(l => ({ rel: l.rel, href: l.href, sizes: l.sizes?.value }))
   ```
3. Choisir la meilleure icône (priorité : apple-touch-icon > icon 192x192 > icon 96x96 > icon 32x32 > favicon.ico)
4. Tenter le téléchargement via `curl -sL -A "Mozilla/5.0"` dans `icons/platforms/`
5. Si curl échoue (403) : récupérer via `evaluate_script` en base64 depuis le navigateur :
   ```js
   async () => {
     const res = await fetch('{url_icone}');
     const blob = await res.blob();
     return new Promise(r => {
       const reader = new FileReader();
       reader.onloadend = () => r(reader.result);
       reader.readAsDataURL(blob);
     });
   }
   ```
   Puis décoder le base64 et sauvegarder le fichier.

## Source 2 (dernier recours) — Simple Icons CDN

Uniquement si la Source 1 échoue totalement (site inaccessible, pas de favicon exploitable).
[simple-icons-cdn](https://github.com/LitoMore/simple-icons-cdn) fournit un SVG mono-couleur
à la couleur officielle de la marque — pratique mais ce n'est PAS le vrai logo.

- Format : `https://cdn.simpleicons.org/{slug}` (couleur de marque par défaut)
  - Couleur imposée : `https://cdn.simpleicons.org/{slug}/{couleur}` (hex sans `#`, ou mot-clé CSS)
- **Slug** : nom de marque en minuscules, sans espaces ni ponctuation (`aliexpress`, `bluesky`, `x`).
  En cas de doute : https://simpleicons.org (clic sur le titre = copie le slug) ou
  https://github.com/simple-icons/simple-icons/blob/master/slugs.md
- Téléchargement : `curl -sL "https://cdn.simpleicons.org/{slug}" -o "icons/platforms/{nom}.svg"`
- **Contrôle** : un slug inconnu renvoie une page/erreur, pas un SVG. Vérifier que le fichier
  commence par `<svg` (`head -c 20`) ; sinon supprimer. Ne couvre que les grandes marques
  (les services de niche — agechecker, agego, ageverif, veriff… — n'y sont pas).

## Finalisation

6. Vérifier le fichier avec `file` pour confirmer que c'est bien une image (ou un SVG valide)
7. Afficher un résumé : nom du fichier, dimensions/format, source utilisée (favicon ou Simple Icons)

Sauvegarder sous `icons/platforms/{nom_court_du_site}.{ext}` (PNG préféré, sinon SVG/WebP/ICO).
