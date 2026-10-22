// Shared in-memory stand-in for Prisma: just enough of the query API for the campaign / delivery code.
// ───────────── a small stateful in-memory stand-in for Prisma (only what the sender uses) ─────────────
const db = {};
let seq = 0;
const uid = () => `id${++seq}`;

function cmp(a, b) {
  const x = a instanceof Date ? a.getTime() : a;
  const y = b instanceof Date ? b.getTime() : b;
  return x < y ? -1 : x > y ? 1 : 0;
}
function matchValue(v, cond) {
  if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
    if ('equals' in cond) {
      return cond.mode === 'insensitive'
        ? typeof v === 'string' && v.toLowerCase() === String(cond.equals).toLowerCase()
        : v === cond.equals;
    }
    if ('in' in cond) return cond.in.includes(v);
    if ('lt' in cond) return v != null && cmp(v, cond.lt) < 0;
    if ('gt' in cond) return v != null && cmp(v, cond.gt) > 0;
    if ('not' in cond) return (v ?? null) !== cond.not;
    return false;
  }
  return (v ?? null) === (cond ?? null);
}
function match(row, where = {}) {
  return Object.entries(where).every(([k, cond]) => {
    if (k === 'OR') return cond.some((w) => match(row, w));
    if (k === 'campaign') {
      // relation filter on a recipient: join to its campaign
      const camp = db.campaigns.find((c) => c.id === row.campaignId);
      return Boolean(camp) && match(camp, cond);
    }
    if (k === 'user') {
      // relation filter on a user-property role: join to its user (db.users, optional for most tests)
      const user = (db.users || []).find((u) => u.id === row.userId);
      return Boolean(user) && match(user, cond);
    }
    return matchValue(row[k], cond);
  });
}
function applyData(row, data) {
  for (const [k, v] of Object.entries(data)) {
    if (v && typeof v === 'object' && !(v instanceof Date) && ('increment' in v || 'decrement' in v)) {
      row[k] = (row[k] || 0) + (v.increment || 0) - (v.decrement || 0);
    } else row[k] = v;
  }
  return row;
}
const table = (name) => ({
  findMany: async ({ where, take, orderBy } = {}) => {
    let rows = db[name].filter((r) => match(r, where));
    const ob = Array.isArray(orderBy) ? orderBy[0] : orderBy;
    if (ob) {
      const [[key, dir]] = Object.entries(ob);
      rows = [...rows].sort((a, b) => cmp(a[key] ?? 0, b[key] ?? 0) * (dir === 'desc' ? -1 : 1));
    }
    return (take ? rows.slice(0, take) : rows).map((r) => ({ ...r }));
  },
  findFirst: async ({ where }) => {
    const r = db[name].find((x) => match(x, where));
    return r ? { ...r } : null;
  },
  findUnique: async ({ where }) => {
    const r = db[name].find((x) => match(x, where));
    return r ? { ...r } : null;
  },
  count: async ({ where }) => db[name].filter((r) => match(r, where)).length,
  update: async ({ where, data }) => {
    const r = db[name].find((x) => match(x, where));
    if (!r) throw new Error(`${name} not found`);
    return { ...applyData(r, data) };
  },
  updateMany: async ({ where, data }) => {
    const rows = db[name].filter((r) => match(r, where));
    rows.forEach((r) => applyData(r, data));
    return { count: rows.length };
  },
  create: async ({ data }) => {
    const row = { id: uid(), ...data };
    db[name].push(row);
    return { ...row };
  },
});
const recipients = table('recipients');
const fakePrisma = {
  campaign: table('campaigns'),
  campaignRecipient: {
    ...recipients,
    createMany: async ({ data, skipDuplicates }) => {
      let count = 0;
      for (const d of data) {
        if (skipDuplicates && db.recipients.some((r) => r.campaignId === d.campaignId && r.contactId === d.contactId)) continue;
        db.recipients.push({ id: uid(), ...d });
        count += 1;
      }
      return { count };
    },
    groupBy: async ({ where }) => {
      const out = {};
      db.recipients.filter((r) => match(r, where)).forEach((r) => (out[r.status] = (out[r.status] || 0) + 1));
      return Object.entries(out).map(([status, n]) => ({ status, _count: { _all: n } }));
    },
  },
  contact: table('contacts'),
  segment: table('segments'),
  property: table('properties'),
  suppressionEntry: table('suppressions'),
  notification: table('notifications'),
  outboxEvent: table('outbox'),
  auditLog: table('audits'),
  userPropertyRole: table('userRoles'),
  $transaction: async (fn) => fn(fakePrisma),
};

module.exports = { db, fakePrisma, uid, match };
