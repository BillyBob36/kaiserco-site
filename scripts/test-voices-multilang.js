// Génère échantillons EN et ZH pour comparer les voix masculines candidates.
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
const URL_TTS = `https://${env.AZURE_SPEECH_REGION}.tts.speech.microsoft.com/cognitiveservices/v1`;

// Phrase équivalente dans les 3 langues, ton direct, présentation perso.
const SAMPLES = [
    // ── EN candidates ──
    {
        id: 'en-andrew2',
        voice: 'en-us-Andrew2:DragonHDLatestNeural',
        lang: 'en-US',
        text: "Hi, I'm Johann Kaiser. I code, I think, I model. If you're looking for a dev who thinks before typing, we should get along.",
        label: 'EN — Andrew2 (conversational, GA)',
    },
    {
        id: 'en-davis',
        voice: 'en-us-Davis:DragonHDLatestNeural',
        lang: 'en-US',
        text: "Hi, I'm Johann Kaiser. I code, I think, I model. If you're looking for a dev who thinks before typing, we should get along.",
        label: 'EN — Davis (posed)',
    },
    {
        id: 'en-steffan',
        voice: 'en-us-Steffan:DragonHDLatestNeural',
        lang: 'en-US',
        text: "Hi, I'm Johann Kaiser. I code, I think, I model. If you're looking for a dev who thinks before typing, we should get along.",
        label: 'EN — Steffan (narrator)',
    },
    // ── ZH candidate (only HD male GA) ──
    {
        id: 'zh-yunfan',
        voice: 'zh-cn-Yunfan:DragonHDLatestNeural',
        lang: 'zh-CN',
        text: "你好,我是Johann Kaiser。我写代码,我思考,我做三维建模。如果你想找一个先动脑再敲键盘的开发者,我们应该合得来。",
        label: 'ZH — Yunfan (HD GA)',
    },
];

function escapeXml(s) {
    return s.replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]);
}

const outDir = path.join(ROOT, 'voice-tests-multilang');
fs.mkdirSync(outDir, { recursive: true });

console.log(`→ Endpoint: ${URL_TTS}\n`);

let done = 0, failed = 0;
for (const s of SAMPLES) {
    const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${s.lang}"><voice name="${s.voice}">${escapeXml(s.text)}</voice></speak>`;
    process.stdout.write(`  ↻ ${s.id.padEnd(15)} (${s.label.padEnd(34)}) ... `);
    try {
        const res = await fetch(URL_TTS, {
            method: 'POST',
            headers: {
                'Ocp-Apim-Subscription-Key': env.AZURE_SPEECH_KEY,
                'Content-Type': 'application/ssml+xml',
                'X-Microsoft-OutputFormat': 'riff-24khz-16bit-mono-pcm',
                'User-Agent': 'kaiserco-mltest',
            },
            body: ssml,
        });
        if (!res.ok) {
            console.log(`✗ HTTP ${res.status} — ${(await res.text()).slice(0, 200)}`);
            failed++;
            continue;
        }
        fs.writeFileSync(path.join(outDir, `${s.id}.wav`), Buffer.from(await res.arrayBuffer()));
        console.log('✓');
        done++;
        await new Promise(r => setTimeout(r, 250));
    } catch (e) {
        console.log(`✗ ${e.message}`);
        failed++;
    }
}

const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>Voix EN + ZH — KAISER CO</title>
<style>
  body { font: 15px/1.5 system-ui, sans-serif; max-width: 720px; margin: 32px auto; padding: 0 20px; background: #f3efe8; color: #0a0a0a; }
  h1 { font-size: 24px; }
  h2.section { margin-top: 32px; font-size: 14px; text-transform: uppercase; letter-spacing: 0.1em; opacity: 0.6; }
  .voice { background: #fff; border: 1px solid rgba(0,0,0,0.08); border-radius: 6px; padding: 16px 20px; margin-bottom: 14px; }
  .voice h3 { font-size: 16px; margin-bottom: 4px; }
  .meta { font-family: ui-monospace, monospace; font-size: 11px; opacity: 0.55; margin-bottom: 8px; }
  .text { background: #ece6db; padding: 10px 14px; border-radius: 4px; font-style: italic; margin-bottom: 12px; font-size: 14px; }
  audio { width: 100%; height: 36px; }
</style>
</head>
<body>
<h1>Voix masculines EN et ZH</h1>
<p style="opacity:0.6">Réponds avec l'id (ex: <code>en-andrew2</code>, <code>zh-yunfan</code>).</p>

<h2 class="section">English</h2>
${SAMPLES.filter(s => s.id.startsWith('en')).map(s => `
<div class="voice">
  <h3>${s.label}</h3>
  <div class="meta">id: <strong>${s.id}</strong> · ${s.voice}</div>
  <div class="text">"${s.text}"</div>
  <audio controls preload="metadata" src="./${s.id}.wav"></audio>
</div>`).join('')}

<h2 class="section">中文 (Chinese)</h2>
${SAMPLES.filter(s => s.id.startsWith('zh')).map(s => `
<div class="voice">
  <h3>${s.label}</h3>
  <div class="meta">id: <strong>${s.id}</strong> · ${s.voice}</div>
  <div class="text">"${s.text}"</div>
  <audio controls preload="metadata" src="./${s.id}.wav"></audio>
</div>`).join('')}
</body>
</html>`;
fs.writeFileSync(path.join(outDir, 'index.html'), html);

console.log(`\n→ ${done} générés, ${failed} échecs`);
console.log(`→ Page: ${path.join(outDir, 'index.html')}`);
