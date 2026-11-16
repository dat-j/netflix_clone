import { HLS_KEY_URI_PLACEHOLDER } from "@app/shared/media";
import { describe, expect, it } from "vitest";
import {
  buildMasterPlaylist,
  buildPosterArgs,
  buildThumbFrameArgs,
  buildTranscodeArgs,
  keyInfoFile,
  outputFrameRate,
  parseMediaPlaylist,
  variantBandwidth,
} from "../src/pipeline/hls.js";
import { selectRenditions } from "../src/pipeline/renditions.js";
import { planThumbs } from "../src/pipeline/thumbs.js";

const base = {
  input: "/w/source.mkv",
  outDir: "/w/out",
  keyInfoPath: "/w/secret/enc.keyinfo",
  videoStreamIndex: 0,
  audioStreamIndex: 2,
  sourceFrameRate: 30,
  hdr: false,
  preset: "veryfast",
};
const arg = (args: string[], flag: string) => args[args.indexOf(flag) + 1];

describe("buildTranscodeArgs", () => {
  const renditions = selectRenditions(1920, 1080, 30);
  const args = buildTranscodeArgs({ ...base, renditions });

  it("decodes once and splits into one branch per rendition", () => {
    const graph = arg(args, "-filter_complex")!;
    expect(graph.startsWith("[0:0]format=yuv420p,split=4[s0][s1][s2][s3]")).toBe(true);
    expect(graph).toContain("[s3]scale=1920:1080:flags=bicubic,setsar=1[v3]");
    expect(args.filter((a) => a === "-i")).toHaveLength(1);
  });

  it("maps video+audio per variant and names variants via var_stream_map", () => {
    expect(arg(args, "-var_stream_map")).toBe("v:0,a:0,name:360p v:1,a:1,name:480p v:2,a:2,name:720p v:3,a:3,name:1080p");
    expect(args.filter((a) => a === "0:2")).toHaveLength(4);
    expect(args.at(-1)).toBe("/w/out/%v/index.m3u8");
    expect(arg(args, "-hls_segment_filename")).toBe("/w/out/%v/seg_%05d.ts");
  });

  it("closed GOP aligned to 4 s segments, scene-cut off, H.264 High yuv420p", () => {
    expect(arg(args, "-g")).toBe("120");
    expect(arg(args, "-keyint_min")).toBe("120");
    expect(arg(args, "-sc_threshold")).toBe("0");
    expect(arg(args, "-flags")).toBe("+cgop");
    expect(arg(args, "-force_key_frames")).toBe("expr:gte(t,n_forced*4)");
    expect(arg(args, "-x264-params")).toContain("scenecut=0");
    expect(arg(args, "-x264-params")).toContain("open-gop=0");
    expect(arg(args, "-c:v")).toBe("libx264");
    expect(arg(args, "-profile:v")).toBe("high");
    expect(arg(args, "-pix_fmt")).toBe("yuv420p");
    expect(arg(args, "-hls_time")).toBe("4");
    expect(arg(args, "-hls_playlist_type")).toBe("vod");
    expect(arg(args, "-hls_segment_type")).toBe("mpegts");
  });

  it("per-variant bitrates, VBV and level", () => {
    expect(arg(args, "-b:v:0")).toBe("800k");
    expect(arg(args, "-maxrate:v:3")).toBe("5500k");
    expect(arg(args, "-bufsize:v:3")).toBe("7500k");
    expect(arg(args, "-level:v:3")).toBe("4.0");
    expect(arg(args, "-b:a:0")).toBe("96k");
    expect(arg(args, "-b:a:3")).toBe("192k");
    expect(arg(args, "-ac")).toBe("2");
    expect(arg(args, "-hls_key_info_file")).toBe("/w/secret/enc.keyinfo");
  });

  it("GOP follows the frame rate (29.97 → 120, 25 → 100, 120 fps capped to 60 → 240)", () => {
    expect(arg(buildTranscodeArgs({ ...base, renditions, sourceFrameRate: 29.97 }), "-g")).toBe("120");
    expect(arg(buildTranscodeArgs({ ...base, renditions, sourceFrameRate: 25 }), "-g")).toBe("100");
    const hfr = buildTranscodeArgs({ ...base, renditions, sourceFrameRate: 120 });
    expect(arg(hfr, "-g")).toBe("240");
    expect(arg(hfr, "-filter_complex")).toContain("fps=60");
    expect(outputFrameRate(null)).toBe(30);
  });

  it("video-only sources have no audio maps", () => {
    const a = buildTranscodeArgs({ ...base, renditions, audioStreamIndex: null });
    expect(arg(a, "-var_stream_map")).toBe("v:0,name:360p v:1,name:480p v:2,name:720p v:3,name:1080p");
    expect(a).not.toContain("-c:a");
  });

  it("HDR sources are pre-scaled to the top rendition then tone-mapped to 8-bit BT.709", () => {
    const g = arg(buildTranscodeArgs({ ...base, renditions, hdr: true }), "-filter_complex")!;
    expect(g).toMatch(/^\[0:0\]scale=1920:1080:flags=bicubic,zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p,split=4/);
  });
});

