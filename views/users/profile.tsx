import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getViewer } from "@/auth";
import { AvatarEditor } from "@/components/account/avatar-editor";
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

  /** Submission counts, progress and standings, beyond the identity header. */
  activity: boolean;
}

/**
 * The identity header shows only what standings already show, plus what the
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
    <header className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {profile.editable ? (
          <AvatarEditor current={user} size="md" />
        ) : (
          <Avatar of={user} size="md" />
        )}
        <div className="min-w-0">
          <h1 className="text-fg text-xl leading-tight font-bold break-words">
            {user.nickname}
          </h1>
          <p className="text-fg-muted font-mono text-sm">{user.username}</p>
        </div>
        {user.groups.length > 0 ? (
          <ul aria-label="用户组" className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {user.groups.map((group) => (
              <li key={group}>
                <Badge>{groupName(group)}</Badge>
              </li>
            ))}
          </ul>
        ) : null}
        {profile.own ? (
          <Link
            href="/settings"
            className="text-fg-muted hover:text-fg ml-auto text-sm underline underline-offset-2 transition-colors"
          >
            编辑资料
          </Link>
        ) : null}
      </div>

      {profile.bio ? (
        <p className="text-fg max-w-2xl text-sm leading-6 break-words whitespace-pre-line">
          {profile.bio}
        </p>
      ) : null}

      <div className="text-fg-muted flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
        {data ? (
          <Suspense fallback={<ProfileFactsSkeleton />}>
            <ProfileFacts data={data} />
          </Suspense>
        ) : null}
        <span>加入于 {joined.format(profile.joinedAt)}</span>
      </div>
    </header>
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
      <Identity profile={profile} data={data} />

      {data ? (
        <Suspense fallback={<ProfileTabsSkeleton />}>
          <ProfileTabs data={data} tab={tab} username={profile.user.username} />
        </Suspense>
      ) : null}

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
        <p className="text-fg-muted border-border border-y py-10 text-center text-sm">
          <Link
            href={`/login?next=${encodeURIComponent(profileHref(profile.user.username))}`}
            className="text-fg underline underline-offset-2"
          >
            登录
          </Link>
          后可查看做题记录。
        </p>
      ) : null}
    </div>
  );
}
