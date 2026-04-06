/**
 * Gestion du cache des animes
 * Structure optimisée avec TTL, lazy-write et batch save
 */

const CACHE_KEY = 'animeCache_v2';
const SAVE_DEBOUNCE_MS = 500;

class AnimeCacheManager {
    constructor() {
        this.cache = null;
        this._saveTimer = null;
        this.ready = this.initCache();
    }

    /**
     * Initialise le cache depuis le stockage local
     */
    async initCache() {
        return new Promise(resolve => {
            chrome.storage.local.get([CACHE_KEY, 'animeNotFoundCache'], result => {
                if (result[CACHE_KEY]) {
                    this.cache = result[CACHE_KEY];
                } else if (result.animeNotFoundCache) {
                    // Migration depuis l'ancien format
                    this.cache = this._migrateFromV1(result.animeNotFoundCache);
                    this._saveImmediate();
                    // Nettoyer l'ancien cache
                    chrome.storage.local.remove('animeNotFoundCache');
                } else {
                    this.cache = {
                        customUrls: {},
                        ignoredItems: [],
                        version: 2
                    };
                }

                // Nettoyage des entrées expirées au chargement
                this._cleanup();
                resolve();
            });
        });
    }

    /**
     * Migration depuis le format v1
     */
    _migrateFromV1(oldCache) {
        const newCache = {
            customUrls: {},
            ignoredItems: oldCache.ignoredItems || [],
            version: 2
        };

        // Migrer les customUrls avec timestamp
        if (oldCache.customUrls) {
            for (const [key, value] of Object.entries(oldCache.customUrls)) {
                newCache.customUrls[key] = {
                    ...value,
                    timestamp: Date.now()
                };
            }
        }

        return newCache;
    }

    /**
     * Nettoyage (placeholder pour d'éventuelles futures règles)
     * Les customUrls n'expirent jamais - seul l'utilisateur peut les supprimer
     */
    _cleanup() {
        // Les customUrls sont permanentes, pas de nettoyage automatique
    }

    /**
     * Attend que le cache soit initialisé
     */
    async ensureCacheReady() {
        if (!this.cache) {
            await this.ready;
        }
    }

    /**
     * Sauvegarde le cache avec debounce pour éviter les écritures trop fréquentes
     */
    _scheduleSave() {
        if (this._saveTimer) {
            clearTimeout(this._saveTimer);
        }
        this._saveTimer = setTimeout(() => {
            this._saveImmediate();
        }, SAVE_DEBOUNCE_MS);
    }

    /**
     * Sauvegarde immédiate
     */
    _saveImmediate() {
        return new Promise(resolve => {
            chrome.storage.local.set({ [CACHE_KEY]: this.cache }, resolve);
        });
    }

    /**
     * Normalise une clé de cache (lowercase + trim)
     */
    _normalize(key) {
        return key?.toLowerCase().trim() || '';
    }

    /**
     * Vérifie si un terme de recherche a une correspondance dans le cache
     * @param {string} searchTerm - Terme de recherche à vérifier
     * @returns {true|object|null} true si ignoré, object si customUrl, null sinon
     */
    async isInCache(searchTerm) {
        await this.ensureCacheReady();
        const key = this._normalize(searchTerm);

        if (this.cache.ignoredItems.includes(key)) {
            return true;
        }

        const customUrl = this.cache.customUrls[key];
        if (customUrl) {
            return customUrl;
        }

        return null;
    }

    /**
     * Ignore un anime pour ne plus le rechercher
     * @param {string} searchTerm - Terme de recherche à ignorer
     */
    async ignoreAnime(searchTerm) {
        await this.ensureCacheReady();
        const key = this._normalize(searchTerm);

        if (!this.cache.ignoredItems.includes(key)) {
            this.cache.ignoredItems.push(key);
            delete this.cache.customUrls[key];
            this._scheduleSave();
            return true;
        }
        return false;
    }

    /**
     * Définit une URL personnalisée pour un anime
     * @param {string} searchTerm - Terme de recherche
     * @param {string} customUrl - URL personnalisée AniList
     */
    async setCustomUrl(searchTerm, customUrl) {
        await this.ensureCacheReady();
        const key = this._normalize(searchTerm);

        const anilistId = this._extractAnilistId(customUrl);
        let entry = {
            anilistUrl: customUrl,
            malUrl: null,
            title: searchTerm,
            timestamp: Date.now()
        };

        if (anilistId) {
            try {
                const mediaData = await this._fetchAnilistMediaData(anilistId);
                if (mediaData) {
                    entry.malUrl = mediaData.malUrl;
                    entry.title = mediaData.title?.romaji || searchTerm;
                }
            } catch (error) {
                console.error("Erreur lors de la récupération des données AniList:", error);
            }
        }

        this.cache.customUrls[key] = entry;

        // Retirer des ignorés si nécessaire
        this.cache.ignoredItems = this.cache.ignoredItems.filter(item => item !== key);

        // Sauvegarder immédiatement car c'est une action utilisateur explicite
        await this._saveImmediate();
        return true;
    }

    /**
     * Extrait l'ID AniList à partir d'une URL
     */
    _extractAnilistId(url) {
        try {
            const urlObj = new URL(url);
            if (urlObj.hostname === 'anilist.co') {
                const pathParts = urlObj.pathname.split('/').filter(Boolean);
                if (pathParts.length >= 2 && pathParts[0] === 'anime') {
                    const id = pathParts[1];
                    if (/^\d+$/.test(id)) return id;
                }
            }
            return null;
        } catch (e) {
            return null;
        }
    }

    /**
     * Récupère les données d'un anime via l'API AniList
     */
    async _fetchAnilistMediaData(id) {
        try {
            const query = `
            query ($id: Int) {
                Media (id: $id, type: ANIME) {
                    id
                    idMal
                    title {
                        romaji
                        english
                        native
                    }
                    siteUrl
                }
            }
            `;

            const response = await fetch('https://graphql.anilist.co', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                },
                body: JSON.stringify({
                    query: query,
                    variables: { id: parseInt(id) }
                })
            });

            const data = await response.json();

            if (data.data?.Media) {
                const media = data.data.Media;
                const malUrl = media.idMal
                    ? `https://myanimelist.net/anime/${media.idMal}`
                    : null;

                return {
                    title: media.title,
                    siteUrl: media.siteUrl,
                    malUrl: malUrl
                };
            }

            return null;
        } catch (error) {
            console.error("Erreur lors de la requête à l'API AniList:", error);
            return null;
        }
    }

    /**
     * Récupère toutes les données du cache
     */
    async getAllData() {
        await this.ensureCacheReady();
        return {
            customUrls: this.cache.customUrls,
            ignoredItems: this.cache.ignoredItems
        };
    }

    /**
     * Supprime un anime du cache
     * @param {string} searchTerm - Terme de recherche à supprimer
     */
    async removeAnime(searchTerm) {
        await this.ensureCacheReady();
        const key = this._normalize(searchTerm);

        let modified = false;

        if (this.cache.customUrls[key]) {
            delete this.cache.customUrls[key];
            modified = true;
        }
        if (this.cache.ignoredItems.includes(key)) {
            this.cache.ignoredItems = this.cache.ignoredItems.filter(item => item !== key);
            modified = true;
        }

        if (modified) {
            await this._saveImmediate();
            return true;
        }
        return false;
    }

    /**
     * Vide entièrement le cache
     */
    async clearAll() {
        this.cache = {
            customUrls: {},
            ignoredItems: [],
            version: 2
        };
        await this._saveImmediate();
    }
}

// Exporter une instance unique
export const animeCache = new AnimeCacheManager();
