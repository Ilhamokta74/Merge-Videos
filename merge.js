/**
 * Merge video episode drama (dengan animasi progres).
 *
 * Struktur:
 *   input/
 *     Judul Drama A/
 *       ep1.mp4, ep2.mp4, ...
 *   output/
 *     Judul Drama A.mp4
 *
 * Syarat: ffmpeg + ffprobe terinstall dan ada di PATH.
 * Jalankan: node merge.js
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, execFile } = require('child_process');

const INPUT_DIR = path.resolve(__dirname, 'input');
const OUTPUT_DIR = path.resolve(__dirname, 'output');
const VIDEO_EXT = new Set(['.mp4', '.mkv', '.mov', '.avi', '.webm', '.ts', '.flv']);
const IS_TTY = process.stdout.isTTY;

const naturalSort = (a, b) =>
  a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

const escapeForConcat = (p) => p.replace(/\\/g, '/').replace(/'/g, "'\\''");

const fmtTime = (sec) => {
  if (!isFinite(sec) || sec < 0) return '--:--';
  sec = Math.round(sec);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
};

// Ambil durasi (detik) satu file via ffprobe
function getDuration(file) {
  return new Promise((resolve) => {
    execFile(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file],
      (err, stdout) => resolve(err ? 0 : parseFloat(stdout) || 0)
    );
  });
}

// Jalankan ffmpeg + tampilkan spinner & progress bar
function runFfmpeg(args, { totalSec, label }) {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', [...args, '-progress', 'pipe:1', '-nostats'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    let frame = 0;
    let doneSec = 0;
    let speed = '';
    let stderr = '';
    let buf = '';
    let lastLoggedPct = -1;
    const startedAt = Date.now();

    const render = () => {
      const pct = totalSec > 0 ? Math.min(100, (doneSec / totalSec) * 100) : 0;
      const elapsed = (Date.now() - startedAt) / 1000;
      const eta = pct > 1 ? (elapsed / pct) * (100 - pct) : NaN;

      if (!IS_TTY) {
        const step = Math.floor(pct / 10) * 10;
        if (step > lastLoggedPct) {
          lastLoggedPct = step;
          console.log(`   ${label}: ${step}%`);
        }
        return;
      }

      const width = 28;
      const filled = Math.round((pct / 100) * width);
      const bar = '█'.repeat(filled) + '░'.repeat(width - filled);
      const line =
        `${frames[frame % frames.length]} ${label} ${bar} ${pct.toFixed(1).padStart(5)}% ` +
        `| ${fmtTime(doneSec)}/${fmtTime(totalSec)} ` +
        `| ETA ${fmtTime(eta)}` +
        (speed ? ` | ${speed}` : '');
      process.stdout.write('\r' + line + '\x1b[K');
    };

    const timer = setInterval(() => {
      frame++;
      render();
    }, 100);

    proc.stdout.on('data', (chunk) => {
      buf += chunk.toString();
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const l of lines) {
        const [k, v] = l.split('=');
        if (k === 'out_time_us' || k === 'out_time_ms') {
          const us = parseInt(v, 10);
          if (!isNaN(us)) doneSec = us / 1e6;
        } else if (k === 'speed') {
          speed = (v || '').trim();
        }
      }
    });

    proc.stderr.on('data', (d) => (stderr += d.toString()));

    const finish = () => {
      clearInterval(timer);
      if (IS_TTY) process.stdout.write('\r\x1b[K');
    };

    proc.on('error', (err) => {
      finish();
      reject(new Error(`Gagal menjalankan ffmpeg (sudah terinstall?): ${err.message}`));
    });
    proc.on('close', (code) => {
      finish();
      code === 0 ? resolve() : reject(new Error(stderr.split('\n').slice(-8).join('\n')));
    });
  });
}

async function mergeFolder(folderName, idx, total) {
  const folderPath = path.join(INPUT_DIR, folderName);
  const files = fs
    .readdirSync(folderPath)
    .filter((f) => VIDEO_EXT.has(path.extname(f).toLowerCase()))
    .sort(naturalSort);

  const tag = `[${idx}/${total}]`;

  if (files.length === 0) {
    console.log(`${tag} SKIP  ${folderName}: tidak ada video`);
    return;
  }

  const outputFile = path.join(OUTPUT_DIR, `${folderName}.mp4`);
  if (fs.existsSync(outputFile)) {
    console.log(`${tag} SKIP  ${folderName}: output sudah ada`);
    return;
  }

  console.log(`${tag} MERGE ${folderName} (${files.length} episode)`);

  // Hitung total durasi supaya persentase akurat
  const fullPaths = files.map((f) => path.join(folderPath, f));
  const durations = await Promise.all(fullPaths.map(getDuration));
  const totalSec = durations.reduce((a, b) => a + b, 0);

  const listFile = path.join(
    os.tmpdir(),
    `concat_${Date.now()}_${Math.random().toString(36).slice(2)}.txt`
  );
  fs.writeFileSync(
    listFile,
    fullPaths.map((p) => `file '${escapeForConcat(p)}'`).join('\n')
  );

  const t0 = Date.now();
  try {
    // Cara cepat: stream copy (tanpa re-encode)
    await runFfmpeg(
      ['-y', '-f', 'concat', '-safe', '0', '-i', listFile,
       '-c', 'copy', '-movflags', '+faststart', outputFile],
      { totalSec, label: 'Menggabungkan' }
    );
    console.log(`${tag} OK    ${folderName}.mp4 (${fmtTime((Date.now() - t0) / 1000)})`);
  } catch (err) {
    console.log(`${tag} WARN  Stream copy gagal, re-encode dulu (lebih lama)...`);
    if (fs.existsSync(outputFile)) fs.unlinkSync(outputFile);
    try {
      await runFfmpeg(
        ['-y', '-f', 'concat', '-safe', '0', '-i', listFile,
         '-c:v', 'libx264', '-preset', 'medium', '-crf', '20',
         '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', outputFile],
        { totalSec, label: 'Re-encode    ' }
      );
      console.log(`${tag} OK    ${folderName}.mp4 (re-encode, ${fmtTime((Date.now() - t0) / 1000)})`);
    } catch (err2) {
      console.error(`${tag} FAIL  ${folderName}:\n${err2.message}`);
      if (fs.existsSync(outputFile)) fs.unlinkSync(outputFile);
    }
  } finally {
    fs.existsSync(listFile) && fs.unlinkSync(listFile);
  }
}

async function main() {
  if (!fs.existsSync(INPUT_DIR)) {
    console.error(`Folder input tidak ditemukan: ${INPUT_DIR}`);
    process.exit(1);
  }
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const folders = fs
    .readdirSync(INPUT_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort(naturalSort);

  if (folders.length === 0) {
    console.log('Tidak ada folder drama di dalam input/');
    return;
  }

  for (let i = 0; i < folders.length; i++) {
    await mergeFolder(folders[i], i + 1, folders.length);
  }
  console.log('Selesai.');
}

main();