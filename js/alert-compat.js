// alert-compat.js - Compatibility layer for custom alerts using toast notifications

// Replace the old showCustomAlert with toast-based version
window.showCustomAlert = function(title, message) {
    return new Promise((resolve) => {
        // Show toast notification
        const isError = title.toLowerCase().includes('error') || title.toLowerCase().includes('fail');
        const isSuccess = title.toLowerCase().includes('success') || title.toLowerCase().includes('complete');
        const isWarning = title.toLowerCase().includes('warning') || title.toLowerCase().includes('caution');
        
        let toastType = 'info';
        if (isError) toastType = 'error';
        else if (isSuccess) toastType = 'success';
        else if (isWarning) toastType = 'warning';
        
        window.toast.show({
            title: title,
            message: message,
            type: toastType,
            duration: 4000
        });
        
        // Resolve immediately since toasts don't block
        resolve();
    });
};

// Replace the old showCustomConfirm with a modal-based confirm dialog
window.showCustomConfirm = function(title, message) {
    return new Promise((resolve) => {
        // Create modal overlay
        const overlay = document.createElement('div');
        overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.7);
            backdrop-filter: blur(4px);
            z-index: 10000;
            display: flex;
            align-items: center;
            justify-content: center;
            animation: fadeIn 0.2s ease;
        `;
        
        // Create modal
        const modal = document.createElement('div');
        modal.style.cssText = `
            background: #1A1A1F;
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 16px;
            padding: 24px;
            max-width: 400px;
            width: 90%;
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
            animation: scaleIn 0.2s ease;
        `;
        
        // Create content
        modal.innerHTML = `
            <style>
                @keyframes fadeIn {
                    from { opacity: 0; }
                    to { opacity: 1; }
                }
                @keyframes scaleIn {
                    from { transform: scale(0.9); opacity: 0; }
                    to { transform: scale(1); opacity: 1; }
                }
            </style>
            <h3 style="color: white; font-size: 18px; font-weight: 600; margin-bottom: 12px;">${title}</h3>
            <p style="color: #9CA3AF; font-size: 14px; line-height: 1.6; margin-bottom: 24px;">${message}</p>
            <div style="display: flex; gap: 12px; justify-content: flex-end;">
                <button id="confirm-cancel" style="
                    padding: 10px 20px;
                    border-radius: 8px;
                    border: 1px solid rgba(255, 255, 255, 0.2);
                    background: transparent;
                    color: #9CA3AF;
                    font-size: 14px;
                    font-weight: 500;
                    cursor: pointer;
                    transition: all 0.2s;
                ">Cancel</button>
                <button id="confirm-ok" style="
                    padding: 10px 20px;
                    border-radius: 8px;
                    border: none;
                    background: linear-gradient(to right, #C99700, #FFD700);
                    color: black;
                    font-size: 14px;
                    font-weight: 600;
                    cursor: pointer;
                    transition: all 0.2s;
                ">Confirm</button>
            </div>
        `;
        
        overlay.appendChild(modal);
        document.body.appendChild(overlay);
        
        // Add hover effects
        const cancelBtn = modal.querySelector('#confirm-cancel');
        const okBtn = modal.querySelector('#confirm-ok');
        
        cancelBtn.addEventListener('mouseenter', () => {
            cancelBtn.style.background = 'rgba(255, 255, 255, 0.1)';
            cancelBtn.style.color = 'white';
        });
        cancelBtn.addEventListener('mouseleave', () => {
            cancelBtn.style.background = 'transparent';
            cancelBtn.style.color = '#9CA3AF';
        });
        
        okBtn.addEventListener('mouseenter', () => {
            okBtn.style.opacity = '0.9';
        });
        okBtn.addEventListener('mouseleave', () => {
            okBtn.style.opacity = '1';
        });
        
        // Handle clicks
        const cleanup = () => {
            overlay.style.animation = 'fadeIn 0.2s ease reverse';
            setTimeout(() => {
                document.body.removeChild(overlay);
            }, 200);
        };
        
        okBtn.addEventListener('click', () => {
            cleanup();
            resolve(true);
        });
        
        cancelBtn.addEventListener('click', () => {
            cleanup();
            resolve(false);
        });
        
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                cleanup();
                resolve(false);
            }
        });
    });
};

// Override default alert() to use toasts (optional - can be commented out if needed)
// window.alert = function(message) {
//     showErrorToast('Alert', message, 4000);
// };

// Override default confirm() to use custom modal (optional - can be commented out if needed)
// window.confirm = function(message) {
//     return showCustomConfirm('Confirm', message);
// };
