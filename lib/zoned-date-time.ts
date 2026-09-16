import { z } from "zod";

const ZONED_ISO =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

/**
 * An instant, as content writes it.
 *
 * The offset is required rather than inferred from `site.timezone`: a config
 * file has to name the same moment wherever the process happens to run, and a
 * bare wall clock does not.
 */
export const zonedDateTime = z
  .string()
  .regex(
    ZONED_ISO,
    "时间必须是带时区的 ISO 8601，例如 2026-01-15T13:00:00+08:00",
  )
  .transform((value) => new Date(value))
  .refine((date) => !Number.isNaN(date.getTime()), "不是有效的时间");
