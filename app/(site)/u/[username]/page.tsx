import { UserProfileView, userProfileMetadata } from "@/views/users/profile";

export const dynamic = "force-dynamic";

export function generateMetadata(props: PageProps<"/u/[username]">) {
  return userProfileMetadata(props);
}

export default function Page(props: PageProps<"/u/[username]">) {
  return <UserProfileView {...props} />;
}
