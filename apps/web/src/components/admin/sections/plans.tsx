"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus } from "lucide-react";
import type { PlanDto } from "@app/shared";
import { formatPrice } from "../lib/format";
import { adminApi, qk, usePlans } from "../lib/queries";
import { fieldErrors, planFormSchema, planParsedToInput, planToForm, type PlanFormValues } from "../lib/schemas";
import { Dialog } from "../ui/dialog";
import { useFeedback } from "../ui/feedback";
import { Badge, Button, Card, EmptyState, ErrorState, Field, Input, PageHeader, Select, Switch, Textarea } from "../ui/primitives";
import { FullRow, SkeletonRows, Table, Td, Th, THead, Tr } from "../ui/table";

export function PlansSection() {
  const qc = useQueryClient();
  const plans = usePlans();
  const { toast, toastError } = useFeedback();
  const [editing, setEditing] = useState<PlanDto | "new" | null>(null);
  const list = [...(plans.data ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);

  const toggleActive = async (p: PlanDto) => {
    const prev = qc.getQueryData<PlanDto[]>(qk.plans);
    qc.setQueryData<PlanDto[]>(qk.plans, (d) => d?.map((x) => (x.id === p.id ? { ...x, isActive: !p.isActive } : x)));
    try {
      await adminApi.updatePlan(p.id, { isActive: !p.isActive });
      toast("success", p.isActive ? "Đã ẩn gói" : "Đã bật gói", p.name);
    } catch (e) {
      qc.setQueryData(qk.plans, prev);
      toastError(e);
    }
  };

  const cols = 8;
  return (
    <>
      <PageHeader
        title="Gói cước"
        description="Giá, chất lượng tối đa, số luồng và số hồ sơ của từng gói."
        actions={
          <Button variant="primary" onClick={() => setEditing("new")}>
            <Plus className="size-4" /> Tạo gói
          </Button>
        }
      />
      <Card>
        <Table minWidth={820}>
          <THead>
            <Th className="w-[26%]">Gói</Th>
            <Th className="text-right">Giá</Th>
            <Th>Chu kỳ</Th>
            <Th>Chất lượng</Th>
            <Th className="text-right">Luồng</Th>
            <Th className="text-right">Hồ sơ</Th>
            <Th>Hiển thị</Th>
            <Th className="text-right">
              <span className="sr-only">Hành động</span>
            </Th>
          </THead>
          {plans.isError ? (
            <FullRow cols={cols}>
              <ErrorState error={plans.error} onRetry={() => plans.refetch()} />
            </FullRow>
          ) : !plans.data ? (
            <SkeletonRows cols={cols} rows={3} />
          ) : list.length === 0 ? (
            <FullRow cols={cols}>
              <EmptyState title="Chưa có gói cước" action={<Button onClick={() => setEditing("new")}>Tạo gói đầu tiên</Button>} />
            </FullRow>
          ) : (
            <tbody>
              {list.map((p) => (
                <Tr key={p.id} className={p.isActive ? undefined : "text-zinc-400"}>
                  <Td>
                    <p className="font-medium text-zinc-900">
                      {p.name} <span className="ml-1 font-mono text-[11px] font-normal text-zinc-400">{p.code}</span>
                    </p>
                    {p.description ? <p className="truncate text-xs text-zinc-500">{p.description}</p> : null}
                  </Td>
                  <Td className="text-right font-medium tabular-nums whitespace-nowrap">{formatPrice(p.priceAmount, p.currency)}</Td>
                  <Td className="whitespace-nowrap">{p.intervalMonths} tháng</Td>
                  <Td>
                    <Badge tone={p.maxHeight >= 1080 ? "violet" : "neutral"}>{p.maxHeight >= 2160 ? "4K" : `${p.maxHeight}p`}</Badge>
                  </Td>
                  <Td className="text-right tabular-nums">{p.maxConcurrentStreams}</Td>
                  <Td className="text-right tabular-nums">{p.maxProfiles}</Td>
                  <Td>
                    <Switch checked={p.isActive} onChange={() => toggleActive(p)} label={`Hiển thị gói ${p.name}`} />
                  </Td>
                  <Td className="text-right">
                    <Button size="sm" variant="ghost" onClick={() => setEditing(p)}>
                      <Pencil className="size-3.5" /> Sửa
                    </Button>
                  </Td>
                </Tr>
              ))}
            </tbody>
          )}
        </Table>
      </Card>
      {editing ? <PlanDialog plan={editing === "new" ? null : editing} nextSort={list.length} onClose={() => setEditing(null)} /> : null}
    </>
  );
}

function PlanDialog({ plan, nextSort, onClose }: { plan: PlanDto | null; nextSort: number; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast, toastError } = useFeedback();
  const [v, setV] = useState<PlanFormValues>(() => ({ ...planToForm(plan), ...(plan ? {} : { sortOrder: String(nextSort) }) }));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof PlanFormValues>(k: K, val: PlanFormValues[K]) => setV((p) => ({ ...p, [k]: val }));

  const submit = async () => {
    const r = planFormSchema.safeParse(v);
    if (!r.success) {
      setErrors(fieldErrors(r.error));
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const input = planParsedToInput(r.data);
      const saved = plan ? await adminApi.updatePlan(plan.id, input) : await adminApi.createPlan(input);
      qc.setQueryData<PlanDto[]>(qk.plans, (d) => (d ? (plan ? d.map((x) => (x.id === saved.id ? saved : x)) : [...d, saved]) : d));
      void qc.invalidateQueries({ queryKey: qk.plans });
      toast("success", plan ? "Đã lưu gói" : "Đã tạo gói", saved.name);
      onClose();
    } catch (e) {
      toastError(e, "Không lưu được gói");
    } finally {
      setBusy(false);
    }
  };

  const num = (k: keyof PlanFormValues, label: string, hint?: string) => (
    <Field label={label} error={errors[k]} hint={hint}>
      <Input inputMode="numeric" value={v[k] as string} onChange={(e) => set(k, e.target.value as never)} aria-invalid={!!errors[k]} aria-label={label} />
    </Field>
  );

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      size="lg"
      title={plan ? `Sửa gói “${plan.name}”` : "Tạo gói cước"}
      footer={
        <>
          <Button onClick={onClose}>Huỷ</Button>
          <Button variant="primary" onClick={submit} loading={busy}>
            {plan ? "Lưu" : "Tạo gói"}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Tên gói" error={errors.name} className="sm:col-span-2">
          <Input value={v.name} onChange={(e) => set("name", e.target.value)} aria-invalid={!!errors.name} aria-label="Tên gói" />
        </Field>
        <Field label="Mã (code)" error={errors.code} hint={plan ? "Đổi mã có thể ảnh hưởng tích hợp" : undefined}>
          <Input value={v.code} onChange={(e) => set("code", e.target.value)} aria-invalid={!!errors.code} aria-label="Mã gói" className="font-mono" />
        </Field>
        <Field label="Mô tả" className="sm:col-span-3">
          <Textarea rows={2} value={v.description} onChange={(e) => set("description", e.target.value)} />
        </Field>
        {num("priceAmount", "Giá")}
        <Field label="Tiền tệ" error={errors.currency}>
          <Input value={v.currency} onChange={(e) => set("currency", e.target.value.toUpperCase())} aria-invalid={!!errors.currency} aria-label="Tiền tệ" />
        </Field>
        {num("intervalMonths", "Chu kỳ (tháng)")}
        <Field label="Chất lượng tối đa">
          <Select value={v.maxHeight} onChange={(e) => set("maxHeight", e.target.value as PlanFormValues["maxHeight"])} aria-label="Chất lượng tối đa">
            <option value="480">480p (SD)</option>
            <option value="720">720p (HD)</option>
            <option value="1080">1080p (Full HD)</option>
            <option value="2160">2160p (4K)</option>
          </Select>
        </Field>
        {num("maxConcurrentStreams", "Luồng đồng thời")}
        {num("maxProfiles", "Số hồ sơ")}
        {num("sortOrder", "Thứ tự hiển thị")}
        <div className="flex items-end gap-2 pb-2 sm:col-span-2">
          <Switch checked={v.isActive} onChange={(x) => set("isActive", x)} label="Hiển thị cho khách" />
          <span className="text-[13px] text-zinc-700">Hiển thị trên trang chọn gói</span>
        </div>
      </div>
    </Dialog>
  );
}
