import { SectionNav } from "@/components/site/section-nav";

export function AdminNav() {
  return (
    <SectionNav
      label="管理导航"
      items={[
        { href: "/admin", label: "概况" },
        { href: "/admin/accounts", label: "账号" },
        { href: "/admin/contests", label: "比赛" },
        { href: "/admin/enrollment", label: "分流规则" },
      ]}
    />
  );
}
