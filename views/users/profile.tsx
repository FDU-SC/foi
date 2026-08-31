import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getViewer } from "@/auth";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { getAccountByUsername } from "@/lib/accounts/queries";
import { resolveFromRow } from "@/lib/accounts/resolve";
import type { ResolvedUser } from "@/lib/accounts/types";
import { allows } from "@/lib/authz/engine";
import { groupName } from "@/lib/authz/groups";
import { dateFormatter } from "@/lib/format";

interface Profile {
  user: ResolvedUser;
  joinedAt: Date;
}

/**
 * Only what standings already show: a face, a name, and the groups a policy
 * might name. Email and account status are directory data and stay behind
 * `account.read`.
 */
async function load(username: string): Promise<Profile | null> {
  const row = await getAccountByUsername(username);
  if (!row) return null;

  const user = resolveFromRow(row);
  if (user.disabled) return null;

  if (!allows("account.viewProfile", user, await getViewer())) return null;

  return { user, joinedAt: row.createdAt };
}

const joined = dateFormatter({ dateStyle: "long" });

export async function userProfileMetadata({
  params,
}: PageProps<"/u/[username]">): Promise<Metadata> {
  const { username } = await params;
  const profile = await load(username);

  return { title: profile ? profile.user.nickname : "选手" };
}

export async function UserProfileView({ params }: PageProps<"/u/[username]">) {
  const { username } = await params;

  const profile = await load(username);
  if (!profile) notFound();

  const { user } = profile;

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div className="flex items-center gap-5">
        <Avatar of={user} size="lg" />

        <div className="min-w-0 space-y-1">
          <h1 className="text-fg truncate text-2xl font-bold tracking-tight">
            {user.nickname}
          </h1>
          <p className="text-fg-muted truncate font-mono text-sm">
            {user.username}
          </p>
        </div>
      </div>

      {user.groups.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {user.groups.map((group) => (
            <Badge key={group}>{groupName(group)}</Badge>
          ))}
        </div>
      ) : null}

      <p className="text-fg-subtle text-xs">
        加入于 {joined.format(profile.joinedAt)}
      </p>
    </div>
  );
}
