import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

const About: React.FC = () => {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-4 py-8">
        <Link to="/" className="inline-flex items-center text-blue-600 hover:text-blue-700 mb-8">
          <ArrowLeft size={20} className="mr-2" />
          Back to Explorer
        </Link>
        
        <div className="prose prose-lg max-w-none">
          <h1 className="text-4xl font-bold text-blue-600 mb-8">About MitoSpace Explorer</h1>
          
          <section className="mb-12">
            <h2 className="text-2xl font-semibold text-blue-600 mb-4">Overview</h2>
            <p className="text-gray-600 mb-4">
              Welcome to MitoSpace Explorer, an interactive platform that allows you to explore the fascinating world of mitochondrial morphology and its response to drug treatments. MitoSpace is a self-supervised deep learning atlas that maps the phenotypic changes of mitochondria over time, giving researchers and enthusiasts a unique way to visualize and interact with complex 4D cellular data.
            </p>
            <p className="text-gray-600">
              Our goal is to provide a user-friendly, visual interface for anyone interested in understanding how mitochondria behave in response to various conditions, including drug treatments. MitoSpace Explorer enables you to dive deep into the intricate dynamics of mitochondrial morphology and temporal changes, all within a highly interactive and engaging 3D space.
            </p>
          </section>
          
          <section className="mb-12">
            <h2 className="text-2xl font-semibold text-blue-600 mb-4">Technology Behind MitoSpace</h2>
            <p className="text-gray-600">
              MitoSpace Explorer is powered by cutting-edge machine learning techniques, including self-supervised learning models and 4D data processing. Built using technologies like PyTorch and transformer-based architectures, MitoSpace uses advanced algorithms to analyze and interpret mitochondrial data, allowing us to generate detailed maps of mitochondrial morphology and changes over time.
            </p>
            <p className="text-gray-600">
              The data you see is derived from real-world experimental results, capturing how mitochondria respond to drug-induced changes. This dynamic, multidimensional dataset offers a rare glimpse into the behavior of mitochondria at the cellular level.
            </p>
          </section>
          
          <section className="mb-12">
            <h2 className="text-2xl font-semibold text-blue-600 mb-4">Scientific Impact</h2>
            <p className="text-gray-600">
              MitoSpace Explorer is more than just a visualization tool—it's a resource for scientific discovery. By enabling users to interact with 4D mitochondrial data, we aim to accelerate research in mitochondrial biology, drug development, and disease understanding. The insights gained from MitoSpace can contribute to identifying new drug targets, understanding mitochondrial dysfunction in diseases, and improving our overall understanding of cellular processes.
            </p>
            <p className="text-gray-600">
              This platform is intended for researchers, students, and anyone with an interest in cellular biology, offering a novel way to interact with complex scientific data.
            </p>
          </section>
          
          <section className="mb-12">
            <h2 className="text-2xl font-semibold text-blue-600 mb-4">Interactive Features</h2>
            <ul className="list-disc pl-6 text-gray-600 space-y-2">
              <li>3D Visualization: View mitochondrial data from multiple angles and zoom levels to gain a detailed understanding of its structure and behavior.</li>
              <li>Temporal Exploration: Explore the time-based changes in mitochondrial morphology in response to different conditions or treatments.</li>
              <li>Data Slicing: Slice through different dimensions of the data to view specific sections or time points.</li>
              <li>Analysis Tools: Utilize advanced tools to analyze the data and explore relationships between morphology, time, and drug treatments.</li>
            </ul>
          </section>
          
          <section className="mb-12">
            <h2 className="text-2xl font-semibold text-blue-600 mb-4">Future Developments</h2>
            <p className="text-gray-600">
              MitoSpace Explorer is continually evolving. We're working on adding more datasets, refining the interactive tools, and expanding the platform's capabilities to help you get the most out of your exploration. Stay tuned for upcoming updates and new features designed to make this platform even more powerful.
            </p>
          </section>
          
          <section>
            <h2 className="text-2xl font-semibold text-blue-600 mb-4">Acknowledgments</h2>
            <p className="text-gray-600">
              MitoSpace Explorer is the result of a collaborative effort between researchers, developers, and institutions. We would like to thank the teams behind the data collection and the development of the underlying machine learning models that made this platform possible.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
};

export default About;