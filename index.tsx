import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import SeasonBacktestPanel from './components/SeasonBacktestPanel';
import { BUILD_META, shortCommit } from './buildMeta';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const builtLabel = Number.isNaN(Date.parse(BUILD_META.builtAt))
  ? BUILD_META.builtAt
  : new Date(BUILD_META.builtAt).toLocaleString();

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <div className="relative min-h-screen bg-gray-950">
      <SeasonBacktestPanel />
      <App />
      <div className="fixed bottom-3 right-3 z-50 max-w-[calc(100vw-1.5rem)] rounded-lg border border-emerald-500/25 bg-gray-950/95 px-3 py-2 text-[10px] sm:text-xs text-gray-300 shadow-xl backdrop-blur">
        <span className="font-bold text-emerald-300">Last deployed:</span>{' '}
        {builtLabel}
        <span className="mx-1.5 text-gray-600">·</span>
        <span className="font-mono text-indigo-300">{shortCommit}</span>
        <span className="mx-1.5 text-gray-600">·</span>
        <span className="uppercase text-gray-500">{BUILD_META.environment}</span>
      </div>
    </div>
  </React.StrictMode>
);
