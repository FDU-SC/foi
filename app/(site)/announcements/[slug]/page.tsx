import {
  AnnouncementDetailView,
  announcementMetadata,
} from "@/views/announcements/detail";
export const dynamic = "force-dynamic";
export const generateMetadata = announcementMetadata;
export default function Page(props: PageProps<"/announcements/[slug]">) {
  return <AnnouncementDetailView {...props} />;
}
