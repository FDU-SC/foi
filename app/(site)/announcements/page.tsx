import type { Metadata } from "next";
import { AnnouncementListView } from "@/views/announcements";
export const metadata: Metadata = { title: "公告" };
export const dynamic = "force-dynamic";
export default function Page() {
  return <AnnouncementListView />;
}
