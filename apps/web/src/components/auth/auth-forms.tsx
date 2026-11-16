"use client";

import type { AuthResponse } from "@app/shared";
import { useQueryClient } from "@tanstack/react-query";
import { CircleAlert, CircleCheck, MailCheck } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { FloatingInput } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { api } from "@/lib/api/client";
import { errorMessage, isApiError } from "@/lib/api/messages";
import { setAuthHint } from "@/lib/auth-hint";
import { BRAND } from "@/lib/brand";
import { qk } from "@/lib/queries";
import { safeNextPath } from "@/lib/utils";

const email = z.string().trim().min(1, "Vui lòng nhập email.").pipe(z.email("Vui lòng nhập địa chỉ email hợp lệ."));
const password = z.string().min(8, "Mật khẩu phải có ít nhất 8 ký tự.").max(200, "Mật khẩu quá dài.");
const loginPassword = z.string().min(1, "Vui lòng nhập mật khẩu.");

type Errors<K extends string> = Partial<Record<K, string>>;

function validate<K extends string>(schema: z.ZodType, values: Record<K, string>): Errors<K> {
  const r = schema.safeParse(values);
  if (r.success) return {};
  const out: Errors<K> = {};
  for (const issue of r.error.issues) {
    const k = issue.path[0] as K;
    if (!out[k]) out[k] = issue.message;
  }
  return out;
}

function FormAlert({ tone = "error", children }: { tone?: "error" | "success"; children: React.ReactNode }) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={
        tone === "error"
          ? "mb-4 flex gap-3 rounded bg-[#d89d31] px-4 py-3 text-sm text-black"
          : "mb-4 flex gap-3 rounded bg-success/15 px-4 py-3 text-sm text-success"
      }
    >
      {tone === "error" ? <CircleAlert className="mt-px size-5 shrink-0" /> : <CircleCheck className="mt-px size-5 shrink-0" />}
      <div>{children}</div>
    </div>
  );
}

function useAfterAuth() {
  const qc = useQueryClient();
  const router = useRouter();
  const params = useSearchParams();
  return (res: AuthResponse) => {
    setAuthHint();
    qc.clear();
    qc.setQueryData(qk.me, undefined);
    void res.user;
    const next = safeNextPath(params.get("next"), "/browse");
    // Everyone passes through the profile gate after signing in (like the reference product)
    router.replace(next.startsWith("/profiles") ? next : `/profiles${next !== "/browse" ? `?next=${encodeURIComponent(next)}` : ""}`);
  };
}

/** Field-level validation runs on blur, then live once a field has been touched. */
function useFormState<K extends string>(initial: Record<K, string>, schema: z.ZodType) {
  const [values, setValues] = useState(initial);
  const [touched, setTouched] = useState<Partial<Record<K, boolean>>>({});
  const [submitted, setSubmitted] = useState(false);
  const all = validate<K>(schema, values);
  const errors: Errors<K> = {};
  for (const k of Object.keys(values) as K[]) if (submitted || touched[k]) errors[k] = all[k];
  return {
    values,
    errors,
    valid: Object.keys(all).length === 0,
    bind: (k: K) => ({
      value: values[k],
      error: errors[k],
      onChange: (e: React.ChangeEvent<HTMLInputElement>) => setValues((v) => ({ ...v, [k]: e.target.value })),
      onBlur: () => setTouched((t) => ({ ...t, [k]: true })),
    }),
    submit: () => {
      setSubmitted(true);
      return Object.keys(all).length === 0;
    },
  };
}

// ───────── login ─────────
export function LoginForm() {
  const params = useSearchParams();
  const afterAuth = useAfterAuth();
  const form = useFormState({ email: params.get("email") ?? "", password: "" }, z.object({ email, password: loginPassword }));
  const [error, setError] = useState<React.ReactNode>(null);
  const [pending, setPending] = useState(false);
  const expired = params.has("expired");

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!form.submit()) return;
    setPending(true);
    try {
      const res = await api<AuthResponse>("/auth/login", { method: "POST", body: { email: form.values.email.trim(), password: form.values.password }, noRefresh: true });
      afterAuth(res);
    } catch (err) {
      setPending(false);
      if (isApiError(err, "INVALID_CREDENTIALS")) {
        setError(
          <>
            <strong>Mật khẩu không đúng</strong> hoặc email chưa được đăng ký. Vui lòng thử lại hoặc{" "}
            <Link href="/forgot-password" className="underline">
              đặt lại mật khẩu
            </Link>
            .
          </>,
        );
      } else {
        setError(errorMessage(err, { FORBIDDEN: `Tài khoản của bạn đã bị khóa. Vui lòng liên hệ ${BRAND.supportEmail} để được hỗ trợ.` }));
      }
    }
  };

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4" data-testid="login-form">
      <h1 className="mb-7 text-[2rem] font-bold">Đăng nhập</h1>
      {expired && !error && <FormAlert>Phiên đăng nhập của bạn đã hết hạn. Vui lòng đăng nhập lại.</FormAlert>}
      {error && <FormAlert>{error}</FormAlert>}
      <FloatingInput label="Email" type="email" autoComplete="email" inputMode="email" autoFocus {...form.bind("email")} />
      <FloatingInput label="Mật khẩu" type="password" autoComplete="current-password" {...form.bind("password")} />
      <Button type="submit" variant="brand" size="lg" className="mt-2 w-full text-base" loading={pending}>
        Đăng nhập
      </Button>
      <div className="text-center">
        <Link href="/forgot-password" className="text-[0.95rem] text-white hover:underline hover:text-white/70">
          Bạn quên mật khẩu?
        </Link>
      </div>
      <p className="pt-6 text-white/70">
        Bạn mới sử dụng {BRAND.name}?{" "}
        <Link href="/signup" className="font-semibold text-white hover:underline">
          Đăng ký ngay.
        </Link>
      </p>
      <p className="text-[0.8125rem] leading-snug text-[#8c8c8c]">
        Trang này được bảo vệ để đảm bảo bạn không phải là robot. Mật khẩu của bạn được mã hóa và không bao giờ được chia sẻ.
      </p>
    </form>
  );
}

