// Pré-calcul des timelines de visemes côté Node (sans browser).
// Analyse RMS + Zero-Crossing-Rate sur chaque WAV de public/assets/voices/.
// Heuristique légère : pas aussi précise que wawa-lipsync (FFT 7 bandes côté browser),
// mais largement suffisante pour un preview — la bouche bouge en sync avec le son.
// Pour un lipsync de qualité finale, utilise scripts/build-visemes.html dans le browser.
//
// Output: public/assets/voices/visemes.json

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const voicesDir = path.join(ROOT, 'public', 'assets', 'voices');
const faqPath = path.join(ROOT, 'data', 'faq.json');

const faq = JSON.parse(fs.readFileSync(faqPath, 'utf8'));

const FRAME_MS = 16;            // ~60 Hz, comme côté browser
const SILENCE_RMS = 0.018;
const LOUD_RMS = 0.08;

function readWav(filePath) {
    const buf = fs.readFileSync(filePath);
    if (buf.slice(0, 4).toString() !== 'RIFF') throw new Error('Not RIFF');
    const sampleRate = buf.readUInt32LE(24);
    const channels = buf.readUInt16LE(22);
    const bps = buf.readUInt16LE(34);
    if (bps !== 16) throw new Error('Only 16-bit WAV supported');

    // Find 'data' chunk (sometimes there are extra chunks before).
    let off = 12;
    let dataOff = -1, dataLen = 0;
    while (off + 8 <= buf.length) {
        const id = buf.slice(off, off + 4).toString();
        const size = buf.readUInt32LE(off + 4);
        if (id === 'data') { dataOff = off + 8; dataLen = size; break; }
        off += 8 + size;
    }
    if (dataOff < 0) throw new Error('No data chunk');

    // Mono PCM16 → Float32 normalized.
    const samples = new Float32Array(dataLen / 2);
    for (let i = 0; i < samples.length; i++) {
        const s = buf.readInt16LE(dataOff + i * 2);
        samples[i] = s / 32768;
    }
    // If stereo, mix down to mono.
    if (channels > 1) {
        const mono = new Float32Array(samples.length / channels);
        for (let i = 0; i < mono.length; i++) {
            let acc = 0;
            for (let c = 0; c < channels; c++) acc += samples[i * channels + c];
            mono[i] = acc / channels;
        }
        return { samples: mono, sampleRate };
    }
    return { samples, sampleRate };
}

// Pick a viseme from RMS + ZCR + a tiny bit of variation over time.
// Mapping rationale (heuristique, pas phonétique strict):
//   silence → viseme_sil
//   loud + low ZCR → back vowel (aa / O), depending on running variation
//   loud + high ZCR → front vowel (E / I) or fricative (SS) for very high ZCR
//   medium → mix between sil / E / aa
function pickViseme(rms, zcr, tIndex) {
    if (rms < SILENCE_RMS) return 'viseme_sil';
    const cycle = tIndex % 8;
    if (rms < LOUD_RMS) {
        if (zcr > 0.20) return cycle < 4 ? 'viseme_E' : 'viseme_I';
        return cycle < 4 ? 'viseme_E' : 'viseme_O';
    }
    // Loud
    if (zcr > 0.30) return 'viseme_SS';
    if (zcr > 0.18) return cycle < 4 ? 'viseme_E' : 'viseme_I';
    return cycle < 4 ? 'viseme_aa' : 'viseme_O';
}

function analyze(samples, sampleRate) {
    const winSize = Math.round(sampleRate * FRAME_MS / 1000);
    const nFrames = Math.floor(samples.length / winSize);
    const frames = [];

    for (let f = 0; f < nFrames; f++) {
        const start = f * winSize;
        let sumSq = 0, zc = 0;
        let prev = samples[start];
        for (let i = 1; i < winSize; i++) {
            const s = samples[start + i];
            sumSq += s * s;
            if ((prev >= 0) !== (s >= 0)) zc++;
            prev = s;
        }
        const rms = Math.sqrt(sumSq / winSize);
        const zcr = zc / winSize; // 0..0.5

        const t = +(start / sampleRate).toFixed(3);
        const v = pickViseme(rms, zcr, f);
        const vol = +Math.min(1, rms * 4).toFixed(3);
        frames.push({ t, v, vol });
    }
    return frames;
}

const result = {};
let processed = 0, missing = 0;

for (const item of faq.items) {
    const wavPath = path.join(voicesDir, `${item.id}.wav`);
    if (!fs.existsSync(wavPath)) {
        console.log(`  · ${item.id} (no .wav, skip)`);
        missing++;
        continue;
    }
    try {
        const { samples, sampleRate } = readWav(wavPath);
        const frames = analyze(samples, sampleRate);
        const duration = +(samples.length / sampleRate).toFixed(3);
        result[item.id] = {
            question: item.question,
            answer: item.answer,
            duration,
            frames,
        };
        console.log(`  ✓ ${item.id} → ${frames.length} frames / ${duration}s`);
        processed++;
    } catch (e) {
        console.log(`  ✗ ${item.id} : ${e.message}`);
    }
}

const outPath = path.join(voicesDir, 'visemes.json');
fs.writeFileSync(outPath, JSON.stringify(result));
const sizeKb = (fs.statSync(outPath).size / 1024).toFixed(1);
console.log(`\n→ Écrit ${outPath} (${sizeKb} Ko)`);
console.log(`→ ${processed} traités, ${missing} sans WAV`);
