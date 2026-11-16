"use client";

import type { ProfileDto } from "@app/shared";
import { Check, Pencil, Plus } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Switch } from "radix-ui";
import { useEffect, useState, type FormEvent } from "react";
import { ErrorPanel } from "@/components/browse/state-panels";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { FloatingInput } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { errorMessage } from "@/lib/api/messages";
import { setAuthHint } from "@/lib/auth-hint";
import { useAvatars, useDeleteProfile, useMe, useProfiles, useSaveProfile, useSelectProfile } from "@/lib/queries";
import { toast } from "@/lib/toast";
import { cn, safeNextPath } from "@/lib/utils";
import { avatarSrc, ProfileAvatar } from "./profile-avatar";

const TILE = "w-[clamp(5.5rem,10vw,10rem)]";

export function ProfileGate() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNextPath(params.get("next"), "/browse");
  const { data: profiles, isPending, error, refetch } = useProfiles();
  const { data: me } = useMe();
  const select = useSelectProfile();
  const [manage, setManage] = useState(params.has("manage"));
  const [editing, setEditing] = useState<ProfileDto | "new" | null>(null);
  const [entering, setEntering] = useState<ProfileDto | null>(null);

  useEffect(() => setAuthHint(), []);

  const maxProfiles = me?.subscription?.status === "ACTIVE" ? me.subscription.plan.maxProfiles : 5;
  const canAdd = (profiles?.length ?? 0) < maxProfiles;

  const choose = (p: ProfileDto) => {
    if (manage) return setEditing(p);
    setEntering(p);
    select.mutate(p.id, {
      onSuccess: () => router.replace(next),
      onError: (e) => {
        setEntering(null);
        toast({ message: errorMessage(e), tone: "error" });
      },
    });
  };

  if (entering) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-8" role="status" aria-label={`Đang vào hồ sơ ${entering.name}`}>
        <div className="relative">
          <ProfileAvatar profile={entering} className="size-28 animate-[dialog-in_.4s_ease-out] rounded-md md:size-36" />
        </div>
        <Spinner className="size-12 text-brand" />
      </div>
    );
  }

  return (
    <div className="flex min-h-[calc(100dvh-var(--header-h))] flex-col items-center justify-center px-4 pb-16 animate-fade-in">
      <h1 className="text-center text-[clamp(1.75rem,3.5vw,3.5rem)] font-medium">{manage ? "Quản lý hồ sơ" : "Ai đang xem?"}</h1>

      {isPending ? (
        <div className="mt-[2vw] flex flex-wrap justify-center gap-[2vw]">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className={TILE}>
              <Skeleton className="aspect-square w-full rounded-md" />
              <Skeleton className="mx-auto mt-3 h-4 w-2/3" />
            </div>
          ))}
        </div>
      ) : error ? (
        <ErrorPanel error={error} onRetry={() => void refetch()} />
      ) : (
        <ul className="mt-[2vw] flex max-w-5xl flex-wrap justify-center gap-[clamp(1rem,2vw,2rem)] pt-4" data-testid="profile-list">
          {profiles.map((p) => (
            <li key={p.id} className={TILE}>
              <button
                type="button"
                onClick={() => choose(p)}
                className="group flex w-full flex-col items-center gap-3 rounded-md outline-offset-4"
                aria-label={manage ? `Chỉnh sửa hồ sơ ${p.name}` : `Chọn hồ sơ ${p.name}`}
                data-testid="profile-tile"
              >
                <span className="relative block aspect-square w-full overflow-hidden rounded-md ring-white transition-[box-shadow] duration-200 group-hover:ring-[3px] group-focus-visible:ring-[3px]">
                  <ProfileAvatar profile={p} className={cn("size-full transition-[filter]", manage && "brightness-[.45]")} />
                  {manage && (
                    <span className="absolute inset-0 flex items-center justify-center">
                      <span className="flex size-[38%] items-center justify-center rounded-full border-2 border-white">
                        <Pencil className="size-1/2" />
                      </span>
                    </span>
                  )}
                </span>
                <span className="max-w-full truncate text-[clamp(0.9rem,1.3vw,1.3rem)] text-[#808080] transition-colors group-hover:text-white group-focus-visible:text-white">
                  {p.name}
                </span>
                {p.isKids && <span className="-mt-2 rounded bg-white/10 px-1.5 text-[0.65rem] font-bold tracking-wide text-white/70">TRẺ EM</span>}
              </button>
            </li>
          ))}
          {canAdd && (
            <li className={TILE}>
              <button type="button" onClick={() => setEditing("new")} className="group flex w-full flex-col items-center gap-3 rounded-md outline-offset-4" data-testid="add-profile">
                <span className="flex aspect-square w-full items-center justify-center rounded-md text-[#808080] transition-colors group-hover:bg-white group-hover:text-black">
                  <span className="flex size-1/2 items-center justify-center rounded-full bg-[#808080]/30 group-hover:bg-transparent">
                    <Plus className="size-2/3" strokeWidth={1.5} />
                  </span>
                </span>
                <span className="text-[clamp(0.9rem,1.3vw,1.3rem)] text-[#808080] group-hover:text-white">Thêm hồ sơ</span>
              </button>
            </li>
          )}
        </ul>
      )}

      {profiles && (
        <div className="mt-[clamp(2rem,4vw,4rem)]">
          {manage ? (
            <button
              type="button"
              onClick={() => setManage(false)}
              className="bg-white px-[1.5em] py-[0.5em] text-[clamp(0.95rem,1.2vw,1.2rem)] font-semibold tracking-wider text-black uppercase transition-colors hover:bg-brand hover:text-white"
            >
              Xong
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setManage(true)}
              className="border border-[#808080] px-[1.5em] py-[0.5em] text-[clamp(0.95rem,1.2vw,1.2rem)] tracking-wider text-[#808080] uppercase transition-colors hover:border-white hover:text-white"
            >
              Quản lý hồ sơ
            </button>
          )}
        </div>
      )}

      <ProfileEditor
        key={editing === "new" ? "new" : editing?.id ?? "closed"}
        profile={editing}
        canDelete={(profiles?.length ?? 0) > 1}
        onClose={() => setEditing(null)}
      />
    </div>
  );
}

