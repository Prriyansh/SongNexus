import { NextResponse } from 'next/server';
import { artistNeighborhood } from '@/lib/artist-neighborhood';
import { parseDetailsParams, UpstreamError, ValidationError } from '@/lib/musicbrainz';

export const maxDuration = 60;

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    params.set('type', 'artist');
    const { id } = parseDetailsParams(params);
    const neighborhood = await artistNeighborhood(id);
    return NextResponse.json({ neighborhood }, { headers: { 'Cache-Control': neighborhood.failed.length ? 'no-store' : 'public, max-age=300' } });
  } catch (error) {
    if (error instanceof ValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof UpstreamError) return NextResponse.json({ error: error.message, retryable: error.retryable }, { status: error.status });
    return NextResponse.json({ error: 'Could not discover this artist’s neighborhood.' }, { status: 500 });
  }
}
