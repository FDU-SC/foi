import type { GroupInput } from "@/lib/authz/groups";
import type {
  EnrollmentPolicyInput,
  EnrollmentRuleInput,
} from "@/lib/enrollment/types";
import { AUDIENCE, CONSOLE, ENTRANTS, FULL } from "./groups";

export const policy: EnrollmentPolicyInput = {
  emailDomains: ["example.test"],
};

export const groups: GroupInput[] = [
  { id: FULL, description: "夹具的全权组。" },
  { id: CONSOLE, description: "夹具的只读控制台组。" },
  { id: AUDIENCE, description: "限定受众题目的受众。" },
  { id: ENTRANTS, description: "夹具赛的参赛范围。" },
];

export const rules: EnrollmentRuleInput[] = [
  {
    label: "按邮箱分流的普通标签",
    email: /@example\.test$/i,
    groups: [AUDIENCE, ENTRANTS],
  },
  {
    label: "全权组",
    uids: [1],
    groups: [FULL],
  },
  {
    label: "控制台组",
    uids: [2],
    groups: [CONSOLE],
  },
];
