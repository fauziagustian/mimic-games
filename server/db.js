export function database(env) {
  if (!env.DB) throw new Error('Database unavailable');
  // Netlify supplies a request-scoped SQLite adapter backed by a strongly
  // consistent Blob and ETag compare-and-swap. Keep D1 for local worker tests.
  if (typeof env.DB.one === 'function' && typeof env.DB.batch === 'function') return env.DB;
  return {
    statement:(sql,...values)=>env.DB.prepare(sql).bind(...values),
    one:(sql,...values)=>env.DB.prepare(sql).bind(...values).first(),
    all:async(sql,...values)=>(await env.DB.prepare(sql).bind(...values).all()).results,
    run:(sql,...values)=>env.DB.prepare(sql).bind(...values).run(),
    batch:statements=>env.DB.batch(statements),
  };
}
