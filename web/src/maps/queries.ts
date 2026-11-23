/** Data hooks for the similar-music maps, playlist maps and playlist rooms. */
import {useMutation, useQuery, type QueryClient} from '@tanstack/react-query';

import {api, unwrap, type Schemas} from '../api/client';

import type {Track} from './playlist';

const MINUTE = 60_000;
const MAP_CACHE = {staleTime: 30 * MINUTE, gcTime: 60 * MINUTE} as const;

export type SimilarMap = Schemas['SimilarMap'];
export type TasteMap = Schemas['TasteMap'];
export type TasteRoom = Schemas['TasteRoom'];

/** A map that couldn't reach its source answers again on the next visit. */
const stale = (data: SimilarMap | undefined) =>
  data?.sources.some(s => s.status === 'UNAVAILABLE' || s.status === 'PARTIAL')
    ? 0
    : MAP_CACHE.staleTime;

export function fetchArtistMap(id: string): Promise<SimilarMap> {
  return unwrap(
    api.GET('/v1/artists/{artist}:similar', {params: {path: {artist: id}}}),
  );
}

export function useArtistMap(id: string | undefined) {
  return useQuery({
    queryKey: ['map', 'artist', id],
    queryFn: () => fetchArtistMap(id!),
    enabled: Boolean(id),
    ...MAP_CACHE,
    staleTime: q => stale(q.state.data),
  });
}

/** For zoom-in discovery: the same cache as `useArtistMap`. */
export function prefetchArtistMap(client: QueryClient, id: string) {
  return client.fetchQuery({
    queryKey: ['map', 'artist', id],
    queryFn: () => fetchArtistMap(id),
    ...MAP_CACHE,
  });
}

export function useSongMap(id: string | undefined) {
  return useQuery({
    queryKey: ['map', 'song', id],
    queryFn: () =>
      unwrap(
        api.GET('/v1/recordings/{recording}:similar', {
          params: {path: {recording: id!}},
        }),
      ),
    enabled: Boolean(id),
    ...MAP_CACHE,
    staleTime: q => stale(q.state.data),
  });
}

export function useCompareMap(a: string | undefined, b: string | undefined) {
  return useQuery({
    queryKey: ['map', 'compare', a, b],
    queryFn: () =>
      unwrap(
        api.GET('/v1/artists/{artist}:compareMap', {
          params: {path: {artist: a!}, query: {other: `artists/${b!}`}},
        }),
      ),
    enabled: Boolean(a && b && a !== b),
    ...MAP_CACHE,
  });
}

export function useTasteMap(
  mine: Track[] | null,
  friend: Track[] | null,
  friendName: string,
) {
  return useQuery({
    queryKey: ['map', 'taste', mine, friend, friendName],
    queryFn: () =>
      unwrap(
        api.POST('/v1/tasteMaps', {
          body: {
            mine: mine!,
            ...(friend ? {friend, friendName: friendName.slice(0, 30)} : {}),
          },
        }),
      ),
    enabled: Boolean(mine?.length),
    ...MAP_CACHE,
  });
}

export function useCreateRoom() {
  return useMutation({
    mutationFn: (member: Schemas['RoomMember-Input']) =>
      unwrap(api.POST('/v1/tasteRooms', {body: member})),
  });
}

export function useJoinRoom() {
  return useMutation({
    mutationFn: ({
      code,
      member,
    }: {
      code: string;
      member: Schemas['RoomMember-Input'];
    }) =>
      unwrap(
        api.POST('/v1/tasteRooms/{code}:join', {
          params: {path: {code}},
          body: member,
        }),
      ),
  });
}

export function useRoom(code: string | null) {
  return useQuery({
    queryKey: ['tasteRoom', code],
    queryFn: () =>
      unwrap(api.GET('/v1/tasteRooms/{code}', {params: {path: {code: code!}}})),
    enabled: Boolean(code),
    staleTime: 0,
    // Waiting for a friend to join: look again every few seconds until they do.
    refetchInterval: q => (q.state.data && !q.state.data.guest ? 5000 : false),
  });
}
