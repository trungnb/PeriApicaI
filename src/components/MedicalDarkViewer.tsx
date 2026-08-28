import React from 'react';
import { Maximize2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../store/appStore';

interface MedicalDarkViewerProps {
  imageDataUrl?: string;
  toothFdi?: string;
  technique?: string;
  receptor?: string;
  showScannerBeam?: boolean;
  className?: string;
}

export const MedicalDarkViewer: React.FC<MedicalDarkViewerProps> = React.memo(({
  imageDataUrl,
  showScannerBeam = false,
  className = '',
}) => {
  const { t } = useTranslation('common');
  const appEngineMode = useAppStore((state) => state.appEngineMode);
  const isPathology = appEngineMode === 'pathology_segmentation';

  return (
    <div className={`bg-slate-950 rounded-2xl p-2 border border-slate-800 shadow-md relative overflow-hidden flex flex-col ${className}`}>
      {/* Radiograph Canvas Area */}
      <div className="relative w-full aspect-[4/5] bg-black rounded-xl overflow-hidden border border-slate-900 flex items-center justify-center select-none group">
        {imageDataUrl ? (
          <div className="relative w-full h-full flex items-center justify-center">
            <img
              src={imageDataUrl}
              alt="Dental Radiograph"
              referrerPolicy="no-referrer"
              className="max-h-full max-w-full object-contain pointer-events-none"
            />
          </div>
        ) : (
          <div className="p-8 text-center text-slate-500 text-xs space-y-1">
            <Maximize2 className="w-8 h-8 mx-auto text-slate-700" />
            <p>{t('noImageLoaded')}</p>
          </div>
        )}

        {/* AI Laser Scanner Beam animation when analyzing */}
        {showScannerBeam && imageDataUrl && (
          <div className="absolute inset-0 pointer-events-none overflow-hidden">
            <div className={`w-full h-1 bg-gradient-to-r from-transparent to-transparent animate-[scan_3s_ease-in-out_infinite] ${
              isPathology
                ? 'via-teal-400 shadow-[0_0_15px_#14b8a6,0_0_30px_#14b8a6]'
                : 'via-blue-400 shadow-[0_0_15px_#3b82f6,0_0_30px_#3b82f6]'
            }`} />
            <div className={`absolute inset-x-0 top-0 h-24 bg-gradient-to-b to-transparent animate-[scan_3s_ease-in-out_infinite] ${
              isPathology
                ? 'from-teal-500/15'
                : 'from-blue-500/10'
            }`} />
          </div>
        )}
      </div>
    </div>
  );
});