// ───────── signup ─────────
export function SignupForm() {
  const params = useSearchParams();
  const afterAuth = useAfterAuth();
  const schema = z
    .object({ email, password, confirm: z.string() })
    .refine((v) => v.password === v.confirm, { path: ["confirm"], message: "Mật khẩu nhập lại không khớp." });
  const form = useFormState({ email: params.get("email") ?? "", password: "", confirm: "" }, schema);
  const [error, setError] = useState<React.ReactNode>(null);
  const [pending, setPending] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!form.submit()) return;
    setPending(true);
    try {
      const res = await api<AuthResponse>("/auth/register", { method: "POST", body: { email: form.values.email.trim(), password: form.values.password }, noRefresh: true });
      afterAuth(res);
    } catch (err) {
      setPending(false);
      if (isApiError(err, "EMAIL_TAKEN")) {
        setError(
          <>
            Email này đã được đăng ký.{" "}
            <Link href={`/login?email=${encodeURIComponent(form.values.email)}`} className="font-semibold underline">
              Đăng nhập
            </Link>{" "}
            hoặc dùng email khác.
          </>,
        );
      } else setError(errorMessage(err));
    }
  };

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4" data-testid="signup-form">
      <p className="text-xs font-semibold tracking-wider text-white/60 uppercase">Bước 1/2</p>
      <h1 className="text-[2rem] leading-tight font-bold">Tạo tài khoản</h1>
      <p className="mb-6 text-white/70">Chỉ vài bước nữa là bạn có thể bắt đầu xem. Chúng tôi cũng ghét giấy tờ.</p>
      {error && <FormAlert>{error}</FormAlert>}
      <FloatingInput label="Email" type="email" autoComplete="email" inputMode="email" autoFocus={!form.values.email} {...form.bind("email")} />
      <FloatingInput label="Mật khẩu" type="password" autoComplete="new-password" hint="Tối thiểu 8 ký tự." autoFocus={!!form.values.email} {...form.bind("password")} />
      <FloatingInput label="Nhập lại mật khẩu" type="password" autoComplete="new-password" {...form.bind("confirm")} />
      <Button type="submit" variant="brand" size="lg" className="mt-2 w-full text-base" loading={pending}>
        Tiếp theo
      </Button>
      <p className="text-[0.8125rem] leading-snug text-[#8c8c8c]">
        Khi tiếp tục, bạn đồng ý với Điều khoản sử dụng và Chính sách quyền riêng tư của {BRAND.name}. Chúng tôi sẽ gửi email xác minh tới địa chỉ của bạn.
      </p>
      <p className="pt-4 text-white/70">
        Đã có tài khoản?{" "}
        <Link href="/login" className="font-semibold text-white hover:underline">
          Đăng nhập.
        </Link>
      </p>
    </form>
  );
}

