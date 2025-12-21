// toast.js - Modern Toast Notification System for ChampZero

class ToastManager {
    constructor() {
        this.container = null;
        this.init();
    }

    init() {
        if (!this.container) {
            this.injectStyles();
            this.createContainer();
        }
    }

    injectStyles() {
        if (document.getElementById('cz-toast-styles')) return;

        const style = document.createElement('style');
        style.id = 'cz-toast-styles';
        style.textContent = `
            :root {
                --toast-success: #10B981;
                --toast-error: #EF4444;
                --toast-warning: #F59E0B;
                --toast-info: #3B82F6;
                --toast-default: #6B7280;
            }

            #toast-container {
                position: fixed;
                top: 20px;
                right: 20px;
                z-index: 9999;
                pointer-events: none;
                max-width: 400px;
                width: 100%;
                padding: 0 20px;
            }

            .toast {
                pointer-events: auto;
                background: rgba(26, 26, 31, 0.98);
                backdrop-filter: blur(16px);
                border: 1px solid rgba(255, 255, 255, 0.1);
                border-radius: 12px;
                padding: 16px 20px;
                margin-bottom: 12px;
                box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
                display: flex;
                align-items: flex-start;
                gap: 12px;
                animation: slideIn 0.3s ease-out;
                position: relative;
                overflow: hidden;
                transition: all 0.3s ease;
            }

            .toast::before {
                content: '';
                position: absolute;
                left: 0;
                top: 0;
                bottom: 0;
                width: 4px;
                background: var(--toast-color);
            }

            .toast:hover {
                transform: translateX(-4px);
                box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
            }

            .toast.removing {
                animation: slideOut 0.3s ease-in forwards;
            }

            .toast-icon {
                width: 24px;
                height: 24px;
                flex-shrink: 0;
                display: flex;
                align-items: center;
                justify-content: center;
                border-radius: 50%;
                background: var(--toast-color);
                color: white;
                font-weight: bold;
                font-size: 14px;
            }

            .toast-content {
                flex: 1;
                min-width: 0;
            }

            .toast-title {
                font-weight: 600;
                color: white;
                font-size: 14px;
                margin-bottom: 4px;
                line-height: 1.4;
            }

            .toast-message {
                font-size: 13px;
                color: #9CA3AF;
                line-height: 1.5;
                word-wrap: break-word;
            }

            .toast-close {
                width: 24px;
                height: 24px;
                flex-shrink: 0;
                background: transparent;
                border: none;
                color: #6B7280;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                border-radius: 6px;
                transition: all 0.2s ease;
                font-size: 18px;
                line-height: 1;
                padding: 0;
            }

            .toast-close:hover {
                background: rgba(255, 255, 255, 0.1);
                color: white;
            }

            .toast-progress {
                position: absolute;
                bottom: 0;
                left: 0;
                height: 3px;
                background: var(--toast-color);
                opacity: 0.6;
                animation: progressBar linear;
            }

            @keyframes slideIn {
                from {
                    opacity: 0;
                    transform: translateX(100%);
                }
                to {
                    opacity: 1;
                    transform: translateX(0);
                }
            }

            @keyframes slideOut {
                from {
                    opacity: 1;
                    transform: translateX(0);
                    max-height: 200px;
                    margin-bottom: 12px;
                }
                to {
                    opacity: 0;
                    transform: translateX(100%);
                    max-height: 0;
                    margin-bottom: 0;
                    padding-top: 0;
                    padding-bottom: 0;
                }
            }

            @keyframes progressBar {
                from {
                    width: 100%;
                }
                to {
                    width: 0%;
                }
            }

            @media (max-width: 640px) {
                #toast-container {
                    top: 10px;
                    right: 10px;
                    padding: 0 10px;
                    max-width: calc(100% - 20px);
                }

                .toast {
                    padding: 12px 16px;
                }
            }
        `;
        document.head.appendChild(style);
    }

    createContainer() {
        this.container = document.createElement('div');
        this.container.id = 'toast-container';
        document.body.appendChild(this.container);
    }

    getIcon(type) {
        const icons = {
            success: '✓',
            error: '✕',
            warning: '⚠',
            info: 'i',
            default: '•'
        };
        return icons[type] || icons.default;
    }

    getColor(type) {
        const colors = {
            success: 'var(--toast-success)',
            error: 'var(--toast-error)',
            warning: 'var(--toast-warning)',
            info: 'var(--toast-info)',
            default: 'var(--toast-default)'
        };
        return colors[type] || colors.default;
    }

    show(options) {
        const {
            title = '',
            message = '',
            type = 'default',
            duration = 4000,
            dismissible = true
        } = options;

        const toast = document.createElement('div');
        toast.className = 'toast';
        toast.style.setProperty('--toast-color', this.getColor(type));

        const icon = document.createElement('div');
        icon.className = 'toast-icon';
        icon.textContent = this.getIcon(type);

        const content = document.createElement('div');
        content.className = 'toast-content';

        if (title) {
            const titleEl = document.createElement('div');
            titleEl.className = 'toast-title';
            titleEl.textContent = title;
            content.appendChild(titleEl);
        }

        if (message) {
            const messageEl = document.createElement('div');
            messageEl.className = 'toast-message';
            messageEl.innerHTML = message;
            content.appendChild(messageEl);
        }

        toast.appendChild(icon);
        toast.appendChild(content);

        if (dismissible) {
            const closeBtn = document.createElement('button');
            closeBtn.className = 'toast-close';
            closeBtn.innerHTML = '×';
            closeBtn.onclick = () => this.remove(toast);
            toast.appendChild(closeBtn);
        }

        if (duration > 0) {
            const progress = document.createElement('div');
            progress.className = 'toast-progress';
            progress.style.animationDuration = `${duration}ms`;
            toast.appendChild(progress);

            setTimeout(() => this.remove(toast), duration);
        }

        this.container.appendChild(toast);

        return toast;
    }

    remove(toast) {
        if (!toast || !toast.parentElement) return;

        toast.classList.add('removing');
        setTimeout(() => {
            if (toast.parentElement) {
                toast.parentElement.removeChild(toast);
            }
        }, 300);
    }

    success(title, message, duration) {
        return this.show({ title, message, type: 'success', duration });
    }

    error(title, message, duration) {
        return this.show({ title, message, type: 'error', duration });
    }

    warning(title, message, duration) {
        return this.show({ title, message, type: 'warning', duration });
    }

    info(title, message, duration) {
        return this.show({ title, message, type: 'info', duration });
    }

    clear() {
        if (this.container) {
            this.container.innerHTML = '';
        }
    }
}

// Create global instance
const toast = new ToastManager();

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
    module.exports = toast;
}

// Make available globally
window.toast = toast;

// Convenience global functions
window.showToast = (title, message, type = 'default', duration = 4000) => {
    return toast.show({ title, message, type, duration });
};

window.showSuccessToast = (title, message, duration) => toast.success(title, message, duration);
window.showErrorToast = (title, message, duration) => toast.error(title, message, duration);
window.showWarningToast = (title, message, duration) => toast.warning(title, message, duration);
window.showInfoToast = (title, message, duration) => toast.info(title, message, duration);
