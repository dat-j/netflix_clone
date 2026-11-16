import ffmpegStatic from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

/** System ffmpeg in production (FFMPEG_PATH / PATH), the bundled static build in dev. */
export function ffmpegPath(): string {
  return process.env.FFMPEG_PATH || (ffmpegStatic as unknown as string | null) || "ffmpeg";
}
export function ffprobePath(): string {
  return process.env.FFPROBE_PATH || ffprobeStatic.path || "ffprobe";
}

export class ProcessError extends Error {
  constructor(
    message: string,
    readonly exitCode: number | null,
    readonly stderrTail: string[],
  ) {
    super(message);
    this.name = "ProcessError";
  }
}

export interface RunOptions {
  signal?: AbortSignal;
  /** Kill the process after this many ms. */
  timeoutMs?: number;
  onStdoutLine?: (line: string) => void;
  /** Collect the whole stdout (for ffprobe JSON). */
  captureStdout?: boolean;
  /** How many trailing stderr lines to keep. */
  tailLines?: number;
}

/** Spawns a binary, keeps the last N stderr lines, rejects with ProcessError on non-zero exit / abort / timeout. */
export function runProcess(bin: string, args: string[], opts: RunOptions = {}): Promise<{ stdout: string; stderrTail: string[] }> {
  const tailMax = opts.tailLines ?? 40;
  return new Promise((resolve, reject) => {
    if (opts.signal?.aborted) return reject(new ProcessError("aborted before start", null, []));
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    const tail: string[] = [];
    let stdout = "";
    let killedReason: string | undefined;

    const kill = (reason: string) => {
      if (killedReason) return;
      killedReason = reason;
      child.kill("SIGTERM");
      setTimeout(() => child.exitCode === null && child.kill("SIGKILL"), 5000).unref();
    };
    const onAbort = () => kill("aborted");
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    const timer = opts.timeoutMs ? setTimeout(() => kill(`timed out after ${opts.timeoutMs} ms`), opts.timeoutMs) : undefined;

    createInterface({ input: child.stderr }).on("line", (line) => {
      if (!line.trim()) return;
      tail.push(line);
      if (tail.length > tailMax) tail.shift();
    });
    if (opts.captureStdout) {
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (d: string) => (stdout += d));
    } else if (opts.onStdoutLine) {
      createInterface({ input: child.stdout }).on("line", opts.onStdoutLine);
    } else {
      child.stdout.resume();
    }

    child.on("error", (err) => {
      cleanup();
      reject(new ProcessError(`failed to start ${bin}: ${err.message}`, null, tail));
    });
    child.on("close", (code, sig) => {
      cleanup();
      if (killedReason) return reject(new ProcessError(`process ${killedReason}`, code, tail));
      if (code !== 0) {
        const last = tail.at(-1) ?? "";
        return reject(new ProcessError(`exited with code ${code ?? sig}${last ? `: ${last}` : ""}`, code, tail));
      }
      resolve({ stdout, stderrTail: tail });
    });
    function cleanup() {
      if (timer) clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
    }
  });
}

/**
 * Parses `-progress pipe:1` key=value lines; calls `onTime(seconds)` for each `out_time_us`.
 * Returns a line handler for runProcess.
 */
export function progressLineHandler(onTime: (seconds: number) => void): (line: string) => void {
  return (line) => {
    const eq = line.indexOf("=");
    if (eq < 0) return;
    const k = line.slice(0, eq);
    const v = line.slice(eq + 1).trim();
    // ffmpeg's out_time_ms is (historically) microseconds too; prefer out_time_us.
    if (k === "out_time_us" || k === "out_time_ms") {
      const us = Number(v);
      if (Number.isFinite(us) && us >= 0) onTime(us / 1e6);
    }
  };
}
