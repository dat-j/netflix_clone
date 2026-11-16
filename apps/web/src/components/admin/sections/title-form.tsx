"use client";

import { useId, useMemo, useState, type FormEvent } from "react";
import { Check, Search } from "lucide-react";
import type { AdminTitleInput, GenreDto } from "@app/shared";
import { cn } from "../lib/format";
import { useGenres } from "../lib/queries";
import { fieldErrors, isOverridden, parsedToInput, titleFormSchema, type TitleFormValues } from "../lib/schemas";
import { Badge, Button, Field, Input, Select, Spinner, Textarea } from "../ui/primitives";

const MATURITY = ["P", "K", "T13", "T16", "T18", "G", "PG", "PG-13", "R", "NC-17", "TV-MA", "TV-14"];

export function TitleForm({
  initial,
  overridden = [],
  fromTmdb = false,
  submitLabel,
  submitting,
  requireDirty = false,
  onSubmit,
  onCancel,
}: {
  initial: TitleFormValues;
  overridden?: string[];
  fromTmdb?: boolean;
  submitLabel: string;
  submitting?: boolean;
  requireDirty?: boolean;
  onSubmit: (input: AdminTitleInput) => void;
  onCancel?: () => void;
}) {
  const [v, setV] = useState<TitleFormValues>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const id = useId();
  const dirty = useMemo(() => JSON.stringify(v) !== JSON.stringify(initial), [v, initial]);

  const set = <K extends keyof TitleFormValues>(k: K, val: TitleFormValues[K]) => {
    setV((p) => ({ ...p, [k]: val }));
    if (errors[k as string]) setErrors((e) => ({ ...e, [k as string]: "" }));
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const r = titleFormSchema.safeParse(v);
    if (!r.success) {
      setErrors(fieldErrors(r.error));
      return;
    }
    setErrors({});
    onSubmit(parsedToInput(r.data));
  };

  const ov = (field: string) =>
    fromTmdb && isOverridden(overridden, field) ? (
      <Badge tone="violet" title="Đã sửa tay — đồng bộ TMDB sẽ không ghi đè trường này">
        Đã ghi đè
      </Badge>
    ) : null;

  const f = (name: keyof TitleFormValues) => `${id}-${name}`;

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Tên phim *" htmlFor={f("name")} error={errors.name} badge={ov("name")} className="sm:col-span-2">
          <Input id={f("name")} value={v.name} onChange={(e) => set("name", e.target.value)} aria-invalid={!!errors.name} />
        </Field>
        <Field label="Tên gốc" htmlFor={f("originalName")} badge={ov("originalName")}>
          <Input id={f("originalName")} value={v.originalName} onChange={(e) => set("originalName", e.target.value)} />
        </Field>
        <Field label="Slug" htmlFor={f("slug")} error={errors.slug} hint="Để trống để tự tạo từ tên" badge={ov("slug")}>
          <Input id={f("slug")} value={v.slug} onChange={(e) => set("slug", e.target.value)} aria-invalid={!!errors.slug} placeholder="ten-phim" />
        </Field>
        <Field label="Loại" htmlFor={f("type")}>
          <Select id={f("type")} value={v.type} onChange={(e) => set("type", e.target.value as TitleFormValues["type"])}>
            <option value="MOVIE">Phim lẻ</option>
            <option value="SERIES">Phim bộ</option>
          </Select>
        </Field>
        <Field label="Phân loại độ tuổi" htmlFor={f("maturityRating")} badge={ov("maturityRating")}>
          <Input id={f("maturityRating")} list={`${id}-mat`} value={v.maturityRating} onChange={(e) => set("maturityRating", e.target.value)} placeholder="T13" />
          <datalist id={`${id}-mat`}>
            {MATURITY.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </Field>
        <Field label="Ngày phát hành" htmlFor={f("releaseDate")} error={errors.releaseDate} badge={ov("releaseDate")}>
          <Input id={f("releaseDate")} type="date" value={v.releaseDate} onChange={(e) => set("releaseDate", e.target.value)} aria-invalid={!!errors.releaseDate} />
        </Field>
        <Field label="Thời lượng (phút)" htmlFor={f("runtimeMinutes")} error={errors.runtimeMinutes} badge={ov("runtimeMinutes")}>
          <Input id={f("runtimeMinutes")} inputMode="numeric" value={v.runtimeMinutes} onChange={(e) => set("runtimeMinutes", e.target.value)} aria-invalid={!!errors.runtimeMinutes} />
        </Field>
        <Field label="Khẩu hiệu (tagline)" htmlFor={f("tagline")} badge={ov("tagline")} className="sm:col-span-2">
          <Input id={f("tagline")} value={v.tagline} onChange={(e) => set("tagline", e.target.value)} />
        </Field>
        <Field label="Mô tả" htmlFor={f("overview")} badge={ov("overview")} className="sm:col-span-2">
          <Textarea id={f("overview")} rows={4} value={v.overview} onChange={(e) => set("overview", e.target.value)} />
        </Field>
        <Field label="Quốc gia" htmlFor={f("countries")} error={errors.countries} hint="Mã ISO 2 chữ cái, cách nhau bởi dấu phẩy (VD: VN, US)" badge={ov("countries")} className="sm:col-span-2">
          <Input id={f("countries")} value={v.countries} onChange={(e) => set("countries", e.target.value)} aria-invalid={!!errors.countries} />
        </Field>
        <div className="sm:col-span-2">
          <GenrePicker value={v.genreIds} onChange={(ids) => set("genreIds", ids)} badge={ov("genreIds")} />
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-zinc-100 pt-4">
        {dirty ? <span className="mr-auto text-xs text-amber-700">Có thay đổi chưa lưu</span> : null}
        {onCancel ? <Button onClick={onCancel}>Huỷ</Button> : null}
        <Button type="submit" variant="primary" loading={submitting} disabled={requireDirty && !dirty}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

function GenrePicker({ value, onChange, badge }: { value: string[]; onChange: (ids: string[]) => void; badge?: React.ReactNode }) {
  const genres = useGenres();
  const [filter, setFilter] = useState("");
  const list: GenreDto[] = genres.data ?? [];
  const shown = filter ? list.filter((g) => g.name.toLowerCase().includes(filter.toLowerCase())) : list;
  const toggle = (gid: string) => onChange(value.includes(gid) ? value.filter((x) => x !== gid) : [...value, gid]);

  return (
    <fieldset className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <legend className="text-[13px] font-medium text-zinc-700">Thể loại</legend>
        {badge}
        <span className="text-xs text-zinc-500">({value.length} đã chọn)</span>
      </div>
      <div className="rounded-md border border-zinc-300 bg-white">
        <div className="relative border-b border-zinc-200">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-zinc-400" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Lọc thể loại…"
            aria-label="Lọc thể loại"
            className="h-8 w-full rounded-t-md bg-transparent pr-2 pl-8 text-[13px] focus:outline-none"
          />
        </div>
        <div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto p-2">
          {genres.isPending ? (
            <Spinner />
          ) : genres.isError ? (
            <span className="text-xs text-zinc-500">Không tải được danh sách thể loại.</span>
          ) : shown.length === 0 ? (
            <span className="text-xs text-zinc-500">Không có thể loại phù hợp.</span>
          ) : (
            shown.map((g) => {
              const on = value.includes(g.id);
              return (
                <button
                  type="button"
                  key={g.id}
                  onClick={() => toggle(g.id)}
                  aria-pressed={on}
                  className={cn(
                    "inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-xs font-medium transition-colors",
                    on ? "border-indigo-600 bg-indigo-600 text-white" : "border-zinc-300 bg-white text-zinc-700 hover:border-zinc-400",
                  )}
                >
                  {on ? <Check className="size-3" /> : null}
                  {g.name}
                </button>
              );
            })
          )}
        </div>
      </div>
    </fieldset>
  );
}
