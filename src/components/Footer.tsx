import React from 'react';

const Footer: React.FC = () => {
  return (
    <footer className="bg-white text-gray-600 border-t border-gray-200">
      <div className="container mx-auto px-4 py-2">
        <div className="flex justify-center items-center">
          <p className="text-gray-500 text-xs">
            © 2025 MitoSpace Explorer | Advanced visualizations for mitochondrial phenotypes
          </p>
        </div>
      </div>
    </footer>
  );
};

export default Footer;