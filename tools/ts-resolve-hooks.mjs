/**
 * ts-resolve-hooks.mjs — Node uchun kichik resolve hook.
 *
 * Loyihadagi importlar kengaytmasiz (`./match`), lekin Node ESM
 * kengaytmani talab qiladi. Bu hook `./x` -> `./x.ts` ga qaytaradi.
 */

export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context);
  } catch (err) {
    const rel = specifier.startsWith(".") || specifier.startsWith("/");
    if (rel) {
      try {
        return await next(`${specifier}.ts`, context);
      } catch {
        try {
          return await next(`${specifier}/index.ts`, context);
        } catch {
          throw err;
        }
      }
    }
    throw err;
  }
}
