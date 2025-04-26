import React, { useState, useRef } from 'react';
import { X, Microscope, Pill, Clock, Dna, Video, Play, Pause, Palette } from 'lucide-react';
import { useSample } from '../context/SampleContext';

const SamplePanel: React.FC = () => {
  const { selectedSample, setSelectedSample, visualizerOptions } = useSample();
  const [videoLoadError, setVideoLoadError] = useState<Record<number, boolean>>({});
  const [videoLoading, setVideoLoading] = useState<Record<number, boolean>>({});
  const [isPlaying, setIsPlaying] = useState(false);
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
  
  return (
    <div className="w-96 bg-white h-full border-l border-gray-200 overflow-y-auto">
      {/* Header */}
      <div className="bg-blue-600 text-white p-4 flex justify-between items-center sticky top-0 z-10">
        <h3 className="text-lg font-semibold flex items-center">
          <Microscope size={20} className="mr-2" />
          Sample Details
        </h3>
      </div>
      
      {/* Content */}
      {selectedSample ? (
        <div className="p-4 space-y-6">
          {/* Color Indicator */}
          <div className="bg-gray-50 p-3 rounded-md">
            <div className="flex items-center space-x-3">
              <Palette size={18} className="text-gray-500" />
              <div className="flex-grow">
                <p className="text-sm font-medium">Sample Color</p>
                <p className="text-xs text-gray-500">
                  {visualizerOptions.coloringMode === 'phenotype' ? 'By Phenotype' : 'By Treatment'}
                </p>
              </div>
              <div 
                className="w-8 h-8 rounded-full shadow-inner border border-gray-200"
                style={getColorStyle()}
              ></div>
            </div>
          </div>

          {/* Images/Videos */}
          <div>
            <h4 className="text-sm font-medium text-gray-500 uppercase mb-3 flex items-center">
              {selectedSample.videos ? (
                <>
                  <Video size={16} className="mr-2" />
                  4D Lattice Light Sheet Microscopy Movie
                </>
              ) : (
                <>
                  <Microscope size={16} className="mr-2" />
                  2D Confocal Microscopy Images
                </>
              )}
            </h4>
            <div className="space-y-4">
              {selectedSample.videos ? (
                <>
                  {/* Synchronized video controls */}
                  <div className="bg-gray-100 p-2 rounded-md flex justify-center">
                    <button
                      onClick={togglePlayPause}
                      className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition duration-150"
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
                  </div>
                  
                  {/* Videos */}
                  {selectedSample.videos.map((video, index) => (
                    <div key={index} className="bg-gray-50 p-2 rounded-md">
                      <div className="relative pb-[56.25%] h-0">
                        {videoLoadError[index] ? (
                          <div className="absolute inset-0 flex items-center justify-center bg-gray-100 rounded-md">
                            <div className="text-center text-gray-500">
                              <Video size={24} className="mx-auto mb-2" />
                              <p className="text-sm">Video failed to load</p>
                            </div>
                          </div>
                        ) : (
                          <>
                            <video
                              ref={el => videoRefs.current[index] = el}
                              key={video}
                              preload="metadata"
                              className="absolute top-0 left-0 w-full h-full rounded-md"
                              onError={() => handleVideoError(index)}
                              onLoadStart={() => handleVideoLoadStart(index)}
                              onCanPlay={() => handleVideoCanPlay(index)}
                              onTimeUpdate={handleTimeUpdate}
                              onEnded={handleVideoEnded}
                            >
                              <source src={video} type="video/mp4" />
                              Your browser does not support the video tag.
                            </video>
                            {videoLoading[index] && (
                              <div className="absolute inset-0 flex items-center justify-center bg-gray-100 bg-opacity-75 rounded-md">
                                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                      <p className="text-xs text-gray-500 mt-2 text-center">
                        Video {index + 1}
                      </p>
                    </div>
                  ))}
                </>
              ) : (
                // Render images for 2D samples
                selectedSample.images?.map((image, index) => (
                  <div key={index} className="bg-gray-50 p-2 rounded-md">
                    <img 
                      src={image} 
                      alt={`Sample image ${index + 1}`} 
                      className="w-full h-auto rounded-md shadow-sm"
                    />
                    <p className="text-xs text-gray-500 mt-1 text-center">
                      Image {index + 1}
                    </p>
                  </div>
                ))
              )}
            </div>
          </div>
          
          {/* Treatment Info */}
          <div>
            <h4 className="text-sm font-medium text-gray-500 uppercase mb-3">Drug Condition</h4>
            <div className="bg-blue-50 p-3 rounded-md space-y-3">
              <div className="flex items-start">
                <Pill className="text-blue-500 mt-0.5 mr-2 flex-shrink-0" size={18} />
                <div>
                  <p className="text-sm font-medium">Drug</p>
                  <p className="text-sm text-gray-700">{selectedSample.treatment.drug}</p>
                </div>
              </div>
              
              <div className="flex items-start">
                <span className="text-blue-500 mr-2 flex-shrink-0 font-bold text-xs mt-1">μg</span>
                <div>
                  <p className="text-sm font-medium">Dose</p>
                  <p className="text-sm text-gray-700">{selectedSample.treatment.dose}</p>
                </div>
              </div>
              
              <div className="flex items-start">
                <Clock className="text-blue-500 mt-0.5 mr-2 flex-shrink-0" size={18} />
                <div>
                  <p className="text-sm font-medium">Treatment Time</p>
                  <p className="text-sm text-gray-700">{selectedSample.treatment.time}</p>
                </div>
              </div>
            </div>
          </div>
          
          {/* Only show metadata section if there are metadata fields */}
          {Object.keys(selectedSample.metadata).length > 0 && (
            <div>
              <h4 className="text-sm font-medium text-gray-500 uppercase mb-3 flex items-center">
                <Dna size={16} className="mr-1" />
                Additional Metadata
              </h4>
              <div className="bg-gray-50 p-3 rounded-md">
                <div className="space-y-2">
                  {Object.entries(selectedSample.metadata).map(([key, value]) => (
                    <div key={key} className="flex justify-between border-b border-gray-100 pb-1 last:border-0 last:pb-0">
                      <p className="text-sm font-medium">{key.charAt(0).toUpperCase() + key.slice(1)}</p>
                      <p className="text-sm text-gray-700">{value}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="p-8 flex flex-col items-center justify-center text-gray-500">
          <Microscope size={48} className="mb-4 text-gray-400" />
          <p className="text-center">
            Click on a point in the visualization to view sample details
          </p>
        </div>
      )}
    </div>
  );
};

export default SamplePanel;