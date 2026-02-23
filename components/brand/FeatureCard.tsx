'use client';

import React from 'react';

export function FeatureCard({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return (
    <div className="bg-zinc-900/40 border border-zinc-800/60 rounded-xl p-5 space-y-2">
      <div className="flex items-center gap-3">
        {icon}
        <h3 className="font-semibold text-white">{title}</h3>
      </div>
      <p className="text-zinc-400 text-sm leading-relaxed">{description}</p>
    </div>
  );
}
