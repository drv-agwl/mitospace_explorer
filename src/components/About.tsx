import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Microscope, Code, Users } from 'lucide-react';

const About: React.FC = () => {
  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-white">
      <div className="container mx-auto px-4 py-12">
        <Link to="/" className="inline-flex items-center text-blue-600 hover:text-blue-700 mb-8 transition-colors duration-200">
          <ArrowLeft size={20} className="mr-2" />
          Back to Explorer
        </Link>
        
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-12">
            <h1 className="text-4xl font-bold text-blue-600 mb-4">About MitoSpace Explorer</h1>
            <p className="text-gray-500 text-lg">Exploring mitochondrial morphology through advanced visualization</p>
          </div>
          
          <div className="grid gap-8">
            <section className="bg-white rounded-xl shadow-sm p-8 border border-gray-100 hover:shadow-md transition-shadow duration-200">
              <div className="flex items-center mb-4">
                <Microscope size={24} className="text-blue-500 mr-3" />
                <h2 className="text-2xl font-semibold text-gray-800">Overview</h2>
              </div>
              <p className="text-gray-600 leading-relaxed">
                MitoSpace Explorer is an interactive platform for visualizing mitochondrial morphology and its dynamic response to drug treatments. It enables users to explore both 2D MitoSpace, trained on confocal microscopy images, and 4D MitoSpace, trained on time-resolved Lattice Light-Sheet Microscopy (LLSM) movies. Together, they offer a unique window into mitochondrial structure and behavior across space and time.
              </p>
            </section>
            
            <section className="bg-white rounded-xl shadow-sm p-8 border border-gray-100 hover:shadow-md transition-shadow duration-200">
              <div className="flex items-center mb-4">
                <Code size={24} className="text-blue-500 mr-3" />
                <h2 className="text-2xl font-semibold text-gray-800">Technology</h2>
              </div>
              <div className="space-y-4 text-gray-600 leading-relaxed">
                <p>
                  MitoSpace Explorer is built on the fusion of two cutting-edge technologies: advanced microscopy and self-supervised deep learning.
                </p>
                <div className="pl-4 border-l-2 border-blue-100 space-y-3">
                  <p>
                    <span className="font-medium text-gray-700">2D MitoSpace</span> was developed using high-resolution confocal microscopy images combined with deep learning models to map mitochondrial morphologies.
                  </p>
                  <p>
                    <span className="font-medium text-gray-700">4D MitoSpace</span> leverages Lattice Light-Sheet Microscopy (LLSM) to capture mitochondrial dynamics in four dimensions, combined with state-of-the-art AI to create a time-resolved atlas of mitochondrial phenotypes.
                  </p>
                </div>
                <p>
                  Both spaces were trained on data collected from Cal27 cell lines treated across 25 different drug conditions, enabling the model to capture a wide spectrum of mitochondrial behaviors under various perturbations.
                </p>
                <p>
                  To ensure smooth and fast performance on the website, the data you see here has been downsampled and compressed compared to the original high-quality datasets used for training. If you are interested in accessing the full-resolution data, please feel free to contact us.
                </p>
                <p>
                  The MitoSpace Explorer's integrated 3D visualizer lets you navigate through this phenotypic space, exploring how mitochondrial structures cluster and change based on different treatments. Whether you're a researcher, student, or simply curious, MitoSpace offers an accessible yet powerful way to interact with complex biological data.
                </p>
                <p>
                  We are actively working to expand MitoSpace by adding more cell lines, drug conditions, and extending the atlas to organoid models in the future.
                </p>
              </div>
            </section>
            
            <section className="bg-white rounded-xl shadow-sm p-8 border border-gray-100 hover:shadow-md transition-shadow duration-200">
              <div className="flex items-center mb-4">
                <Users size={24} className="text-blue-500 mr-3" />
                <h2 className="text-2xl font-semibold text-gray-800">Acknowledgments</h2>
              </div>
              <p className="text-gray-600 leading-relaxed">
                This work was done by Dhruv Agarwal*, Zichen Wang*, Parth Natekar*, Hiroyuki Hakozaki, Andre Modolo, Mehul Arora, Siddharth Nahar, Manav Doshi, Gillian McMahon, and Johannes Schöneberg from the{' '}
                <a 
                  href="https://www.schoeneberglab.org/team" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:text-blue-700 underline transition-colors duration-200"
                >
                  Schöneberg Lab
                </a>.
              </p>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
};

export default About;