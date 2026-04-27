/**
 * Gestionnaire de toasts pour l'extension
 */
class ToastManager {
    constructor(position = 'top-right') {
        this.container = null;
        this.position = position;
        this.toasts = new Set(); // Pour suivre les toasts actifs
        this.initContainer();
    }

    /**
     * Définit la position des toasts
     * @param {string} position - 'top-left', 'top-center', 'top-right', 'bottom-left', 'bottom-center', 'bottom-right'
     */
    setPosition(position) {
        this.position = position;
        this.updateContainerPosition();
    }

    updateContainerPosition() {
        const positions = {
            'top-left': 'top: 20px; left: 20px; flex-direction: column;',
            'top-center': 'top: 20px; left: 50%; transform: translateX(-50%); flex-direction: column;',
            'top-right': 'top: 20px; right: 20px; flex-direction: column;',
            'bottom-left': 'bottom: 20px; left: 20px; flex-direction: column-reverse;',
            'bottom-center': 'bottom: 20px; left: 50%; transform: translateX(-50%); flex-direction: column-reverse;',
            'bottom-right': 'bottom: 20px; right: 20px; flex-direction: column-reverse;'
        };

        const positionStyle = positions[this.position] || positions['top-right'];
        this.container.style.cssText = `
            position: fixed;
            ${positionStyle}
            z-index: 999999;
            display: flex;
            gap: 10px;
            pointer-events: none;
            max-height: 100vh;
            overflow-y: hidden;
            padding: 10px;
        `;
    }

    initContainer() {
        if (!this.container) {
            this.container = document.createElement('div');
            this.container.id = 'extension-toast-container';
            this.updateContainerPosition();
            document.body.appendChild(this.container);
        }
    }

    /**
     * Affiche un toast avec des options avancées
     * @param {string} message - Message à afficher
     * @param {Object} options - Options du toast
     * @param {string} options.type - Type de toast ('success', 'error', 'info', 'warning')
     * @param {number} options.duration - Durée d'affichage en ms (défaut: 3000)
     * @param {string} options.position - Position du toast
     * @param {Array} options.buttons - Boutons à ajouter au toast [{text, onClick, type}]
     */
    show(message, options = {}) {
        const {
            type = 'info',
            duration = 3000,
            position,
            buttons = []
        } = options;

        // Mettre à jour la position si spécifiée
        if (position) {
            this.setPosition(position);
        }

        const toast = document.createElement('div');
        toast.className = `extension-toast toast-${type}`;

        // Couleurs par type
        const bgColors = {
            success: '#f0fdf4',
            error: '#fef2f2',
            warning: '#fffbeb',
            info: '#eff6ff'
        };
        const borderColors = {
            success: '#bbf7d0',
            error: '#fecaca',
            warning: '#fde68a',
            info: '#bfdbfe'
        };
        const textColors = {
            success: '#166534',
            error: '#991b1b',
            warning: '#92400e',
            info: '#1e40af'
        };

        // Styles du toast
        toast.style.cssText = `
            padding: 10px 14px;
            background: ${bgColors[type] || bgColors.info};
            border: 1px solid ${borderColors[type] || borderColors.info};
            border-radius: 6px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.08);
            opacity: 0;
            pointer-events: auto;
            transform: translateY(-8px);
            transition: all 0.25s ease;
            display: flex;
            flex-direction: column;
            gap: 6px;
            min-width: 220px;
            max-width: 360px;
            margin: 0;
            color: ${textColors[type] || textColors.info};
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            font-size: 13px;
            line-height: 1.4;
        `;

        // Contenu principal du toast
        const contentDiv = document.createElement('div');
        contentDiv.className = 'toast-content';
        contentDiv.style.cssText = `
            display: flex;
            align-items: center;
            gap: 10px;
        `;

        // Ajouter l'icône et le message
        const icon = this.getIconForType(type);
        contentDiv.innerHTML = `
            <span class="toast-icon" style="display:flex;flex-shrink:0;">${icon}</span>
            <span class="toast-message" style="flex:1;min-width:0;">${message}</span>
        `;
        toast.appendChild(contentDiv);

        // Ajouter les boutons si présents
        if (buttons.length > 0) {
            const buttonsContainer = document.createElement('div');
            buttonsContainer.className = 'toast-buttons';
            buttonsContainer.style.cssText = `
                display: flex;
                gap: 8px;
                margin-top: 4px;
                justify-content: flex-end;
            `;

            buttons.forEach(button => {
                const btnElement = document.createElement('button');
                btnElement.textContent = button.text;
                btnElement.className = `toast-button ${button.type || 'default'}`;
                btnElement.style.cssText = `
                    padding: 4px 10px;
                    border: 1px solid ${borderColors[type] || borderColors.info};
                    border-radius: 4px;
                    font-size: 11px;
                    font-weight: 500;
                    cursor: pointer;
                    background: transparent;
                    color: ${textColors[type] || textColors.info};
                    transition: background 0.15s;
                    font-family: inherit;
                `;
                btnElement.addEventListener('click', () => {
                    if (typeof button.onClick === 'function') {
                        button.onClick();
                    }
                    // Fermer le toast après avoir cliqué sur le bouton
                    this.removeToast(toast);
                });
                buttonsContainer.appendChild(btnElement);
            });

            toast.appendChild(buttonsContainer);
        }

        // Ajouter le toast au conteneur
        this.container.appendChild(toast);
        this.toasts.add(toast);

        // Animation d'entrée
        requestAnimationFrame(() => {
            toast.style.opacity = '1';
            toast.style.transform = 'translateY(0)';
        });

        // Suppression automatique après la durée spécifiée
        if (duration > 0) {
            setTimeout(() => {
                this.removeToast(toast);
            }, duration);
        }

        return toast; // Retourner le toast pour permettre de le manipuler plus tard
    }

    /**
     * Supprime un toast spécifique avec animation
     */
    removeToast(toast) {
        if (!this.toasts.has(toast)) return;

        toast.style.opacity = '0';
        toast.style.transform = 'translateY(-8px)';
        setTimeout(() => {
            if (this.container.contains(toast)) {
                this.container.removeChild(toast);
                this.toasts.delete(toast);
            }
        }, 300);
    }

    /**
     * Retourne la couleur de fond pour un type de bouton
     */
    getButtonColor(type) {
        const colors = {
            primary: '#2196F3',
            success: '#4CAF50',
            danger: '#F44336',
            warning: '#FF9800',
            info: '#03A9F4',
            default: '#757575'
        };
        return colors[type] || colors.default;
    }

    /**
     * Retourne l'icône SVG correspondant au type de toast
     */
    getIconForType(type) {
        const iconColors = {
            success: '#166534',
            error: '#991b1b',
            warning: '#92400e',
            info: '#1e40af'
        };
        const c = iconColors[type] || iconColors.info;
        const icons = {
            success: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>`,
            error: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2.5" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>`,
            warning: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/></svg>`,
            info: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>`
        };
        return icons[type] || icons.info;
    }
}

// Exporter une instance unique
const toastManager = new ToastManager();

// Exposer les méthodes nécessaires
export function showToast(message, options = {}) {
    // Vérifier si les toasts sont activés
    return new Promise(resolve => {
        chrome.storage.sync.get({ enableToasts: true }, function (items) {
            if (items.enableToasts) {
                const toast = toastManager.show(message, options);
                resolve(toast);
            } else {
                // Toasts désactivés, mais on peut quand même logger le message
                console.log('[Toast désactivé]', message, options);
                resolve(null);
            }
        });
    });
} 