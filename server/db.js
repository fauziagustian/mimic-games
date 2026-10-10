export function database(env) {
  if (!env.DB) throw new Error('Database unavailable');
  return {
    statement:(sql,...values)=>env.DB.prepare(sql).bind(...values),
    one:(sql,...values)=>env.DB.prepare(sql).bind(...values).first(),
    all:async(sql,...values)=>(await env.DB.prepare(sql).bind(...values).all()).results,
    run:(sql,...values)=>env.DB.prepare(sql).bind(...values).run(),
    batch:statements=>env.DB.batch(statements),
  };
}
