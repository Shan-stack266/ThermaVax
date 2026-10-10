import { useMemo, useState } from 'react';
import Icon from './Icon';

const PAGE_SIZE = 10;

export default function DataTable({ columns, rows, rowKey = 'id', getSearchText, getStatuses }) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState({ key: '', direction: 1 });
  const statuses = useMemo(() => [...new Set(rows.flatMap(row => getStatuses?.(row) || []))].sort(), [rows, getStatuses]);
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const result = rows.filter(row => {
      const text = getSearchText ? getSearchText(row) : Object.values(row).join(' ');
      return (!normalized || String(text).toLowerCase().includes(normalized))
        && (!status || (getStatuses?.(row) || []).includes(status));
    });
    if (sort.key) {
      const column = columns.find(item => item.key === sort.key);
      result.sort((a, b) => String(column?.sortValue?.(a) ?? a[sort.key] ?? '').localeCompare(
        String(column?.sortValue?.(b) ?? b[sort.key] ?? ''), undefined, { numeric: true }
      ) * sort.direction);
    }
    return result;
  }, [rows, query, status, sort, columns, getSearchText, getStatuses]);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pages);
  const visible = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const sortBy = column => {
    if (column.sortable === false || !column.label) return;
    setSort(current => ({ key: column.key, direction: current.key === column.key ? current.direction * -1 : 1 }));
  };

  return <>
    <div className="data-toolbar">
      <label className="table-search"><Icon name="search" /><span className="visually-hidden">Search table</span><input type="search" placeholder="Search records" value={query} onChange={event => { setQuery(event.target.value); setPage(1); }} /></label>
      {statuses.length > 0 && <label className="table-filter"><span className="visually-hidden">Filter by status</span><select value={status} onChange={event => { setStatus(event.target.value); setPage(1); }}><option value="">All statuses</option>{statuses.map(item => <option key={item}>{item}</option>)}</select></label>}
      <div className="table-pagination"><span>{filtered.length ? `${(currentPage - 1) * PAGE_SIZE + 1}-${Math.min(currentPage * PAGE_SIZE, filtered.length)} of ${filtered.length}` : 'No matches'}</span><button type="button" className="icon-button" aria-label="Previous page" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}><Icon name="chevron-left" /></button><button type="button" className="icon-button" aria-label="Next page" disabled={currentPage === pages || !filtered.length} onClick={() => setPage(currentPage + 1)}><Icon name="chevron-right" /></button></div>
    </div>
    <div className="table-scroll"><table><thead><tr>{columns.map(column => <th key={column.key} className={column.sortable === false || !column.label ? '' : 'sortable'} tabIndex={column.sortable === false || !column.label ? undefined : 0} role={column.sortable === false || !column.label ? undefined : 'button'} aria-sort={sort.key === column.key ? (sort.direction === 1 ? 'ascending' : 'descending') : undefined} onClick={() => sortBy(column)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); sortBy(column); } }}>{column.label}</th>)}</tr></thead><tbody>{visible.map(row => <tr key={typeof rowKey === 'function' ? rowKey(row) : row[rowKey]}>{columns.map(column => <td key={column.key}>{column.render ? column.render(row) : row[column.key]}</td>)}</tr>)}</tbody></table></div>
  </>;
}
