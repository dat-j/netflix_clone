import { masterRenditionNames, rewriteMaster, rewriteRendition } from "./playlist.js";
import { audioTracksOf } from "./playback.service.js";

/** Bố cục cũ: audio mux trong từng variant. */
const OLD = [
  "#EXTM3U", "#EXT-X-VERSION:3", "#EXT-X-INDEPENDENT-SEGMENTS",
  '#EXT-X-STREAM-INF:BANDWIDTH=900000,RESOLUTION=640x360,CODECS="avc1.64001e,mp4a.40.2",FRAME-RATE=25.000', "360p/index.m3u8",
  '#EXT-X-STREAM-INF:BANDWIDTH=5200000,RESOLUTION=1920x1080,CODECS="avc1.640028,mp4a.40.2",FRAME-RATE=25.000', "1080p/index.m3u8", "",
].join("\n");
/** Bố cục mới (worker hiện tại): video-only variants + nhóm AUDIO. */
const NEW = [
  "#EXTM3U", "#EXT-X-VERSION:3", "#EXT-X-INDEPENDENT-SEGMENTS",
  '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="English",LANGUAGE="en",DEFAULT=YES,AUTOSELECT=YES,CHANNELS="2",URI="audio_1_en/index.m3u8"',
  '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="Tiếng Việt",LANGUAGE="vi",DEFAULT=NO,AUTOSELECT=YES,CHANNELS="2",URI="audio_2_vi/index.m3u8"',
  '#EXT-X-STREAM-INF:BANDWIDTH=1000000,RESOLUTION=640x360,CODECS="avc1.64001e,mp4a.40.2",FRAME-RATE=25.000,AUDIO="aud"', "360p/index.m3u8",
  '#EXT-X-STREAM-INF:BANDWIDTH=5300000,RESOLUTION=1920x1080,CODECS="avc1.640028,mp4a.40.2",FRAME-RATE=25.000,AUDIO="aud"', "1080p/index.m3u8", "",
].join("\n");

describe("master rewriting — both layouts", () => {
  it("lists video and audio playlist names", () => {
    expect(masterRenditionNames(OLD)).toEqual(["360p", "1080p"]);
    expect(masterRenditionNames(NEW).sort()).toEqual(["1080p", "360p", "audio_1_en", "audio_2_vi"]);
  });
  it("old layout: filters variants by allowed set, relative proxied URIs", () => {
    const out = rewriteMaster(OLD, new Set(["360p"]));
    expect(out).toContain("\nr/360p/index.m3u8");
    expect(out).not.toContain("1080p");
    expect(out).not.toContain("EXT-X-MEDIA");
  });
  it("new layout: audio media URIs → proxied playlists, AUDIO group kept, high variants dropped", () => {
    const out = rewriteMaster(NEW, new Set(["360p", "audio_1_en", "audio_2_vi"]));
    expect(out.split("\n")).toEqual([
      "#EXTM3U", "#EXT-X-VERSION:3", "#EXT-X-INDEPENDENT-SEGMENTS",
      '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="English",LANGUAGE="en",DEFAULT=YES,AUTOSELECT=YES,CHANNELS="2",URI="r/audio_1_en/index.m3u8"',
      '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="Tiếng Việt",LANGUAGE="vi",DEFAULT=NO,AUTOSELECT=YES,CHANNELS="2",URI="r/audio_2_vi/index.m3u8"',
      '#EXT-X-STREAM-INF:BANDWIDTH=1000000,RESOLUTION=640x360,CODECS="avc1.64001e,mp4a.40.2",FRAME-RATE=25.000,AUDIO="aud"', "r/360p/index.m3u8",
      "",
    ]);
  });
  it("audio playlists: segments signed exactly like video, key URI replaced, no escape from the asset", () => {
    const pl = '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="urn:app:hls-key",IV=0x00\n#EXTINF:4,\nseg_00000.ts\n#EXTINF:4,\nseg_00001.ts\n';
    const r = rewriteRendition(pl, { assetPrefix: "hls/a", renditionDir: "hls/a/audio_2_vi", keyUrl: "/k", signObject: (k) => `S:${k}` });
    expect(r).toBe('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="/k",IV=0x00\n#EXTINF:4,\nS:hls/a/audio_2_vi/seg_00000.ts\n#EXTINF:4,\nS:hls/a/audio_2_vi/seg_00001.ts\n');
    expect(() => rewriteRendition("../../b/x.ts", { assetPrefix: "hls/a", renditionDir: "hls/a/audio_1_en", keyUrl: "/k", signObject: (k) => k })).toThrow();
  });
});

describe("audioTracksOf", () => {
  const row = (lang: string, playlistKey: string | null, isDefault = false) => ({ id: lang, language: lang, label: lang, channels: 2, isDefault, playlistKey });
  it("old assets (muxed audio, playlistKey null) → []", () => {
    expect(audioTracksOf([row("en", null, true)], "hls/a/")).toEqual([]);
  });
  it("single separate track → [] (nothing to choose); ≥2 → listed", () => {
    expect(audioTracksOf([row("en", "hls/a/audio_1_en/index.m3u8", true)], "hls/a/")).toEqual([]);
    expect(audioTracksOf([row("en", "hls/a/audio_1_en/index.m3u8", true), row("vi", "hls/a/audio_2_vi/index.m3u8")], "hls/a/")).toEqual([
      { id: "en", language: "en", label: "en", channels: 2, isDefault: true },
      { id: "vi", language: "vi", label: "vi", channels: 2, isDefault: false },
    ]);
  });
  it("ignores playlists outside the asset prefix", () => {
    expect(audioTracksOf([row("en", "hls/b/audio_1_en/index.m3u8"), row("vi", "hls/a/audio_2_vi/index.m3u8")], "hls/a/")).toEqual([]);
  });
});
