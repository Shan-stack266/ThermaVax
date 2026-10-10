const { createAnonymousClient, createUserClient } = require('./supabase');

function jwtSubject(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    return typeof payload.sub === 'string' ? payload.sub : '';
  } catch {
    return '';
  }
}

async function authenticate(req, res, next) {
  try {
    const header = req.get('authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) return res.status(401).json({ error: 'Authentication required' });

    const userId = jwtSubject(token);
    if (!userId) return res.status(401).json({ error: 'Session expired or invalid' });

    const authClient = createAnonymousClient();
    const client = createUserClient(token);
    const [authResult, profileResult] = await Promise.all([
      authClient.auth.getUser(token),
      client.from('profiles')
        .select('id, email, role, active, created_at')
        .eq('id', userId)
        .maybeSingle()
    ]);
    if (authResult.error || !authResult.data.user || profileResult.error || !profileResult.data) {
      return res.status(401).json({ error: 'Session expired or invalid' });
    }

    const profile = profileResult.data;
    if (!profile.active) return res.status(403).json({ error: 'This account is disabled' });

    req.user = profile;
    req.accessToken = token;
    req.supabase = client;
    next();
  } catch (error) {
    next(error);
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Insufficient permission' });
    next();
  };
}

module.exports = { authenticate, requireRole };
