import type { Metadata } from "next";
import { JudgesView } from "@/views/judges";

export const metadata: Metadata = { title: "评测机" };

export const dynamic = "force-dynamic";

export default function Page() {
  return <JudgesView />;
}
