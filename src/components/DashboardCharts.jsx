import { useState } from 'react';
import { PanelHeader } from './Common';
import Icon from './Icon';

function BarChart({ title, items, selectedId }) {
  const values = items.map(item => Number(item.value) || 0);
  const maximum = Math.max(1, ...values);
  const summary = items.map(item => `${item.label}: ${item.value}`).join(', ');

  return <div
    id="dashboard-chart-panel"
    className="dashboard-chart-bars"
    role="tabpanel"
    aria-labelledby={`dashboard-chart-tab-${selectedId}`}
    aria-label={`${title}. ${summary}`}
  >
      {items.map(item => {
        const value = Number(item.value) || 0;
        const width = value === 0 ? 0 : Math.max(4, (value / maximum) * 100);
        return <div className="dashboard-chart-row" key={item.label}>
          <div className="dashboard-chart-label">
            <i className={`dashboard-chart-dot ${item.tone || 'primary'}`} aria-hidden="true" />
            <span title={item.label}>{item.label}</span>
          </div>
          <div className="dashboard-chart-track" aria-hidden="true">
            <span className={`dashboard-chart-fill ${item.tone || 'primary'}`} style={{ width: `${width}%` }} />
          </div>
          <strong className="dashboard-chart-value">{value.toLocaleString()}</strong>
        </div>;
      })}
  </div>;
}

function ColumnChart({ title, items, selectedId }) {
  const values = items.map(item => Number(item.value) || 0);
  const maximum = Math.max(1, ...values);
  const summary = items.map(item => `${item.label}: ${item.value}`).join(', ');

  return <div
    id="dashboard-chart-panel"
    className="dashboard-column-chart"
    role="tabpanel"
    aria-labelledby={`dashboard-chart-tab-${selectedId}`}
    aria-label={`${title}. ${summary}`}
    style={{ gridTemplateColumns: `repeat(${items.length}, minmax(54px, 1fr))` }}
  >
    {items.map(item => {
      const value = Number(item.value) || 0;
      const height = value === 0 ? 0 : Math.max(7, (value / maximum) * 100);
      return <div className="dashboard-column-item" key={item.label}>
        <div className="dashboard-column-plot">
          <span className={`dashboard-column-bar ${item.tone || 'primary'}`} style={{ height: `${height}%` }}>
            <strong>{value.toLocaleString()}</strong>
          </span>
        </div>
        <div className="dashboard-column-label" title={item.label}>
          <i className={`dashboard-chart-dot ${item.tone || 'primary'}`} aria-hidden="true" />
          <span>{item.label}</span>
        </div>
      </div>;
    })}
  </div>;
}

export default function DashboardCharts({ charts }) {
  const views = [
    {
      id: 'inventory',
      label: 'Inventory',
      icon: 'syringe',
      unit: 'doses',
      title: 'Available inventory',
      description: 'Doses currently available by vaccine',
      items: charts.inventory
    },
    {
      id: 'shipments',
      label: 'Shipments',
      icon: 'truck',
      unit: 'shipments',
      title: 'Shipment lifecycle',
      description: 'All shipments grouped by current status',
      items: charts.shipments
    },
    {
      id: 'expiration',
      label: 'Expiration',
      icon: 'clock-alert',
      unit: 'batches',
      title: 'Expiration health',
      description: 'Current batch expiration classification',
      items: charts.expiration
    },
    {
      id: 'temperature',
      label: 'Temperature',
      icon: 'triangle-alert',
      unit: 'active shipments',
      title: 'Temperature health',
      description: 'Active shipments with and without active alerts',
      items: charts.temperature
    }
  ];
  const [selectedId, setSelectedId] = useState(views[0].id);
  const [chartType, setChartType] = useState('bar');
  const selected = views.find(view => view.id === selectedId) || views[0];
  const total = selected.items.reduce((sum, item) => sum + (Number(item.value) || 0), 0);

  return <section className="panel dashboard-chart">
    <PanelHeader
      title={selected.title}
      description={selected.description}
      action={<div className="dashboard-chart-actions">
        <div className="dashboard-chart-total"><strong>{total.toLocaleString()}</strong><span>{selected.unit}</span></div>
        <div className="chart-type-toggle" role="group" aria-label="Chart view">
          <button type="button" className={chartType === 'bar' ? 'active' : ''} aria-pressed={chartType === 'bar'} title="Bar view" onClick={() => setChartType('bar')}><Icon name="chart-bar" /><span className="visually-hidden">Bar view</span></button>
          <button type="button" className={chartType === 'column' ? 'active' : ''} aria-pressed={chartType === 'column'} title="Column view" onClick={() => setChartType('column')}><Icon name="chart-column" /><span className="visually-hidden">Column view</span></button>
        </div>
      </div>}
    />
    <div className="dashboard-chart-tabs" role="tablist" aria-label="Dashboard chart">
      {views.map(view => <button
        key={view.id}
        id={`dashboard-chart-tab-${view.id}`}
        type="button"
        role="tab"
        aria-selected={selected.id === view.id}
        aria-controls="dashboard-chart-panel"
        className={selected.id === view.id ? 'active' : ''}
        onClick={() => setSelectedId(view.id)}
      ><Icon name={view.icon} /> <span>{view.label}</span></button>)}
    </div>
    {chartType === 'column'
      ? <ColumnChart title={selected.title} items={selected.items} selectedId={selected.id} />
      : <BarChart title={selected.title} items={selected.items} selectedId={selected.id} />}
  </section>;
}
