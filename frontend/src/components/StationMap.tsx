import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import { MapPin } from 'lucide-react';
import type { Device } from '@/lib/data';
import { isDeviceOnline } from '@/lib/data';

const pinIcon = (online: boolean) =>
  L.divIcon({
    className: '',
    html: `<div style="width:20px;height:20px;border-radius:9999px;border:3px solid white;box-shadow:0 1px 4px rgba(0,0,0,.35);background:${online ? '#0d9488' : '#dc2626'}"></div>`,
    iconSize: [20, 20],
    iconAnchor: [10, 10],
  });

export default function StationMap({ devices }: { devices: Device[] }) {
  return (
    <MapContainer
      center={[16.5, 108.0]}
      zoom={5}
      className="h-full w-full z-0"
      scrollWheelZoom
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {devices.map((d) => {
        const online = isDeviceOnline(d);
        return (
          <Marker key={d.id} position={[d.lat, d.lng]} icon={pinIcon(online)}>
            <Popup>
              <div className="min-w-[180px]">
                <div className="flex items-center gap-1.5 font-semibold text-slate-800">
                  <MapPin size={13} className="text-teal-600" />
                  {d.name}
                </div>
                <div className="text-xs text-slate-500 mb-1">{d.code}</div>
                <div className={`text-xs font-medium ${online ? 'text-teal-600' : 'text-red-600'}`}>
                  {online ? 'Đang hoạt động' : 'Mất kết nối'}
                </div>
              </div>
            </Popup>
          </Marker>
        );
      })}
    </MapContainer>
  );
}
