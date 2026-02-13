import React, { useState, useRef } from 'react';
import { X, Microscope, Pill, Clock, Video, Play, Pause, MapPin, Database } from 'lucide-react';
import { useSample } from '../context/SampleContext';

const SamplePanel: React.FC = () => {
  const { selectedSample, setSelectedSample, visualizerOptions } = useSample();
  const [videoLoadError, setVideoLoadError] = useState<Record<number, boolean>>({});
  const [videoLoading, setVideoLoading] = useState<Record<number, boolean>>({});
  const [isPlaying, setIsPlaying] = useState(false);
  const [imageLoadError, setImageLoadError] = useState<Record<number, boolean>>({});
  const [imageLoading, setImageLoading] = useState<Record<number, boolean>>({});
  const videoRefs = useRef<(HTMLVideoElement | null)[]>([]);

  const handleVideoError = (index: number) => {
    setVideoLoadError((prev) => ({ ...prev, [index]: true }));
    setVideoLoading((prev) => ({ ...prev, [index]: false }));
  };

  const handleVideoLoadStart = (index: number) => {
    setVideoLoading((prev) => ({ ...prev, [index]: true }));
  };

  const handleVideoCanPlay = (index: number) => {
    setVideoLoading((prev) => ({ ...prev, [index]: false }));
  };

  const togglePlayPause = () => {
    const newPlayingState = !isPlaying;
    setIsPlaying(newPlayingState);
    videoRefs.current.forEach((video) => {
      if (video) {
        if (newPlayingState) video.play();
        else video.pause();
      }
    });
  };

  const handleTimeUpdate = (event: React.SyntheticEvent<HTMLVideoElement>) => {
    const currentVideo = event.currentTarget;
    videoRefs.current.forEach((video) => {
      if (video && video !== currentVideo && Math.abs(video.currentTime - currentVideo.currentTime) > 0.1) {
        video.currentTime = currentVideo.currentTime;
      }
    });
  };

  const handleVideoEnded = () => {
    setIsPlaying(false);
    videoRefs.current.forEach((video) => {
      if (video) video.currentTime = 0;
    });
  };

  const handleImageError = (index: number) => {
    setImageLoadError((prev) => ({ ...prev, [index]: true }));
    setImageLoading((prev) => ({ ...prev, [index]: false }));
  };

  const handleImageLoadStart = (index: number) => {
    setImageLoading((prev) => ({ ...prev, [index]: true }));
  };

  const handleImageLoad = (index: number) => {
    setImageLoading((prev) => ({ ...prev, [index]: false }));
  };

  const getColorStyle = () => {
    if (!selectedSample) return {};
    const color = visualizerOptions.coloringMode === 'phenotype' ? selectedSample.color_phenotypic : selectedSample.color;
    return { backgroundColor: `rgb(${color.r * 255}, ${color.g * 255}, ${color.b * 255})` };
  };

  const getContrastColor = () => {
    if (!selectedSample) return 'text-black';
    const color = visualizerOptions.coloringMode === 'phenotype' ? selectedSample.color_phenotypic : selectedSample.color;
    const luminance = 0.299 * color.r + 0.587 * color.g + 0.114 * color.b;
    return luminance > 0.5 ? 'text-black' : 'text-white';
  };

  return (
    <div className="w-[420px] min-w-[420px] bg-black border-l border-white/10 h-full flex flex-col overflow-hidden">
      {selectedSample ? (
        <>
          <div
            className="shrink-0 px-6 py-4 border-b border-white/10"
            style={{ ...getColorStyle(), color: undefined }}
          >
            <div className="flex justify-between items-start">
              <div>
                <h3 className={`text-lg font-semibold ${getContrastColor()}`}>
                  {selectedSample.treatment.drug}
                </h3>
                <div className={`mt-1 flex items-center gap-2 ${getContrastColor()} opacity-90`}>
                  <MapPin size={12} />
                  <span className="text-xs">
                    ({selectedSample.x.toFixed(2)}, {selectedSample.y.toFixed(2)}, {selectedSample.z.toFixed(2)})
                  </span>
                </div>
                <div className={`mt-2 flex flex-wrap gap-2 ${getContrastColor()}`}>
                  <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-black/20 backdrop-blur-sm">
                    {selectedSample.phenotype}
                  </span>
                  {selectedSample.t !== undefined && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-black/20 backdrop-blur-sm">
                      <Clock size={10} />
                      T{selectedSample.t}
                    </span>
                  )}
                </div>
              </div>
              <button
                onClick={() => setSelectedSample(null)}
                className={`p-2 rounded-lg ${getContrastColor()} opacity-80 hover:opacity-100 hover:bg-black/10 transition-all`}
                title="Close"
              >
                <X size={18} />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto scrollbar-thin px-6 py-5 space-y-6">
            {(selectedSample.videos || selectedSample.images) && (
              <section>
                <h4 className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-3 flex items-center gap-2">
                  {selectedSample.videos ? (
                    <>
                      <Video size={14} className="text-white/60" />
                      4D Movie
                    </>
                  ) : (
                    <>
                      <Microscope size={14} className="text-white/60" />
                      Images
                    </>
                  )}
                </h4>
                {selectedSample.videos ? (
                  <div className="space-y-4">
                    {selectedSample.videos.length > 1 && (
                      <button onClick={togglePlayPause} className="btn-primary w-full text-sm">
                        {isPlaying ? <><Pause size={14} className="mr-2" />Pause</> : <><Play size={14} className="mr-2" />Play all</>}
                      </button>
                    )}
                    {selectedSample.videos.map((video, index) => (
                      <div key={index} className="rounded-xl overflow-hidden bg-white/5 border border-white/10">
                        <div className="relative aspect-video">
                          {videoLoadError[index] ? (
                            <div className="absolute inset-0 flex items-center justify-center text-white/40">
                              <Video size={24} className="mb-2" />
                              <p className="text-xs">Video unavailable</p>
                            </div>
                          ) : (
                            <>
                              <video
                                ref={(el) => (videoRefs.current[index] = el)}
                                src={video}
                                preload="metadata"
                                className="absolute inset-0 w-full h-full object-cover"
                                onError={() => handleVideoError(index)}
                                onLoadStart={() => handleVideoLoadStart(index)}
                                onCanPlay={() => handleVideoCanPlay(index)}
                                onTimeUpdate={handleTimeUpdate}
                                onEnded={handleVideoEnded}
                              />
                              {videoLoading[index] && (
                                <div className="absolute inset-0 flex items-center justify-center bg-black/60">
                                  <div className="w-8 h-8 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="space-y-4">
                    {selectedSample.images?.map((image, index) => (
                      <div key={index} className="rounded-xl overflow-hidden bg-white/5 border border-white/10">
                        <div className="relative aspect-video">
                          {imageLoadError[index] ? (
                            <div className="absolute inset-0 flex items-center justify-center text-white/40">
                              <Microscope size={24} className="mb-2" />
                              <p className="text-xs">Image unavailable</p>
                            </div>
                          ) : (
                            <>
                              <img
                                src={image}
                                alt={`Sample ${index + 1}`}
                                className="w-full h-full object-cover"
                                loading="lazy"
                                onError={() => handleImageError(index)}
                                onLoadStart={() => handleImageLoadStart(index)}
                                onLoad={() => handleImageLoad(index)}
                              />
                              {imageLoading[index] && (
                                <div className="absolute inset-0 flex items-center justify-center bg-black/60">
                                  <div className="w-8 h-8 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            )}

            <section>
              <h4 className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-3 flex items-center gap-2">
                <Pill size={14} className="text-white/60" />
                Treatment
              </h4>
              <div className="rounded-xl border border-white/10 overflow-hidden">
                <div className="grid grid-cols-2 divide-x divide-white/10">
                  <div className="p-4 text-center">
                    <p className="text-xs font-medium text-white/50 mb-0.5">Drug</p>
                    <p className="text-sm font-medium text-white">{selectedSample.treatment.drug.toUpperCase()}</p>
                  </div>
                  <div className="p-4 text-center">
                    <p className="text-xs font-medium text-white/50 mb-0.5">Dose</p>
                    <p className="text-sm font-medium text-white">{selectedSample.treatment.dose}</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 divide-x divide-t divide-white/10 border-t border-white/10">
                  <div className="p-4">
                    <p className="text-xs font-medium text-white/50 mb-0.5">SMILES</p>
                    <p className="text-xs text-white/80 break-all">{selectedSample.treatment.smiles || 'N/A'}</p>
                  </div>
                  <div className="p-4 flex flex-col justify-center items-center">
                    <p className="text-xs font-medium text-white/50 mb-0.5">PubChem</p>
                    {selectedSample.treatment.pubchem ? (
                      <a
                        href={`https://pubchem.ncbi.nlm.nih.gov/compound/${selectedSample.treatment.pubchem}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-white hover:text-white/80 font-medium"
                      >
                        View
                      </a>
                    ) : (
                      <span className="text-sm text-white/50">N/A</span>
                    )}
                  </div>
                </div>
              </div>
            </section>

            <section>
              <h4 className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-3">Colors</h4>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg border border-white/10 p-3">
                  <p className="text-xs font-medium text-white/50 mb-2">Treatment</p>
                  <div className="flex items-center gap-2">
                    <div
                      className="w-8 h-8 rounded-lg border border-white/20"
                      style={{
                        backgroundColor: `rgb(${selectedSample.color.r * 255}, ${selectedSample.color.g * 255}, ${selectedSample.color.b * 255})`,
                      }}
                    />
                    <span className="text-xs text-white/60 tabular-nums">
                      RGB({Math.round(selectedSample.color.r * 255)}, {Math.round(selectedSample.color.g * 255)}, {Math.round(selectedSample.color.b * 255)})
                    </span>
                  </div>
                </div>
                <div className="rounded-lg border border-white/10 p-3">
                  <p className="text-xs font-medium text-white/50 mb-2">Phenotype</p>
                  <div className="flex items-center gap-2">
                    <div
                      className="w-8 h-8 rounded-lg border border-white/20"
                      style={{
                        backgroundColor: `rgb(${selectedSample.color_phenotypic.r * 255}, ${selectedSample.color_phenotypic.g * 255}, ${selectedSample.color_phenotypic.b * 255})`,
                      }}
                    />
                    <span className="text-xs text-white/60 tabular-nums">
                      RGB({Math.round(selectedSample.color_phenotypic.r * 255)}, {Math.round(selectedSample.color_phenotypic.g * 255)}, {Math.round(selectedSample.color_phenotypic.b * 255)})
                    </span>
                  </div>
                </div>
              </div>
            </section>

            <section>
              <h4 className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-3 flex items-center gap-2">
                <Database size={14} className="text-white/60" />
                Metadata
              </h4>
              <div className="rounded-xl border border-white/10 overflow-hidden">
                <table className="w-full text-sm">
                  <tbody>
                    {Object.entries(selectedSample.metadata).map(([key, value]) => (
                      <tr key={key} className="border-b border-white/5 last:border-0">
                        <td className="py-2.5 px-4 font-medium text-white/50 capitalize">{key}</td>
                        <td className="py-2.5 px-4 text-white/90">{value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        </>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center px-8 text-center">
          <div className="w-16 h-16 rounded-2xl bg-white/5 flex items-center justify-center mb-4">
            <Microscope size={28} className="text-white/40" />
          </div>
          <p className="text-base font-medium text-white mb-2">No sample selected</p>
          <p className="text-sm text-white/50 max-w-[240px]">
            Click any point in the visualization to view sample details, media, and treatment data.
          </p>
        </div>
      )}
    </div>
  );
};

export default SamplePanel;
