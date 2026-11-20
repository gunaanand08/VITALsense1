import { Activity, FileText, HeartPulse, History, LayoutDashboard, Settings2 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export interface NavItem {
  to: string;
  label: string;
  shortLabel: string;
  description: string;
  icon: LucideIcon;
}

export const NAV_ITEMS: NavItem[] = [
  {
    to: '/',
    label: 'Overview',
    shortLabel: 'Overview',
    description: 'Live monitoring workspace',
    icon: LayoutDashboard,
  },
  {
    to: '/ecg',
    label: 'ECG Analysis',
    shortLabel: 'ECG',
    description: 'Signal inspection and processing',
    icon: Activity,
  },
  {
    to: '/hrv',
    label: 'Heart Rate & HRV',
    shortLabel: 'HRV',
    description: 'Rate and variability metrics',
    icon: HeartPulse,
  },
  {
    to: '/sessions',
    label: 'Session History',
    shortLabel: 'Sessions',
    description: 'Recorded sessions and exports',
    icon: History,
  },
  {
    to: '/reports',
    label: 'Reports',
    shortLabel: 'Reports',
    description: 'CSV and PDF delivery',
    icon: FileText,
  },
  {
    to: '/settings',
    label: 'Device Settings',
    shortLabel: 'Settings',
    description: 'Source, device and filters',
    icon: Settings2,
  },
];
