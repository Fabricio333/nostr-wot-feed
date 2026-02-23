import { NextResponse } from 'next/server';
import { getTrendingData, ensureTrendingRefresh } from '@/lib/content/serverTrending';

export async function GET() {
  ensureTrendingRefresh();
  return NextResponse.json(getTrendingData());
}
