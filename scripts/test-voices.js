// Génère le même texte avec 7 voix masculines candidates pour comparaison.
// Output: voice-tests/<voice-id>.wav + voice-tests/index.html (page d'écoute).
// Usage: node scripts/test-voices.js

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function loadEnv() {
    const env = {};
    for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split('\n')) {
        const t = line.trim();
        if (!t || t.startsWith('#')) continue;
        const eq = t.indexOf('=');
        if (eq === -1) continue;
        env[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
    }
    return env;
}

const env = loadEnv();
const REGION = env.AZURE_SPEECH_REGION;
const KEY = env.AZURE_SPEECH_KEY;
const URL_TTS = `https://${REGION}.tts.speech.microsoft.com/cognitiveservices/v1`;

// Phrase-test représentative : voix masculine, ton direct, vocabulaire mixte (parlé + technique).
const TEST_TEXT = "Salut, je suis Johann Kaiser. Je code, je pense, je modélise. Si tu cherches un dev qui réfléchit avant de taper, on devrait s'entendre.";

// 7 voix masculines candidates. Pour les voix non-FR, on enrobe avec <lang xml:lang="fr-FR">.
const VOICES = [
    { id: 'remy-hd',         voice: 'fr-fr-Remy:DragonHDLatestNeural',       lang: null,    label: 'Remy — Dragon HD natif FR' },
    { id: 'remy-hd-omni',    voice: 'fr-fr-Remy:DragonHDOmniLatestNeural',   lang: null,    label: 'Remy — Dragon HD Omni' },
    { id: 'andrew-hd-omni',  voice: 'en-US-Andrew:DragonHDOmniLatestNeural', lang: 'fr-FR', label: 'Andrew US — voix grave' },
    { id: 'adam-hd-omni',    voice: 'en-US-Adam:DragonHDOmniLatestNeural',   lang: 'fr-FR', label: 'Adam US — voix claire' },
    { id: 'brian-hd-omni',   voice: 'en-US-Brian:DragonHDOmniLatestNeural',  lang: 'fr-FR', label: 'Brian US — voix profonde' },
    { id: 'davis-hd-omni',   voice: 'en-US-Davis:DragonHDOmniLatestNeural',  lang: 'fr-FR', label: 'Davis US — voix posée' },
    { id: 'steffan-hd-omni', voice: 'en-US-Steffan:DragonHDOmniLatestNeural',lang: 'fr-FR', label: 'Steffan US — voix narrateur' },
];

function buildSSML(voice, lang, text) {
    const inner = lang
        ? `<lang xml:lang="${lang}">${text}</lang>`
        : text;
    return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${lang || 'fr-FR'}">
  <voice name="${voice}">${inner}</voice>
</speak>`;
}

const outDir = path.join(ROOT, 'voice-tests');
fs.mkdirSync(outDir, { recursive: true });

console.log(`→ Endpoint: ${URL_TTS}`);
console.log(`→ Texte: "${TEST_TEXT}"\n`);

let done = 0, failed = 0;

for (const v of VOICES) {
    const ssml = buildSSML(v.voice, v.lang, TEST_TEXT);
    const outPath = path.join(outDir, `${v.id}.wav`);
    process.stdout.write(`  ↻ ${v.id.padEnd(20)} (${v.label.padEnd(36)}) ... `);
    try {
        const res = await fetch(URL_TTS, {
            method: 'POST',
            headers: {
                'Ocp-Apim-Subscription-Key': KEY,
                'Content-Type': 'application/ssml+xml',
                'X-Microsoft-OutputFormat': 'riff-24khz-16bit-mono-pcm',
                'User-Agent': 'kaiserco-voicetest',
            },
            body: ssml,
        });
        if (!res.ok) {
            const err = await res.text();
            console.log(`✗ HTTP ${res.status} — ${err.slice(0, 200)}`);
            failed++;
            continue;
        }
        const buf = Buffer.from(await res.arrayBuffer());
        fs.writeFileSync(outPath, buf);
        console.log(`✓ ${(buf.length / 1024).toFixed(1)} Ko`);
        done++;
    } catch (e) {
        console.log(`✗ ${e.message}`);
        failed++;
    }
    await new Promise(r => setTimeout(r, 300));
}

// Page HTML d'écoute
const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>Choix voix — KAISER CO</title>
<style>
  body { font: 15px/1.5 system-ui, sans-serif; max-width: 720px; margin: 32px auto; padding: 0 20px; background: #f3efe8; color: #0a0a0a; }
  h1 { font-size: 24px; margin-bottom: 8px; }
  p.sub { opacity: 0.6; margin-bottom: 32px; font-size: 13px; }
  .voice { background: #fff; border: 1px solid rgba(0,0,0,0.08); border-radius: 6px; padding: 16px 20px; margin-bottom: 14px; }
  .voice h2 { font-size: 16px; margin-bottom: 4px; }
  .voice .meta { font-family: ui-monospace, monospace; font-size: 11px; opacity: 0.55; margin-bottom: 12px; word-break: break-all; }
  audio { width: 100%; height: 36px; }
  .phrase { background: #ece6db; padding: 12px 16px; border-radius: 4px; font-style: italic; margin: 24px 0; }
</style>
</head>
<body>
<h1>Choix de voix masculine</h1>
<p class="sub">Écoute les 7 candidats. Réponds "voice X" (ex: "remy-hd") ou décris ce que tu veux ajuster.</p>
<div class="phrase">"${TEST_TEXT}"</div>
${VOICES.map(v => `
<div class="voice">
  <h2>${v.label}</h2>
  <div class="meta">id: <strong>${v.id}</strong> · ${v.voice}${v.lang ? ` · &lt;lang ${v.lang}&gt;` : ''}</div>
  <audio controls preload="metadata" src="./${v.id}.wav"></audio>
</div>`).join('')}
</body>
</html>`;
fs.writeFileSync(path.join(outDir, 'index.html'), html);

console.log(`\n→ Terminé: ${done} générés, ${failed} échecs`);
console.log(`→ Page d'écoute: ${path.join(outDir, 'index.html')}`);
