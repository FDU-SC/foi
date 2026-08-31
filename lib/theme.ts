/**
 * The deployment's theme, as an entry point.
 *
 * A stylesheet rather than a value, but the same rule applies: only `lib/`
 * reaches into `content/`, so the root layout imports this instead of the CSS
 * directly. Load order carries the meaning — this lands after `globals.css`,
 * and later declarations of a custom property win.
 */

import "@/content/theme.css";
