import ffmpegPath from 'ffmpeg-static';
import { execFile } from 'node:child_process';
import { mkdir, rm, stat } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import https from 'node:https';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const execFileAsync = promisify(execFile);

const items = [
  {
    name: 'ground-oven',
    url: 'https://firebasestorage.googleapis.com/v0/b/systems-hub.firebasestorage.app/o/DirectoryGallery%2Fvideos%2F3191697714.mp4?alt=media',
    time: '00:00:02.4',
  },
  {
    name: 'hot-rocks',
    url: 'https://firebasestorage.googleapis.com/v0/b/systems-hub.firebasestorage.app/o/DirectoryGallery%2Fvideos%2F3209454685.mp4?alt=media',
    time: '00:00:01.8',
  },
];

const tmpDirUrl = new URL('./.tmp/', import.meta.url);
const outDirUrl = new URL('../public/directory/posters/', import.meta.url);
const tmpDir = fileURLToPath(tmpDirUrl);
const outDir = fileURLToPath(outDirUrl);

async function ensureDir(path) {
  await mkdir(path, { recursive: true });
}

function downloadFile(url, destPath, redirects = 0) {
  return new Promise((resolve, reject) => {
    const file = createWriteStream(destPath);
    https
      .get(url, (res) => {
        const status = res.statusCode || 0;
        if (status >= 300 && status < 400 && res.headers.location && redirects < 5) {
          file.close();
          res.resume();
          return resolve(downloadFile(res.headers.location, destPath, redirects + 1));
        }
        if (status >= 400) {
          file.close();
          res.resume();
          return reject(new Error(`HTTP ${status} for ${url}`));
        }
        res.pipe(file);
        file.on('finish', () => file.close(resolve));
      })
      .on('error', (err) => {
        file.close();
        reject(err);
      });
  });
}

async function fileExists(path) {
  try {
    const info = await stat(path);
    return info.size > 0;
  } catch {
    return false;
  }
}

async function extractFrame(videoPath, outPath, time) {
  const args = [
    '-y',
    '-ss', time,
    '-i', videoPath,
    '-frames:v', '1',
    '-q:v', '2',
    outPath,
  ];
  await execFileAsync(ffmpegPath, args);
}

async function main() {
  if (!ffmpegPath) throw new Error('ffmpeg-static path not found.');
  await ensureDir(tmpDir);
  await ensureDir(outDir);

  for (const item of items) {
    const videoPath = path.join(tmpDir, `${item.name}.mp4`);
    const outPath = path.join(outDir, `${item.name}.jpg`);

    if (!(await fileExists(videoPath))) {
      await downloadFile(item.url, videoPath);
    }
    await extractFrame(videoPath, outPath, item.time);
  }

  await rm(tmpDir, { recursive: true, force: true });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
