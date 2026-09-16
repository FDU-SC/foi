/**
 * Reading and rewriting a page's query string.
 *
 * URL state is how a server-rendered filter works without JavaScript: every
 * control is a link to the same page with one parameter changed. These are the
 * string mechanics behind that, and they know nothing about which parameters a
 * page has.
 */

export type SearchParams = Record<string, string | string[] | undefined>;

function values(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

/** The first value under a key. A repeated parameter is not an error here. */
export function readOne(
  params: SearchParams,
  key: string,
): string | undefined {
  return values(params[key])[0];
}

/** Every value under a key, deduplicated so toggling stays reversible. */
export function readAll(params: SearchParams, key: string): string[] {
  return [...new Set(values(params[key]))];
}

function render(search: URLSearchParams): string {
  const query = search.toString();
  return query ? `?${query}` : "";
}

/**
 * `params` with one key replaced. Keys hold their position and a key set to
 * nothing disappears, so the same state always renders the same URL.
 */
function replaced(
  params: SearchParams,
  key: string,
  next: string[],
): string {
  const search = new URLSearchParams();
  let written = false;

  const append = (name: string, list: string[]) => {
    for (const value of list) search.append(name, value);
  };

  for (const [name, value] of Object.entries(params)) {
    if (name === key) {
      append(key, next);
      written = true;
    } else {
      append(name, values(value));
    }
  }

  if (!written) append(key, next);

  return render(search);
}

/** `params` with `value` added to `key`, or removed if it was already there. */
export function toggled(
  params: SearchParams,
  key: string,
  value: string,
): string {
  const held = readAll(params, key);
  const next = held.includes(value)
    ? held.filter((one) => one !== value)
    : [...held, value];

  return replaced(params, key, next);
}

/** `params` with `key` set to a single value, or dropped when undefined. */
export function withParam(
  params: SearchParams,
  key: string,
  value: string | undefined,
): string {
  return replaced(params, key, value === undefined ? [] : [value]);
}

/**
 * The parameters a GET form has to resend as hidden inputs.
 *
 * Submitting a form replaces the whole query string with its own fields, so
 * anything the form does not name is lost unless it is carried along.
 */
export function carried(
  params: SearchParams,
  ...omit: string[]
): { name: string; value: string }[] {
  return Object.entries(params).flatMap(([name, value]) =>
    omit.includes(name)
      ? []
      : values(value).map((one) => ({ name, value: one })),
  );
}