describe("sprite + poster args", () => {
  it("thumbnail pass emits one 160px frame per 10 s", () => {
    const a = buildThumbFrameArgs({ input: "/i", framesDir: "/t", videoStreamIndex: 1, hdr: false, thumbs: planThumbs(1920, 1080), keyframesOnly: true });
    expect(arg(a, "-vf")).toBe("fps=1/10,scale=160:90:flags=bicubic,format=yuv420p,setsar=1");
    expect(a).toContain("-skip_frame");
    expect(a.at(-1)).toBe("/t/thumb_%05d.jpg");
  });
  it("poster seeks and grabs one frame", () => {
    const a = buildPosterArgs({ input: "/i", output: "/o/poster.jpg", videoStreamIndex: 0, hdr: false, atSec: 4.8, width: 1280, height: 720 });
    expect(arg(a, "-ss")).toBe("4.800");
    expect(arg(a, "-frames:v")).toBe("1");
    expect(a.indexOf("-ss")).toBeLessThan(a.indexOf("-i"));
  });
});

describe("keyInfoFile", () => {
  it("uses the placeholder URI, local key path and explicit IV", () => {
    expect(keyInfoFile(HLS_KEY_URI_PLACEHOLDER, "/k/enc.key", "00112233445566778899aabbccddeeff")).toBe(
      "urn:app:hls-key\n/k/enc.key\n00112233445566778899aabbccddeeff\n",
    );
    expect(() => keyInfoFile(HLS_KEY_URI_PLACEHOLDER, "/k", "abc")).toThrow();
  });
});

describe("variant stats + master playlist", () => {
  const pl = [
    "#EXTM3U",
    "#EXT-X-VERSION:3",
    "#EXT-X-TARGETDURATION:4",
    `#EXT-X-KEY:METHOD=AES-128,URI="${HLS_KEY_URI_PLACEHOLDER}",IV=0x00112233445566778899aabbccddeeff`,
    "#EXTINF:4.000000,",
    "seg_00000.ts",
    "#EXTINF:4.000000,",
    "seg_00001.ts",
    "#EXTINF:1.500000,",
    "seg_00002.ts",
    "#EXT-X-ENDLIST",
  ].join("\n");

  it("parses segments", () => {
    expect(parseMediaPlaylist(pl)).toEqual([
      { uri: "seg_00000.ts", duration: 4 },
      { uri: "seg_00001.ts", duration: 4 },
      { uri: "seg_00002.ts", duration: 1.5 },
    ]);
  });

  it("computes peak and average bandwidth from segment sizes", () => {
    const sizes: Record<string, number> = { "seg_00000.ts": 400_000, "seg_00001.ts": 600_000, "seg_00002.ts": 100_000 };
    const bw = variantBandwidth(parseMediaPlaylist(pl), (u) => sizes[u]!);
    expect(bw.duration).toBeCloseTo(9.5);
    expect(bw.peak).toBe(1_200_000); // 600 kB * 8 / 4 s
    expect(bw.average).toBe(Math.ceil((1_100_000 * 8) / 9.5));
  });

  it("writes a master with relative variant URIs, CODECS, RESOLUTION, FRAME-RATE, sorted by bandwidth", () => {
    const [r360, , r720] = selectRenditions(1280, 720, 25);
    const m = buildMasterPlaylist(
      [
        { rendition: r720!, bandwidth: 3_200_000, averageBandwidth: 2_900_000 },
        { rendition: r360!, bandwidth: 950_000, averageBandwidth: 880_000 },
      ],
      { frameRate: 25, hasAudio: true },
    );
    expect(m).toBe(
      [
        "#EXTM3U",
        "#EXT-X-VERSION:3",
        "#EXT-X-INDEPENDENT-SEGMENTS",
        '#EXT-X-STREAM-INF:BANDWIDTH=950000,AVERAGE-BANDWIDTH=880000,RESOLUTION=640x360,CODECS="avc1.64001e,mp4a.40.2",FRAME-RATE=25.000',
        "360p/index.m3u8",
        '#EXT-X-STREAM-INF:BANDWIDTH=3200000,AVERAGE-BANDWIDTH=2900000,RESOLUTION=1280x720,CODECS="avc1.64001f,mp4a.40.2",FRAME-RATE=25.000',
        "720p/index.m3u8",
        "",
      ].join("\n"),
    );
    expect(buildMasterPlaylist([{ rendition: r360!, bandwidth: 1, averageBandwidth: 1 }], { frameRate: 29.97, hasAudio: false })).toContain(
      'CODECS="avc1.64001e",FRAME-RATE=29.970',
    );
  });
});
