import {
  BadgeCheck, ChartBar, ChartColumn, Check, ChevronLeft, ChevronRight, Circle, CircleCheck, CircleDot,
  ClockAlert, Download, FileChartColumn, LayoutDashboard, LogOut, MapPinPlus,
  MapPinned, Menu, Moon, Package, PackageCheck, Plus, RefreshCw, Search, Sun, Syringe,
  Trash2, TriangleAlert, Truck, UserPlus, Users, X
} from 'lucide-react';

const icons = {
  'badge-check': BadgeCheck, 'chart-bar': ChartBar, 'chart-column': ChartColumn,
  check: Check, 'chevron-left': ChevronLeft,
  'chevron-right': ChevronRight, circle: Circle, 'circle-check': CircleCheck,
  'circle-dot': CircleDot, 'clock-alert': ClockAlert, download: Download,
  'file-chart-column': FileChartColumn, 'layout-dashboard': LayoutDashboard,
  'log-out': LogOut, 'map-pin-plus': MapPinPlus, 'map-pinned': MapPinned,
  menu: Menu, moon: Moon, package: Package, 'package-check': PackageCheck, plus: Plus,
  'refresh-cw': RefreshCw, search: Search, syringe: Syringe,
  sun: Sun, 'trash-2': Trash2, 'triangle-alert': TriangleAlert, truck: Truck, 'user-plus': UserPlus,
  users: Users, x: X
};

export default function Icon({ name, ...props }) {
  const Component = icons[name] || Circle;
  return <Component aria-hidden="true" {...props} />;
}
