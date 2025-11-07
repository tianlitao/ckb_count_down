'use client';

import React, { useEffect, useState } from 'react';

export default function Providers({ children }: { children: React.ReactNode }) {
  const [CccProvider, setCccProvider] = useState<React.ComponentType<{ children: React.ReactNode }> | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const mod = await import('@ckb-ccc/connector-react');
        const ProviderComp: React.FC<{ children: React.ReactNode }> = ({ children }) => (
          <mod.ccc.Provider>{children}</mod.ccc.Provider>
        );
        if (mounted) setCccProvider(() => ProviderComp);
      } catch (_e) {
        // ignore; keep CccProvider null to avoid SSR crash
      }
    })();
    return () => { mounted = false; };
  }, []);

  if (!CccProvider) {
    // Avoid rendering children until ccc provider is ready to prevent hook usage outside provider
    return null;
  }

  return <CccProvider>{children}</CccProvider>;
}
