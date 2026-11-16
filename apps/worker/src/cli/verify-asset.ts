/**
 * Proves a READY asset is playable: mirrors hls/<assetId>/ from the media bucket to a temp dir, decrypts the asset
 * key from the DB and checks every rendition through two independent paths:
 *   1. ffprobe's HLS demuxer with EXT-X-KEY pointed at a local key file and `-count_frames` (full decode, player-like);
 *   2. each segment decrypted here with plain AES-128-CBC (key + playlist IV, PKCS#7), concatenated, and fully
 *      decoded again (`-count_frames`, every stream; any error at -v error fails; frame counts must match path 1).
 * Decoding uses ffprobe because the bundled static ffmpeg 7.0.2 segfaults whenever it demuxes MPEG-TS input.
 * Also checks duration vs the source, resolution vs the Rendition row, thumbs.vtt → sprites, poster, subtitles.
 *
 *   pnpm --filter @app/worker verify:asset --asset-id <uuid> [--asset-id <uuid> …] [--all-ready]
 */
import "../env.js";
import { decryptMediaKey, HLS_KEY_URI_PLACEHOLDER, mediaLayout } from "@app/shared/media";
import { createDecipheriv } from "node:crypto";
import { appendFile, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { env } from "../env.js";
import { closeContext, db, mediaBucket } from "../lib/context.js";
import { ffprobePath, runProcess } from "../lib/ffmpeg.js";
import { errMessage } from "../lib/log.js";
import { mapPool } from "../lib/pool.js";
import { downloadToFile, listAllObjects } from "../lib/s3.js";
import { parseMediaPlaylist } from "../pipeline/hls.js";

const PROTO = ["-allowed_extensions", "ALL", "-protocol_whitelist", "file,crypto,data"];

async function verify(assetId: string): Promise<boolean> {
  const a = await db().mediaAsset.findUnique({ where: { id: assetId }, include: { renditions: true, sourceFile: true, subtitleTracks: true } });
  if (!a) throw new Error(`asset ${assetId} not found`);
  if (a.status !== "READY" || !a.encKeyCipher || !a.encKeyIv || !a.encKeyTag || !a.hlsIv) throw new Error(`asset ${assetId} is ${a.status}, not READY with a key`);
  const dir = await mkdtemp(join(env().workDir, "verify-"));
  const problems: string[] = [];
  try {
    const prefix = `${mediaLayout.assetPrefix(assetId)}/`;
    const keys: string[] = [];
    for await (const o of listAllObjects(mediaBucket(), prefix)) keys.push(o.Key!);
    await mapPool(keys, 8, async (k) => {
      const dest = join(dir, k.slice(prefix.length));
      await mkdir(dirname(dest), { recursive: true });
      await downloadToFile(mediaBucket(), k, dest);
    });
    const key = decryptMediaKey({ encKeyCipher: a.encKeyCipher, encKeyIv: a.encKeyIv, encKeyTag: a.encKeyTag }, env().mediaKeySecret);
    const keyPath = join(dir, "local.key");
    await writeFile(keyPath, key, { mode: 0o600 });

    const master = await readFile(join(dir, "master.m3u8"), "utf8");
    const src = a.sourceFile?.durationSec ?? null;
    console.log(`\nasset ${assetId}  source=${a.sourceFile?.key} (${src?.toFixed(2)} s)  objects=${keys.length}`);
    for (const r of a.renditions.sort((x, y) => x.height - y.height)) {
      if (!master.includes(`${r.name}/index.m3u8`)) problems.push(`${r.name} missing from master`);
      const pl = join(dir, r.name, "index.m3u8");
      const text = await readFile(pl, "utf8");
      if (!text.includes(`URI="${HLS_KEY_URI_PLACEHOLDER}",IV=0x${a.hlsIv}`)) problems.push(`${r.name}: unexpected EXT-X-KEY`);
      const local = join(dir, r.name, "local.m3u8");
      await writeFile(local, text.replace(`URI="${HLS_KEY_URI_PLACEHOLDER}"`, `URI="${keyPath}"`));

      const probe = JSON.parse(
        (
          await runProcess(ffprobePath(), ["-v", "error", ...PROTO, "-count_frames", "-print_format", "json", "-show_streams", "-show_format", local], {
            captureStdout: true,
            timeoutMs: 600_000,
          })
        ).stdout,
      ) as {
        streams: Array<{ codec_type: string; codec_name: string; width?: number; height?: number; profile?: string; channels?: number; nb_read_frames?: string; avg_frame_rate?: string }>;
        format: { duration?: string };
      };
      // path 2: decrypt segments ourselves (AES-128-CBC, IV from the playlist) → one TS file
      const iv = Buffer.from(a.hlsIv, "hex");
      const plain = join(dir, r.name, "decrypted.ts");
      for (const seg of parseMediaPlaylist(text)) {
        const d = createDecipheriv("aes-128-cbc", key, iv);
        await appendFile(plain, Buffer.concat([d.update(await readFile(join(dir, r.name, seg.uri))), d.final()]));
      }
      const v = probe.streams.find((s) => s.codec_type === "video");
      const au = probe.streams.find((s) => s.codec_type === "audio");
      const t = Date.now();
      // path 2: full decode of the self-decrypted TS (every stream); at -v error ffprobe's stderr must stay empty
      let decodeErrors: string[] = [];
      let plainFrames = 0;
      try {
        const r2 = await runProcess(ffprobePath(), ["-v", "error", "-count_frames", "-print_format", "json", "-show_streams", plain], { captureStdout: true, timeoutMs: 600_000 });
        decodeErrors = r2.stderrTail;
        const st = (JSON.parse(r2.stdout) as { streams: Array<{ codec_type: string; nb_read_frames?: string }> }).streams;
        plainFrames = Number(st.find((x) => x.codec_type === "video")?.nb_read_frames ?? 0);
        if (au && !Number(st.find((x) => x.codec_type === "audio")?.nb_read_frames ?? 0)) decodeErrors.push("no audio frames decoded");
      } catch (err) {
        decodeErrors = [`ffprobe failed: ${errMessage(err)}`];
      }
      const dur = Number(probe.format.duration);
      const frames = Number(v?.nb_read_frames ?? 0);
      const [fn, fd] = (v?.avg_frame_rate ?? "0/1").split("/").map(Number);
      const fps = fd ? fn! / fd : 0;
      const framesSec = fps ? frames / fps : 0;
      const decodedSec = fps ? plainFrames / fps : 0;
      const ok =
        decodeErrors.length === 0 &&
        frames > 0 &&
        frames === plainFrames &&
        v?.width === r.width &&
        v?.height === r.height &&
        v?.codec_name === "h264" &&
        (src === null || (Math.abs(framesSec - src) < 0.5 && Math.abs(decodedSec - src) < 0.5));
      if (!ok) problems.push(`${r.name}: hlsFrames=${frames} plainFrames=${plainFrames} size=${v?.width}x${v?.height} errors=${decodeErrors.slice(0, 2).join(" | ")}`);
      console.log(
        `  ${r.name.padEnd(5)} ${`${v?.width}x${v?.height}`.padEnd(9)} ${v?.codec_name}/${v?.profile} + ${au ? `${au.codec_name} ${au.channels}ch` : "no audio"}  ` +
          `playlist=${dur.toFixed(2)}s frames(hls+aes)=${frames} frames(self-decrypted)=${plainFrames} → ${framesSec.toFixed(2)}s ` +
          `(Δsrc ${src === null ? "?" : (framesSec - src).toFixed(2)}s)  decodeErrors=${decodeErrors.length}  ${((Date.now() - t) / 1000).toFixed(1)}s  ${ok ? "OK" : "FAIL"}`,
      );
    }
    // thumbnails + poster + subs
    const vtt = await readFile(join(dir, "thumbs", "thumbs.vtt"), "utf8");
    const sprites = new Set((await readdir(join(dir, "thumbs"))).filter((f) => f.endsWith(".jpg")));
    const refs = [...vtt.matchAll(/^(sprite_\d+\.jpg)#xywh=(\d+),(\d+),(\d+),(\d+)$/gm)];
    const missing = refs.filter((m) => !sprites.has(m[1]!));
    if (!refs.length || missing.length) problems.push(`thumbs.vtt: ${refs.length} cues, ${missing.length} reference missing sprites`);
    const poster = keys.includes(mediaLayout.posterFrame(assetId));
    if (!poster) problems.push("poster.jpg missing");
    const leaked = keys.filter((k) => /\.key$|keyinfo/i.test(k));
    if (leaked.length) problems.push(`key material in bucket: ${leaked.join(",")}`);
    for (const s of a.subtitleTracks) if (!keys.includes(s.key)) problems.push(`subtitle ${s.key} missing`);
    console.log(`  thumbs: ${refs.length} cues over ${sprites.size} sprite sheet(s); poster: ${poster ? "yes" : "NO"}; subtitles: ${a.subtitleTracks.length}; key files in bucket: ${leaked.length}`);
    console.log(problems.length ? `  RESULT: FAIL\n    - ${problems.join("\n    - ")}` : "  RESULT: PLAYABLE");
    return problems.length === 0;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function main() {
  const { values } = parseArgs({ options: { "asset-id": { type: "string", multiple: true }, "all-ready": { type: "boolean", default: false } } });
  let ids = values["asset-id"] ?? [];
  if (values["all-ready"]) ids = (await db().mediaAsset.findMany({ where: { status: "READY" }, select: { id: true }, orderBy: { createdAt: "asc" } })).map((x) => x.id);
  if (!ids.length) throw new Error("--asset-id <uuid> or --all-ready required");
  await mkdir(env().workDir, { recursive: true });
  let failed = 0;
  for (const id of ids) {
    try {
      if (!(await verify(id))) failed++;
    } catch (err) {
      failed++;
      console.log(`\nasset ${id}: ERROR ${errMessage(err)}`);
    }
  }
  console.log(`\n${ids.length - failed}/${ids.length} assets playable`);
  await closeContext();
  process.exitCode = failed ? 2 : 0;
}
main().catch(async (err) => {
  console.error(`verify failed: ${errMessage(err)}`);
  await closeContext();
  process.exit(1);
});
