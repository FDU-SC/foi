import { site } from "@/lib/site";

/**
 * Nickname, username, email and password are one switch rather than four: where accounts
 * are shared — a public demo hands the same credentials to every visitor — the first person
 * to change any of them locks out everyone else, and a partial lock leaves that hole open.
 */
export const selfServiceEnabled: boolean = site.accountSelfService !== false;

export const SELF_SERVICE_OFF = "本站不支持修改账号资料与登录凭据。";
