'use client';

import dynamic from 'next/dynamic';

// The app reads window.location and localStorage on first render, so it only renders in the browser.
const App = dynamic(() => import('./App'), {
  ssr: false,
  loading: () => <div className="app-boot" role="status" aria-label="Loading Song Nexus" />,
});

export default function ClientApp() {
  return <App />;
}
