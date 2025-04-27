import React from 'react';
import { Microscope } from 'lucide-react';
import { Link } from 'react-router-dom';

const Header: React.FC = () => {
  return (
    <header className="bg-white border-b border-gray-200 text-gray-800 shadow-sm">
      <div className="container mx-auto py-3 pl-1">
        <div className="flex items-center justify-between">
          <Link to="/" className="flex items-center gap-3">
            <Microscope size={24} className="text-blue-600" />
            <h1 className="text-2xl font-bold">MitoSpace Explorer</h1>
          </Link>
          
          <nav>
            <ul className="flex space-x-6">
              <li>
                <Link to="/" className="text-gray-600 hover:text-blue-600 transition duration-300 text-sm font-medium">
                  Dashboard
                </Link>
              </li>
              <li>
                <Link to="/about" className="text-gray-600 hover:text-blue-600 transition duration-300 text-sm font-medium">
                  About
                </Link>
              </li>
            </ul>
          </nav>
        </div>
      </div>
    </header>
  );
};

export default Header