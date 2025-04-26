import React from 'react';

const Footer: React.FC = () => {
  return (
    <footer className="bg-gray-800 text-gray-300">
      <div className="container mx-auto px-4 py-6">
        <div className="flex flex-col md:flex-row justify-between items-center">
          <div className="mb-4 md:mb-0">
            <h3 className="text-white font-semibold text-lg">MitoSpace Explorer</h3>
            <p className="text-gray-400 text-sm">Advanced visualizations for mitochondrial phenotypes</p>
          </div>
          
          <div className="flex space-x-6">
            <a href="#" className="text-gray-400 hover:text-white transition duration-150">
              Contact
            </a>
          </div>
        </div>
        
        <div className="mt-6 pt-4 border-t border-gray-700 text-center text-gray-500 text-sm">
          © 2025 MitoSpace Explorer. All rights reserved.
        </div>
      </div>
    </footer>
  );
};

export default Footer;