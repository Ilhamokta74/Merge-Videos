const fs = require("fs");
const path = require("path");
const ffmpeg = require("fluent-ffmpeg");

// ✅ Fix ffmpeg & ffprobe path (biar gak error lagi)
const ffmpegPath = require("@ffmpeg-installer/ffmpeg").path;
const ffprobePath = require("@ffprobe-installer/ffprobe").path;

ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobePath);

// 📁 Folder
const inputDir = path.join(__dirname, "input");
const outputDir = path.join(__dirname, "output");

// buat folder output kalau belum ada
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir);
}

// ambil semua folder di input
const folders = fs.readdirSync(inputDir).filter(f =>
  fs.statSync(path.join(inputDir, f)).isDirectory()
);

// 🔥 function merge per folder
async function mergeFolder(folderName) {
  return new Promise((resolve, reject) => {
    const folderPath = path.join(inputDir, folderName);

    let files = fs.readdirSync(folderPath)
      .filter(f => /\.(mp4|ts)$/i.test(f)) // support mp4 + ts
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    if (files.length === 0) {
      console.log(`⏭ Skip ${folderName} (tidak ada video)`);
      return resolve();
    }

    const outputPath = path.join(outputDir, `${folderName}.mp4`);

    console.log(`\n🎬 Start merge: ${folderName}`);
    console.log(`📦 Total file: ${files.length}`);

    let command = ffmpeg();

    // masukkan semua file sebagai input
    files.forEach(file => {
      command = command.input(path.join(folderPath, file));
    });

    command
      // 🔥 re-encode biar aman (mp4 + ts pasti bisa)
      .videoCodec("libx264")
      .audioCodec("aac")
      .outputOptions([
        "-preset veryfast",
        "-crf 23"
      ])
      .on("start", cmd => {
        console.log("🚀 FFmpeg jalan...");
      })
      .on("progress", p => {
        if (p.percent) {
          process.stdout.write(
            `⏳ ${folderName}: ${p.percent.toFixed(2)}%   \r`
          );
        }
      })
      .on("end", () => {
        console.log(`\n✅ Selesai: ${folderName}`);
        resolve();
      })
      .on("error", err => {
        console.error(`\n❌ Error di ${folderName}:`, err.message);
        reject(err);
      })
      .mergeToFile(outputPath, outputDir);
  });
}

// 🚀 main runner (biar gak overload)
async function main() {
  console.log("🚀 Mulai proses merge semua folder...\n");

  for (const folder of folders) {
    try {
      await mergeFolder(folder);
    } catch (err) {
      console.log(`⚠️ Lewati folder: ${folder}`);
    }
  }

  console.log("\n🎉 Semua proses selesai!");
}

main();