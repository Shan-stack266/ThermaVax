import { useEffect, useRef } from 'react';
import L from 'leaflet';
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';
import useApiData from '../hooks/useApiData';
import { ErrorState, LoadingState, SectionHeading } from '../components/Common';
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
  return <><SectionHeading title="Active shipment locations" description="Latest GPS reading received for each active shipment." /><section className="panel map-panel"><ShipmentMap shipments={shipments} /></section><ShipmentTable shipments={shipments} title="Located shipments" onShipment={openShipment} /></>;
}
