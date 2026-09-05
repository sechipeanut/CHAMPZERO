import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-auth.js";
import { collection, addDoc, doc, getDoc } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-firestore.js";

document.addEventListener('DOMContentLoaded', () => {
    const contactForm = document.getElementById('contactForm');
    const nameInput = document.getElementById('name');
    const emailInput = document.getElementById('email');
    const subjectSelect = document.getElementById('subject');
    const messageInput = document.getElementById('message');
    const organizerHintBox = document.getElementById('organizer-hint-box');

    // Custom dropdown elements
    const triggerBtn = document.getElementById('custom-subject-trigger');
    const labelEl = document.getElementById('custom-subject-label');
    const chevronEl = document.getElementById('custom-subject-chevron');
    const menuEl = document.getElementById('custom-subject-menu');
    const options = document.querySelectorAll('.custom-subject-option');

    let currentLoggedInUser = null;
    let currentUserData = null;

    const ORGANIZER_PLACEHOLDER = 
`Please provide the following organizer details:
- Community / Organization Name:
- Primary Esports Games (Valorant, MLBB, HOK, etc.):
- Discord Username & Server Link:
- Estimated Participants / Bracket Scale:
- Past Tournament Experience (if any):`;

    const DEFAULT_PLACEHOLDER = "Type your message or inquiry here...";

    function toggleMenu(forceOpen = null) {
        if (!menuEl) return;
        const shouldOpen = forceOpen !== null ? forceOpen : menuEl.classList.contains('hidden');
        if (shouldOpen) {
            menuEl.classList.remove('hidden');
            triggerBtn?.setAttribute('aria-expanded', 'true');
            if (chevronEl) chevronEl.style.transform = 'rotate(180deg)';
        } else {
            menuEl.classList.add('hidden');
            triggerBtn?.setAttribute('aria-expanded', 'false');
            if (chevronEl) chevronEl.style.transform = 'rotate(0deg)';
        }
    }

    function selectSubject(val) {
        if (subjectSelect) {
            subjectSelect.value = val;
            subjectSelect.dispatchEvent(new Event('change'));
        }
        updateCustomDropdownUI(val);
        toggleMenu(false);
    }

    function updateCustomDropdownUI(val) {
        options.forEach(opt => {
            const optVal = opt.dataset.value;
            const checkmark = opt.querySelector('.checkmark');
            const isMatch = optVal === val;
            if (isMatch) {
                opt.classList.add('bg-[#FFD700]/15', 'border-l-2', 'border-[#FFD700]');
                if (checkmark) checkmark.classList.remove('opacity-0');
                if (labelEl) {
                    const titleText = opt.querySelector('span')?.textContent || optVal;
                    labelEl.textContent = titleText;
                    labelEl.classList.remove('text-neutral-400');
                    labelEl.classList.add('text-white', 'font-bold');
                }
            } else {
                opt.classList.remove('bg-[#FFD700]/15', 'border-l-2', 'border-[#FFD700]');
                if (checkmark) checkmark.classList.add('opacity-0');
            }
        });

        if (!val && labelEl) {
            labelEl.textContent = "Select a subject...";
            labelEl.classList.add('text-neutral-400');
            labelEl.classList.remove('text-white', 'font-bold');
        }

        if (triggerBtn) {
            triggerBtn.classList.remove('border-rose-500', 'ring-2', 'ring-rose-500/30');
        }
    }

    if (triggerBtn) {
        triggerBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleMenu();
        });
    }

    options.forEach(opt => {
        opt.addEventListener('click', (e) => {
            e.stopPropagation();
            const val = opt.dataset.value;
            selectSubject(val);
        });
    });

    document.addEventListener('click', (e) => {
        if (!e.target.closest('#custom-subject-dropdown')) {
            toggleMenu(false);
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') toggleMenu(false);
    });

    function handleSubjectChange() {
        if (!subjectSelect) return;
        const isOrganizer = subjectSelect.value === 'Organizer Role Request';
        if (organizerHintBox) {
            if (isOrganizer) {
                organizerHintBox.classList.remove('hidden');
            } else {
                organizerHintBox.classList.add('hidden');
            }
        }
        if (messageInput) {
            if (isOrganizer) {
                messageInput.placeholder = ORGANIZER_PLACEHOLDER;
            } else {
                messageInput.placeholder = DEFAULT_PLACEHOLDER;
            }
        }
    }

    if (subjectSelect) {
        subjectSelect.addEventListener('change', handleSubjectChange);

        // Preselect subject from URL params: e.g. /contact.html?subject=organizer
        const urlParams = new URLSearchParams(window.location.search);
        const requestedSubject = urlParams.get('subject') || urlParams.get('inquiry') || '';
        if (requestedSubject) {
            const clean = requestedSubject.toLowerCase().replace(/[-_]/g, ' ');
            for (let opt of subjectSelect.options) {
                if (clean.includes('organizer') && opt.value.toLowerCase().includes('organizer')) {
                    selectSubject(opt.value);
                    break;
                } else if (opt.value.toLowerCase().includes(clean)) {
                    selectSubject(opt.value);
                    break;
                }
            }
        }
    }

    // Auto-fill logged in user info
    onAuthStateChanged(auth, async (user) => {
        if (!user) return;
        currentLoggedInUser = user;
        if (emailInput && !emailInput.value) {
            emailInput.value = user.email || '';
        }
        try {
            const snap = await getDoc(doc(db, "users", user.uid));
            currentUserData = snap.exists() ? snap.data() : {};
            if (nameInput && !nameInput.value) {
                nameInput.value = currentUserData.realName || currentUserData.ign || currentUserData.displayName || user.displayName || (user.email ? user.email.split('@')[0] : '');
            }
        } catch (err) {
            if (nameInput && !nameInput.value) {
                nameInput.value = user.displayName || (user.email ? user.email.split('@')[0] : '');
            }
        }
    });
    
    if (contactForm) {
        contactForm.addEventListener('submit', async function(e) {
            e.preventDefault();

            // Validate subject
            const selectedSubject = subjectSelect?.value || '';
            if (!selectedSubject) {
                if (triggerBtn) {
                    triggerBtn.classList.add('border-rose-500', 'ring-2', 'ring-rose-500/30');
                    triggerBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    triggerBtn.focus();
                }
                if (typeof window.showWarningToast === 'function') {
                    window.showWarningToast("Subject Required", "Please select an inquiry subject from the list.");
                } else {
                    alert("Please select a subject.");
                }
                return;
            }

            const submitButton = e.target.querySelector('button[type="submit"]');
            const originalText = submitButton.textContent;
            
            submitButton.disabled = true;
            submitButton.textContent = 'Sending...';
            
            const isOrgRequest = selectedSubject === 'Organizer Role Request';

            const formData = {
                name: document.getElementById('name').value.trim(),
                email: document.getElementById('email').value.trim(),
                subject: selectedSubject,
                message: document.getElementById('message').value.trim(),
                sentAt: new Date().toISOString(),
                createdAt: new Date().toISOString()
            };

            if (currentLoggedInUser) {
                formData.userId = currentLoggedInUser.uid;
                formData.userEmail = currentLoggedInUser.email || '';
                if (currentUserData?.ign) formData.userIgn = currentUserData.ign;
                if (currentUserData?.role) formData.currentRole = currentUserData.role;
            }

            if (isOrgRequest) {
                formData.isOrganizerRequest = true;
                formData.roleRequested = 'organizer';
            }

            try {
                // This sends the data to your 'messages' collection in Firestore
                await addDoc(collection(db, "messages"), formData);

                if (isOrgRequest) {
                    if (typeof window.showSuccessToast === 'function') {
                        window.showSuccessToast("Organizer Application Received! 🏆", "Thank you for applying. ChampZero administrators will review your community details and follow up soon.", 5000);
                    } else {
                        alert("Organizer Application Received! Thank you for applying. Our administrators will review your request.");
                    }
                } else {
                    if (typeof window.showSuccessToast === 'function') {
                        window.showSuccessToast("Message Sent!", "Thank you for reaching out. Our staff will get back to you shortly.", 4000);
                    } else {
                        alert("Message Sent! Thank you for reaching out.");
                    }
                }

                e.target.reset();
                selectSubject('');
            } catch (error) {
                console.error("Error sending message: ", error);
                if (typeof window.showErrorToast === 'function') {
                    window.showErrorToast("Error", "Failed to send message: " + (error.message || "Please try again later."), 4000);
                } else {
                    alert("Failed to send message: " + (error.message || "Please try again later."));
                }
            } finally {
                submitButton.disabled = false;
                submitButton.textContent = originalText;
            }
        });
    }
});