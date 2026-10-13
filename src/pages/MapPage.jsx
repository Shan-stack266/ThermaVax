import { useEffect, useRef } from 'react';
import L from 'leaflet';
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';
import useApiData from '../hooks/useApiData';
import { ErrorState, LoadingState, PanelHeader, SectionHeading, Stat, StatusBadge } from '../components/Common';
import { ShipmentTable } from './shared';

L.Icon.Default.mergeOptions({ iconRetinaUrl: markerIcon2x, iconUrl: markerIcon, shadowUrl: markerShadow });

function ShipmentMap({ shipments }) {
  const elementRef = useRef(null);
  const mapRef = useRef(null);
  useEffect(() => {
    if (!shipments.length || !elementRef.current) return undefined;
    try {
      const map = L.map(elementRef.current);
      mapRef.current = map;
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(map);
      const markers = shipments.map(item => {
        const popup = document.createElement('div');
        const title = document.createElement('strong');
        title.textContent = item.tracking_code;
        popup.append(title, document.createElement('br'), document.createTextNode(`${item.origin} to ${item.destination}`));
        return L.marker([item.latitude, item.longitude]).addTo(map).bindPopup(popup);
      });
      map.fitBounds(L.featureGroup(markers).getBounds().pad(.25), { maxZoom: 12 });
    } catch {
      elementRef.current.textContent = 'Map tiles are unavailable. Location coordinates remain listed below.';
      elementRef.current.classList.add('compact-empty');
    }
    return () => { mapRef.current?.remove(); mapRef.current = null; };
  }, [shipments]);
  return <div id="shipment-map" ref={elementRef}>{!shipments.length && <div className="compact-empty">No active shipment has a GPS reading yet.</div>}</div>;
}

export default function MapPage({ refreshKey, openShipment }) {
  const { data: shipments, error, loading } = useApiData('/api/map', refreshKey, { refreshIntervalMs: 5000 });
  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} />;
  const reporting = shipments.filter(item => item.device_connection === 'Reporting').length;
  const stale = shipments.filter(item => item.device_connection === 'Stale').length;
  const alerting = shipments.filter(item => Number(item.active_alerts || 0) > 0).length;
  return <>
    <SectionHeading title="Active shipment locations" />
    <div className="stats">
      <Stat label="Tracked shipments" value={shipments.length} />
      <Stat label="Reporting" value={reporting} />
      <Stat label="Stale devices" value={stale} tone={stale ? 'warning' : ''} />
      <Stat label="New alerts" value={alerting} tone={alerting ? 'danger' : ''} />
    </div>
    <div className="map-layout">
      <section className="panel map-panel"><ShipmentMap shipments={shipments} /></section>
      <section className="panel map-list-panel">
        <PanelHeader title="Tracked shipments" />
        <div className="list">
          {shipments.length ? shipments.map(item => (
            <button className="list-row" key={item.id} onClick={() => openShipment(item.id)}>
              <span>
                <strong>{item.tracking_code}</strong>
                <small>{item.origin} to {item.destination}</small>
              </span>
              <span>
                <StatusBadge>{item.device_connection || item.status}</StatusBadge>
                <small>{item.active_alerts ? `${item.active_alerts} new alerts` : 'No new alerts'}</small>
              </span>
            </button>
          )) : <div className="compact-empty">No active shipment has a GPS reading yet.</div>}
        </div>
      </section>
    </div>
    <ShipmentTable shipments={shipments} title="Located shipments" onShipment={openShipment} />
  </>;
}
