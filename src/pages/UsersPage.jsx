import useApiData from '../hooks/useApiData';
import DataTable from '../components/DataTable';
import Icon from '../components/Icon';
import { ErrorState, LoadingState, SectionHeading, StatusBadge } from '../components/Common';
import { api } from '../services/api';
import { formatDate } from '../utils/format';

export default function UsersPage({ user, refreshKey, onChanged, openCreate, notify }) {
  const { data: users, error, loading } = useApiData('/api/users', refreshKey);
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
  const columns = [
    { key: 'email', label: 'Email', render: account => <><strong>{account.email}</strong>{account.id === user.id && <span className="mono">Current account</span>}</> },
    { key: 'role', label: 'Role', render: account => <StatusBadge>{account.role}</StatusBadge> },
    { key: 'active', label: 'Access', render: account => <StatusBadge>{account.active ? 'Enabled' : 'Disabled'}</StatusBadge> },
    { key: 'auth_confirmed', label: 'Authentication', render: account => <StatusBadge>{account.auth_confirmed === null ? 'Unavailable' : account.auth_confirmed ? 'Confirmed' : 'Pending'}</StatusBadge> },
    { key: 'created_at', label: 'Created', render: account => formatDate(account.created_at) },
    { key: 'action', label: '', sortable: false, render: account => <div className="row-actions">{!account.auth_confirmed && account.auth_confirmed !== null && <button className="secondary button-with-icon" onClick={() => confirm(account)}><Icon name="badge-check" /><span>Confirm</span></button>}{account.id !== user.id && <button className="secondary" onClick={() => changeStatus(account)}>{account.active ? 'Disable' : 'Enable'}</button>}</div> }
  ];
  return <><SectionHeading title="Users and roles" description="Manage staff access to ThermaVax operations." action={<button className="secondary accent button-with-icon" onClick={openCreate}><Icon name="user-plus" /><span>Add staff</span></button>} /><section className="panel table-panel"><DataTable columns={columns} rows={users} getSearchText={account => `${account.email} ${account.role} ${account.active ? 'Enabled' : 'Disabled'}`} getStatuses={account => [account.role, account.active ? 'Enabled' : 'Disabled', account.auth_confirmed === null ? 'Unavailable' : account.auth_confirmed ? 'Confirmed' : 'Pending']} /></section></>;
}
