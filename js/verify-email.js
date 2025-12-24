// js/verify-email.js
import { auth } from './firebase-config.js';
import { applyActionCode } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-auth.js";

document.addEventListener('DOMContentLoaded', async () => {
    const urlParams = new URLSearchParams(window.location.search);
    const mode = urlParams.get('mode');
    const oobCode = urlParams.get('oobCode');

    const loading = document.getElementById('loading');
    const errorState = document.getElementById('error-state');
    const successState = document.getElementById('success-state');
    const errorMessage = document.getElementById('error-message');

    // Check if this is an email verification action
    if (mode !== 'verifyEmail' || !oobCode) {
        loading.classList.add('hidden');
        errorState.classList.remove('hidden');
        errorMessage.textContent = 'Invalid verification link.';
        return;
    }

    try {
        // Apply the email verification code
        await applyActionCode(auth, oobCode);
        
        // Show success state
        loading.classList.add('hidden');
        successState.classList.remove('hidden');
        window.showSuccessToast("Success!", "Email verified successfully!", 2000);

    } catch (error) {
        console.error('Email verification error:', error);
        loading.classList.add('hidden');
        errorState.classList.remove('hidden');

        let msg = "This verification link is invalid or has expired.";
        if (error.code === 'auth/expired-action-code') {
            msg = "This verification link has expired. Please sign up again or request a new verification email.";
        } else if (error.code === 'auth/invalid-action-code') {
            msg = "This verification link is invalid or has already been used.";
        }

        errorMessage.textContent = msg;
        window.showErrorToast("Error", msg, 4000);
    }
});
