import { Injectable, Logger } from "@nestjs/common";
import nodemailer, { type Transporter } from "nodemailer";
import { env } from "../../env.js";

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

@Injectable()
export class MailService {
  private readonly logger = new Logger("MailService");
  private transporter: Transporter | null = null;

  private getTransporter(): Transporter {
    this.transporter ??= nodemailer.createTransport({
      host: env("SMTP_HOST", "localhost"),
      port: Number(env("SMTP_PORT", "1025")),
      secure: env("SMTP_SECURE", "false") === "true",
      auth: process.env.SMTP_USER ? { user: env("SMTP_USER"), pass: env("SMTP_PASS", "") } : undefined,
    });
    return this.transporter;
  }

  async send(msg: MailMessage): Promise<void> {
    await this.getTransporter().sendMail({ from: env("MAIL_FROM", "no-reply@localhost"), ...msg });
  }

  /** Gửi nền: không chặn request, không lộ thời gian xử lý, chỉ log lỗi. */
  sendInBackground(msg: MailMessage): void {
    this.send(msg).catch((err: unknown) => {
      this.logger.error(`Gửi mail tới ${msg.to} thất bại: ${err instanceof Error ? err.message : String(err)}`);
    });
  }

  webUrl(path: string): string {
    return `${env("PUBLIC_WEB_URL", "http://localhost:3000").replace(/\/$/, "")}${path}`;
  }
}
