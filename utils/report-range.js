/**
 * Shared date-window parsing for report endpoints.
 * Defaults to last 30 days; hard-caps range length.
 */

function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

function endOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

function parseReportRange(query, { defaultDays = 30, maxDays = 366 } = {}) {
  const now = new Date();
  let to = query?.to || query?.endDate ? new Date(query.to || query.endDate) : now;
  let from =
    query?.from || query?.startDate
      ? new Date(query.from || query.startDate)
      : new Date(now.getFullYear(), now.getMonth(), now.getDate() - (defaultDays - 1), 0, 0, 0, 0);

  if (Number.isNaN(from.getTime())) from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (defaultDays - 1));
  if (Number.isNaN(to.getTime())) to = now;

  if (from > to) {
    const tmp = from;
    from = to;
    to = tmp;
  }

  from = startOfDay(from);
  to = endOfDay(to);

  const maxMs = maxDays * 24 * 60 * 60 * 1000;
  if (to.getTime() - from.getTime() > maxMs) {
    from = new Date(to.getTime() - maxMs);
    from = startOfDay(from);
  }

  return { from, to, defaultDays, maxDays };
}

module.exports = { parseReportRange, startOfDay, endOfDay };
