import { NextResponse } from 'next/server';
import { refreshTrending, getTrendingData, ensureTrendingRefresh } from '@/lib/content/serverTrending';

export async function POST() {
  ensureTrendingRefresh();
  await refreshTrending();
  return NextResponse.json(getTrendingData());
}
