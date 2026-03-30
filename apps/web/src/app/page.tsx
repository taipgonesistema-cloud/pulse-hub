import { DashboardClient } from '@/components/dashboard-client';
import { fallbackOverview } from '@/lib/pulse-hub';

export default async function Home() {
  return <DashboardClient initialOverview={fallbackOverview} />;
}
