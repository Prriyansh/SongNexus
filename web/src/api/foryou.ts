/**
 * For You (the server's recommendations) and the Personalize page's data: artists suggested
 * for chosen genres, the feed (signed in) or a feed preview from picks (signed out, nothing is
 * stored on the server), and following picked artists.
 */
import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';

import {api, idOf, unwrap, type Schemas} from './client';

export type FeedItem = Schemas['FeedItem'];
export type Feed = Schemas['Feed'];

const MINUTE = 60_000;
const SUGGESTIONS_PER_GENRE = 12;
export const FEED_SIZE = 12;

/** The best-connected artists of each chosen genre, for the Personalize page. */
export function useGenreSuggestions(genres: string[]) {
  return useQueries({
    queries: genres.map(genre => ({
      queryKey: ['genreArtists', genre, SUGGESTIONS_PER_GENRE],
      queryFn: () =>
        unwrap(
          api.GET('/v1/genres/{genre}/artists', {
            params: {
              path: {genre: idOf(genre)},
              query: {pageSize: SUGGESTIONS_PER_GENRE},
            },
          }),
        ),
      staleTime: 30 * MINUTE,
    })),
  });
}

/**
 * The listener's For You feed: their own when signed in, or a preview from the artists they
 * picked in this browser when signed out (disabled when there are none).
 */
export function useForYou(signedIn: boolean, seeds: string[]) {
  return useQuery({
    queryKey: ['forYou', signedIn, signedIn ? [] : seeds],
    queryFn: (): Promise<Feed> =>
      signedIn
        ? unwrap(
            api.GET('/v1/users/{user}/feed', {
              params: {path: {user: 'me'}, query: {pageSize: FEED_SIZE}},
            }),
          )
        : unwrap(
            api.POST('/v1/feed:preview', {
              body: {seeds, exclude: [], pageSize: FEED_SIZE},
            }),
          ),
    enabled: signedIn || seeds.length > 0,
    staleTime: 10 * MINUTE,
  });
}

/** Follows the given artists (`artists/{id}`), skipping ones already followed. */
export function useFollowArtists() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (artists: string[]) => {
      const followed = await unwrap(
        api.GET('/v1/users/{user}/followedArtists', {
          params: {path: {user: 'me'}},
        }),
      );
      const already = new Set(
        followed.followedArtists.flatMap(f =>
          f.artist ? [f.artist.name] : [],
        ),
      );
      for (const artist of artists.filter(a => !already.has(a))) {
        await unwrap(
          api.POST('/v1/users/{user}/followedArtists', {
            params: {path: {user: 'me'}},
            body: {artist},
          }),
        );
      }
    },
    onSettled: () => queryClient.invalidateQueries({queryKey: ['forYou']}),
  });
}
