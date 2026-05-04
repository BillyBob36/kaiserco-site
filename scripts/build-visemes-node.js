// Pré-calcul des timelines de visemes côté Node (sans browser).
// Analyse RMS + Zero-Crossing-Rate sur chaque WAV de public/assets/voices/.
// Pour chaque item de faq.json, traite TOUTES les variantes (v1, v2, v3) et les
// agrège dans un objet `variants[]`.
//
// Output: public/assets/voices/visemes.json
//
// Format produit:
//   { [clipId]: { question, answers: [...], variants: [{duration, frames}, ...] } }

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const voicesDir = path.join(ROOT, 'public', 'assets', 'voices');
const faqPath = path.join(ROOT, 'data', 'faq.json');

const faq = JSON.parse(fs.readFileSync(faqPath, 'utf8'));

const FRAME_MS = 16;
const SILENCE_RMS = 0.018;
const LOUD_RMS = 0.08;

function readWav(filePath) {
    const buf = fs.readFileSync(filePath);
    if (buf.slice(0, 4).toString() !== 'RIFF') throw new Error('Not RIFF');
    const sampleRate = buf.readUInt32LE(24);
    const channels = buf.readUInt16LE(22);
    const bps = buf.readUInt16LE(34);
    if (bps !== 16) throw new Error('Only 16-bit WAV supported');

    let off = 12;
    let dataOff = -1, dataLen = 0;
    while (off + 8 <= buf.length) {
        const id = buf.slice(off, off + 4).toString();
        const size = buf.readUInt32LE(off + 4);
        if (id === 'data') { dataOff = off + 8; dataLen = size; break; }
        off += 8 + size;
    }
    if (dataOff < 0) throw new Error('No data chunk');

    const samples = new Float32Array(dataLen / 2);
    for (let i = 0; i < samples.length; i++) {
        samples[i] = buf.readInt16LE(dataOff + i * 2) / 32768;
    }
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

function pickViseme(rms, zcr, tIndex) {
    if (rms < SILENCE_RMS) return 'viseme_sil';
    const cycle = tIndex % 8;
    if (rms < LOUD_RMS) {
        if (zcr > 0.20) return cycle < 4 ? 'viseme_E' : 'viseme_I';
        return cycle < 4 ? 'viseme_E' : 'viseme_O';
    }
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
        let sumSq = 0, zc = 0, prev = samples[start];
        for (let i = 1; i < winSize; i++) {
            const s = samples[start + i];
            sumSq += s * s;
            if ((prev >= 0) !== (s >= 0)) zc++;
            prev = s;
        }
        const rms = Math.sqrt(sumSq / winSize);
        const zcr = zc / winSize;
        frames.push({
            t: +(start / sampleRate).toFixed(3),
            v: pickViseme(rms, zcr, f),
            vol: +Math.min(1, rms * 4).toFixed(3),
        });
    }
    return frames;
}

const result = {};
let totalProcessed = 0, totalMissing = 0;

for (const item of faq.items) {
    const variants = [];
    const answers = item.answers || [];
    for (let i = 0; i < answers.length; i++) {
        const variantId = `${item.id}_v${i + 1}`;
        const wavPath = path.join(voicesDir, `${variantId}.wav`);
        if (!fs.existsSync(wavPath)) {
            console.log(`  · ${variantId} (no .wav, skip)`);
            totalMissing++;
            variants.push(null);
            continue;
        }
        try {
            const { samples, sampleRate } = readWav(wavPath);
            const frames = analyze(samples, sampleRate);
            const duration = +(samples.length / sampleRate).toFixed(3);
            variants.push({ duration, frames });
            console.log(`  ✓ ${variantId} → ${frames.length} frames / ${duration}s`);
            totalProcessed++;
        } catch (e) {
            console.log(`  ✗ ${variantId} : ${e.message}`);
            variants.push(null);
        }
    }
    result[item.id] = {
        question: item.question,
        answers,
        variants,
    };
}

const outPath = path.join(voicesDir, 'visemes.json');
fs.writeFileSync(outPath, JSON.stringify(result));
const sizeKb = (fs.statSync(outPath).size / 1024).toFixed(1);
console.log(`\n→ Écrit ${outPath} (${sizeKb} Ko)`);
console.log(`→ ${totalProcessed} variantes traitées, ${totalMissing} sans WAV`);
