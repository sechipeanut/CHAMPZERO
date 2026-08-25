import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-auth.js";
import { collection, addDoc, doc, getDoc } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-firestore.js";

document.addEventListener('DOMContentLoaded', () => {
    const contactForm = document.getElementById('contactForm');
    const nameInput = document.getElementById('name');
    const emailInput = document.getElementById('email');

    // Auto-fill logged in user info
    onAuthStateChanged(auth, async (user) => {
        if (!user) return;
        if (emailInput && !emailInput.value) {
            emailInput.value = user.email || '';
        }
        if (nameInput && !nameInput.value) {
            try {
                const snap = await getDoc(doc(db, "users", user.uid));
                const data = snap.exists() ? snap.data() : {};
                nameInput.value = data.realName || data.ign || data.displayName || user.displayName || (user.email ? user.email.split('@')[0] : '');
            } catch (err) {
                nameInput.value = user.displayName || (user.email ? user.email.split('@')[0] : '');
            }
        }
    });
    
    if (contactForm) {
        contactForm.addEventListener('submit', async function(e) {
            e.preventDefault();
            const submitButton = e.target.querySelector('button[type="submit"]');
            const originalText = submitButton.textContent;
            
            submitButton.disabled = true;
            submitButton.textContent = 'Sending...';
            
            const formData = {
                name: document.getElementById('name').value,
                email: document.getElementById('email').value,
                subject: document.getElementById('subject').value,
                message: document.getElementById('message').value,
                sentAt: new Date().toISOString()
            };

            try {
                // This sends the data to your 'messages' collection in Firestore
                await addDoc(collection(db, "messages"), formData);
                if (typeof window.showSuccessToast === 'function') {
                    window.showSuccessToast("Message Sent!", "Thank you for reaching out. Our staff will get back to you shortly.", 4000);
                } else {
                    alert("Message Sent! Thank you for reaching out.");
                }
                e.target.reset();
            } catch (error) {
                console.error("Error sending message: ", error);
                if (typeof window.showErrorToast === 'function') {
                    window.showErrorToast("Error", "Failed to send message. Please try again later.", 4000);
                } else {
                    alert("Failed to send message. Please try again later.");
                }
            } finally {
                submitButton.disabled = false;
                submitButton.textContent = originalText;
            }
        });
    }
});