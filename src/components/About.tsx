import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Microscope, Code, Users } from 'lucide-react';
import Header from './Header';
import Footer from './Footer';

const About: React.FC = () => {
  return (
    <div className="min-h-screen flex flex-col bg-black">
      <Header />
      <main className="flex-grow">
        <div className="max-w-3xl mx-auto px-6 py-12">
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-white/80 hover:text-white font-medium text-sm mb-10 transition-colors"
          >
            <ArrowLeft size={18} />
            Back to Explorer
          </Link>

          <div className="space-y-12">
            <div className="text-center">
              <h1 className="text-3xl font-semibold text-white tracking-tight mb-3">
                About MitoSpace Explorer
              </h1>
              <p className="text-white/60 text-lg">
                Exploring mitochondrial morphology through interactive visualization
              </p>
            </div>

            <section className="card p-8">
              <div className="flex items-start gap-4 mb-6">
                <div className="w-12 h-12 rounded-xl bg-white/10 flex items-center justify-center shrink-0">
                  <Microscope size={24} className="text-white" />
                </div>
                <div>
                  <h2 className="text-xl font-semibold text-white mb-2">Overview</h2>
                  <p className="text-white/70 leading-relaxed">
                    MitoSpace Explorer is an interactive platform for visualizing mitochondrial morphology and its dynamic response to drug treatments. It enables users to explore both 2D MitoSpace, trained on confocal microscopy images, and 4D MitoSpace, trained on time-resolved Lattice Light-Sheet Microscopy (LLSM) movies. Together, they offer a unique window into mitochondrial structure and behavior across space and time.
                  </p>
                </div>
              </div>
            </section>

            <section className="card p-8">
              <div className="flex items-start gap-4 mb-6">
                <div className="w-12 h-12 rounded-xl bg-white/10 flex items-center justify-center shrink-0">
                  <Code size={24} className="text-white" />
                </div>
                <div>
                  <h2 className="text-xl font-semibold text-white mb-2">Technology</h2>
                  <div className="space-y-4 text-white/70 leading-relaxed">
                    <p>
                      MitoSpace Explorer combines advanced microscopy with self-supervised deep learning.
                    </p>
                    <div className="pl-4 border-l-2 border-white/20 space-y-3">
                      <p>
                        <span className="font-medium text-white/90">2D MitoSpace</span> uses high-resolution confocal microscopy images and deep learning to map mitochondrial morphologies.
                      </p>
                      <p>
                        <span className="font-medium text-white/90">4D MitoSpace</span> leverages Lattice Light-Sheet Microscopy (LLSM) to capture mitochondrial dynamics in four dimensions, combined with AI to create a time-resolved atlas.
                      </p>
                    </div>
                    <p>
                      Both spaces were trained on data from Cal27 cell lines treated across 25 drug conditions, capturing a wide spectrum of mitochondrial behaviors.
                    </p>
                    <p>
                      The data shown here has been downsampled for web performance. Contact us for full-resolution access.
                    </p>
                  </div>
                </div>
              </div>
            </section>

            <section className="card p-8">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-xl bg-white/10 flex items-center justify-center shrink-0">
                  <Users size={24} className="text-white" />
                </div>
                <div>
                  <h2 className="text-xl font-semibold text-white mb-2">Acknowledgments</h2>
                  <p className="text-white/70 leading-relaxed">
                    Dhruv Agarwal*, Zichen Wang*, Parth Natekar*, Hiroyuki Hakozaki, Andre Modolo, Mehul Arora, Siddharth Nahar, Manav Doshi, Gillian McMahon, and Johannes Schöneberg —{' '}
                    <a
                      href="https://www.schoeneberglab.org/team"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-white hover:text-white/80 font-medium"
                    >
                      Schöneberg Lab
                    </a>
                  </p>
                </div>
              </div>
            </section>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default About;
