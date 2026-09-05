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

// ==========================================
// UNIVERSAL ESPORTS CUSTOM CONFIRM MODAL
// ==========================================
window.showCustomConfirm = function(title, message, options = {}) {
    return new Promise((resolve) => {
        const confirmText = options.confirmText || 'Confirm';
        const cancelText = options.cancelText || 'Cancel';
        const lowerTitle = String(title || '').toLowerCase();
        const isDanger = options.isDanger || lowerTitle.includes('delete') || lowerTitle.includes('disband') || lowerTitle.includes('kick') || lowerTitle.includes('drop') || lowerTitle.includes('leave');

        const overlay = document.createElement('div');
        overlay.id = 'cz-custom-confirm-modal';
        overlay.className = 'fixed inset-0 bg-black/85 backdrop-blur-md z-[99999] flex items-center justify-center p-4 transition-opacity duration-200 opacity-0';

        overlay.innerHTML = `
            <div class="bg-[#111116] border border-white/20 ring-1 ring-[#FFD700]/25 rounded-2xl max-w-md w-full p-6 shadow-[0_25px_60px_rgba(0,0,0,0.9)] transform scale-95 transition-all duration-200">
                <div class="flex items-center gap-3 mb-3">
                    <div class="w-10 h-10 rounded-xl ${isDanger ? 'bg-red-500/20 text-red-400 border border-red-500/30' : 'bg-[#FFD700]/15 text-[#FFD700] border border-[#FFD700]/30'} flex items-center justify-center shrink-0">
                        ${isDanger 
                            ? '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>'
                            : '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>'
                        }
                    </div>
                    <div>
                        <h3 class="font-heading font-bold text-base text-white uppercase tracking-tight">${title}</h3>
                        <p class="text-[10px] font-mono-tag text-neutral-400 uppercase tracking-wider">// Confirmation Required</p>
                    </div>
                </div>
                <div class="text-xs text-neutral-300 leading-relaxed mb-6 font-sans">
                    ${message}
                </div>
                <div class="flex items-center justify-end gap-3 pt-3 border-t border-white/10 font-heading font-bold text-xs uppercase tracking-wider">
                    <button type="button" id="cz-confirm-cancel" class="px-4 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-neutral-300 hover:text-white border border-white/10 transition-all cursor-pointer">
                        ${cancelText}
                    </button>
                    <button type="button" id="cz-confirm-submit" class="px-5 py-2.5 rounded-xl ${isDanger ? 'bg-red-600 hover:bg-red-500 text-white shadow-[0_0_15px_rgba(239,68,68,0.35)]' : 'bg-[#FFD700] hover:bg-[#FFF099] text-black shadow-[0_0_15px_rgba(255,215,0,0.3)]'} transition-all cursor-pointer font-extrabold">
                        ${confirmText}
                    </button>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);

        requestAnimationFrame(() => {
            overlay.classList.remove('opacity-0');
            const card = overlay.querySelector('div');
            if (card) {
                card.classList.remove('scale-95');
                card.classList.add('scale-100');
            }
        });

        function cleanup(result) {
            overlay.classList.add('opacity-0');
            const card = overlay.querySelector('div');
            if (card) {
                card.classList.remove('scale-100');
                card.classList.add('scale-95');
            }
            setTimeout(() => {
                if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
                resolve(result);
            }, 180);
        }

        const cancelBtn = overlay.querySelector('#cz-confirm-cancel');
        const submitBtn = overlay.querySelector('#cz-confirm-submit');

        if (cancelBtn) cancelBtn.onclick = () => cleanup(false);
        if (submitBtn) submitBtn.onclick = () => cleanup(true);

        overlay.onclick = (e) => {
            if (e.target === overlay) cleanup(false);
        };

        const keyHandler = (e) => {
            if (e.key === 'Escape') {
                document.removeEventListener('keydown', keyHandler);
                cleanup(false);
            }
        };
        document.addEventListener('keydown', keyHandler);
    });
};

window.customConfirm = window.showCustomConfirm;

window.showCustomAlert = function(title, message) {
    const lowerTitle = String(title || '').toLowerCase();
    const isError = lowerTitle.includes('error') || lowerTitle.includes('fail');
    const isSuccess = lowerTitle.includes('success') || lowerTitle.includes('complete') || lowerTitle.includes('joined') || lowerTitle.includes('saved');
    const isWarning = lowerTitle.includes('warning') || lowerTitle.includes('caution') || lowerTitle.includes('denied') || lowerTitle.includes('required');

    if (isError) window.showErrorToast(title, message);
    else if (isSuccess) window.showSuccessToast(title, message);
    else if (isWarning) window.showWarningToast(title, message);
    else window.showInfoToast(title, message);
    return Promise.resolve();
};

window.customAlert = window.showCustomAlert;

// Seamless Alert Override to ensure NO ugly grey browser popups ever occur
if (typeof window !== 'undefined') {
    window.alert = function(msg) {
        const text = String(msg || '');
        if (text.toLowerCase().includes('error') || text.toLowerCase().includes('fail')) {
            window.showErrorToast("Notice", text);
        } else if (text.toLowerCase().includes('warning') || text.toLowerCase().includes('required') || text.toLowerCase().includes('cannot') || text.toLowerCase().includes('need at least') || text.toLowerCase().includes('only')) {
            window.showWarningToast("Notice", text);
        } else {
            window.showInfoToast("ChampZero", text);
        }
    };
}
