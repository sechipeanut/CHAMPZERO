/**
 * ChampZero Esports Stinger Transition
 * High-impact cinematic shutter wipe & branding intro
 */

function injectStingerStyles() {
    if (document.getElementById('cz-stinger-styles')) return;

    const style = document.createElement('style');
    style.id = 'cz-stinger-styles';
    style.textContent = `
        #cz-stinger-overlay {
            position: fixed;
            inset: 0;
            z-index: 999999;
            pointer-events: auto;
            overflow: hidden;
            display: flex;
            align-items: center;
            justify-content: center;
            background: transparent;
            font-family: 'Space Grotesk', system-ui, -apple-system, sans-serif;
        }

        .cz-stinger-shutter-top {
            position: absolute;
            top: 0;
            left: -20%;
            width: 140%;
            height: 55%;
            background: linear-gradient(135deg, #07070A 0%, #0D0D14 100%);
            border-bottom: 2px solid #FFD700;
            box-shadow: 0 10px 40px rgba(255, 215, 0, 0.25), 0 0 100px rgba(0, 0, 0, 0.9);
            transform: skewY(-4deg) translateY(0);
            transition: transform 0.45s cubic-bezier(0.7, 0, 0.3, 1);
            will-change: transform;
        }

        .cz-stinger-shutter-bottom {
            position: absolute;
            bottom: 0;
            left: -20%;
            width: 140%;
            height: 55%;
            background: linear-gradient(135deg, #0A0A10 0%, #050508 100%);
            border-top: 2px solid #FFD700;
            box-shadow: 0 -10px 40px rgba(255, 215, 0, 0.25), 0 0 100px rgba(0, 0, 0, 0.9);
            transform: skewY(-4deg) translateY(0);
            transition: transform 0.45s cubic-bezier(0.7, 0, 0.3, 1);
            will-change: transform;
        }

        .cz-stinger-grid {
            position: absolute;
            inset: 0;
            background-image: 
                linear-gradient(rgba(255, 215, 0, 0.04) 1px, transparent 1px),
                linear-gradient(90deg, rgba(255, 215, 0, 0.04) 1px, transparent 1px);
            background-size: 32px 32px;
            pointer-events: none;
        }

        .cz-stinger-beam {
            position: absolute;
            top: 50%;
            left: -50%;
            width: 200%;
            height: 2px;
            background: linear-gradient(90deg, transparent, rgba(255, 215, 0, 0.8), #FFFFFF, rgba(255, 215, 0, 0.8), transparent);
            transform: translateY(-50%) rotate(-4deg);
            filter: drop-shadow(0 0 12px #FFD700);
            animation: beam-sweep 0.8s ease-in-out forwards;
        }

        @keyframes beam-sweep {
            0% { transform: translateY(-50%) rotate(-4deg) translateX(-60%); opacity: 0; }
            30% { opacity: 1; }
            100% { transform: translateY(-50%) rotate(-4deg) translateX(60%); opacity: 0; }
        }

        #cz-stinger-emblem {
            position: relative;
            z-index: 10;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            text-align: center;
            opacity: 0;
            transform: scale(0.85);
            transition: transform 0.35s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.25s ease-out;
            will-change: transform, opacity;
        }

        .cz-stinger-visible {
            opacity: 1 !important;
            transform: scale(1) !important;
        }

        .cz-stinger-logo-wrap {
            position: relative;
            width: 84px;
            height: 84px;
            display: flex;
            align-items: center;
            justify-content: center;
            margin-bottom: 0.75rem;
        }

        .cz-stinger-logo-pulse {
            position: absolute;
            inset: -12px;
            border-radius: 50%;
            background: radial-gradient(circle, rgba(255, 215, 0, 0.35) 0%, rgba(255, 215, 0, 0) 70%);
            animation: pulse-bloom 1s infinite alternate ease-in-out;
        }

        @keyframes pulse-bloom {
            0% { transform: scale(0.9); opacity: 0.5; }
            100% { transform: scale(1.2); opacity: 0.9; }
        }

        .cz-stinger-logo {
            width: 72px;
            height: 72px;
            object-fit: contain;
            filter: drop-shadow(0 0 20px rgba(255, 215, 0, 0.75));
            position: relative;
            z-index: 2;
        }

        .cz-stinger-title {
            font-size: 1.75rem;
            font-weight: 900;
            letter-spacing: 0.25em;
            text-transform: uppercase;
            color: #FFFFFF;
            margin: 0;
            background: linear-gradient(180deg, #FFFFFF 0%, #FFD700 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            text-shadow: 0 0 30px rgba(255, 215, 0, 0.5);
        }

        .cz-stinger-tag {
            display: inline-flex;
            align-items: center;
            gap: 0.5rem;
            margin-top: 0.35rem;
            font-family: 'JetBrains Mono', monospace;
            font-size: 0.65rem;
            font-weight: 700;
            letter-spacing: 0.2em;
            color: #FFD700;
            text-transform: uppercase;
            padding: 0.2rem 0.6rem;
            background: rgba(255, 215, 0, 0.1);
            border: 1px solid rgba(255, 215, 0, 0.3);
            border-radius: 9999px;
            box-shadow: 0 0 15px rgba(255, 215, 0, 0.2);
        }

        /* Exit Animations */
        .cz-stinger-exit .cz-stinger-shutter-top {
            transform: skewY(-4deg) translateY(-120%);
        }

        .cz-stinger-exit .cz-stinger-shutter-bottom {
            transform: skewY(-4deg) translateY(120%);
        }

        .cz-stinger-exit #cz-stinger-emblem {
            opacity: 0 !important;
            transform: scale(1.15) !important;
            transition: transform 0.3s ease-in, opacity 0.2s ease-in;
        }
    `;
    document.head.appendChild(style);
}

