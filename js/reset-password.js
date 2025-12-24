// js/reset-password.js
import { auth } from './firebase-config.js';
import { verifyPasswordResetCode, confirmPasswordReset } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-auth.js";

document.addEventListener('DOMContentLoaded', async () => {
    const urlParams = new URLSearchParams(window.location.search);
    const mode = urlParams.get('mode');
    const oobCode = urlParams.get('oobCode');

    const loading = document.getElementById('loading');
    const errorState = document.getElementById('error-state');
    const successState = document.getElementById('success-state');
    const resetForm = document.getElementById('resetForm');
    const errorMessage = document.getElementById('error-message');

    // Check if this is a password reset action
    if (mode !== 'resetPassword' || !oobCode) {
        loading.classList.add('hidden');
        errorState.classList.remove('hidden');
        errorMessage.textContent = 'Invalid reset link. Please request a new password reset.';
        return;
    }

    try {
        // Verify the password reset code is valid
        await verifyPasswordResetCode(auth, oobCode);
        
        // Code is valid, show the form
        loading.classList.add('hidden');
        resetForm.classList.remove('hidden');

        // Handle form submission
        resetForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            const newPassword = document.getElementById('new-password').value;
            const confirmPassword = document.getElementById('confirm-password').value;
            const btn = resetForm.querySelector('button[type="submit"]');

            // Validate passwords match
            if (newPassword !== confirmPassword) {
                window.showWarningToast("Validation Error", "Passwords do not match!", 3000);
                return;
            }

            // Validate password length
            if (newPassword.length < 6) {
                window.showWarningToast("Validation Error", "Password must be at least 6 characters!", 3000);
                return;
            }

            try {
                btn.disabled = true;
                btn.textContent = "Resetting...";

                // Confirm the password reset
                await confirmPasswordReset(auth, oobCode, newPassword);

                // Show success state
                resetForm.classList.add('hidden');
                successState.classList.remove('hidden');
                window.showSuccessToast("Success!", "Password reset successful!", 2000);

                // Redirect to login after 2 seconds
                setTimeout(() => {
                    window.location.href = '/login';
                }, 2000);

            } catch (error) {
                console.error('Password reset error:', error);
                let msg = "Failed to reset password. Please try again.";
                
                if (error.code === 'auth/weak-password') {
                    msg = "Password is too weak. Please use a stronger password.";
                } else if (error.code === 'auth/expired-action-code') {
                    msg = "This reset link has expired. Please request a new one.";
                } else if (error.code === 'auth/invalid-action-code') {
                    msg = "This reset link is invalid or has already been used.";
                }

                window.showErrorToast("Error", msg, 4000);
                btn.disabled = false;
                btn.textContent = "Reset Password";
            }
        });

    } catch (error) {
        console.error('Code verification error:', error);
        loading.classList.add('hidden');
        errorState.classList.remove('hidden');

        let msg = "This password reset link is invalid or has expired.";
        if (error.code === 'auth/expired-action-code') {
            msg = "This reset link has expired. Please request a new one.";
        } else if (error.code === 'auth/invalid-action-code') {
            msg = "This reset link is invalid or has already been used.";
        }

        errorMessage.textContent = msg;
    }
});
