"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Ban, CalendarPlus, CheckCircle2, MoreHorizontal, Search, Shield, ShieldOff, XCircle } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import type { AdminUser, Paginated, SubscriptionDto, UserRole } from "@app/shared";
import { api } from "@/lib/api/client";
import { formatDate, formatPrice } from "../lib/format";
import { useDebounced } from "../lib/hooks";
import { qk, useMe, usePlans, useUsers } from "../lib/queries";
import { fieldErrors, grantFormSchema, grantParsed, type GrantFormValues } from "../lib/schemas";
import { Dialog } from "../ui/dialog";
import { useFeedback } from "../ui/feedback";
import { Badge, Button, Card, EmptyState, ErrorState, Field, Input, PageHeader, Pagination, Select, Spinner, Textarea, Toolbar } from "../ui/primitives";
import { FullRow, SkeletonRows, Table, Td, Th, THead, Tr } from "../ui/table";
import { SubscriptionBadge } from "../ui/status";

export function UsersSection() {
  const qc = useQueryClient();
  const me = useMe();
  const { toast, toastError, confirm } = useFeedback();
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [grantFor, setGrantFor] = useState<AdminUser | null>(null);
  const dq = useDebounced(q);
  const filters = { q: dq, page };
  const users = useUsers(filters);

  const patchLocal = (id: string, fn: (u: AdminUser) => AdminUser) =>
    qc.setQueryData<Paginated<AdminUser>>(qk.users(filters), (d) => (d ? { ...d, items: d.items.map((u) => (u.id === id ? fn(u) : u)) } : d));

  const patchUser = async (u: AdminUser, body: { disabled?: boolean; role?: UserRole }, okMsg: string) => {
    const prev = qc.getQueryData<Paginated<AdminUser>>(qk.users(filters));
    patchLocal(u.id, (x) => ({ ...x, ...body })); // lạc quan
    try {
      const updated = await api<AdminUser>(`/admin/users/${u.id}`, { method: "PATCH", body });
      patchLocal(u.id, () => updated);
      toast("success", okMsg, u.email);
    } catch (e) {
      if (prev) qc.setQueryData(qk.users(filters), prev);
      toastError(e);
    }
  };

  const toggleDisabled = async (u: AdminUser) => {
    if (!u.disabled) {
      const ok = await confirm({
        title: `Vô hiệu hoá ${u.email}?`,
        description: "Người dùng sẽ bị đăng xuất khỏi mọi thiết bị và không thể đăng nhập cho tới khi được kích hoạt lại.",
        confirmLabel: "Vô hiệu hoá",
        danger: true,
      });
      if (!ok) return;
    }
    await patchUser(u, { disabled: !u.disabled }, u.disabled ? "Đã kích hoạt lại tài khoản" : "Đã vô hiệu hoá tài khoản");
  };

  const toggleRole = async (u: AdminUser) => {
    const role: UserRole = u.role === "ADMIN" ? "USER" : "ADMIN";
    const ok = await confirm({
      title: role === "ADMIN" ? `Cấp quyền quản trị cho ${u.email}?` : `Thu hồi quyền quản trị của ${u.email}?`,
      description: role === "ADMIN" ? "Tài khoản này sẽ truy cập được toàn bộ trang quản trị." : undefined,
      confirmLabel: role === "ADMIN" ? "Cấp quyền" : "Thu hồi",
      danger: role === "USER",
    });
    if (ok) await patchUser(u, { role }, "Đã đổi vai trò");
  };

  const revoke = async (u: AdminUser) => {
    const ok = await confirm({
      title: `Thu hồi gói của ${u.email}?`,
      description: "Thuê bao sẽ kết thúc ngay, các phiên đang xem sẽ bị dừng.",
      confirmLabel: "Thu hồi gói",
      danger: true,
    });
    if (!ok) return;
    try {
      await api(`/admin/users/${u.id}/subscription`, { method: "DELETE" });
      patchLocal(u.id, (x) => ({ ...x, subscription: x.subscription ? { ...x.subscription, status: "CANCELED" } : null }));
      toast("success", "Đã thu hồi thuê bao", u.email);
      void qc.invalidateQueries({ queryKey: qk.usersAll });
      void qc.invalidateQueries({ queryKey: qk.stats });
    } catch (e) {
      toastError(e, "Không thu hồi được");
    }
  };

  const cols = 7;
  return (
    <>
      <PageHeader title="Người dùng" description="Tài khoản, thuê bao và quyền truy cập." />
      <Card>
        <Toolbar>
          <div className="relative min-w-0 flex-1 basis-56">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-zinc-400" />
            <Input
              placeholder="Tìm theo email…"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(1);
              }}
              className="pl-8"
              aria-label="Tìm người dùng"
            />
          </div>
          {users.isFetching && users.data ? <Spinner /> : null}
        </Toolbar>
        <Table minWidth={860}>
          <THead>
            <Th className="w-[28%]">Email</Th>
            <Th>Vai trò</Th>
            <Th>Trạng thái</Th>
            <Th>Thuê bao</Th>
            <Th className="text-right">Hồ sơ</Th>
            <Th>Ngày tạo</Th>
            <Th className="text-right">
              <span className="sr-only">Hành động</span>
            </Th>
          </THead>
          {users.isError ? (
            <FullRow cols={cols}>
              <ErrorState error={users.error} onRetry={() => users.refetch()} />
            </FullRow>
          ) : !users.data ? (
            <SkeletonRows cols={cols} />
          ) : users.data.items.length === 0 ? (
            <FullRow cols={cols}>
              <EmptyState title="Không có người dùng phù hợp" />
            </FullRow>
          ) : (
            <tbody>
              {users.data.items.map((u) => {
                const self = me.data?.user.id === u.id;
                return (
                  <Tr key={u.id} className={u.disabled ? "bg-zinc-50/80 text-zinc-500" : undefined}>
                    <Td className="max-w-0">
                      <p className="truncate font-medium text-zinc-900" title={u.email}>
                        {u.email}
                        {self ? <span className="ml-1.5 text-xs font-normal text-zinc-400">(bạn)</span> : null}
                      </p>
                      {!u.emailVerified ? <p className="text-[11px] text-amber-700">Chưa xác thực email</p> : null}
                    </Td>
                    <Td className="whitespace-nowrap">{u.role === "ADMIN" ? <Badge tone="violet">Admin</Badge> : <span className="text-xs text-zinc-600">Người dùng</span>}</Td>
                    <Td>{u.disabled ? <Badge tone="red">Vô hiệu</Badge> : <Badge tone="green">Hoạt động</Badge>}</Td>
                    <Td>
                      <SubscriptionBadge sub={u.subscription} />
                    </Td>
                    <Td className="text-right tabular-nums">{u.profileCount}</Td>
                    <Td className="text-xs whitespace-nowrap">{formatDate(u.createdAt)}</Td>
                    <Td className="text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1">
                        <Button size="sm" onClick={() => setGrantFor(u)}>
                          <CalendarPlus className="size-3.5" /> {u.subscription?.status === "ACTIVE" ? "Gia hạn" : "Cấp gói"}
                        </Button>
                        <RowMenu
                          user={u}
                          self={self}
                          onRevoke={() => revoke(u)}
                          onToggleDisabled={() => toggleDisabled(u)}
                          onToggleRole={() => toggleRole(u)}
                        />
                      </div>
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          )}
        </Table>
        {users.data && users.data.total > 0 ? <Pagination {...users.data} onPage={setPage} /> : null}
      </Card>
      {grantFor ? (
        <GrantDialog
          user={grantFor}
          onClose={() => setGrantFor(null)}
          onGranted={(sub) => {
            patchLocal(grantFor.id, (x) => ({ ...x, subscription: sub }));
            void qc.invalidateQueries({ queryKey: qk.usersAll });
            void qc.invalidateQueries({ queryKey: qk.stats });
          }}
        />
      ) : null}
    </>
  );
}

function RowMenu({ user, self, onRevoke, onToggleDisabled, onToggleRole }: { user: AdminUser; self: boolean; onRevoke: () => void; onToggleDisabled: () => void; onToggleRole: () => void }) {
  const item = "flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-[13px] outline-none data-[disabled]:cursor-not-allowed data-[disabled]:opacity-40 data-[highlighted]:bg-zinc-100";
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <Button size="icon" variant="ghost" aria-label={`Thao tác khác cho ${user.email}`}>
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={4} className="admin-root z-50 min-w-48 rounded-md border border-zinc-200 bg-white p-1 text-zinc-800 shadow-lg">
          <DropdownMenu.Item className={`${item} text-red-600`} disabled={user.subscription?.status !== "ACTIVE"} onSelect={onRevoke}>
            <XCircle className="size-4" /> Thu hồi thuê bao
          </DropdownMenu.Item>
          <DropdownMenu.Item className={item} disabled={self} onSelect={onToggleRole}>
            {user.role === "ADMIN" ? <ShieldOff className="size-4" /> : <Shield className="size-4" />}
            {user.role === "ADMIN" ? "Bỏ quyền admin" : "Cấp quyền admin"}
          </DropdownMenu.Item>
          <DropdownMenu.Separator className="my-1 h-px bg-zinc-100" />
          <DropdownMenu.Item className={`${item} ${user.disabled ? "" : "text-red-600"}`} disabled={self} onSelect={onToggleDisabled}>
            {user.disabled ? <CheckCircle2 className="size-4" /> : <Ban className="size-4" />}
            {user.disabled ? "Kích hoạt lại" : "Vô hiệu hoá"}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function GrantDialog({ user, onClose, onGranted }: { user: AdminUser; onClose: () => void; onGranted: (s: SubscriptionDto) => void }) {
  const plans = usePlans();
  const { toast, toastError } = useFeedback();
  const active = (plans.data ?? []).filter((p) => p.isActive).sort((a, b) => a.sortOrder - b.sortOrder);
  const [v, setV] = useState<GrantFormValues>({ planCode: user.subscription?.plan.code ?? "", months: "1", note: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const planCode = v.planCode || active[0]?.code || "";
  const plan = active.find((p) => p.code === planCode);
  const extending = user.subscription?.status === "ACTIVE";

  const submit = async () => {
    const r = grantFormSchema.safeParse({ ...v, planCode });
    if (!r.success) {
      setErrors(fieldErrors(r.error));
      return;
    }
    setBusy(true);
    try {
      const sub = await api<SubscriptionDto>(`/admin/users/${user.id}/subscription`, { method: "POST", body: grantParsed(r.data) });
      onGranted(sub);
      toast("success", extending ? "Đã gia hạn thuê bao" : "Đã cấp thuê bao", `${user.email} · ${sub.plan.name} đến ${formatDate(sub.currentPeriodEnd)}`);
      onClose();
    } catch (e) {
      toastError(e, "Không cấp được thuê bao");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={extending ? "Gia hạn thuê bao" : "Cấp thuê bao"}
      description={user.email}
      footer={
        <>
          <Button onClick={onClose}>Huỷ</Button>
          <Button variant="primary" onClick={submit} loading={busy} disabled={!active.length}>
            {extending ? "Gia hạn" : "Cấp gói"}
          </Button>
        </>
      }
    >
      {user.subscription ? (
        <div className="mb-4 rounded-md bg-zinc-50 px-3 py-2 text-xs text-zinc-600">
          Hiện tại: <SubscriptionBadge sub={user.subscription} />
        </div>
      ) : null}
      {plans.isError ? (
        <ErrorState error={plans.error} compact onRetry={() => plans.refetch()} />
      ) : plans.isPending ? (
        <Spinner />
      ) : (
        <div className="grid gap-4 sm:grid-cols-[1fr_120px]">
          <Field label="Gói cước" error={errors.planCode}>
            <Select value={planCode} onChange={(e) => setV({ ...v, planCode: e.target.value })} aria-label="Gói cước">
              {active.map((p) => (
                <option key={p.id} value={p.code}>
                  {p.name} — {formatPrice(p.priceAmount, p.currency)}/{p.intervalMonths > 1 ? `${p.intervalMonths} tháng` : "tháng"}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Số tháng" error={errors.months}>
            <Input inputMode="numeric" value={v.months} onChange={(e) => setV({ ...v, months: e.target.value })} aria-invalid={!!errors.months} aria-label="Số tháng" />
          </Field>
          {plan ? (
            <p className="text-xs text-zinc-500 sm:col-span-2">
              Tối đa {plan.maxHeight}p · {plan.maxConcurrentStreams} luồng đồng thời · {plan.maxProfiles} hồ sơ
              {extending ? " · thời hạn được cộng thêm vào kỳ hiện tại" : ""}
            </p>
          ) : null}
          <Field label="Ghi chú (tuỳ chọn)" error={errors.note} className="sm:col-span-2" hint="VD: đã chuyển khoản ngày …, mã giao dịch …">
            <Textarea rows={2} value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} />
          </Field>
        </div>
      )}
    </Dialog>
  );
}
