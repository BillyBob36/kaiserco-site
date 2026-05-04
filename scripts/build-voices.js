// Génère les WAV pour chaque variante de chaque entrée de data/faq.json
// via Azure AI Speech (Dragon HD voices). Sortie déterministe — la même voix
// à chaque appel, contrairement à Azure OpenAI Realtime.
//
// Usage: node scripts/build-voices.js [--force] [--only=q01_qui,q02_dev]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function loadEnv() {
    const envPath = path.join(ROOT, '.env');
    if (!fs.existsSync(envPath)) {
        console.error('✗ .env introuvable à la racine du projet.');
        process.exit(1);
    }
    const env = {};
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
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
const VOICE = env.AZURE_SPEECH_VOICE || 'fr-fr-Remy:DragonHDLatestNeural';

if (!REGION || !KEY) {
    console.error('✗ AZURE_SPEECH_REGION et AZURE_SPEECH_KEY requis dans .env');
    process.exit(1);
}

const args = process.argv.slice(2);
const FORCE = args.includes('--force');
const ONLY = args.find(a => a.startsWith('--only='))?.slice(7).split(',').filter(Boolean);

const URL_TTS = `https://${REGION}.tts.speech.microsoft.com/cognitiveservices/v1`;

const faq = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'faq.json'), 'utf8'));
const lang = faq.lang || 'fr-FR';
const outDir = path.join(ROOT, 'public', 'assets', 'voices');
fs.mkdirSync(outDir, { recursive: true });

console.log(`→ Endpoint: ${URL_TTS}`);
console.log(`→ Voix: ${VOICE}`);
const total = faq.items.reduce((acc, it) => acc + (it.answers?.length || 0), 0);
console.log(`→ ${faq.items.length} questions, ${total} variantes à générer\n`);

function escapeXml(s) {
    return s.replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]);
}

function buildSSML(text) {
    return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${lang}">
  <voice name="${VOICE}">${escapeXml(text)}</voice>
</speak>`;
}

async function synth(text) {
    const res = await fetch(URL_TTS, {
        method: 'POST',
        headers: {
            'Ocp-Apim-Subscription-Key': KEY,
            'Content-Type': 'application/ssml+xml',
            'X-Microsoft-OutputFormat': 'riff-24khz-16bit-mono-pcm',
            'User-Agent': 'kaiserco-tts',
        },
        body: buildSSML(text),
    });
    if (!res.ok) {
        const err = await res.text();
        throw new Error(`HTTP ${res.status} — ${err.slice(0, 300)}`);
    }
    return Buffer.from(await res.arrayBuffer());
}

let done = 0, skipped = 0, failed = 0;

for (const item of faq.items) {
    if (ONLY && !ONLY.includes(item.id)) continue;
    const variants = item.answers || [];
    for (let i = 0; i < variants.length; i++) {
        const variantId = `${item.id}_v${i + 1}`;
        const outPath = path.join(outDir, `${variantId}.wav`);
        if (fs.existsSync(outPath) && !FORCE) {
            console.log(`  · ${variantId} (skip)`);
            skipped++;
            continue;
        }
        process.stdout.write(`  ↻ ${variantId.padEnd(20)} ... `);
        try {
            const wav = await synth(variants[i]);
            fs.writeFileSync(outPath, wav);
            console.log(`✓ ${(wav.length / 1024).toFixed(1)} Ko`);
            done++;
            await new Promise(r => setTimeout(r, 250));
        } catch (e) {
            console.log(`✗ ${e.message}`);
            failed++;
        }
    }
}

console.log(`\n→ Terminé: ${done} générés, ${skipped} skippés, ${failed} échecs`);
if (failed > 0) process.exit(1);
