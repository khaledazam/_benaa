/** Pure startup checks. Never connect to a datasource or print its value. */
export function validateRuntimeConfiguration(env: NodeJS.ProcessEnv = process.env): void {
  const errors: string[] = [];
  const requireName = (name: string) => { if (!env[name]?.trim()) errors.push(name); };
  for (const name of ['DATABASE_URL', 'JWT_SECRET', 'NEXT_PUBLIC_API_URL', 'NEXT_PUBLIC_APP_URL',
    'BENAA_DEPLOYMENT_ENV', 'BENAA_DATABASE_HOST', 'BENAA_DATABASE_NAME', 'BENAA_ALLOWED_ORIGINS', 'BENAA_WRITE_DISABLED']) requireName(name);
  const isolated = env.BENAA_DEPLOYMENT_ENV === 'isolated' && env.BENAA_ISOLATED_RUNTIME === 'true';
  const mongoLimiter=env.BENAA_RATE_LIMIT_BACKEND === 'mongodb';
  if (env.BENAA_RATE_LIMIT_BACKEND && !['redis','mongodb'].includes(env.BENAA_RATE_LIMIT_BACKEND)) errors.push('BENAA_RATE_LIMIT_BACKEND');
  if (mongoLimiter && ['UPSTASH_REDIS_REST_URL','UPSTASH_REDIS_URL','UPSTASH_REDIS_REST_TOKEN','UPSTASH_REDIS_TOKEN'].some(k=>!!env[k])) errors.push('Remove Redis credentials when MongoDB limiter is selected');
  if (!['staging', 'production', ...(isolated ? ['isolated'] : [])].includes(env.BENAA_DEPLOYMENT_ENV || '')) errors.push('BENAA_DEPLOYMENT_ENV');
  if ((env.JWT_SECRET?.trim().length || 0) < 32 || new Set(env.JWT_SECRET || '').size < 12) errors.push('JWT_SECRET');
  const origin = (value: string | undefined) => {
    try { const u = new URL(value || ''); return !u.username && !u.password && !u.search && !u.hash &&
      (u.pathname === '/' || !u.pathname) && (u.protocol === 'https:' || (isolated && u.protocol === 'http:')) &&
      (isolated ? u.hostname === '127.0.0.1' : !['localhost', '127.0.0.1', '::1', '[::1]'].includes(u.hostname));
    } catch { return false; }
  };
  for (const name of ['NEXT_PUBLIC_API_URL', 'NEXT_PUBLIC_APP_URL']) if (!origin(env[name])) errors.push(name);
  const origins = (env.BENAA_ALLOWED_ORIGINS || '').split(',').map(x => x.trim());
  if (!origins.length || origins.some(x => !origin(x) || x.endsWith('/'))) errors.push('BENAA_ALLOWED_ORIGINS');
  try {
    const db = new URL(env.DATABASE_URL || '');
    if (!['mongodb:', 'mongodb+srv:'].includes(db.protocol) || db.hostname !== env.BENAA_DATABASE_HOST ||
        decodeURIComponent(db.pathname.slice(1)) !== env.BENAA_DATABASE_NAME || !env.BENAA_DATABASE_NAME ||
        ['admin', 'local', 'config'].includes(env.BENAA_DATABASE_NAME)) errors.push('DATABASE_URL identity');
    if (isolated ? (db.hostname !== '127.0.0.1' || !/^benaa_(audit|cert|linux|restore|test)_/.test(db.pathname.slice(1))) :
      (db.protocol !== 'mongodb+srv:' || !db.hostname.endsWith('.mongodb.net'))) errors.push('DATABASE_URL isolation/TLS');
    if (db.searchParams.get('tls') === 'false' || db.searchParams.get('ssl') === 'false') errors.push('DATABASE_URL TLS');
  } catch { errors.push('DATABASE_URL format'); }
  if (!['true','false'].includes(env.BENAA_WRITE_DISABLED || '')) errors.push('BENAA_WRITE_DISABLED');
  if (env.BENAA_WRITE_DISABLED === 'false' && !isolated &&
      env[env.BENAA_DEPLOYMENT_ENV === 'production' ? 'BENAA_CUSTOMER_WRITES_APPROVED' : 'BENAA_STAGING_WRITES_APPROVED'] !== 'true') errors.push('Write activation approval');
  if (!isolated && !mongoLimiter && !(env.UPSTASH_REDIS_REST_URL || env.UPSTASH_REDIS_URL)) errors.push('UPSTASH_REDIS_REST_URL');
  if (!isolated && !mongoLimiter && !(env.UPSTASH_REDIS_REST_TOKEN || env.UPSTASH_REDIS_TOKEN)) errors.push('UPSTASH_REDIS_REST_TOKEN');
  if (!isolated && !mongoLimiter) {
    requireName('BENAA_REDIS_HOST');
    const redisUrl = env.UPSTASH_REDIS_URL || env.UPSTASH_REDIS_REST_URL;
    const redisToken = env.UPSTASH_REDIS_TOKEN || env.UPSTASH_REDIS_REST_TOKEN;
    if (env.UPSTASH_REDIS_URL && env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_URL !== env.UPSTASH_REDIS_REST_URL) errors.push('Conflicting Redis URL aliases');
    if (env.UPSTASH_REDIS_TOKEN && env.UPSTASH_REDIS_REST_TOKEN && env.UPSTASH_REDIS_TOKEN !== env.UPSTASH_REDIS_REST_TOKEN) errors.push('Conflicting Redis token aliases');
    try {
      const redis = new URL(redisUrl || '');
      if (redis.protocol !== 'https:' || redis.username || redis.password || redis.search || redis.hash || redis.pathname !== '/' || redis.hostname !== env.BENAA_REDIS_HOST) errors.push('Redis HTTPS target identity');
    } catch { errors.push('Redis URL format'); }
    if ((redisToken?.trim().length || 0) < 32) errors.push('UPSTASH_REDIS_REST_TOKEN');
  }
  const groups = [ ['STRIPE_API_KEY','STRIPE_WEBHOOK_SECRET','NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY'],
    ['QSTASH_URL','QSTASH_TOKEN','QSTASH_CURRENT_SIGNING_KEY','QSTASH_NEXT_SIGNING_KEY'],
    ['GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET'], ['BREVO_API_KEY','BREVO_SENDER_EMAIL'] ];
  for (const group of groups) if (group.some(n => !!env[n])) for (const n of group) requireName(n);
  if (env.BENAA_REMINDERS_ENABLED === 'true' && (env.INTERNAL_API_KEY?.length || 0) < 32) errors.push('INTERNAL_API_KEY');
  if (errors.length) throw new Error('Unsafe runtime configuration: ' + [...new Set(errors)].join(', '));
}
