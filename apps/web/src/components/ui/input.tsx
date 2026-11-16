"use client";

import { CircleX, Eye, EyeOff } from "lucide-react";
import { forwardRef, useId, useState, type InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export interface FloatingInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  label: string;
  error?: string | null;
  hint?: string;
  /** "dark" for translucent fields on imagery (auth, landing), "solid" for settings forms */
  appearance?: "dark" | "solid";
  size?: "md" | "lg";
}

/** Floating-label input with inline error, used across auth and settings forms. */
export const FloatingInput = forwardRef<HTMLInputElement, FloatingInputProps>(function FloatingInput(
  { label, error, hint, appearance = "dark", size = "lg", className, id, type = "text", ...props },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const [reveal, setReveal] = useState(false);
  const isPassword = type === "password";
  const describedBy = error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined;

  return (
    <div className={cn("w-full", className)}>
      <div className="relative">
        <input
          ref={ref}
          id={inputId}
          type={isPassword && reveal ? "text" : type}
          placeholder=" "
          aria-invalid={!!error || undefined}
          aria-describedby={describedBy}
          className={cn(
            "peer block w-full rounded border px-4 pt-6 pb-2 text-base text-white transition-[border-color,box-shadow] outline-none placeholder:text-transparent",
            size === "lg" ? "h-14" : "h-12 pt-5 pb-1.5",
            appearance === "dark" ? "border-white/35 bg-[rgb(22_22_22/0.7)]" : "border-white/15 bg-[#222]",
            "focus:border-white focus:ring-2 focus:ring-white/80 focus:ring-offset-0",
            error && "border-danger focus:border-danger focus:ring-danger/70",
            isPassword && "pr-12",
          )}
          {...props}
        />
        <label
          htmlFor={inputId}
          className={cn(
            "pointer-events-none absolute top-1/2 left-4 origin-left -translate-y-1/2 text-base text-white/70 transition-all duration-150",
            "peer-focus:top-[0.85rem] peer-focus:translate-y-0 peer-focus:text-xs",
            "peer-[:not(:placeholder-shown)]:top-[0.85rem] peer-[:not(:placeholder-shown)]:translate-y-0 peer-[:not(:placeholder-shown)]:text-xs",
            size === "md" && "peer-focus:top-2 peer-[:not(:placeholder-shown)]:top-2",
          )}
        >
          {label}
        </label>
        {isPassword && (
          <button
            type="button"
            onClick={() => setReveal((r) => !r)}
            aria-label={reveal ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
            className="absolute top-1/2 right-3 -translate-y-1/2 rounded p-1.5 text-white/70 hover:text-white"
          >
            {reveal ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
          </button>
        )}
      </div>
      {error ? (
        <p id={`${inputId}-error`} className="mt-1.5 flex items-start gap-1.5 text-[0.8125rem] text-danger">
          <CircleX className="mt-px size-4 shrink-0" aria-hidden />
          {error}
        </p>
      ) : hint ? (
        <p id={`${inputId}-hint`} className="mt-1.5 text-[0.8125rem] text-white/60">
          {hint}
        </p>
      ) : null}
    </div>
  );
});
