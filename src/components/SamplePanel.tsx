import React, { useState, useRef } from 'react';
import { X, Microscope, Pill, Clock, Dna, Video, Play, Pause, Info, MapPin, Cpu, Database } from 'lucide-react';
import { useSample } from '../context/SampleContext';

const SamplePanel: React.FC = () => {
  const { selectedSample, setSelectedSample, visualizerOptions } = useSample();
  const [videoLoadError, setVideoLoadError] = useState<Record<number, boolean>>({});
  const [videoLoading, setVideoLoading] = useState<Record<number, boolean>>({});
  const [isPlaying, setIsPlaying] = useState(false);
  // No longer using tabs as per requirement
  const videoRefs = useRef<(HTMLVideoElement | null)[]>([]);
  
  const handleVideoError = (index: number) => {
    setVideoLoadError(prev => ({ ...prev, [index]: true }));
    setVideoLoading(prev => ({ ...prev, [index]: false }));
  };

  const handleVideoLoadStart = (index: number) => {
    setVideoLoading(prev => ({ ...prev, [index]: true }));
  };

  const handleVideoCanPlay = (index: number) => {
    setVideoLoading(prev => ({ ...prev, [index]: false }));
  };

  const togglePlayPause = () => {
    const newPlayingState = !isPlaying;
    setIsPlaying(newPlayingState);
    
    videoRefs.current.forEach(video => {
      if (video) {
        if (newPlayingState) {
          video.play();
        } else {
          video.pause();
        }
      }
    });
  };

  const handleTimeUpdate = (event: React.SyntheticEvent<HTMLVideoElement>) => {
    const currentVideo = event.currentTarget;
    videoRefs.current.forEach(video => {
      if (video && video !== currentVideo && Math.abs(video.currentTime - currentVideo.currentTime) > 0.1) {
        video.currentTime = currentVideo.currentTime;
      }
    });
  };

  const handleVideoEnded = () => {
    setIsPlaying(false);
    videoRefs.current.forEach(video => {
      if (video) {
        video.currentTime = 0;
      }
    });
  };

  const getColorStyle = () => {
    if (!selectedSample) return {};
    
    const color = visualizerOptions.coloringMode === 'phenotype' 
      ? selectedSample.color_phenotypic 
      : selectedSample.color;
    
    return {
      backgroundColor: `rgb(${color.r * 255}, ${color.g * 255}, ${color.b * 255})`
    };
  };

  const getContrastColor = () => {
    if (!selectedSample) return 'text-gray-800';
    
    const color = visualizerOptions.coloringMode === 'phenotype' 
      ? selectedSample.color_phenotypic 
      : selectedSample.color;
    
    // Calculate luminance using the formula: 0.299*R + 0.587*G + 0.114*B
    const luminance = 0.299 * color.r + 0.587 * color.g + 0.114 * color.b;
    
    // Return white for dark colors, black for light colors
    return luminance > 0.5 ? 'text-gray-900' : 'text-white';
  };
  
  return (
    <div className="w-96 bg-white h-screen border-l border-gray-200 overflow-y-auto flex flex-col text-gray-800 sticky top-0 right-0 shadow-md">
      {/* Header */}
      {selectedSample ? (
        <div 
          className="p-4 flex flex-col sticky top-0 z-10"
          style={{
            ...getColorStyle(),
            boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)'
          }}
        >
          <div className="flex justify-between items-start">
            <h3 className={`text-xl font-bold ${getContrastColor()}`}>
              {selectedSample.treatment.drug}
            </h3>
            <button 
              onClick={() => setSelectedSample(null)}
              className={`${getContrastColor()} opacity-80 hover:opacity-100 transition-opacity rounded-full p-1`}
              title="Close panel"
            >
              <X size={18} />
            </button>
          </div>
          
          <div className={`mt-1 flex items-center ${getContrastColor()} opacity-90`}>
            <MapPin size={14} className="mr-1" />
            <span className="text-sm">
              Position: ({selectedSample.x.toFixed(2)}, {selectedSample.y.toFixed(2)}, {selectedSample.z.toFixed(2)})
            </span>
          </div>
          
          <div className={`mt-3 flex ${getContrastColor()}`}>
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-opacity-25 bg-white">
              {selectedSample.phenotype}
            </span>
            {selectedSample.t !== undefined && (
              <span className="ml-2 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-opacity-25 bg-white">
                <Clock size={12} className="mr-1" />
                T{selectedSample.t}
              </span>
            )}
          </div>
        </div>
      ) : (
        <div className="bg-white p-4 text-gray-800 sticky top-0 z-10 border-b border-gray-200">
          <h3 className="text-lg font-semibold flex items-center">
            <Microscope size={20} className="mr-2 text-blue-600" />
            Sample Details
          </h3>
        </div>
      )}
      
      {/* Content - All combined in one panel without tabs */}
      {selectedSample ? (
        <div className="flex-1 overflow-y-auto">
          <div className="p-4 space-y-6">
            {/* Treatment Info */}
            <div>
              <h4 className="text-xl font-medium text-gray-800 mb-3 border-b border-gray-200 pb-2 flex items-center">
                <Pill size={18} className="mr-2 text-blue-600" />
                Treatment Data
              </h4>
              <div className="bg-white rounded-lg overflow-hidden shadow-sm border border-gray-200">
                <div className="grid grid-cols-2 divide-x divide-gray-200">
                  <div className="p-4 flex flex-col items-center text-center">
                    <div className="text-blue-600 mb-1">
                      <Pill size={24} />
                    </div>
                    <h5 className="text-xs uppercase font-semibold text-gray-500 mb-1">Drug</h5>
                    <div className="text-gray-800 text-sm">{selectedSample.treatment.drug.toUpperCase()}</div>
                  </div>
                  
                  <div className="p-4 flex flex-col items-center text-center">
                    <div className="text-green-600 mb-1 font-bold">μg</div>
                    <h5 className="text-xs uppercase font-semibold text-gray-500 mb-1">Dose</h5>
                    <div className="text-gray-800">{selectedSample.treatment.dose}</div>
                  </div>
                </div>
                <div className="grid grid-cols-2 divide-x divide-gray-200 border-t border-gray-200">
                  <div className="p-4 flex flex-col items-center text-center">
                    <div className="text-purple-600 mb-1">
                      <Dna size={24} />
                    </div>
                    <h5 className="text-xs uppercase font-semibold text-gray-500 mb-1">SMILES</h5>
                    <div className="text-gray-800 text-sm break-all">{selectedSample.treatment.smiles || 'N/A'}</div>
                  </div>
                  
                  <div className="p-4 flex flex-col items-center text-center">
                    <div className="text-blue-600 mb-1">
                      <Database size={24} />
                    </div>
                    <h5 className="text-xs uppercase font-semibold text-gray-500 mb-1">PubChem</h5>
                    {selectedSample.treatment.pubchem ? (
                      <a 
                        href={`https://pubchem.ncbi.nlm.nih.gov/compound/${selectedSample.treatment.pubchem}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:text-blue-800 text-sm"
                      >
                        View in PubChem
                      </a>
                    ) : (
                      <div className="text-gray-800 text-sm">N/A</div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Color Info */}
            <div>
              <h4 className="text-xl font-medium text-gray-800 mb-3 border-b border-gray-200 pb-2 flex items-center">
                <span className="text-purple-600 mr-2">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22Z" fill="currentColor" fillOpacity="0.2" />
                    <path d="M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
                Sample Colors
              </h4>
              <div className="bg-white rounded-lg overflow-hidden shadow-sm border border-gray-200">
                <div className="grid grid-cols-2 divide-x divide-gray-200">
                  <div className="p-4">
                    <h5 className="text-[10px] uppercase font-semibold text-gray-500 mb-2">Treatment Color</h5>
                    <div className="flex items-center">
                      <div 
                        className="w-10 h-10 rounded-md shadow-inner border border-gray-300"
                        style={{ 
                          backgroundColor: `rgb(${selectedSample.color.r * 255}, ${selectedSample.color.g * 255}, ${selectedSample.color.b * 255})` 
                        }}
                      ></div>
                      <div className="ml-3 text-[10px] leading-tight">
                        RGB({Math.round(selectedSample.color.r * 255)}, {Math.round(selectedSample.color.g * 255)}, {Math.round(selectedSample.color.b * 255)})
                      </div>
                    </div>
                  </div>
                  
                  <div className="p-4">
                    <h5 className="text-[10px] uppercase font-semibold text-gray-500 mb-2">Phenotypic Color</h5>
                    <div className="flex items-center">
                      <div 
                        className="w-10 h-10 rounded-md shadow-inner border border-gray-300"
                        style={{ 
                          backgroundColor: `rgb(${selectedSample.color_phenotypic.r * 255}, ${selectedSample.color_phenotypic.g * 255}, ${selectedSample.color_phenotypic.b * 255})` 
                        }}
                      ></div>
                      <div className="ml-3 text-[10px] leading-tight">
                        RGB({Math.round(selectedSample.color_phenotypic.r * 255)}, {Math.round(selectedSample.color_phenotypic.g * 255)}, {Math.round(selectedSample.color_phenotypic.b * 255)})
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Images/Videos Section */}
            {(selectedSample.videos || selectedSample.images) && (
              <div>
                <h4 className="text-xl font-medium text-gray-800 mb-3 border-b border-gray-200 pb-2 flex items-center justify-between">
                  <div className="flex items-center">
                    {selectedSample.videos ? (
                      <>
                        <Video size={18} className="mr-2 text-red-600" />
                        4D Movie
                      </>
                    ) : (
                      <>
                        <Microscope size={18} className="mr-2 text-indigo-600" />
                        Images
                      </>
                    )}
                  </div>
                  {selectedSample.videos && (
                    <button
                      onClick={togglePlayPause}
                      className="flex items-center space-x-2 px-4 py-2 bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-md hover:from-blue-700 hover:to-blue-800 transition-colors shadow"
                    >
                      {isPlaying ? (
                        <>
                          <Pause size={16} />
                          <span>Pause</span>
                        </>
                      ) : (
                        <>
                          <Play size={16} />
                          <span>Play</span>
                        </>
                      )}
                    </button>
                  )}
                </h4>
                
                {selectedSample.videos ? (
                  <div className="space-y-6">
                    {/* Videos */}
                    {selectedSample.videos.map((video, index) => (
                      <div key={index} className="bg-white rounded-lg overflow-hidden shadow-sm border border-gray-200">
                        <div className="relative pb-[75%] h-0">
                          {videoLoadError[index] ? (
                            <div className="absolute inset-0 flex items-center justify-center bg-gray-50 rounded-md">
                              <div className="text-center text-gray-500">
                                <Video size={24} className="mx-auto mb-2" />
                                <p className="text-sm">Video unavailable</p>
                              </div>
                            </div>
                          ) : (
                            <>
                              <video
                                ref={el => videoRefs.current[index] = el}
                                key={video}
                                preload="metadata"
                                className="absolute top-0 left-0 w-full h-full rounded-md object-cover"
                                onError={() => handleVideoError(index)}
                                onLoadStart={() => handleVideoLoadStart(index)}
                                onCanPlay={() => handleVideoCanPlay(index)}
                                onTimeUpdate={handleTimeUpdate}
                                onEnded={handleVideoEnded}
                                controls={false}
                              >
                                <source src={video} type="video/mp4" />
                                Your browser does not support the video tag.
                              </video>
                              {videoLoading[index] && (
                                <div className="absolute inset-0 flex items-center justify-center bg-gray-50 bg-opacity-75 rounded-md">
                                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  // Render images for 2D samples
                  <div className="grid grid-cols-1 gap-4">
                    {selectedSample.images?.map((image, index) => (
                      <div key={index} className="bg-white rounded-lg overflow-hidden shadow-sm border border-gray-200">
                        <div className="aspect-w-16 aspect-h-9 overflow-hidden">
                          <img 
                            src={image} 
                            alt={`Sample image ${index + 1}`} 
                            className="w-full h-auto object-cover transform transition-transform hover:scale-105"
                            loading="lazy"
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Color Legend */}
            <div>
              <h4 className="text-xl font-medium text-gray-800 mb-3 border-b border-gray-200 pb-2 flex items-center">
                <span className="text-purple-600 mr-2">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22Z" fill="currentColor" fillOpacity="0.2" />
                    <path d="M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
                Color Legend
              </h4>
              <div className="bg-white rounded-lg overflow-hidden shadow-sm border border-gray-200 p-3">
                <div className="flex items-center space-x-6">
                  <div className="flex items-center">
                    <div className="w-6 h-6 rounded-md mr-3" style={{ backgroundColor: 'rgb(0, 255, 0)' }}></div>
                    <span className="text-sm">MitoTracker</span>
                  </div>
                  <div className="flex items-center">
                    <div className="w-6 h-6 rounded-md mr-3" style={{ backgroundColor: 'rgb(255, 0, 255)' }}></div>
                    <span className="text-sm">TMRM</span>
                  </div>
                </div>
              </div>
            </div>
            
            {/* Metadata */}
            <div>
              <h4 className="text-xl font-medium text-gray-800 mb-3 border-b border-gray-200 pb-2 flex items-center">
                <Cpu size={18} className="mr-2 text-orange-600" />
                Metadata
              </h4>
              
              <div className="bg-white rounded-lg overflow-hidden shadow-sm border border-gray-200">
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="py-3 px-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Property</th>
                      <th className="py-3 px-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Value</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    <tr className="hover:bg-gray-50">
                      <td className="py-3 px-4 text-sm font-medium text-gray-600">Cell Line</td>
                      <td className="py-3 px-4 text-sm text-gray-800">{selectedSample.metadata.cellLine}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center p-8 text-gray-500">
          <div className="bg-white p-8 rounded-lg shadow-sm border border-gray-200 text-center max-w-xs">
            <Microscope size={48} className="mx-auto mb-4 text-blue-600" />
            <p className="text-lg font-medium text-gray-800 mb-2">No Sample Selected</p>
            <p className="text-gray-500 mb-4">
              Click on any point in the 3D space to view detailed information about that sample.
            </p>
            <div className="flex justify-center">
              <Info size={16} className="text-gray-500 mr-1" />
              <p className="text-xs text-gray-500">
                You can zoom in/out using mouse wheel or the zoom buttons.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SamplePanel;