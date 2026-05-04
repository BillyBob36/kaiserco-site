// script.js — site KAISER CO multilang
// Charge le visemes.json de la langue active (qui contient AUSSI les textes du site),
// applique les textes au DOM, monte l'avatar et gère le cycling des variantes + le switcher de langue.

import { AvatarPlayer } from './lib/avatar-player.js';

const SUPPORTED_LANGS = ['fr', 'en', 'zh'];
const STORAGE_KEY = 'kaiserco-lang';
const HTML_ROOT = document.documentElement;

function detectInitialLang() {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && SUPPORTED_LANGS.includes(stored)) return stored;
    const nav = (navigator.language || 'fr').toLowerCase();
    if (nav.startsWith('zh')) return 'zh';
    if (nav.startsWith('en')) return 'en';
    return 'fr';
}

let currentLang = detectInitialLang();

// ── DOM refs ─────────────────────────────────────────────────────────
const hdr = document.getElementById('hdr');
const faqList = document.getElementById('faq-list');
const slot = document.getElementById('kaiser-avatar-slot');
const stopBtn = document.getElementById('faq-stop');
const heroLines = [...document.querySelectorAll('[data-hero-line]')];
const manifestoLines = [...document.querySelectorAll('[data-manifesto]')];

let player = null;
let activeBtn = null;
let buildReady = false;
let currentSite = null;

// ── Header auto-hide on scroll down ──────────────────────────────────
let lastY = 0;
window.addEventListener('scroll', () => {
    const y = window.scrollY;
    if (y > 80 && y > lastY) hdr.classList.add('hide');
    else hdr.classList.remove('hide');
    lastY = y;
}, { passive: true });

// ── i18n: walk the data-i18n keys and apply text from the site payload ─
function get(obj, dotPath) {
    return dotPath.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
}

function applySiteTexts(site) {
    if (!site) return;
    currentSite = site;
    HTML_ROOT.lang = site.lang || currentLang;

    // text only
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const v = get(site, el.dataset.i18n);
        if (typeof v === 'string') el.textContent = v;
    });
    // html (allows entities like &nbsp; and tags like <sup>)
    document.querySelectorAll('[data-i18n-html]').forEach(el => {
        const v = get(site, el.dataset.i18nHtml);
        if (typeof v === 'string') el.innerHTML = v;
    });

    // Hero lines
    if (site.hero?.lines) {
        heroLines.forEach((el, i) => {
            const txt = site.hero.lines[i] || '';
            const glitch = site.hero.glitchWord;
            if (glitch && txt.includes(glitch)) {
                const [before, after] = txt.split(glitch);
                el.innerHTML = `${before}<i class="glitch" data-text="${glitch}">${glitch}</i>${after}`;
            } else {
                el.textContent = txt;
            }
        });
    }

    // Manifesto
    if (Array.isArray(site.manifesto)) {
        manifestoLines.forEach((el, i) => { el.textContent = site.manifesto[i] || ''; });
    }

    // Services
    if (site.services?.items) {
        site.services.items.forEach((s, i) => {
            const h = document.querySelector(`[data-srv-h="${i}"]`);
            const tag = document.querySelector(`[data-srv-tag="${i}"]`);
            const desc = document.querySelector(`[data-srv-desc="${i}"]`);
            if (h) h.textContent = s.h;
            if (tag) tag.textContent = s.tag;
            if (desc) desc.textContent = s.desc;
        });
    }

    // <title> + lang on document
    if (site.lang) document.documentElement.lang = site.lang;
}

// ── FAQ ──────────────────────────────────────────────────────────────
function renderFaq(clips) {
    if (!clips) {
        faqList.innerHTML = '<li><em style="opacity:0.5;font-style:italic">FAQ indisponible.</em></li>';
        return;
    }
    const ids = Object.keys(clips);
    if (!ids.length) {
        faqList.innerHTML = '<li><em style="opacity:0.5;font-style:italic">FAQ indisponible.</em></li>';
        return;
    }
    faqList.innerHTML = '';
    ids.forEach((id, i) => {
        const li = document.createElement('li');
        const btn = document.createElement('button');
        btn.dataset.id = id;
        btn.innerHTML = `<span class="num">${String(i + 1).padStart(2, '0')}</span><span>${clips[id].question}</span>`;
        btn.addEventListener('click', () => onQuestionClick(btn, id));
        li.appendChild(btn);
        faqList.appendChild(li);
    });
}

// ── Avatar lifecycle ─────────────────────────────────────────────────
function setSlotMessage(html) {
    const loadingEl = slot.querySelector('.avatar-loading');
    if (loadingEl) loadingEl.innerHTML = html;
}

async function initAvatar() {
    player = new AvatarPlayer({
        container: slot,
        avatarUrl: '/assets/avatar/men/men.gltf',
        voicesBaseUrl: '/assets/voices',
        lang: currentLang,
        audioFormat: 'mp3',
    });
    try {
        await player.init();
        const loadingEl = slot.querySelector('.avatar-loading');
        if (loadingEl) loadingEl.remove();
        player.on('ended', () => {
            if (activeBtn) { activeBtn.classList.remove('active'); activeBtn = null; }
            stopBtn.hidden = true;
        });
        const site = player.getSiteTexts();
        if (site) applySiteTexts(site);
        const clips = player.clips;
        if (clips && Object.keys(clips).length) {
            buildReady = true;
            renderFaq(clips);
        } else {
            renderFaq(null);
        }
    } catch (e) {
        console.error('[KaiserCo] Avatar init failed:', e);
        setSlotMessage(`// avatar indisponible<br><span style="font-size:10px;opacity:0.5">${(e && e.message) || e}</span>`);
        player = null;
    }
}

async function onQuestionClick(btn, clipId) {
    if (!player) return;
    if (!buildReady) {
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

// ── Language switcher ────────────────────────────────────────────────
function updateSwitcherUI() {
    document.querySelectorAll('.lang-switcher button').forEach(b => {
        b.classList.toggle('active', b.dataset.lang === currentLang);
    });
}

async function switchLang(lang) {
    if (!SUPPORTED_LANGS.includes(lang)) return;
    if (lang === currentLang) return;
    currentLang = lang;
    localStorage.setItem(STORAGE_KEY, lang);
    updateSwitcherUI();
    if (!player) return;
    await player.setLanguage(lang);
    const site = player.getSiteTexts();
    if (site) applySiteTexts(site);
    const clips = player.clips;
    buildReady = !!(clips && Object.keys(clips).length);
    renderFaq(clips);
    if (activeBtn) { activeBtn.classList.remove('active'); activeBtn = null; }
    stopBtn.hidden = true;
}

document.querySelectorAll('.lang-switcher button').forEach(b => {
    b.addEventListener('click', () => switchLang(b.dataset.lang));
});

// ── Init ─────────────────────────────────────────────────────────────
updateSwitcherUI();
initAvatar();
