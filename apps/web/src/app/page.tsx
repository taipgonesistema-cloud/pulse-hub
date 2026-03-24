import { DashboardClient } from '@/components/dashboard-client';
import { getDashboardOverview } from '@/lib/pulse-hub';

export default async function Home() {
  const overview = await getDashboardOverview();

  return <DashboardClient initialOverview={overview} />;
}
