import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Microscope, Code, Users, ExternalLink } from 'lucide-react';
import Header from './Header';
import Footer from './Footer';

const About: React.FC = () => {
  return (
    <div className="min-h-screen flex flex-col bg-black">
      <Header />
      <main className="flex-grow">
        <div className="max-w-[1920px] mx-auto px-6 sm:px-8 lg:px-12">
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-white/60 hover:text-white font-medium text-base mt-6 mb-8 transition-colors group"
          >
            <ArrowLeft size={18} className="group-hover:-translate-x-0.5 transition-transform" />
            Back to Explorer
          </Link>

          {/* Hero */}
          <section className="py-12 lg:py-20 border-b border-white/[0.06]">
            <div className="max-w-4xl">
              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-semibold text-white tracking-tight mb-6">
                About MitoSpace Explorer
              </h1>
              <p className="text-xl sm:text-2xl text-white/60 leading-relaxed max-w-2xl">
                An interactive platform for visualizing mitochondrial morphology and its dynamic response to drug treatments. Explore structure and behavior across space and time.
              </p>
            </div>
          </section>

          {/* Overview */}
          <section className="py-16 lg:py-24 grid lg:grid-cols-[auto_1fr] gap-12 lg:gap-16 items-start border-b border-white/[0.06]">
            <div className="flex items-center justify-center w-16 h-16 rounded-2xl bg-white/[0.06] border border-white/[0.08] shrink-0">
              <Microscope size={28} className="text-white/90" strokeWidth={1.5} />
            </div>
            <div>
              <h2 className="text-2xl sm:text-3xl font-semibold text-white tracking-tight mb-6">Overview</h2>
              <div className="space-y-5 text-white/70 text-lg sm:text-xl leading-relaxed">
                <p>
                  MitoSpace Explorer enables users to explore both <span className="text-white/90 font-medium">2D MitoSpace</span>, trained on confocal microscopy images, and <span className="text-white/90 font-medium">4D MitoSpace</span>, trained on time-resolved Lattice Light-Sheet Microscopy (LLSM) movies.
                </p>
                <p>
                  Together, they offer a unique window into mitochondrial structure and behavior—from static snapshots to dynamic, time-resolved trajectories.
                </p>
              </div>
            </div>
          </section>

          {/* Technology */}
          <section className="py-16 lg:py-24 grid lg:grid-cols-[auto_1fr] gap-12 lg:gap-16 items-start border-b border-white/[0.06]">
            <div className="flex items-center justify-center w-16 h-16 rounded-2xl bg-white/[0.06] border border-white/[0.08] shrink-0">
              <Code size={28} className="text-white/90" strokeWidth={1.5} />
            </div>
            <div>
              <h2 className="text-2xl sm:text-3xl font-semibold text-white tracking-tight mb-6">Technology</h2>
              <div className="space-y-6 text-white/70 text-lg sm:text-xl leading-relaxed">
                <p>
                  MitoSpace Explorer combines advanced microscopy with self-supervised deep learning to map mitochondrial morphologies into interpretable embeddings.
                </p>
                <div className="grid sm:grid-cols-2 gap-6">
                  <div className="p-6 rounded-xl bg-white/[0.03] border border-white/[0.06]">
                    <h3 className="text-white font-medium mb-2 text-lg">2D MitoSpace</h3>
                    <p className="text-base text-white/60">
                      High-resolution confocal microscopy and deep learning for static mitochondrial morphology mapping.
                    </p>
                  </div>
                  <div className="p-6 rounded-xl bg-white/[0.03] border border-white/[0.06]">
                    <h3 className="text-white font-medium mb-2 text-lg">4D MitoSpace</h3>
                    <p className="text-base text-white/60">
                      LLSM time-lapse movies with AI to create a time-resolved mitochondrial atlas.
                    </p>
                  </div>
                </div>
                <p className="text-base text-white/50">
                  Both spaces were trained on Cal27 cell lines across 25 drug conditions. Data shown here is downsampled for web performance—contact us for full-resolution access.
                </p>
              </div>
            </div>
          </section>

          {/* Acknowledgments */}
          <section className="py-16 lg:py-24 grid lg:grid-cols-[auto_1fr] gap-12 lg:gap-16 items-start">
            <div className="flex items-center justify-center w-16 h-16 rounded-2xl bg-white/[0.06] border border-white/[0.08] shrink-0">
              <Users size={28} className="text-white/90" strokeWidth={1.5} />
            </div>
            <div>
              <h2 className="text-2xl sm:text-3xl font-semibold text-white tracking-tight mb-6">Acknowledgments</h2>
              <p className="text-white/70 text-lg sm:text-xl leading-relaxed mb-6">
                Dhruv Agarwal*, Zichen Wang*, Parth Natekar*, Hiroyuki Hakozaki, Andre Modolo, Mehul Arora, Siddharth Nahar, Manav Doshi, Gillian McMahon, and Johannes Schöneberg
              </p>
              <a
                href="https://www.schoeneberglab.org/team"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-white/10 hover:bg-white/15 text-white font-medium text-base transition-colors border border-white/[0.08]"
              >
                Schöneberg Lab
                <ExternalLink size={14} className="opacity-70" />
              </a>
            </div>
          </section>
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default About;
