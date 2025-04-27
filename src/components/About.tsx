import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Microscope, Code, Zap, Rocket, Award, Users } from 'lucide-react';

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
                MitoSpace Explorer is an interactive platform for visualizing mitochondrial morphology and its response to drug treatments. It allows users to explore both 2D MitoSpace, trained on confocal microscopy images, and 4D MitoSpace, trained on time-resolved light sheet microscopy (LLSM) movies, offering a unique view into mitochondrial structure and dynamics.
              </p>
            </section>
            
            <section className="bg-white rounded-xl shadow-sm p-8 border border-gray-100 hover:shadow-md transition-shadow duration-200">
              <div className="flex items-center mb-4">
                <Code size={24} className="text-blue-500 mr-3" />
                <h2 className="text-2xl font-semibold text-gray-800">Technology</h2>
              </div>
              <p className="text-gray-600 leading-relaxed">
                The explorer is powered by self-supervised learning models trained on Cal27 cell lines under 25 different drug conditions, capturing a wide range of mitochondrial behaviors. By combining advanced data analysis with rich biological datasets, MitoSpace reveals the subtle and dramatic phenotypic changes within cells.
              </p>
            </section>
            
            <section className="bg-white rounded-xl shadow-sm p-8 border border-gray-100 hover:shadow-md transition-shadow duration-200">
              <div className="flex items-center mb-4">
                <Zap size={24} className="text-blue-500 mr-3" />
                <h2 className="text-2xl font-semibold text-gray-800">Features</h2>
              </div>
              <p className="text-gray-600 leading-relaxed">
                3D Visualizer: Explore mitochondrial space in three dimensions and discover how different phenotypes cluster based on morphology and treatment.
              </p>
            </section>
            
            <section className="bg-white rounded-xl shadow-sm p-8 border border-gray-100 hover:shadow-md transition-shadow duration-200">
              <div className="flex items-center mb-4">
                <Award size={24} className="text-blue-500 mr-3" />
                <h2 className="text-2xl font-semibold text-gray-800">Scientific Impact</h2>
              </div>
              <p className="text-gray-600 leading-relaxed">
                MitoSpace Explorer provides a new way to study mitochondrial biology, offering insights into drug responses, disease mechanisms, and cell behavior across time and space.
              </p>
            </section>
            
            <section className="bg-white rounded-xl shadow-sm p-8 border border-gray-100 hover:shadow-md transition-shadow duration-200">
              <div className="flex items-center mb-4">
                <Rocket size={24} className="text-blue-500 mr-3" />
                <h2 className="text-2xl font-semibold text-gray-800">Future Plans</h2>
              </div>
              <p className="text-gray-600 leading-relaxed">
                We are working to scale up MitoSpace by adding more cell lines, drug treatments, and expanding into organoid models.
              </p>
            </section>
            
            <section className="bg-white rounded-xl shadow-sm p-8 border border-gray-100 hover:shadow-md transition-shadow duration-200">
              <div className="flex items-center mb-4">
                <Users size={24} className="text-blue-500 mr-3" />
                <h2 className="text-2xl font-semibold text-gray-800">Acknowledgments</h2>
              </div>
              <p className="text-gray-600 leading-relaxed">
                Special thanks to the{' '}
                <a 
                  href="https://www.schoeneberglab.org/team" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:text-blue-700 underline transition-colors duration-200"
                >
                  Schöneberg Lab Team
                </a>
                {' '}for their contributions to the development of MitoSpace Explorer.
              </p>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
};

export default About;