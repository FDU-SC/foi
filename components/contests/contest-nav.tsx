import { SectionNav } from "@/components/site/section-nav";
import { contestHref, standingsHref } from "@/lib/contests/catalogue";

export function ContestNav({ slug }: { slug: string }) {
  return (
    <SectionNav
      label="比赛导航"
      items={[
        { href: contestHref(slug), label: "题目" },
        { href: standingsHref(slug), label: "排行榜" },
      ]}
    />
  );
}
