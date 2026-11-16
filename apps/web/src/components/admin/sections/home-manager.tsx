"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, GripVertical, ImageOff, Layers, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import type { BillboardDto, CollectionDto, HomeRowDto, HomeRowInput, HomeRowKind, TitleType } from "@app/shared";
import { cn, moveItem } from "../lib/format";
import { useDebounced } from "../lib/hooks";
import { adminApi, qk, useBillboards, useCollections, useGenres, useHomeRows, useTitles } from "../lib/queries";
import { Dialog } from "../ui/dialog";
import { useFeedback } from "../ui/feedback";
import { Badge, Button, Card, EmptyState, ErrorState, Field, Input, PageHeader, Select, Skeleton, Switch } from "../ui/primitives";

const KIND_LABEL: Record<HomeRowKind, string> = {
  COLLECTION: "Bộ sưu tập",
  GENRE: "Thể loại",
  TRENDING: "Thịnh hành",
  TOP10: "Top 10",
  CONTINUE_WATCHING: "Xem tiếp",
  MY_LIST: "Danh sách của tôi",
  NEW_RELEASES: "Mới phát hành",
};
const KIND_DEFAULT_TITLE: Record<HomeRowKind, string> = {
  COLLECTION: "",
  GENRE: "",
  TRENDING: "Đang thịnh hành",
  TOP10: "Top 10 hôm nay",
  CONTINUE_WATCHING: "Xem tiếp",
  MY_LIST: "Danh sách của tôi",
  NEW_RELEASES: "Mới phát hành",
};

type Tab = "rows" | "collections" | "billboards";

