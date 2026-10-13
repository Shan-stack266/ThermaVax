import useApiData from '../hooks/useApiData';
import DataTable from '../components/DataTable';
import Icon from '../components/Icon';
import { ErrorState, LoadingState, SectionHeading, Stat, StatusBadge } from '../components/Common';
import { api } from '../services/api';
import { formatDate } from '../utils/format';
import { useState } from 'react';

export default function UsersPage({ user, refreshKey, onChanged, openCreate, notify }) {
  const { data: users, error, loading } = useApiData('/api/users', refreshKey);
  const [deletingId, setDeletingId] = useState(null);
  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} />;
  const changeStatus = async account => {
    const enabling = !account.active;
    if (!window.confirm(`${enabling ? 'Enable' : 'Disable'} this staff account?`)) return;
    try {
      await api(`/api/users/${account.id}/status`, { method: 'PATCH', body: JSON.stringify({ active: enabling }) });
      notify(`Staff account ${enabling ? 'enabled' : 'disabled'}`); onChanged();
    } catch (requestError) { notify(requestError.message); }
  };
  const confirm = async account => {
    try {
      await api(`/api/users/${account.id}/confirm`, { method: 'POST', body: '{}' });
      notify('Staff email confirmed'); onChanged();
    } catch (requestError) { notify(requestError.message); }
  };
  const deleteAccount = async account => {
    if (deletingId || account.id === user.id) return;
    if (!window.confirm(`Delete account ${account.email}? This permanently removes its login. Use Disable instead when the account must be retained for operational records.`)) return;
    setDeletingId(account.id);
    try {
      await api(`/api/users/${account.id}`, { method: 'DELETE' });
      notify('Account deleted'); onChanged();
    } catch (requestError) { notify(requestError.message); }
    finally { setDeletingId(null); }
  };
  const columns = [
    { key: 'email', label: 'Email', render: account => <><strong>{account.email}</strong>{account.id === user.id && <span className="mono">Current account</span>}</> },
    { key: 'role', label: 'Role', render: account => <StatusBadge>{account.role}</StatusBadge> },
    { key: 'active', label: 'Access', render: account => <StatusBadge>{account.active ? 'Enabled' : 'Disabled'}</StatusBadge> },
    { key: 'auth_confirmed', label: 'Authentication', render: account => <StatusBadge>{account.auth_confirmed === null ? 'Unavailable' : account.auth_confirmed ? 'Confirmed' : 'Pending'}</StatusBadge> },
    { key: 'created_at', label: 'Created', render: account => formatDate(account.created_at) },
    { key: 'action', label: '', sortable: false, render: account => <div className="row-actions">{!account.auth_confirmed && account.auth_confirmed !== null && <button className="secondary button-with-icon" onClick={() => confirm(account)}><Icon name="badge-check" /><span>Confirm</span></button>}{account.id !== user.id && <button className="secondary" onClick={() => changeStatus(account)}>{account.active ? 'Disable' : 'Enable'}</button>}{account.id !== user.id && <button type="button" className="icon-button delete-button" aria-label={`Delete account ${account.email}`} title="Delete account" disabled={deletingId !== null} onClick={() => deleteAccount(account)}><Icon name="trash-2" /></button>}</div> }
  ];
  const activeUsers = users.filter(account => account.active).length;
  const admins = users.filter(account => account.role === 'admin').length;
  const staff = users.filter(account => account.role === 'staff').length;
  const riders = users.filter(account => account.role === 'rider').length;
  const pending = users.filter(account => account.auth_confirmed === false).length;
  return <><SectionHeading title="Users and roles" description="Manage staff access to ThermaVax operations." action={<button className="secondary accent button-with-icon" onClick={openCreate}><Icon name="user-plus" /><span>Add staff</span></button>} /><div className="stats five"><Stat label="Active users" value={activeUsers} /><Stat label="Admins" value={admins} /><Stat label="Staff" value={staff} /><Stat label="Riders" value={riders} /><Stat label="Pending" value={pending} tone={pending ? 'warning' : ''} /></div><section className="panel table-panel"><DataTable columns={columns} rows={users} getSearchText={account => `${account.email} ${account.role} ${account.active ? 'Enabled' : 'Disabled'}`} getStatuses={account => [account.role, account.active ? 'Enabled' : 'Disabled', account.auth_confirmed === null ? 'Unavailable' : account.auth_confirmed ? 'Confirmed' : 'Pending']} /></section></>;
}
