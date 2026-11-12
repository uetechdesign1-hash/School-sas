'use client';

import dynamic from 'next/dynamic';

const ClickToComponent = dynamic(
  () => import('click-to-react-component').then((mod) => mod.ClickToComponent),
  { ssr: false }
);

export default function DevInspector() {
  if (process.env.NODE_ENV !== 'development') {
    return null;
  }

  return <ClickToComponent editor="vscode" />;
}