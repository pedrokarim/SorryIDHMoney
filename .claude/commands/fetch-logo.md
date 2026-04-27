Récupère le logo/favicon d'un site web pour l'utiliser dans la config de l'extension.

**Argument** : $ARGUMENTS (URL du site, ex: https://www.crunchyroll.com)

## Étapes

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
6. Vérifier le fichier avec `file` pour confirmer que c'est bien une image
7. Afficher un résumé : nom du fichier, dimensions, format

Sauvegarder sous `icons/platforms/{nom_court_du_site}.{ext}` (PNG préféré, sinon SVG/WebP/ICO).
