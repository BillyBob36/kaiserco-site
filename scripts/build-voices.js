// Génère les WAV pour chaque variante de chaque question, dans toutes les langues,
// via Azure Speech HD. Convertit ensuite en MP3 via ffmpeg pour distribution.
// Le WAV reste sur disque (pour build-visemes-node) mais est gitignored.
//
// Usage: node scripts/build-voices.js [--force] [--only=fr,en] [--items=q01_qui]

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function loadEnv() {
    const envPath = path.join(ROOT, '.env');
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
if (!REGION || !KEY) { console.error('✗ AZURE_SPEECH_REGION/_KEY required'); process.exit(1); }

const URL_TTS = `https://${REGION}.tts.speech.microsoft.com/cognitiveservices/v1`;
const args = process.argv.slice(2);
const FORCE = args.includes('--force');
const langFilter = args.find(a => a.startsWith('--only='))?.slice(7).split(',').filter(Boolean);
const itemFilter = args.find(a => a.startsWith('--items='))?.slice(8).split(',').filter(Boolean);

const i18nDir = path.join(ROOT, 'data', 'i18n');
const allLangs = fs.readdirSync(i18nDir).filter(f => f.endsWith('.json')).map(f => f.replace('.json', ''));
const langs = langFilter ? allLangs.filter(l => langFilter.includes(l)) : allLangs;

console.log(`→ Endpoint: ${URL_TTS}`);
console.log(`→ Langues à traiter: ${langs.join(', ')}\n`);

function escapeXml(s) {
    return s.replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]);
}
function buildSSML(text, voice, lang) {
    return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${lang}"><voice name="${voice}">${escapeXml(text)}</voice></speak>`;
}

async function synth(text, voice, lang) {
    const res = await fetch(URL_TTS, {
        method: 'POST',
        headers: {
            'Ocp-Apim-Subscription-Key': KEY,
            'Content-Type': 'application/ssml+xml',
            'X-Microsoft-OutputFormat': 'riff-24khz-16bit-mono-pcm',
            'User-Agent': 'kaiserco-tts',
        },
        body: buildSSML(text, voice, lang),
    });
    if (!res.ok) {
        const err = await res.text();
        throw new Error(`HTTP ${res.status} — ${err.slice(0, 300)}`);
    }
    return Buffer.from(await res.arrayBuffer());
}

function wavToMp3(wavPath, mp3Path) {
    // 24kHz mono PCM WAV → 64kbps MP3 (mono). Compromis qualité voix / taille.
    const r = spawnSync('ffmpeg', ['-y', '-i', wavPath, '-vn', '-ar', '24000', '-ac', '1', '-b:a', '64k', '-loglevel', 'error', mp3Path], { stdio: 'pipe' });
    if (r.status !== 0) {
        throw new Error(`ffmpeg failed: ${r.stderr?.toString() || 'unknown'}`);
    }
}

let totalDone = 0, totalSkipped = 0, totalFailed = 0;

for (const lang of langs) {
    const data = JSON.parse(fs.readFileSync(path.join(i18nDir, `${lang}.json`), 'utf8'));
    const xmlLang = data.lang;
    const voice = data.voice;
    const outDir = path.join(ROOT, 'public', 'assets', 'voices', lang);
    fs.mkdirSync(outDir, { recursive: true });

    console.log(`\n=== ${lang.toUpperCase()} (${voice}) ===`);

    for (const item of data.items) {
        if (itemFilter && !itemFilter.includes(item.id)) continue;
        const variants = item.answers || [];
        for (let i = 0; i < variants.length; i++) {
            const variantId = `${item.id}_v${i + 1}`;
            const wavPath = path.join(outDir, `${variantId}.wav`);
            const mp3Path = path.join(outDir, `${variantId}.mp3`);
            // Skip si MP3 ET WAV existent déjà (sauf --force)
            if (fs.existsSync(mp3Path) && fs.existsSync(wavPath) && !FORCE) {
                console.log(`  · ${variantId} (skip)`);
                totalSkipped++;
                continue;
            }
            process.stdout.write(`  ↻ ${variantId.padEnd(20)} ... `);
            try {
                const wav = await synth(variants[i], voice, xmlLang);
                fs.writeFileSync(wavPath, wav);
                wavToMp3(wavPath, mp3Path);
                const mp3Size = fs.statSync(mp3Path).size;
                console.log(`✓ wav=${(wav.length/1024).toFixed(0)}Ko mp3=${(mp3Size/1024).toFixed(0)}Ko`);
                totalDone++;
                await new Promise(r => setTimeout(r, 250));
            } catch (e) {
                console.log(`✗ ${e.message}`);
                totalFailed++;
            }
        }
    }
}

console.log(`\n→ Total: ${totalDone} générés, ${totalSkipped} skippés, ${totalFailed} échecs`);
if (totalFailed > 0) process.exit(1);