export function HomeManagerSection() {
  const [tab, setTab] = useState<Tab>("rows");
  const tabs: [Tab, string][] = [
    ["rows", "Hàng phim"],
    ["collections", "Bộ sưu tập"],
    ["billboards", "Billboard"],
  ];
  return (
    <>
      <PageHeader title="Trang chủ" description="Cấu hình các hàng phim, bộ sưu tập biên tập và billboard trên trang chủ." />
      <div className="mb-4 flex gap-1 border-b border-zinc-200" role="tablist">
        {tabs.map(([k, label]) => (
          <button
            key={k}
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={cn("-mb-px border-b-2 px-3 py-2 text-[13px] font-medium", tab === k ? "border-brand text-zinc-900" : "border-transparent text-zinc-500 hover:text-zinc-800")}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "rows" ? <HomeRowsPanel /> : tab === "collections" ? <CollectionsPanel /> : <BillboardsPanel />}
    </>
  );
}

// ───────── Home rows ─────────
function HomeRowsPanel() {
  const qc = useQueryClient();
  const rows = useHomeRows();
  const collections = useCollections();
  const genres = useGenres();
  const { toast, toastError, confirm } = useFeedback();
  const [editing, setEditing] = useState<HomeRowDto | "new" | null>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);
  const list = [...(rows.data ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);

  const reorder = async (from: number, to: number) => {
    if (from === to) return;
    const next = moveItem(list, from, to).map((r, i) => ({ ...r, sortOrder: i }));
    const prev = rows.data;
    qc.setQueryData<HomeRowDto[]>(qk.homeRows, next);
    try {
      await adminApi.reorderHomeRows(next.map((r) => r.id));
      toast("success", "Đã cập nhật thứ tự");
    } catch (e) {
      qc.setQueryData(qk.homeRows, prev);
      toastError(e, "Không đổi được thứ tự");
    }
  };

  const toggle = async (r: HomeRowDto) => {
    const prev = rows.data;
    qc.setQueryData<HomeRowDto[]>(qk.homeRows, (d) => d?.map((x) => (x.id === r.id ? { ...x, isActive: !r.isActive } : x)));
    try {
      await adminApi.updateHomeRow(r.id, { isActive: !r.isActive });
    } catch (e) {
      qc.setQueryData(qk.homeRows, prev);
      toastError(e);
    }
  };

  const remove = async (r: HomeRowDto) => {
    if (!(await confirm({ title: `Xoá hàng “${r.title}”?`, confirmLabel: "Xoá", danger: true }))) return;
    try {
      await adminApi.deleteHomeRow(r.id);
      qc.setQueryData<HomeRowDto[]>(qk.homeRows, (d) => d?.filter((x) => x.id !== r.id));
      toast("success", "Đã xoá hàng");
    } catch (e) {
      toastError(e);
    }
  };

  const detail = (r: HomeRowDto) => {
    const parts: string[] = [];
    if (r.kind === "COLLECTION") parts.push(collections.data?.find((c) => c.id === r.collectionId)?.name ?? "(bộ sưu tập?)");
    if (r.kind === "GENRE") parts.push(genres.data?.find((g) => g.id === r.genreId)?.name ?? "(thể loại?)");
    if (r.titleType) parts.push(r.titleType === "MOVIE" ? "chỉ phim lẻ" : "chỉ phim bộ");
    return parts.join(" · ");
  };

  return (
    <Card
      title={`Hàng phim (${list.length})`}
      actions={
        <Button size="sm" variant="primary" onClick={() => setEditing("new")}>
          <Plus className="size-3.5" /> Thêm hàng
        </Button>
      }
    >
      {rows.isError ? (
        <ErrorState error={rows.error} onRetry={() => rows.refetch()} />
      ) : !rows.data ? (
        <div className="space-y-2 p-3">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-11" />
          ))}
        </div>
      ) : list.length === 0 ? (
        <EmptyState icon={<Layers className="size-8" />} title="Chưa có hàng nào" description="Thêm hàng Thịnh hành, Top 10, Xem tiếp hoặc bộ sưu tập biên tập." />
      ) : (
        <ol className="divide-y divide-zinc-100">
          {list.map((r, i) => (
            <li
              key={r.id}
              draggable
              onDragStart={(e) => {
                setDragIdx(i);
                e.dataTransfer.effectAllowed = "move";
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setOverIdx(i);
              }}
              onDragEnd={() => {
                setDragIdx(null);
                setOverIdx(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragIdx !== null) void reorder(dragIdx, i);
                setDragIdx(null);
                setOverIdx(null);
              }}
              className={cn(
                "flex items-center gap-2 px-2 py-2 sm:px-3",
                dragIdx === i && "opacity-40",
                overIdx === i && dragIdx !== null && dragIdx !== i && "bg-indigo-50 shadow-[inset_0_2px_0_0_var(--color-indigo-500)]",
                !r.isActive && "bg-zinc-50/70",
              )}
              data-testid="home-row"
            >
              <GripVertical className="hidden size-4 shrink-0 cursor-grab text-zinc-300 sm:block" aria-hidden />
              <span className="w-5 text-right text-xs text-zinc-400 tabular-nums">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <p className={cn("truncate text-[13px] font-medium", r.isActive ? "text-zinc-900" : "text-zinc-400")}>{r.title}</p>
                <p className="flex flex-wrap items-center gap-1.5 text-xs text-zinc-500">
                  <Badge tone={r.kind === "COLLECTION" ? "violet" : r.kind === "GENRE" ? "blue" : "neutral"}>{KIND_LABEL[r.kind]}</Badge>
                  <span className="truncate">{detail(r)}</span>
                </p>
              </div>
              <Switch checked={r.isActive} onChange={() => toggle(r)} label={`Bật hàng ${r.title}`} />
              <div className="flex items-center">
                <Button size="icon" variant="ghost" disabled={i === 0} onClick={() => reorder(i, i - 1)} aria-label="Lên">
                  <ArrowUp className="size-4" />
                </Button>
                <Button size="icon" variant="ghost" disabled={i === list.length - 1} onClick={() => reorder(i, i + 1)} aria-label="Xuống">
                  <ArrowDown className="size-4" />
                </Button>
                <Button size="icon" variant="ghost" onClick={() => setEditing(r)} aria-label="Sửa">
                  <Pencil className="size-3.5" />
                </Button>
                <Button size="icon" variant="ghost" className="text-red-600 hover:bg-red-50" onClick={() => remove(r)} aria-label="Xoá">
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            </li>
          ))}
        </ol>
      )}
      {editing ? <HomeRowDialog row={editing === "new" ? null : editing} collections={collections.data ?? []} onClose={() => setEditing(null)} /> : null}
    </Card>
  );
}