// ───────── forgot password ─────────
export function ForgotPasswordForm() {
  const form = useFormState({ email: "" }, z.object({ email }));
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!form.submit()) return;
    setPending(true);
    try {
      await api("/auth/forgot-password", { method: "POST", body: { email: form.values.email.trim() }, noRefresh: true });
      setSent(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  };

  if (sent) {
    return (
      <div className="space-y-4 text-center" role="status">
        <MailCheck className="mx-auto size-14 text-brand" />
        <h1 className="text-2xl font-bold">Kiểm tra hộp thư của bạn</h1>
        <p className="text-white/70">
          Nếu <strong className="text-white">{form.values.email}</strong> đã đăng ký tài khoản {BRAND.name}, bạn sẽ nhận được email kèm liên kết đặt lại mật khẩu trong ít phút.
        </p>
        <Button asChild variant="outline" className="mt-4">
          <Link href="/login">Quay lại đăng nhập</Link>
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <h1 className="text-[2rem] leading-tight font-bold">Quên mật khẩu</h1>
      <p className="mb-6 text-white/70">Nhập email bạn dùng để đăng ký. Chúng tôi sẽ gửi cho bạn liên kết để đặt lại mật khẩu.</p>
      {error && <FormAlert>{error}</FormAlert>}
      <FloatingInput label="Email" type="email" autoComplete="email" autoFocus {...form.bind("email")} />
      <Button type="submit" variant="brand" size="lg" className="w-full text-base" loading={pending}>
        Gửi liên kết
      </Button>
      <p className="pt-2 text-center">
        <Link href="/login" className="text-white/80 hover:underline">
          Quay lại đăng nhập
        </Link>
      </p>
    </form>
  );
}

// ───────── reset password ─────────
export function ResetPasswordForm() {
  const params = useSearchParams();
  const token = params.get("token");
  const schema = z
    .object({ password, confirm: z.string() })
    .refine((v) => v.password === v.confirm, { path: ["confirm"], message: "Mật khẩu nhập lại không khớp." });
  const form = useFormState({ password: "", confirm: "" }, schema);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<React.ReactNode>(null);
  const [pending, setPending] = useState(false);

  if (!token) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Liên kết không hợp lệ</h1>
        <p className="text-white/70">Liên kết đặt lại mật khẩu bị thiếu hoặc không đúng. Vui lòng yêu cầu liên kết mới.</p>
        <Button asChild variant="brand">
          <Link href="/forgot-password">Yêu cầu liên kết mới</Link>
        </Button>
      </div>
    );
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!form.submit()) return;
    setPending(true);
    try {
      await api("/auth/reset-password", { method: "POST", body: { token, password: form.values.password }, noRefresh: true });
      setDone(true);
    } catch (err) {
      setError(
        isApiError(err, "TOKEN_INVALID") ? (
          <>
            Liên kết đã hết hạn hoặc đã được sử dụng.{" "}
            <Link href="/forgot-password" className="font-semibold underline">
              Yêu cầu liên kết mới
            </Link>
            .
          </>
        ) : (
          errorMessage(err)
        ),
      );
    } finally {
      setPending(false);
    }
  };

  if (done) {
    return (
      <div className="space-y-4 text-center" role="status">
        <CircleCheck className="mx-auto size-14 text-success" />
        <h1 className="text-2xl font-bold">Đã đổi mật khẩu</h1>
        <p className="text-white/70">Mật khẩu của bạn đã được cập nhật. Hãy đăng nhập bằng mật khẩu mới.</p>
        <Button asChild variant="brand" size="lg" className="w-full">
          <Link href="/login">Đăng nhập</Link>
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <h1 className="text-[2rem] leading-tight font-bold">Đặt mật khẩu mới</h1>
      <p className="mb-6 text-white/70">Mật khẩu mới cần có ít nhất 8 ký tự.</p>
      {error && <FormAlert>{error}</FormAlert>}
      <FloatingInput label="Mật khẩu mới" type="password" autoComplete="new-password" autoFocus {...form.bind("password")} />
      <FloatingInput label="Nhập lại mật khẩu mới" type="password" autoComplete="new-password" {...form.bind("confirm")} />
      <Button type="submit" variant="brand" size="lg" className="w-full text-base" loading={pending}>
        Lưu mật khẩu
      </Button>
    </form>
  );
}

// ───────── verify email ─────────
export function VerifyEmail() {
  const params = useSearchParams();
  const token = params.get("token");
  const [state, setState] = useState<"pending" | "ok" | "error">(token ? "pending" : "error");
  const [message, setMessage] = useState<string>("Liên kết xác minh bị thiếu hoặc không đúng.");
  const ran = useRef(false);

  useEffect(() => {
    if (!token || ran.current) return;
    ran.current = true;
    api("/auth/verify-email", { method: "POST", body: { token }, noRefresh: true })
      .then(() => setState("ok"))
      .catch((err) => {
        setMessage(errorMessage(err, { TOKEN_INVALID: "Liên kết xác minh không hợp lệ, đã hết hạn hoặc email đã được xác minh trước đó." }));
        setState("error");
      });
  }, [token]);

  return (
    <div className="space-y-4 py-6 text-center" role="status" aria-live="polite">
      {state === "pending" ? (
        <>
          <Spinner className="mx-auto size-12 text-brand" />
          <h1 className="text-2xl font-bold">Đang xác minh email…</h1>
        </>
      ) : state === "ok" ? (
        <>
          <CircleCheck className="mx-auto size-14 text-success" />
          <h1 className="text-2xl font-bold">Email đã được xác minh</h1>
          <p className="text-white/70">Cảm ơn bạn! Tài khoản của bạn đã sẵn sàng.</p>
          <Button asChild variant="brand" size="lg" className="w-full">
            <Link href="/browse">Bắt đầu xem</Link>
          </Button>
        </>
      ) : (
        <>
          <CircleAlert className="mx-auto size-14 text-warning" />
          <h1 className="text-2xl font-bold">Không thể xác minh</h1>
          <p className="text-white/70">{message}</p>
          <Button asChild variant="outline" className="mt-2">
            <Link href="/account">Đến trang tài khoản</Link>
          </Button>
        </>
      )}
    </div>
  );
}
