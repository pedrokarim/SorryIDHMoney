/*
 * Couleurs de la marque pour ce que l'extension pose SUR les sites (toasts,
 * fiche d'anime, boutons, pastilles). Ces éléments vivent sur des pages
 * claires comme sombres : ils gardent donc toujours le même habillage encre
 * et or, celui de l'icône, au lieu de suivre le thème des pages internes.
 *
 * Mêmes valeurs que `styles/base.css` (thème sombre).
 */
export const BRAND = {
  ink: '#17131f',
  surface: '#1a1720',
  surface2: '#231f2b',
  surface3: '#2e2938',
  border: 'rgba(255, 255, 255, 0.09)',
  text: '#f5f1e8',
  muted: '#a9a2b4',
  faint: '#8c8597',
  gold: '#ffc233',
  goldHover: '#ffcf5c',
  onGold: '#17131f',
  ok: '#4fd18b',
  danger: '#ff7a85',
  info: '#8ab0ff',
  shadow: '0 12px 32px rgba(0, 0, 0, 0.38), 0 2px 6px rgba(0, 0, 0, 0.24)',
  font: '"Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, sans-serif',
  radius: '12px',
};

/** Le S sans barre, en SVG inline (même tracé que icons/brand/symbol.svg). */
export const BRAND_SYMBOL_PATH =
  'M196.88 58.11A76 66 0 0 0 142 21.13L142 42A14 14 0 0 1 114 42L114 21.13A76 66 0 0 0 128 152' +
  'A28 18 0 1 1 102.62 177.61L59.12 197.89A76 66 0 0 0 114 234.87L114 214A14 14 0 0 1 142 214' +
  'L142 234.87A76 66 0 0 0 128 104A28 18 0 1 1 153.38 78.39Z';

export function brandSymbolSvg(size = 16, color = BRAND.gold) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 256 256" aria-hidden="true"><path fill="${color}" d="${BRAND_SYMBOL_PATH}"/></svg>`;
}