function HomeRowDialog({ row, collections, onClose }: { row: HomeRowDto | null; collections: CollectionDto[]; onClose: () => void }) {
  const qc = useQueryClient();
  const genres = useGenres();
  const { toast, toastError } = useFeedback();
  const [kind, setKind] = useState<HomeRowKind>(row?.kind ?? "TRENDING");
  const [title, setTitle] = useState(row?.title ?? KIND_DEFAULT_TITLE.TRENDING);
  const [collectionId, setCollectionId] = useState(row?.collectionId ?? "");
  const [genreId, setGenreId] = useState(row?.genreId ?? "");
  const [titleType, setTitleType] = useState<TitleType | "">(row?.titleType ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const onKind = (k: HomeRowKind) => {
    if (!title || title === KIND_DEFAULT_TITLE[kind]) setTitle(KIND_DEFAULT_TITLE[k]);
    setKind(k);
  };

  const submit = async () => {
    const e: Record<string, string> = {};
    if (!title.trim()) e.title = "Bắt buộc nhập tiêu đề";
    if (kind === "COLLECTION" && !collectionId) e.collectionId = "Chọn bộ sưu tập";
    if (kind === "GENRE" && !genreId) e.genreId = "Chọn thể loại";
    setErrors(e);
    if (Object.keys(e).length) return;
    const body: HomeRowInput = {
      kind,
      title: title.trim(),
      collectionId: kind === "COLLECTION" ? collectionId : null,
      genreId: kind === "GENRE" ? genreId : null,
      titleType: titleType || null,
      ...(row ? {} : { isActive: true }),
    };
    setBusy(true);
    try {
      if (row) await adminApi.updateHomeRow(row.id, body);
      else await adminApi.createHomeRow(body);
      await qc.invalidateQueries({ queryKey: qk.homeRows });
      toast("success", row ? "Đã lưu hàng" : "Đã thêm hàng", body.title);
      onClose();
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={row ? "Sửa hàng phim" : "Thêm hàng phim"}
      footer={
        <>
          <Button onClick={onClose}>Huỷ</Button>
          <Button variant="primary" onClick={submit} loading={busy}>
            {row ? "Lưu" : "Thêm"}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Loại hàng">
          <Select value={kind} onChange={(e) => onKind(e.target.value as HomeRowKind)} aria-label="Loại hàng">
            {(Object.keys(KIND_LABEL) as HomeRowKind[]).map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Giới hạn loại phim">
          <Select value={titleType} onChange={(e) => setTitleType(e.target.value as TitleType | "")} aria-label="Giới hạn loại phim">
            <option value="">Tất cả</option>
            <option value="MOVIE">Chỉ phim lẻ</option>
            <option value="SERIES">Chỉ phim bộ</option>
          </Select>
        </Field>
        <Field label="Tiêu đề hiển thị" error={errors.title} className="sm:col-span-2">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} aria-invalid={!!errors.title} aria-label="Tiêu đề hiển thị" />
        </Field>
        {kind === "COLLECTION" ? (
          <Field label="Bộ sưu tập" error={errors.collectionId} className="sm:col-span-2" hint={collections.length ? undefined : "Chưa có bộ sưu tập — tạo ở tab Bộ sưu tập."}>
            <Select value={collectionId} onChange={(e) => setCollectionId(e.target.value)} aria-label="Bộ sưu tập">
              <option value="">— Chọn —</option>
              {collections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.titles.length})
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        {kind === "GENRE" ? (
          <Field label="Thể loại" error={errors.genreId} className="sm:col-span-2">
            <Select value={genreId} onChange={(e) => setGenreId(e.target.value)} aria-label="Thể loại">
              <option value="">— Chọn —</option>
              {(genres.data ?? []).map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
      </div>
    </Dialog>
  );
}

// ───────── Title picker dùng chung ─────────
function TitleSearchList({ onPick, excludeIds = [], publishedOnly }: { onPick: (t: { id: string; name: string; posterUrl: string | null }) => void; excludeIds?: string[]; publishedOnly?: boolean }) {
  const [q, setQ] = useState("");
  const dq = useDebounced(q);
  const titles = useTitles({ q: dq, status: publishedOnly ? "PUBLISHED" : "", type: "", page: 1 });
  const items = (titles.data?.items ?? []).filter((t) => !excludeIds.includes(t.id));
  return (
    <div className="flex min-h-0 flex-col rounded-md border border-zinc-200">
      <div className="relative border-b border-zinc-200">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-zinc-400" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm phim để thêm…" aria-label="Tìm phim để thêm" className="h-9 w-full rounded-t-md pr-2 pl-8 text-[13px] focus:outline-none" />
      </div>
      <ul className="max-h-64 overflow-y-auto">
        {titles.isError ? (
          <li className="p-3 text-xs text-red-600">Không tải được danh sách phim.</li>
        ) : !titles.data ? (
          <li className="p-3">
            <Skeleton className="h-6" />
          </li>
        ) : items.length === 0 ? (
          <li className="p-3 text-xs text-zinc-500">Không có phim phù hợp.</li>
        ) : (
          items.map((t) => {
            const poster = t.images.find((i) => i.kind === "POSTER")?.url ?? null;
            return (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => onPick({ id: t.id, name: t.name, posterUrl: poster })}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] hover:bg-zinc-50"
                >
                  <Plus className="size-3.5 text-zinc-400" />
                  <span className="min-w-0 flex-1 truncate">{t.name}</span>
                  {t.status !== "PUBLISHED" ? <Badge tone="amber">Nháp</Badge> : null}
                </button>
              </li>
            );
          })
        )}
      </ul>
    </div>
  );
}

// ───────── Collections ─────────
function CollectionsPanel() {
  const qc = useQueryClient();
  const collections = useCollections();
  const { toast, toastError, confirm } = useFeedback();
  const [editing, setEditing] = useState<CollectionDto | "new" | null>(null);

  const remove = async (c: CollectionDto) => {
    if (!(await confirm({ title: `Xoá bộ sưu tập “${c.name}”?`, description: "Các hàng trang chủ dùng bộ sưu tập này sẽ không còn nội dung.", confirmLabel: "Xoá", danger: true }))) return;
    try {
      await adminApi.deleteCollection(c.id);
      qc.setQueryData<CollectionDto[]>(qk.collections, (d) => d?.filter((x) => x.id !== c.id));
      toast("success", "Đã xoá bộ sưu tập");
    } catch (e) {
      toastError(e);
    }
  };

  return (
    <Card
      title={`Bộ sưu tập (${collections.data?.length ?? 0})`}
      actions={
        <Button size="sm" variant="primary" onClick={() => setEditing("new")}>
          <Plus className="size-3.5" /> Tạo bộ sưu tập
        </Button>
      }
    >
      {collections.isError ? (
        <ErrorState error={collections.error} onRetry={() => collections.refetch()} />
      ) : !collections.data ? (
        <div className="space-y-2 p-3">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </div>
      ) : collections.data.length === 0 ? (
        <EmptyState title="Chưa có bộ sưu tập" description="Bộ sưu tập là danh sách phim do biên tập viên chọn, dùng cho hàng trang chủ." />
      ) : (
        <ul className="divide-y divide-zinc-100">
          {collections.data.map((c) => (
            <li key={c.id} className="flex items-center gap-3 px-3 py-2.5">
              <div className="flex -space-x-3">
                {c.titles.slice(0, 4).map((t) =>
                  t.posterUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={t.id} src={t.posterUrl} alt="" className="h-12 w-8 rounded border-2 border-white object-cover shadow-sm" />
                  ) : (
                    <div key={t.id} className="h-12 w-8 rounded border-2 border-white bg-zinc-200" />
                  ),
                )}
                {c.titles.length === 0 ? <div className="h-12 w-8 rounded border border-dashed border-zinc-300" /> : null}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium text-zinc-900">{c.name}</p>
                <p className="truncate text-xs text-zinc-500">
                  {c.slug} · {c.titles.length} phim
                </p>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setEditing(c)}>
                <Pencil className="size-3.5" /> Sửa
              </Button>
              <Button size="icon" variant="ghost" className="text-red-600 hover:bg-red-50" onClick={() => remove(c)} aria-label={`Xoá ${c.name}`}>
                <Trash2 className="size-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      {editing ? <CollectionDialog collection={editing === "new" ? null : editing} onClose={() => setEditing(null)} /> : null}
    </Card>
  );
}

function CollectionDialog({ collection, onClose }: { collection: CollectionDto | null; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast, toastError } = useFeedback();
  const [name, setName] = useState(collection?.name ?? "");
  const [slug, setSlug] = useState(collection?.slug ?? "");
  const [titles, setTitles] = useState(collection?.titles ?? []);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = "Bắt buộc";
    if (slug.trim() && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug.trim())) e.slug = "Chỉ a-z, 0-9 và dấu gạch ngang";
    setErrors(e);
    if (Object.keys(e).length) return;
    const body = { name: name.trim(), ...(slug.trim() ? { slug: slug.trim() } : {}), titleIds: titles.map((t) => t.id) };
    setBusy(true);
    try {
      if (collection) await adminApi.updateCollection(collection.id, body);
      else await adminApi.createCollection(body);
      await qc.invalidateQueries({ queryKey: qk.collections });
      toast("success", collection ? "Đã lưu bộ sưu tập" : "Đã tạo bộ sưu tập", body.name);
      onClose();
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      size="xl"
      title={collection ? `Sửa “${collection.name}”` : "Tạo bộ sưu tập"}
      footer={
        <>
          <Button onClick={onClose}>Huỷ</Button>
          <Button variant="primary" onClick={submit} loading={busy}>
            {collection ? "Lưu" : "Tạo"}
          </Button>
        </>
      }
    >
      <div className="mb-4 grid gap-4 sm:grid-cols-2">
        <Field label="Tên" error={errors.name}>
          <Input value={name} onChange={(e) => setName(e.target.value)} aria-invalid={!!errors.name} aria-label="Tên bộ sưu tập" />
        </Field>
        <Field label="Slug" error={errors.slug} hint="Để trống để tự tạo">
          <Input value={slug} onChange={(e) => setSlug(e.target.value)} aria-invalid={!!errors.slug} aria-label="Slug bộ sưu tập" />
        </Field>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <TitleSearchList onPick={(t) => setTitles((x) => [...x, t])} excludeIds={titles.map((t) => t.id)} />
        <div className="rounded-md border border-zinc-200">
          <p className="border-b border-zinc-200 px-3 py-2 text-xs font-medium text-zinc-600">Đã chọn ({titles.length}) — theo thứ tự hiển thị</p>
          {titles.length === 0 ? (
            <p className="p-3 text-xs text-zinc-500">Chưa có phim nào.</p>
          ) : (
            <ol className="max-h-64 divide-y divide-zinc-100 overflow-y-auto">
              {titles.map((t, i) => (
                <li key={t.id} className="flex items-center gap-1 px-2 py-1 text-[13px]">
                  <span className="w-5 text-right text-xs text-zinc-400 tabular-nums">{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate px-1">{t.name}</span>
                  <Button size="icon" variant="ghost" disabled={i === 0} onClick={() => setTitles((x) => moveItem(x, i, i - 1))} aria-label="Lên">
                    <ArrowUp className="size-3.5" />
                  </Button>
                  <Button size="icon" variant="ghost" disabled={i === titles.length - 1} onClick={() => setTitles((x) => moveItem(x, i, i + 1))} aria-label="Xuống">
                    <ArrowDown className="size-3.5" />
                  </Button>
                  <Button size="icon" variant="ghost" onClick={() => setTitles((x) => x.filter((y) => y.id !== t.id))} aria-label={`Bỏ ${t.name}`}>
                    <X className="size-3.5" />
                  </Button>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </Dialog>
  );
}

// ───────── Billboards ─────────
function BillboardsPanel() {
  const qc = useQueryClient();
  const billboards = useBillboards();
  const { toast, toastError, confirm } = useFeedback();
  const [adding, setAdding] = useState(false);
  const list = [...(billboards.data ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);

  const add = async (titleId: string) => {
    try {
      const b = await adminApi.createBillboard(titleId);
      qc.setQueryData<BillboardDto[]>(qk.billboards, (d) => (d ? [...d, b] : [b]));
      toast("success", "Đã thêm billboard", b.titleName);
      setAdding(false);
    } catch (e) {
      toastError(e);
    }
  };
  const remove = async (b: BillboardDto) => {
    if (!(await confirm({ title: `Gỡ billboard “${b.titleName}”?`, confirmLabel: "Gỡ", danger: true }))) return;
    try {
      await adminApi.deleteBillboard(b.id);
      qc.setQueryData<BillboardDto[]>(qk.billboards, (d) => d?.filter((x) => x.id !== b.id));
      toast("success", "Đã gỡ billboard");
    } catch (e) {
      toastError(e);
    }
  };

  return (
    <Card
      title={`Billboard (${list.length})`}
      actions={
        <Button size="sm" variant="primary" onClick={() => setAdding(true)}>
          <Plus className="size-3.5" /> Thêm billboard
        </Button>
      }
    >
      {billboards.isError ? (
        <ErrorState error={billboards.error} onRetry={() => billboards.refetch()} />
      ) : !billboards.data ? (
        <div className="grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="aspect-video" />
          ))}
        </div>
      ) : list.length === 0 ? (
        <EmptyState title="Chưa có billboard" description="Billboard là phim nổi bật ở đầu trang chủ. Nếu trống, hệ thống tự chọn." />
      ) : (
        <ul className="grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((b) => (
            <li key={b.id} className="group relative overflow-hidden rounded-lg border border-zinc-200 bg-zinc-900">
              {b.backdropUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={b.backdropUrl} alt="" className="aspect-video w-full object-cover opacity-90" />
              ) : (
                <div className="flex aspect-video items-center justify-center text-zinc-600">
                  <ImageOff className="size-6" />
                </div>
              )}
              <div className="absolute inset-x-0 bottom-0 flex items-center gap-2 bg-gradient-to-t from-black/85 to-transparent px-3 pt-8 pb-2">
                <p className="min-w-0 flex-1 truncate text-[13px] font-semibold text-white">{b.titleName}</p>
                {!b.isActive ? <Badge tone="amber">Tắt</Badge> : null}
                <button onClick={() => remove(b)} className="rounded bg-white/10 p-1.5 text-white hover:bg-red-600" aria-label={`Gỡ ${b.titleName}`}>
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {adding ? (
        <Dialog open onOpenChange={setAdding} title="Thêm billboard" description="Chỉ nên chọn phim đã xuất bản và có backdrop chất lượng cao.">
          <TitleSearchList publishedOnly onPick={(t) => void add(t.id)} excludeIds={list.map((b) => b.titleId)} />
        </Dialog>
      ) : null}
    </Card>
  );
}