export function playStinger(force = false) {
    if (!force) {
        try {
            if (sessionStorage.getItem('cz_stinger_played')) {
                return;
            }
        } catch (e) {}
    }

    injectStingerStyles();

    // Mark as played for this session
    try {
        sessionStorage.setItem('cz_stinger_played', 'true');
    } catch (e) {}

    let overlay = document.getElementById('cz-stinger-overlay');
    if (overlay) overlay.remove();

    overlay = document.createElement('div');
    overlay.id = 'cz-stinger-overlay';
    overlay.innerHTML = `
        <div class="cz-stinger-shutter-top">
            <div class="cz-stinger-grid"></div>
        </div>
        <div class="cz-stinger-shutter-bottom">
            <div class="cz-stinger-grid"></div>
        </div>
        <div class="cz-stinger-beam"></div>

        <div id="cz-stinger-emblem">
            <div class="cz-stinger-logo-wrap">
                <div class="cz-stinger-logo-pulse"></div>
                <img src="pictures/cz_logo.png" alt="ChampZero" class="cz-stinger-logo" onerror="this.style.display='none'" />
            </div>
            <h1 class="cz-stinger-title">CHAMPZERO</h1>
            <div class="cz-stinger-tag">
                <span style="display:inline-block; width:6px; height:6px; border-radius:50%; background:#FFD700; box-shadow:0 0 6px #FFD700;"></span>
                <span>ENTER THE ARENA</span>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);

    const emblem = overlay.querySelector('#cz-stinger-emblem');

    // Step 1: Reveal Emblem with snap
    requestAnimationFrame(() => {
        setTimeout(() => {
            if (emblem) emblem.classList.add('cz-stinger-visible');
        }, 50);
    });

    // Step 2: Slash shutters open and reveal page
    setTimeout(() => {
        overlay.classList.add('cz-stinger-exit');
    }, 700);

    // Step 3: Cleanup overlay from DOM
    setTimeout(() => {
        if (overlay) overlay.remove();
    }, 1150);
}

// Global hook to test or play stinger on command
window.czReplayStinger = () => playStinger(true);

// Auto-play stinger once per session on initial website open
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => playStinger(false));
} else {
    playStinger(false);
}
