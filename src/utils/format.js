export function formatDate(value, includeTime = true) {
  if (!value) return 'Not set';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat(undefined, includeTime
    ? { dateStyle: 'medium', timeStyle: 'short' }
    : { dateStyle: 'medium' }).format(date);
}

export function todayLabel() {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  }).format(new Date());
}

export function statusClass(value) {
  return String(value || '').toLowerCase().replaceAll(/[\s_]+/g, '-');
}

export function formValues(form) {
  return Object.fromEntries(new FormData(form));
}

export function exportCsv(name, rows) {
  if (!rows.length) return false;
  const columns = Object.keys(rows[0]);
  const quote = value => {
    const raw = String(value ?? '');
    const safe = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
    return `"${safe.replaceAll('"', '""')}"`;
  };
  const csv = [columns.map(quote).join(','), ...rows.map(row => columns.map(column => quote(row[column])).join(','))].join('\n');
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  link.download = `${name.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-')}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
  return true;
}
