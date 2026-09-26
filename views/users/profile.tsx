import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getViewer } from "@/auth";
import { AvatarEditor } from "@/components/account/avatar-editor";
import { CalendarIcon } from "@/components/profile/icons";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { profileHref } from "@/lib/accounts/profile";
import { getAccountByUsername } from "@/lib/accounts/queries";
import { resolveFromRow } from "@/lib/accounts/resolve";
import type { ResolvedUser } from "@/lib/accounts/types";
import { allows } from "@/lib/authz/engine";
import { groupName } from "@/lib/authz/groups";
import type { Viewer } from "@/lib/authz/viewer";
import { dateFormatter } from "@/lib/format";
import { readOne } from "@/lib/query";
import { cn } from "@/lib/utils";
import {
  ProfileFactsSkeleton,
  ProfileMainSkeleton,
  ProfileTabsSkeleton,
} from "@/views/skeletons/user-profile";
import {
  loadProfileData,
  ProfileFacts,
  ProfileMain,
  ProfileTabs,
  readProfileTab,
  type ProfileData,
} from "@/views/users/activity";

interface Profile {
  user: ResolvedUser;
  bio: string | null;
  joinedAt: Date;
  viewer: Viewer;

  /** The viewer is looking at their own page. */
  own: boolean;

  /** Their own face, and a policy that lets them change it. */
  editable: boolean;

  /** Submission counts, progress and standings, beyond the identity column. */
  activity: boolean;
}

/**
 * The identity column shows only what standings already show, plus what the
 * owner wrote about themselves. Email and account status are directory data
 * and stay behind `account.read`.
 */
async function load(username: string): Promise<Profile | null> {
  const row = await getAccountByUsername(username);
  if (!row) return null;

  const user = resolveFromRow(row);
  if (user.disabled) return null;

  const viewer = await getViewer();
  if (!allows("account.viewProfile", user, viewer)) return null;

  const own = viewer.uid === user.uid;
  return {
    user,
    bio: row.bio,
    joinedAt: row.createdAt,
    viewer,
    own,
    editable: own && allows("account.changeAvatar", user, viewer),
    activity: allows("account.readActivity", user, viewer),
  };
}

const joined = dateFormatter({ dateStyle: "long" });

export async function userProfileMetadata({
  params,
}: PageProps<"/u/[username]">): Promise<Metadata> {
  const { username } = await params;
  const profile = await load(username);

  return { title: profile ? profile.user.nickname : "选手" };
}

function Identity({
  profile,
  data,
}: {
  profile: Profile;
  data: Promise<ProfileData> | null;
}) {
  const { user } = profile;
  return (
    <aside className="min-w-0 space-y-4">
      <div className="flex items-center gap-4 lg:block lg:space-y-3">
        {profile.editable ? (
          <AvatarEditor current={user} size="xl" />
        ) : (
          <Avatar of={user} size="xl" className="border-border border" />
        )}
        <div className="min-w-0">
          <h1 className="text-fg truncate text-2xl leading-tight font-semibold">
            {user.nickname}
          </h1>
          <p className="text-fg-muted truncate text-xl leading-tight font-light">
            {user.username}
          </p>
        </div>
      </div>

      {profile.bio ? (
        <p className="text-fg text-sm leading-6 break-words whitespace-pre-line">
          {profile.bio}
        </p>
      ) : null}

      {profile.own ? (
        <Link
          href="/settings"
          className="border-border bg-surface text-fg hover:bg-surface-2 hover:border-border-strong flex h-8 items-center justify-center rounded-md border text-sm font-medium transition-colors"
        >
          编辑资料
        </Link>
      ) : null}

      <div className="space-y-1.5">
        {data ? (
          <Suspense fallback={<ProfileFactsSkeleton />}>
            <ProfileFacts data={data} />
          </Suspense>
        ) : null}
        <p className="text-fg-muted flex items-center gap-1.5 text-sm">
          <CalendarIcon />
          加入于 {joined.format(profile.joinedAt)}
        </p>
      </div>

      {user.groups.length > 0 ? (
        <div className="border-border space-y-2 border-t pt-4">
          <h2 className="text-fg text-sm font-semibold">用户组</h2>
          <div className="flex flex-wrap gap-1.5">
            {user.groups.map((group) => (
              <Badge key={group}>{groupName(group)}</Badge>
            ))}
          </div>
        </div>
      ) : null}
    </aside>
  );
}

export async function UserProfileView({
  params,
  searchParams,
}: PageProps<"/u/[username]">) {
  const [{ username }, query] = await Promise.all([params, searchParams]);

  const profile = await load(username);
  if (!profile) notFound();

  const now = new Date();
  const data = profile.activity ? loadProfileData(profile.user.uid, profile.viewer, now) : null;
  const signIn = !profile.activity && profile.viewer.uid === null;
  const tab = readProfileTab(readOne(query, "tab"));

  return (
    <div className="space-y-6">
      {data ? (
        <Suspense fallback={<ProfileTabsSkeleton />}>
          <ProfileTabs data={data} tab={tab} username={profile.user.username} />
        </Suspense>
      ) : null}

      <div
        className={cn(
          "grid items-start gap-6",
          data || signIn
            ? "lg:grid-cols-[240px_minmax(0,1fr)] xl:grid-cols-[272px_minmax(0,1fr)]"
            : "mx-auto max-w-sm",
        )}
      >
        <Identity profile={profile} data={data} />

        {data ? (
          <Suspense fallback={<ProfileMainSkeleton />}>
            <ProfileMain
              data={data}
              tab={tab}
              year={readOne(query, "year")}
              username={profile.user.username}
              joinedAt={profile.joinedAt}
              own={profile.own}
              now={now}
            />
          </Suspense>
        ) : signIn ? (
          <p className="bg-surface border-border text-fg-muted rounded-md border px-4 py-10 text-center text-sm">
            <Link
              href={`/login?next=${encodeURIComponent(profileHref(profile.user.username))}`}
              className="text-primary hover:underline"
            >
              登录
            </Link>
            后可查看做题记录。
          </p>
        ) : null}
      </div>
    </div>
  );
}
