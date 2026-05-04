// script.js — site KAISER CO
// Charge la FAQ + monte l'avatar (idle visible même sans visemes.json en preview).

import { AvatarPlayer } from './lib/avatar-player.js';

const VISEMES_URL = '/assets/voices/visemes.json';
const FAQ_FALLBACK_URL = '/data/faq.json'; // utilisé en dev si visemes.json n'existe pas encore

// ── Header : auto-hide au scroll vers le bas ─────────────────────────
const hdr = document.getElementById('hdr');
let lastY = 0;
window.addEventListener('scroll', () => {
    const y = window.scrollY;
    if (y > 80 && y > lastY) hdr.classList.add('hide');
    else hdr.classList.remove('hide');
    lastY = y;
}, { passive: true });

// ── FAQ + Avatar ─────────────────────────────────────────────────────
const faqList = document.getElementById('faq-list');
const slot = document.getElementById('kaiser-avatar-slot');
const stopBtn = document.getElementById('faq-stop');

let player = null;
let activeBtn = null;
let buildReady = false;

async function loadFaqItems() {
    // Priorité : visemes.json (prod) → faq.json (dev avant build)
    try {
        const res = await fetch(VISEMES_URL);
        if (res.ok) {
            const data = await res.json();
            const ids = Object.keys(data);
            if (ids.length) {
                buildReady = true;
                return ids.map(id => ({ id, question: data[id].question || id }));
            }
        }
    } catch (_) {}
    try {
        const res = await fetch(FAQ_FALLBACK_URL);
        if (res.ok) {
            const data = await res.json();
            return data.items.map(it => ({ id: it.id, question: it.question }));
        }
    } catch (_) {}
    return [];
}

function renderFaq(items) {
    if (!items.length) {
        faqList.innerHTML = '<li><em style="opacity:0.5;font-style:italic">FAQ indisponible.</em></li>';
        return;
    }
    faqList.innerHTML = '';
    items.forEach((item, i) => {
        const li = document.createElement('li');
        const btn = document.createElement('button');
        btn.dataset.id = item.id;
        btn.innerHTML = `<span class="num">${String(i + 1).padStart(2, '0')}</span><span>${item.question}</span>`;
        btn.addEventListener('click', () => onQuestionClick(btn, item.id));
        li.appendChild(btn);
        faqList.appendChild(li);
    });
    if (!buildReady) {
        const note = document.createElement('li');
        note.innerHTML = '<em style="opacity:0.5;font-size:11px;font-family:monospace;text-transform:uppercase;letter-spacing:0.1em">// build voix non encore lancé — preview design seulement</em>';
        note.style.padding = '12px 0 0';
        faqList.appendChild(note);
    }
}

function setSlotMessage(html) {
    const loadingEl = slot.querySelector('.avatar-loading');
    if (loadingEl) loadingEl.innerHTML = html;
}

async function initAvatar() {
    player = new AvatarPlayer({
        container: slot,
        avatarUrl: '/assets/avatar/men/men.gltf',
        visemesUrl: VISEMES_URL,
        voicesBaseUrl: '/assets/voices',
    });
    try {
        await player.init();
        // Hide the loading overlay once render loop is started.
        const loadingEl = slot.querySelector('.avatar-loading');
        if (loadingEl) loadingEl.remove();
        player.on('ended', () => {
            if (activeBtn) { activeBtn.classList.remove('active'); activeBtn = null; }
            stopBtn.hidden = true;
        });
    } catch (e) {
        console.error('[KaiserCo] Avatar init failed:', e);
        setSlotMessage(`// avatar indisponible<br><span style="font-size:10px;opacity:0.5">${(e && e.message) || e}</span><br><span style="font-size:10px;opacity:0.5">Vérifie la console.</span>`);
        player = null;
    }
}

async function onQuestionClick(btn, clipId) {
    if (!player) return;
    if (!buildReady) {
        // Aucun audio — feedback visuel only.
        if (activeBtn) activeBtn.classList.remove('active');
        activeBtn = btn;
        btn.classList.add('active');
        setTimeout(() => { btn.classList.remove('active'); activeBtn = null; }, 1200);
        return;
    }
    try {
        if (activeBtn) activeBtn.classList.remove('active');
        activeBtn = btn;
        btn.classList.add('active');
        stopBtn.hidden = false;
        await player.play(clipId);
    } catch (e) {
        console.error(e);
        btn.classList.remove('active');
        activeBtn = null;
        stopBtn.hidden = true;
    }
}

stopBtn.addEventListener('click', () => {
    if (player) player.stop();
    if (activeBtn) { activeBtn.classList.remove('active'); activeBtn = null; }
    stopBtn.hidden = true;
});

// ── Init ─────────────────────────────────────────────────────────────
initAvatar();
loadFaqItems().then(renderFaq);
