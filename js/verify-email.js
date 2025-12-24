// js/verify-email.js
import { auth } from './firebase-config.js';
import { applyActionCode, sendEmailVerification, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-auth.js";

document.addEventListener('DOMContentLoaded', async () => {
    const urlParams = new URLSearchParams(window.location.search);
    const mode = urlParams.get('mode');
    const oobCode = urlParams.get('oobCode');
    const fromSignup = urlParams.get('fromSignup');

    const loading = document.getElementById('loading');
    const pendingState = document.getElementById('pending-state');
    const errorState = document.getElementById('error-state');
    const successState = document.getElementById('success-state');
    const errorMessage = document.getElementById('error-message');
    const userEmailEl = document.getElementById('user-email');
    const resendBtn = document.getElementById('resend-btn');

    // Scenario 1: User accessed from email verification link
    if (mode === 'verifyEmail' && oobCode) {
        loading.classList.remove('hidden');
        
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
                msg = "This verification link has expired. Please request a new verification email below.";
            } else if (error.code === 'auth/invalid-action-code') {
                msg = "This verification link is invalid or has already been used.";
            }

            errorMessage.textContent = msg;
            window.showErrorToast("Error", msg, 4000);
        }
    } 
    // Scenario 2: User came from signup or login (needs to verify)
    else {
        onAuthStateChanged(auth, (user) => {
            if (user) {
                // User is signed in but needs verification
                userEmailEl.textContent = user.email;
                pendingState.classList.remove('hidden');
                
                // Handle resend button
                resendBtn.addEventListener('click', async () => {
                    try {
                        resendBtn.disabled = true;
                        resendBtn.textContent = "Sending...";
                        
                        await sendEmailVerification(user, {
                            url: window.location.origin + '/login',
                            handleCodeInApp: false
                        });
                        
                        window.showSuccessToast("Success!", "Verification email sent! Check your inbox.", 3000);
                        resendBtn.textContent = "Email Sent!";
                        
                        setTimeout(() => {
                            resendBtn.disabled = false;
                            resendBtn.textContent = "Resend Verification Email";
                        }, 30000); // Re-enable after 30 seconds
                        
                    } catch (error) {
                        console.error('Resend error:', error);
                        window.showErrorToast("Error", "Failed to send verification email. Please try again.", 4000);
                        resendBtn.disabled = false;
                        resendBtn.textContent = "Resend Verification Email";
                    }
                });
            } else {
                // No user signed in, check if email was passed in URL
                const email = urlParams.get('email');
                if (email) {
                    userEmailEl.textContent = email;
                    pendingState.classList.remove('hidden');
                    resendBtn.classList.add('hidden'); // Can't resend without being signed in
                } else {
                    // No context, redirect to login
                    window.location.href = '/login';
                }
            }
        });
    }
});
