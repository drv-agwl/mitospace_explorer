import React, { useEffect, useState } from 'react';
import { Monitor, Smartphone } from 'lucide-react';
import MitoSpaceLogo from './MitoSpaceLogo';

const MobileBlocker: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => {
      // Check screen size
      const screenCheck = window.innerWidth < 1024;
      
      // Check user agent for mobile devices
      const userAgentCheck = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
        navigator.userAgent
      );
      
      // Check for touch device
      const touchCheck = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
      
      // Consider it mobile if it's a small screen or a mobile user agent
      setIsMobile(screenCheck || userAgentCheck);
    };

    checkMobile();
    window.addEventListener('resize', checkMobile);
    
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  if (!isMobile) {
    return <>{children}</>;
  }

  return (
    <div className="fixed inset-0 bg-gradient-to-br from-black via-gray-900 to-black flex items-center justify-center p-6 overflow-hidden">
      {/* Animated background pattern */}
      <div className="absolute inset-0 opacity-10">
        <div className="absolute top-1/4 left-1/4 w-64 h-64 bg-blue-500 rounded-full filter blur-3xl animate-pulse" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-purple-500 rounded-full filter blur-3xl animate-pulse" style={{ animationDelay: '1s' }} />
      </div>

      <div className="relative max-w-md w-full">
        {/* Logo */}
        <div className="flex justify-center mb-8">
          <div className="w-20 h-20 bg-white/10 backdrop-blur-sm rounded-2xl border border-white/20 flex items-center justify-center shadow-2xl">
            <MitoSpaceLogo variant="dark" className="w-14 h-14" />
          </div>
        </div>

        {/* Main content card */}
        <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-3xl p-8 shadow-2xl">
          <div className="text-center mb-6">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-amber-500/20 rounded-2xl mb-4">
              <Smartphone className="w-8 h-8 text-amber-400" strokeWidth={2} />
            </div>
            <h1 className="text-2xl font-bold text-white mb-2">
              Mobile Not Supported
            </h1>
            <p className="text-white/60 text-sm leading-relaxed">
              MitoSpace Explorer requires a larger screen for optimal visualization and interaction.
            </p>
          </div>

          <div className="bg-white/5 rounded-2xl p-6 mb-6 border border-white/10">
            <div className="flex items-start gap-4">
              <div className="flex-shrink-0">
                <div className="w-12 h-12 bg-blue-500/20 rounded-xl flex items-center justify-center">
                  <Monitor className="w-6 h-6 text-blue-400" strokeWidth={2} />
                </div>
              </div>
              <div>
                <h3 className="text-white font-semibold mb-1">
                  Please use a desktop or laptop
                </h3>
                <p className="text-white/50 text-sm leading-relaxed">
                  For the best experience, access MitoSpace Explorer on a device with a screen width of at least 1024px.
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-2 text-xs text-white/40">
            <p className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 bg-white/40 rounded-full" />
              3D visualization requires desktop performance
            </p>
            <p className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 bg-white/40 rounded-full" />
              Interactive controls need larger screen space
            </p>
            <p className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 bg-white/40 rounded-full" />
              Complex data analysis requires precision
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="text-center mt-8">
          <p className="text-white/30 text-xs">
            Bookmark this page and return on your desktop
          </p>
        </div>
      </div>
    </div>
  );
};

export default MobileBlocker;
