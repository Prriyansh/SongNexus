/** What a failed lookup says, with a way to ask again. */
export function LoadError({ error, retry }: { error: Error; retry: () => void }) {
  return (
    <div className="load-error" role="alert">
      <p className="error-text">{error.message}</p>
      <button className="secondary-button" onClick={retry}>
        Try again
      </button>
    </div>
  );
}
