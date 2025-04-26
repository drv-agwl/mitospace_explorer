import React from 'react';

const Footer: React.FC = () => {
  return (
    <footer className="bg-white text-gray-600 border-t border-gray-200">
      <div className="container mx-auto px-4 py-2">
        <div className="flex justify-between items-center">
          <p className="text-gray-500 text-xs">
            © 2025 MitoSpace Explorer | Advanced visualizations for mitochondrial phenotypes
          </p>
          
          <div className="flex space-x-4">
            <a href="#" className="text-gray-500 hover:text-blue-600 transition duration-150 text-xs">
              Contact
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;