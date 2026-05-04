// Génère les WAV pour chaque entrée de data/faq.json via Azure OpenAI Realtime (WebSocket).
// Le déploiement Realtime supporte text + audio en un seul flux. On force la lecture
// littérale du texte via response.instructions.
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
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eq = trimmed.indexOf('=');
        if (eq === -1) continue;
        env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
    }
    return env;
}

const env = loadEnv();
const ENDPOINT = env.AZURE_OPENAI_ENDPOINT?.replace(/\/+$/, '').replace(/^https:\/\//, '');
const KEY = env.AZURE_OPENAI_KEY;
const DEPLOYMENT = env.AZURE_OPENAI_RT_DEPLOYMENT || 'gpt-realtime-1.5-avatar-3D';
const VOICE = env.AZURE_OPENAI_TTS_VOICE || 'ash';
const API_VERSION = env.AZURE_OPENAI_RT_API_VERSION || '2024-10-01-preview';

if (!ENDPOINT || !KEY) {
    console.error('✗ AZURE_OPENAI_ENDPOINT et AZURE_OPENAI_KEY requis dans .env');
    process.exit(1);
}

const args = process.argv.slice(2);
const FORCE = args.includes('--force');
const ONLY = args.find(a => a.startsWith('--only='))?.slice(7).split(',').filter(Boolean);

const faqPath = path.join(ROOT, 'data', 'faq.json');
const faq = JSON.parse(fs.readFileSync(faqPath, 'utf8'));
const outDir = path.join(ROOT, 'public', 'assets', 'voices');
fs.mkdirSync(outDir, { recursive: true });

const wsUrl = `wss://${ENDPOINT}/openai/realtime?api-version=${API_VERSION}&deployment=${DEPLOYMENT}&api-key=${KEY}`;

console.log(`→ Endpoint: wss://${ENDPOINT}/openai/realtime?...&deployment=${DEPLOYMENT}`);
console.log(`→ Voix: ${VOICE}`);
console.log(`→ ${faq.items.length} items à traiter\n`);

// PCM16 mono 24kHz → header WAV.
function wavHeader(pcmBytes, sampleRate = 24000, channels = 1, bps = 16) {
    const byteRate = sampleRate * channels * bps / 8;
    const blockAlign = channels * bps / 8;
    const buf = Buffer.alloc(44);
    buf.write('RIFF', 0);
    buf.writeUInt32LE(36 + pcmBytes, 4);
    buf.write('WAVE', 8);
    buf.write('fmt ', 12);
    buf.writeUInt32LE(16, 16);
    buf.writeUInt16LE(1, 20);
    buf.writeUInt16LE(channels, 22);
    buf.writeUInt32LE(sampleRate, 24);
    buf.writeUInt32LE(byteRate, 28);
    buf.writeUInt16LE(blockAlign, 32);
    buf.writeUInt16LE(bps, 34);
    buf.write('data', 36);
    buf.writeUInt32LE(pcmBytes, 40);
    return buf;
}

function generateOne(item, instructionsBase) {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(wsUrl);
        const audioChunks = [];
        let done = false;
        let timer = null;

        const fail = (err) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            try { ws.close(); } catch {}
            reject(err);
        };
        const finish = () => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            try { ws.close(); } catch {}
            const pcm = Buffer.concat(audioChunks);
            resolve(Buffer.concat([wavHeader(pcm.length), pcm]));
        };

        ws.addEventListener('open', () => {
            // Configure session for stable, uniform TTS narration.
            // temperature is clamped to >=0.6 by the Realtime API; we use the lowest
            // allowed value to minimize voice drift between calls.
            ws.send(JSON.stringify({
                type: 'session.update',
                session: {
                    modalities: ['text', 'audio'],
                    voice: VOICE,
                    output_audio_format: 'pcm16',
                    turn_detection: null,
                    temperature: 0.6,
                    instructions: instructionsBase,
                },
            }));
            // Send the text to read as a user message.
            ws.send(JSON.stringify({
                type: 'conversation.item.create',
                item: {
                    type: 'message',
                    role: 'user',
                    content: [{ type: 'input_text', text: item.answer }],
                },
            }));
            // Trigger response — instructions force literal, uniform narration.
            ws.send(JSON.stringify({
                type: 'response.create',
                response: {
                    modalities: ['audio', 'text'],
                    instructions: 'Tu es une voix de narration. Lis le texte du message utilisateur EXACTEMENT mot pour mot, en français. Ne change aucun mot, ne saute rien, n\'ajoute rien. Voix masculine posée, ton neutre, débit régulier d\'environ 150 mots par minute, articulation nette, sans emphase théâtrale, sans interprétation émotionnelle, sans accent prononcé. Conserve toujours exactement le même timbre, la même hauteur, le même rythme. Pas d\'introduction, pas de conclusion, pas de salutation, pas de commentaire — uniquement la lecture du texte fourni.',
                },
            }));
            timer = setTimeout(() => fail(new Error('timeout 60s')), 60000);
        });

        ws.addEventListener('message', (ev) => {
            let msg;
            try { msg = JSON.parse(ev.data); } catch { return; }
            if (msg.type === 'response.audio.delta' && msg.delta) {
                audioChunks.push(Buffer.from(msg.delta, 'base64'));
            } else if (msg.type === 'response.done') {
                finish();
            } else if (msg.type === 'error') {
                fail(new Error(msg.error?.message || JSON.stringify(msg.error)));
            }
        });

        ws.addEventListener('error', (ev) => fail(new Error('WebSocket error: ' + (ev.message || ev.type || 'unknown'))));
        ws.addEventListener('close', (ev) => {
            if (!done) fail(new Error(`WebSocket closed (${ev.code}): ${ev.reason || 'no reason'}`));
        });
    });
}

const NARRATION_INSTR = 'Rôle: narrateur vocal strict. Tu lis à voix haute le contenu fourni, en français, sans rien modifier. Voix masculine posée, ton neutre, débit régulier, articulation nette, timbre constant entre les lectures. Aucune improvisation, aucune émotion appuyée, aucun ajout. Sortie audio uniquement.';

let done = 0, skipped = 0, failed = 0;

for (const item of faq.items) {
    if (ONLY && !ONLY.includes(item.id)) continue;

    const outPath = path.join(outDir, `${item.id}.wav`);
    if (fs.existsSync(outPath) && !FORCE) {
        console.log(`  · ${item.id} (skip)`);
        skipped++;
        continue;
    }

    process.stdout.write(`  ↻ ${item.id} ... `);
    try {
        const wav = await generateOne(item, NARRATION_INSTR);
        fs.writeFileSync(outPath, wav);
        console.log(`✓ ${(wav.length / 1024).toFixed(1)} Ko`);
        done++;
        // Small delay to be nice to the API.
        await new Promise(r => setTimeout(r, 500));
    } catch (err) {
        console.log(`✗ ${err.message}`);
        failed++;
    }
}

console.log(`\n→ Terminé: ${done} générés, ${skipped} skippés, ${failed} échecs`);
if (failed > 0) process.exit(1);
