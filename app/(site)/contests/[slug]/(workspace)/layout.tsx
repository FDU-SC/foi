import { ContestWorkspaceView } from "@/views/contests/workspace";

export default function Layout(props: LayoutProps<"/contests/[slug]">) {
  return <ContestWorkspaceView {...props} />;
}
