import React, { useState, useRef } from 'react';
import { X, Microscope, Pill, Clock, Dna, Video, Play, Pause } from 'lucide-react';
import { useSample } from '../context/SampleContext';

const SamplePanel: React.FC = () => {
  const { selectedSample, closeModal } = useSample();
  const [videoLoadError, setVideoLoadError] = useState<Record<number, boolean>>({});
  const [videoLoading, setVideoLoading] = useState<Record<number, boolean>>({});
  const [isPlaying, setIsPlaying] = useState(false);
  const videoRefs = useRef<(HTMLVideoElement | null)[]>([]);
  
  if (!selectedSample) return null;

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
  
  return (
    <div className="w-96 bg-white h-full border-l border-gray-200 overflow-y-auto">
      {/* Header */}
      <div className="bg-blue-600 text-white p-4 flex justify-between items-center sticky top-0 z-10">
        <h3 className="text-lg font-semibold flex items-center">
          <Microscope size={20} className="mr-2" />
          Sample Details
        </h3>
        <button 
          onClick={closeModal}
          className="text-white hover:text-blue-200 focus:outline-none transition duration-150"
        >
          <X size={20} />
        </button>
      </div>
      
      {/* Content */}
      <div className="p-4 space-y-6">
        {/* Images/Videos */}
        <div>
          <h4 className="text-sm font-medium text-gray-500 uppercase mb-3 flex items-center">
            {selectedSample.videos ? (
              <>
                <Video size={16} className="mr-2" />
                Time-lapse Videos
              </>
            ) : (
              <>
                <Microscope size={16} className="mr-2" />
                Microscopy Images
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
                      Video {index + 1} - Sample {selectedSample.id}
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
                    alt={`Sample ${selectedSample.id} image ${index + 1}`} 
                    className="w-full h-auto rounded-md shadow-sm"
                  />
                  <p className="text-xs text-gray-500 mt-1 text-center">
                    Image {index + 1} - Sample {selectedSample.id}
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
        
        {/* Sample Info */}
        <div>
          <h4 className="text-sm font-medium text-gray-500 uppercase mb-3">Sample Properties</h4>
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-gray-50 p-3 rounded-md">
              <p className="text-sm font-medium">ID</p>
              <p className="text-sm text-gray-700">{selectedSample.id}</p>
            </div>
            
            <div className="bg-gray-50 p-3 rounded-md">
              <p className="text-sm font-medium">Phenotype</p>
              <div className="flex items-center mt-1">
                <span 
                  className="w-3 h-3 rounded-full mr-2"
                  style={{ backgroundColor: getPhenotypeColorHex(selectedSample.phenotype) }}
                ></span>
                <p className="text-sm text-gray-700">{selectedSample.phenotype}</p>
              </div>
            </div>
            
            <div className="col-span-2 bg-gray-50 p-3 rounded-md">
              <p className="text-sm font-medium">Coordinates</p>
              <div className="grid grid-cols-3 gap-2 mt-1">
                <p className="text-sm text-gray-700">X: {selectedSample.x.toFixed(2)}</p>
                <p className="text-sm text-gray-700">Y: {selectedSample.y.toFixed(2)}</p>
                <p className="text-sm text-gray-700">Z: {selectedSample.z.toFixed(2)}</p>
                {selectedSample.t !== undefined && (
                  <p className="text-sm text-gray-700">T: {selectedSample.t}</p>
                )}
              </div>
            </div>
          </div>
        </div>
        
        {/* Metadata */}
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
      </div>
    </div>
  );
};

// Helper function to get phenotype colors
function getPhenotypeColorHex(phenotype: string): string {
  switch (phenotype) {
    case 'Normal': return '#3b82f6'; // blue
    case 'Fragmented': return '#ef4444'; // red
    case 'Swollen': return '#f59e0b'; // amber
    case 'Perinuclear': return '#10b981'; // emerald
    case 'Hyperfused': return '#8b5cf6'; // violet
    default: return '#6b7280'; // gray
  }
}

export default SamplePanel;