import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { QUEUE_PROBE, QUEUE_TRANSCODE, type ProbeJobData, type TranscodeJobData } from "@app/shared/media";
import { env } from "../../env.js";

/** Producer BullMQ cho worker transcode/probe (apps/worker là consumer). */
@Injectable()
export class MediaQueuesService implements OnModuleDestroy {
  private readonly connection = new Redis(env("REDIS_URL"), { maxRetriesPerRequest: null });
  readonly transcode = new Queue<TranscodeJobData>(QUEUE_TRANSCODE, { connection: this.connection });
  readonly probe = new Queue<ProbeJobData>(QUEUE_PROBE, { connection: this.connection });

  async enqueueTranscode(data: TranscodeJobData, jobId: string): Promise<string> {
    const job = await this.transcode.add("transcode", data, {
      jobId, removeOnComplete: 1000, removeOnFail: 5000,
      // Khớp TRANSCODE_JOB_OPTS của worker: lỗi tạm thời được thử lại với backoff
      attempts: 3, backoff: { type: "exponential", delay: 60_000 },
    });
    return job.id ?? jobId;
  }

  async enqueueScan(prefix?: string): Promise<void> {
    await this.probe.add("scan", { type: "scan", ...(prefix ? { prefix } : {}) }, { removeOnComplete: 100, removeOnFail: 500 });
  }

  async onModuleDestroy() {
    await Promise.allSettled([this.transcode.close(), this.probe.close()]);
    this.connection.disconnect();
  }
}