function ProfileEditor({ profile, onClose, canDelete }: { profile: ProfileDto | "new" | null; onClose: () => void; canDelete: boolean }) {
  const isNew = profile === "new";
  const existing = profile && profile !== "new" ? profile : null;
  const { data: avatars } = useAvatars(!!profile);
  const save = useSaveProfile();
  const del = useDeleteProfile();
  const [name, setName] = useState(existing?.name ?? "");
  const [avatarKey, setAvatarKey] = useState(existing?.avatarKey ?? "");
  const [isKids, setIsKids] = useState(existing?.isKids ?? false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const chosenKey = avatarKey || avatars?.[0]?.key || "avatar-1";
  const chosenUrl = avatars?.find((a) => a.key === chosenKey)?.url;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    if (!n) return setNameError("Vui lòng nhập tên hồ sơ.");
    if (n.length > 30) return setNameError("Tên hồ sơ tối đa 30 ký tự.");
    save.mutate(
      { id: existing?.id, input: { name: n, avatarKey: chosenKey, isKids } },
      {
        onSuccess: () => {
          toast({ message: isNew ? `Đã tạo hồ sơ “${n}”` : "Đã lưu thay đổi" });
          onClose();
        },
        onError: (err) => toast({ message: errorMessage(err), tone: "error" }),
      },
    );
  };

  return (
    <Dialog open={!!profile} onOpenChange={(o) => !o && onClose()}>
      {profile && (
        <DialogContent title={isNew ? "Thêm hồ sơ" : "Chỉnh sửa hồ sơ"} description={isNew ? "Thêm hồ sơ cho người khác cùng xem." : undefined} variant="sheet" className="sm:w-[min(92vw,36rem)]">
          {confirmDelete && existing ? (
            <div className="space-y-5">
              <div className="flex items-center gap-4">
                <ProfileAvatar profile={existing} className="size-16 rounded-md" />
                <p className="text-white/80">
                  Xóa hồ sơ <strong className="text-white">{existing.name}</strong>? Lịch sử xem, danh sách và đánh giá của hồ sơ này sẽ bị xóa vĩnh viễn.
                </p>
              </div>
              <div className="flex justify-end gap-3">
                <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
                  Giữ hồ sơ
                </Button>
                <Button
                  variant="brand"
                  loading={del.isPending}
                  onClick={() =>
                    del.mutate(existing.id, {
                      onSuccess: () => {
                        toast({ message: `Đã xóa hồ sơ “${existing.name}”` });
                        onClose();
                      },
                      onError: (err) => toast({ message: errorMessage(err), tone: "error" }),
                    })
                  }
                >
                  Xóa hồ sơ
                </Button>
              </div>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="space-y-6" noValidate>
              <div className="flex items-start gap-4">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={chosenUrl ?? avatarSrc({ avatarKey: chosenKey, avatarUrl: "" })}
                  alt=""
                  className="size-20 shrink-0 rounded-md sm:size-24"
                />
                <div className="flex-1 space-y-4">
                  <FloatingInput
                    label="Tên hồ sơ"
                    appearance="solid"
                    size="md"
                    value={name}
                    maxLength={30}
                    autoFocus={isNew}
                    error={nameError}
                    onChange={(e) => {
                      setName(e.target.value);
                      setNameError(null);
                    }}
                  />
                  <label className="flex cursor-pointer items-center justify-between gap-4">
                    <span>
                      <span className="block font-semibold">Hồ sơ trẻ em</span>
                      <span className="block text-sm text-white/60">Chỉ hiển thị nội dung phù hợp với trẻ em.</span>
                    </span>
                    <Switch.Root
                      checked={isKids}
                      onCheckedChange={setIsKids}
                      className="relative h-7 w-12 shrink-0 rounded-full bg-white/20 transition-colors data-[state=checked]:bg-brand"
                    >
                      <Switch.Thumb className="block size-5 translate-x-1 rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-6" />
                    </Switch.Root>
                  </label>
                </div>
              </div>

              <fieldset>
                <legend className="mb-3 text-sm font-semibold text-white/70">Chọn biểu tượng</legend>
                <div className="grid grid-cols-4 gap-3 sm:grid-cols-8 sm:gap-2" role="radiogroup">
                  {(avatars ?? Array.from({ length: 8 }, (_, i) => ({ key: `avatar-${i + 1}`, url: `/avatars/avatar-${i + 1}.svg` }))).map((a) => {
                    const active = a.key === chosenKey;
                    return (
                      <button
                        key={a.key}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        aria-label={`Biểu tượng ${a.key}`}
                        onClick={() => setAvatarKey(a.key)}
                        className={cn(
                          "relative aspect-square overflow-hidden rounded-md ring-offset-2 ring-offset-elevated transition-[box-shadow,scale] hover:scale-105",
                          active ? "ring-2 ring-white" : "ring-0",
                        )}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={a.url} alt="" className="size-full" />
                        {active && (
                          <span className="absolute right-1 bottom-1 flex size-4 items-center justify-center rounded-full bg-white text-black">
                            <Check className="size-3" strokeWidth={3} />
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </fieldset>

              <div className="flex flex-wrap items-center gap-3 border-t border-white/10 pt-5">
                <Button type="submit" variant="primary" loading={save.isPending}>
                  {isNew ? "Tạo hồ sơ" : "Lưu"}
                </Button>
                <Button type="button" variant="outline" onClick={onClose}>
                  Hủy
                </Button>
                {existing && canDelete && (
                  <Button type="button" variant="ghost" className="ml-auto text-white/70" onClick={() => setConfirmDelete(true)}>
                    Xóa hồ sơ
                  </Button>
                )}
              </div>
            </form>
          )}
        </DialogContent>
      )}
    </Dialog>
  );
}
